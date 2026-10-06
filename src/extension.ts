import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { ChatViewProvider, type ChatAction } from './chatView';
import {
  ChangesTree,
  HeadContentProvider,
  HEAD_SCHEME,
  openDiff,
  openFile,
} from './changes';
import {
  compareVersions,
  detectAvailablePackageManagers,
  detectFreebuff,
  fetchLatestVersion,
  firstWorkspaceRoot,
  installCommandFor,
  sanitizePrompt,
  type PackageManager,
} from './freebuff';
import { FreebuffTerminal } from './terminal';

function resolveFsPath(argument: unknown): string | undefined {
  if (typeof argument === 'string') {
    return argument;
  }
  if (argument && typeof argument === 'object') {
    const candidate = argument as {
      fsPath?: unknown;
      id?: unknown;
      resourceUri?: { fsPath?: unknown };
    };
    if (typeof candidate.fsPath === 'string') {
      return candidate.fsPath;
    }
    if (typeof candidate.id === 'string') {
      return candidate.id;
    }
    if (typeof candidate.resourceUri?.fsPath === 'string') {
      return candidate.resourceUri.fsPath;
    }
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const configuration = (): vscode.WorkspaceConfiguration =>
    vscode.workspace.getConfiguration('freebuff');
  const root = (): string | undefined => firstWorkspaceRoot(vscode.workspace.workspaceFolders);
  const executable = (): string => configuration().get<string>('executable', '').trim() || 'freebuff';

  const output = vscode.window.createOutputChannel('Freebuff');
  const changes = new ChangesTree();
  const headContent = new HeadContentProvider();
  const terminal = new FreebuffTerminal(configuration, root);

  const statusItem = vscode.window.createStatusBarItem(
    'freebuff.status',
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusItem.command = 'freebuff.check';

  const refreshStatus = async (): Promise<void> => {
    const info = await detectFreebuff(executable());
    if (info.installed) {
      statusItem.text = `$(hubot) Freebuff ${info.version ?? ''}`.trim();
      statusItem.tooltip = info.binPath
        ? `Freebuff ${info.version ?? ''} — ${info.binPath}`
        : 'Freebuff CLI';
    } else {
      statusItem.text = '$(warning) Freebuff: not installed';
      statusItem.tooltip = 'Freebuff CLI was not found. Run "Freebuff: Install or Update".';
    }
    statusItem.show();
    chat.post({
      type: 'status',
      text: info.installed ? `Freebuff ${info.version ?? ''}`.trim() : 'Freebuff not installed',
      tone: info.installed ? 'ok' : 'error',
    });
  };

  const chat = new ChatViewProvider({
    onSend: (text) => {
      void handleSend(text);
    },
    onAction: (action) => {
      void handleAction(action);
    },
  });

  const handleSend = async (raw: string): Promise<void> => {
    const text = sanitizePrompt(raw);
    if (!text) {
      return;
    }
    changes.beginSession(root());
    chat.post({ type: 'echo', text });
    chat.post({ type: 'status', text: 'Sending…', tone: 'busy' });
    try {
      const result = await terminal.sendPrompt(text);
      chat.post({
        type: 'status',
        text: 'Sent — the reply appears in the terminal',
        tone: 'ok',
      });
      if (result.freshStart) {
        chat.post({
          type: 'note',
          text: 'Freebuff was (re)started in the integrated terminal; the first prompt waited for it to boot.',
        });
      }
    } catch (error) {
      chat.post({ type: 'error', text: String(error) });
    }
    void refreshStatus();
  };

  const handleAction = async (action: ChatAction): Promise<void> => {
    switch (action) {
      case 'start':
        terminal.show();
        break;
      case 'restart':
        terminal.restart();
        chat.post({ type: 'note', text: 'Freebuff restarted in the integrated terminal.' });
        break;
      case 'continue':
        terminal.show(['--continue']);
        chat.post({ type: 'note', text: 'Continuing the last conversation in the terminal.' });
        break;
      case 'check':
        await checkInstallation();
        break;
    }
  };

  const install = async (): Promise<void> => {
    const managers = await detectAvailablePackageManagers();
    if (managers.length === 0) {
      void vscode.window.showErrorMessage(
        'No package manager found (npm, bun, pnpm or yarn). Install one, then retry.',
      );
      return;
    }
    const configured = configuration().get<string>('packageManager', '');
    let manager: PackageManager | undefined = managers.includes(configured as PackageManager)
      ? (configured as PackageManager)
      : undefined;
    if (!manager && managers.length > 1) {
      const picked = await vscode.window.showQuickPick(
        managers.map((pm) => ({ label: pm })),
        { placeHolder: 'Choose a package manager to install Freebuff' },
      );
      manager = picked ? (picked.label as PackageManager) : undefined;
    }
    manager ??= managers[0];
    if (!manager) {
      return;
    }

    const command = installCommandFor(manager);
    output.clear();
    output.show(true);
    output.appendLine(`$ ${command}\n`);
    const child = spawn(command, { shell: true, cwd: root(), windowsHide: true });
    child.stdout?.on('data', (chunk: Buffer) => output.append(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => output.append(chunk.toString()));
    child.on('close', (code) => {
      output.appendLine(code === 0 ? '\nDone.' : `\nFailed with exit code ${String(code)}.`);
      if (code === 0) {
        void vscode.window.showInformationMessage('Freebuff installed. Ready to run.');
      }
      void refreshStatus();
    });
    child.on('error', (error) => {
      output.appendLine(`\n${String(error)}`);
    });
  };

  const checkInstallation = async (): Promise<void> => {
    chat.post({ type: 'status', text: 'Checking Freebuff…', tone: 'busy' });
    const info = await detectFreebuff(executable());
    if (!info.installed) {
      chat.post({ type: 'status', text: 'Freebuff not installed', tone: 'error' });
      const choice = await vscode.window.showWarningMessage(
        'Freebuff CLI is not installed yet.',
        'Install',
        'Open Website',
      );
      if (choice === 'Install') {
        await install();
      } else if (choice === 'Open Website') {
        await vscode.env.openExternal(vscode.Uri.parse('https://freebuff.com'));
      }
      return;
    }

    const latest = await fetchLatestVersion();
    if (latest && info.version && compareVersions(info.version, latest) < 0) {
      chat.post({
        type: 'note',
        text: `Update available: ${info.version} → ${latest}`,
      });
      const choice = await vscode.window.showInformationMessage(
        `Freebuff ${info.version} is installed; ${latest} is available.`,
        'Update',
        'Later',
      );
      if (choice === 'Update') {
        await install();
      }
      return;
    }

    chat.post({ type: 'status', text: `Freebuff ${info.version ?? ''}`.trim(), tone: 'ok' });
    const choice = await vscode.window.showInformationMessage(
      `Freebuff ${info.version ?? ''} is up to date.`.trim(),
      'Start Freebuff',
    );
    if (choice === 'Start Freebuff') {
      terminal.show();
    }
    void refreshStatus();
  };

  const watchers: vscode.FileSystemWatcher[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '**/*'),
    );
    watcher.onDidCreate((uri) => changes.record(uri, 'created', root()));
    watcher.onDidChange((uri) => changes.record(uri, 'modified', root()));
    watcher.onDidDelete((uri) => changes.record(uri, 'deleted', root()));
    watchers.push(watcher);
  }

  context.subscriptions.push(
    output,
    changes,
    terminal,
    statusItem,
    ...watchers,
    vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, headContent),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.createTreeView('freebuff.changes', { treeDataProvider: changes }),
    vscode.commands.registerCommand('freebuff.start', () => {
      terminal.show();
      void refreshStatus();
    }),
    vscode.commands.registerCommand('freebuff.continue', () => {
      terminal.show(['--continue']);
      void refreshStatus();
    }),
    vscode.commands.registerCommand('freebuff.restart', () => {
      terminal.restart();
      void refreshStatus();
    }),
    vscode.commands.registerCommand('freebuff.sendPrompt', async () => {
      const text = await vscode.window.showInputBox({
        prompt: 'Message for Freebuff',
        placeHolder: 'Describe the task…',
      });
      if (text) {
        await handleSend(text);
      }
    }),
    vscode.commands.registerCommand('freebuff.check', () => checkInstallation()),
    vscode.commands.registerCommand('freebuff.install', () => install()),
    vscode.commands.registerCommand('freebuff.clearChanges', () => changes.clear()),
    vscode.commands.registerCommand('freebuff.openChange', async (argument: unknown) => {
      const fsPath = resolveFsPath(argument) ?? (await pickChange(changes));
      if (fsPath) {
        await openFile(fsPath);
      }
    }),
    vscode.commands.registerCommand('freebuff.diffChange', async (argument: unknown) => {
      const fsPath = resolveFsPath(argument) ?? (await pickChange(changes));
      if (fsPath) {
        await openDiff(fsPath, root(), headContent);
      }
    }),
  );

  void refreshStatus();
}

async function pickChange(changes: ChangesTree): Promise<string | undefined> {
  const records = changes.list();
  if (records.length === 0) {
    void vscode.window.showInformationMessage('No changed files recorded yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    records.map((record) => ({ label: record.fsPath, description: record.kind })),
    { placeHolder: 'Choose a changed file' },
  );
  return picked?.label;
}

export function deactivate(): void {
  // Subscriptions registered in activate() are disposed by VS Code.
}
