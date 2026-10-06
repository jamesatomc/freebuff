import { spawn } from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import { ChatViewProvider, type ChatAction } from "./chatView";
import {
  ChangesTree,
  HeadContentProvider,
  HEAD_SCHEME,
  openDiff,
  openFile,
} from "./changes";
import {
  compareVersions,
  detectAvailablePackageManagers,
  detectFreebuff,
  fetchLatestVersion,
  firstWorkspaceRoot,
  installCommandFor,
  sanitizePrompt,
  toPosixPath,
  type PackageManager,
} from "./freebuff";
import {
  listChats,
  TranscriptWatcher,
  type ChatMessageView,
} from "./transcript";
import {
  FREEBUFF_MODELS,
  readCurrentModel,
  settingsPath,
  writeModelPreference,
} from "./models";
import { FreebuffTerminal } from "./terminal";

function resolveFsPath(argument: unknown): string | undefined {
  if (typeof argument === "string") {
    return argument;
  }
  if (argument && typeof argument === "object") {
    const candidate = argument as {
      fsPath?: unknown;
      id?: unknown;
      resourceUri?: { fsPath?: unknown };
    };
    if (typeof candidate.fsPath === "string") {
      return candidate.fsPath;
    }
    if (typeof candidate.id === "string") {
      return candidate.id;
    }
    if (typeof candidate.resourceUri?.fsPath === "string") {
      return candidate.resourceUri.fsPath;
    }
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  console.log("freebuff-vscode: activated");
  const configuration = (): vscode.WorkspaceConfiguration =>
    vscode.workspace.getConfiguration("freebuff");
  const root = (): string | undefined =>
    firstWorkspaceRoot(vscode.workspace.workspaceFolders);
  const executable = (): string =>
    configuration().get<string>("executable", "").trim() || "freebuff";
  /** Where the CLI keeps its model pick; overridable for tests/portability. */
  const settingsFile = (): string =>
    configuration().get<string>("settingsPath", "").trim() || settingsPath();

  const output = vscode.window.createOutputChannel("Freebuff");
  const changes = new ChangesTree();
  const headContent = new HeadContentProvider();
  const terminal = new FreebuffTerminal(configuration, root);

  /** Conversation rendered in the panel: transcript first, optimistic tail. */
  let transcriptMessages: ChatMessageView[] = [];
  let pendingMessages: ChatMessageView[] = [];
  let pendingSequence = 0;

  const statusItem = vscode.window.createStatusBarItem(
    "freebuff.status",
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusItem.command = "freebuff.check";

  const publishMessages = (): void => {
    chat.post({
      type: "messages",
      messages: [...transcriptMessages, ...pendingMessages],
    });
  };

  const publishModels = (): void => {
    chat.post({
      type: "models",
      current: readCurrentModel(settingsFile()),
      options: FREEBUFF_MODELS,
    });
  };

  const refreshStatus = async (): Promise<void> => {
    const info = await detectFreebuff(executable());
    if (info.installed) {
      statusItem.text = `$(hubot) Freebuff ${info.version ?? ""}`.trim();
      statusItem.tooltip = info.binPath
        ? `Freebuff ${info.version ?? ""} — ${info.binPath}`
        : "Freebuff CLI";
      chat.post({
        type: "status",
        text: `Freebuff ${info.version ?? ""}`.trim(),
        tone: "ok",
      });
    } else {
      statusItem.text = "$(warning) Freebuff: not installed";
      statusItem.tooltip =
        'Freebuff CLI was not found. Run "Freebuff: Install or Update".';
      chat.post({
        type: "status",
        text: "Freebuff not installed",
        tone: "error",
      });
    }
    statusItem.show();
  };

  const chat = new ChatViewProvider({
    onSend: (text) => {
      void handleSend(text);
    },
    onAction: (action) => {
      void handleAction(action);
    },
    onQueryFiles: (query, token) => {
      void queryFiles(query, token);
    },
    onSelectModel: (modelId) => {
      void handleSelectModel(modelId);
    },
    onReady: () => {
      publishModels();
      publishMessages();
      publishActiveFile(vscode.window.activeTextEditor);
      void refreshStatus();
    },
  });

  /** Persist the pick; a live idle TUI is restarted so it boots on it. */
  const handleSelectModel = (modelId: string): void => {
    const option = FREEBUFF_MODELS.find((model) => model.id === modelId);
    if (!option) {
      chat.post({ type: "error", text: `Unknown model: ${modelId}` });
      return;
    }
    const result = writeModelPreference(option.id, settingsFile());
    if (!result.ok) {
      chat.post({
        type: "error",
        text: `Could not save the model: ${result.error ?? ""}`,
      });
      return;
    }
    publishModels();
    const working = transcriptMessages.some((message) => message.running);
    if (!terminal.isRunning) {
      chat.post({
        type: "note",
        text: `${option.label} saved — used the next time Freebuff starts.`,
      });
    } else if (working) {
      chat.post({
        type: "note",
        text: `${option.label} saved — applies after the current run finishes.`,
      });
    } else {
      terminal.restart(["--continue"], false);
      chat.post({
        type: "note",
        text: `Switched to ${option.label} — restarting Freebuff with the conversation kept.`,
      });
    }
  };

  const transcript = new TranscriptWatcher(root, (messages) => {
    // Drop the optimistic echo once the CLI records the same user message.
    const lastTranscriptUser = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const lastPending = pendingMessages[pendingMessages.length - 1];
    if (
      lastPending &&
      lastTranscriptUser &&
      lastTranscriptUser.text === lastPending.text
    ) {
      pendingMessages = [];
    }
    transcriptMessages = messages;
    publishMessages();
    const working = messages.some((message) => message.running);
    if (working) {
      chat.post({ type: "status", text: "Freebuff is working…", tone: "busy" });
      statusItem.text = "$(loading~spin) Freebuff working";
      statusItem.show();
    } else if (lastPending || pendingMessages.length > 0) {
      chat.post({
        type: "status",
        text: "Sent — reply will appear here",
        tone: "busy",
      });
    } else if (messages.length > 0) {
      chat.post({
        type: "status",
        text: `Conversation · ${messages.length} messages`,
        tone: "ok",
      });
    }
  });
  transcript.start();

  const handleSend = async (raw: string): Promise<void> => {
    const text = sanitizePrompt(raw);
    if (!text) {
      return;
    }
    changes.beginSession(root());
    pendingSequence += 1;
    pendingMessages.push({
      id: `local-${pendingSequence}`,
      role: "user",
      text,
      thinking: "",
      tools: [],
      running: false,
    });
    publishMessages();
    chat.post({ type: "status", text: "Sending…", tone: "busy" });
    try {
      const result = await terminal.sendPrompt(text);
      if (result.freshStart) {
        chat.post({
          type: "note",
          text: "Freebuff was (re)started in the terminal; first prompt waited for it to boot.",
        });
      }
      chat.post({
        type: "status",
        text: "Sent — reply will appear here",
        tone: "busy",
      });
    } catch (error) {
      chat.post({ type: "error", text: String(error) });
    }
    void refreshStatus();
  };

  const openHistory = async (): Promise<void> => {
    const chats = listChats(root());
    if (chats.length === 0) {
      void vscode.window.showInformationMessage(
        "No saved Freebuff conversations yet.",
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      chats.map((chatEntry) => ({
        label: chatEntry.firstPrompt.slice(0, 90) || "(empty chat)",
        description:
          chatEntry.messageCount > 0
            ? `${chatEntry.messageCount} messages`
            : "no messages",
        detail: chatEntry.chatId,
      })),
      { placeHolder: "Continue a previous conversation" },
    );
    if (!picked || !picked.detail) {
      return;
    }
    terminal.restart(["--continue", picked.detail]);
    chat.post({ type: "note", text: `Continuing chat ${picked.detail}` });
    setTimeout(() => transcript.refresh(), 500);
  };

  const handleAction = async (action: ChatAction): Promise<void> => {
    switch (action) {
      case "terminal":
        terminal.show();
        break;
      case "new": {
        if (terminal.isRunning) {
          await terminal.sendPrompt("/new");
        } else {
          terminal.show();
        }
        pendingMessages = [];
        publishMessages();
        chat.post({ type: "note", text: "Started a new chat." });
        setTimeout(() => transcript.refresh(), 500);
        break;
      }
      case "history":
        await openHistory();
        break;
      case "model":
        if (terminal.isRunning) {
          await terminal.sendPrompt("/model");
        } else {
          terminal.show();
        }
        chat.post({
          type: "note",
          text: "Model picker opened in the terminal.",
        });
        break;
      case "check":
        await checkInstallation();
        break;
    }
  };

  /** Workspace file index backing the @-mention popup. */
  let fileIndex: { paths: string[]; builtAt: number } | undefined;
  const ensureFileIndex = async (): Promise<string[]> => {
    if (fileIndex && Date.now() - fileIndex.builtAt < 30_000) {
      return fileIndex.paths;
    }
    const workspaceRoot = root();
    if (!workspaceRoot) {
      return [];
    }
    const uris = await vscode.workspace.findFiles(
      "**/*",
      "{**/node_modules/**,**/.git/**,**/dist/**,**/.freebuff/**}",
      4000,
    );
    const paths = uris
      .map((uri) => toPosixPath(path.relative(workspaceRoot, uri.fsPath)))
      .filter((relative) => relative.length > 0 && !relative.startsWith(".."))
      .sort();
    fileIndex = { paths, builtAt: Date.now() };
    return paths;
  };

  const queryFiles = async (query: string, token: number): Promise<void> => {
    const paths = await ensureFileIndex();
    const needle = query.toLowerCase();
    const matches = paths
      .map((candidate) => {
        const lower = candidate.toLowerCase();
        const baseStart = lower.lastIndexOf("/") + 1;
        const base = lower.slice(baseStart);
        let score = -1;
        if (needle.length === 0) {
          score = 10;
        } else if (base.startsWith(needle)) {
          score = 100;
        } else if (lower.startsWith(needle)) {
          score = 80;
        } else if (base.includes(needle)) {
          score = 60;
        } else if (lower.includes(needle)) {
          score = 40;
        }
        return { candidate, score };
      })
      .filter((entry) => entry.score >= 0)
      .sort(
        (a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate),
      )
      .slice(0, 15);
    chat.post({
      type: "fileResults",
      token,
      items: matches.map((entry) => ({ label: entry.candidate })),
    });
  };

  const publishActiveFile = (editor: vscode.TextEditor | undefined): void => {
    const workspaceRoot = root();
    const uri = editor?.document.uri;
    if (!workspaceRoot || !uri || uri.scheme !== "file") {
      chat.post({ type: "activeFile", path: null });
      return;
    }
    const relative = toPosixPath(path.relative(workspaceRoot, uri.fsPath));
    chat.post({
      type: "activeFile",
      path: relative.length > 0 && !relative.startsWith("..") ? relative : null,
    });
  };

  const install = async (): Promise<void> => {
    const managers = await detectAvailablePackageManagers();
    if (managers.length === 0) {
      void vscode.window.showErrorMessage(
        "No package manager found (npm, bun, pnpm or yarn). Install one, then retry.",
      );
      return;
    }
    const configured = configuration().get<string>("packageManager", "");
    let manager: PackageManager | undefined = managers.includes(
      configured as PackageManager,
    )
      ? (configured as PackageManager)
      : undefined;
    if (!manager && managers.length > 1) {
      const picked = await vscode.window.showQuickPick(
        managers.map((pm) => ({ label: pm })),
        { placeHolder: "Choose a package manager to install Freebuff" },
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
    const child = spawn(command, {
      shell: true,
      cwd: root(),
      windowsHide: true,
    });
    child.stdout?.on("data", (chunk: Buffer) =>
      output.append(chunk.toString()),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      output.append(chunk.toString()),
    );
    child.on("close", (code) => {
      output.appendLine(
        code === 0 ? "\nDone." : `\nFailed with exit code ${String(code)}.`,
      );
      if (code === 0) {
        void vscode.window.showInformationMessage(
          "Freebuff installed. Ready to run.",
        );
      }
      void refreshStatus();
    });
    child.on("error", (error) => {
      output.appendLine(`\n${String(error)}`);
    });
  };

  const checkInstallation = async (): Promise<void> => {
    chat.post({ type: "status", text: "Checking Freebuff…", tone: "busy" });
    const info = await detectFreebuff(executable());
    if (!info.installed) {
      chat.post({
        type: "status",
        text: "Freebuff not installed",
        tone: "error",
      });
      const choice = await vscode.window.showWarningMessage(
        "Freebuff CLI is not installed yet.",
        "Install",
        "Open Website",
      );
      if (choice === "Install") {
        await install();
      } else if (choice === "Open Website") {
        await vscode.env.openExternal(vscode.Uri.parse("https://freebuff.com"));
      }
      return;
    }

    const latest = await fetchLatestVersion();
    if (latest && info.version && compareVersions(info.version, latest) < 0) {
      chat.post({
        type: "note",
        text: `Update available: ${info.version} → ${latest}`,
      });
      const choice = await vscode.window.showInformationMessage(
        `Freebuff ${info.version} is installed; ${latest} is available.`,
        "Update",
        "Later",
      );
      if (choice === "Update") {
        await install();
      }
      return;
    }

    chat.post({
      type: "status",
      text: `Freebuff ${info.version ?? ""}`.trim(),
      tone: "ok",
    });
    const choice = await vscode.window.showInformationMessage(
      `Freebuff ${info.version ?? ""} is up to date.`.trim(),
      "Start Freebuff",
    );
    if (choice === "Start Freebuff") {
      terminal.show();
    }
    void refreshStatus();
  };

  const watchers: vscode.FileSystemWatcher[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, "**/*"),
    );
    watcher.onDidCreate((uri) => changes.record(uri, "created", root()));
    watcher.onDidChange((uri) => changes.record(uri, "modified", root()));
    watcher.onDidDelete((uri) => changes.record(uri, "deleted", root()));
    watchers.push(watcher);
  }

  context.subscriptions.push(
    output,
    changes,
    terminal,
    transcript,
    statusItem,
    ...watchers,
    vscode.workspace.registerTextDocumentContentProvider(
      HEAD_SCHEME,
      headContent,
    ),
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.createTreeView("freebuff.changes", {
      treeDataProvider: changes,
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) =>
      publishActiveFile(editor),
    ),
    vscode.commands.registerCommand("freebuff.start", () => {
      terminal.show();
      void refreshStatus();
    }),
    vscode.commands.registerCommand("freebuff.continue", () => {
      terminal.show(["--continue"]);
      void refreshStatus();
    }),
    vscode.commands.registerCommand("freebuff.restart", () => {
      terminal.restart();
      void refreshStatus();
    }),
    vscode.commands.registerCommand("freebuff.sendPrompt", async () => {
      const text = await vscode.window.showInputBox({
        prompt: "Message for Freebuff",
        placeHolder: "Describe the task…",
      });
      if (text) {
        await handleSend(text);
      }
    }),
    vscode.commands.registerCommand("freebuff.check", () =>
      checkInstallation(),
    ),
    vscode.commands.registerCommand("freebuff.install", () => install()),
    vscode.commands.registerCommand("freebuff.clearChanges", () =>
      changes.clear(),
    ),
    vscode.commands.registerCommand(
      "freebuff.openChange",
      async (argument: unknown) => {
        const fsPath = resolveFsPath(argument) ?? (await pickChange(changes));
        if (fsPath) {
          await openFile(fsPath);
        }
      },
    ),
    vscode.commands.registerCommand(
      "freebuff.diffChange",
      async (argument: unknown) => {
        const fsPath = resolveFsPath(argument) ?? (await pickChange(changes));
        if (fsPath) {
          await openDiff(fsPath, root(), headContent);
        }
      },
    ),
  );

  publishActiveFile(vscode.window.activeTextEditor);
  void ensureFileIndex();
  void refreshStatus();
}

async function pickChange(changes: ChangesTree): Promise<string | undefined> {
  const records = changes.list();
  if (records.length === 0) {
    void vscode.window.showInformationMessage("No changed files recorded yet.");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    records.map((record) => ({
      label: record.fsPath,
      description: record.kind,
    })),
    { placeHolder: "Choose a changed file" },
  );
  return picked?.label;
}

export function deactivate(): void {
  // Subscriptions registered in activate() are disposed by VS Code.
}
