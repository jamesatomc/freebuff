import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseGitStatus, runCommand, toPosixPath as toPosix } from './freebuff';

export type ChangeKind = 'created' | 'modified' | 'deleted';

export interface ChangeRecord {
  fsPath: string;
  kind: ChangeKind;
  changedAt: number;
  gitStatus: string | null;
}

const IGNORED_PREFIXES = ['.git/', 'node_modules/', 'dist/'];

const KIND_LABEL: Record<ChangeKind, string> = {
  created: 'added',
  modified: 'modified',
  deleted: 'deleted',
};

const KIND_ICON: Record<ChangeKind, string> = {
  created: 'new-file',
  modified: 'edit',
  deleted: 'trash',
};

function isIgnored(fsPath: string, root: string | undefined): boolean {
  const relative = root ? toPosix(path.relative(root, fsPath)) : toPosix(fsPath);
  if (relative.startsWith('..')) {
    return false;
  }
  return IGNORED_PREFIXES.some((prefix) => relative === prefix.slice(0, -1) || relative.startsWith(prefix));
}

/**
 * Records the files Freebuff touches during a session and exposes them as a
 * tree, with git status when the workspace is a repository.
 */
export class ChangesTree implements vscode.TreeDataProvider<ChangeRecord>, vscode.Disposable {
  private readonly records = new Map<string, ChangeRecord>();
  private readonly listeners: Array<(element: ChangeRecord | undefined) => void> = [];
  private gitTimer: ReturnType<typeof setTimeout> | undefined;
  private workspaceRoot: string | undefined;

  readonly onDidChangeTreeData: vscode.Event<ChangeRecord | undefined> = (
    listener,
    thisArgs,
    disposables,
  ) => {
    const bound = thisArgs ? (listener as (element: ChangeRecord | undefined) => void).bind(thisArgs) : listener;
    this.listeners.push(bound);
    const disposable: vscode.Disposable = {
      dispose: () => {
        const index = this.listeners.indexOf(bound);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      },
    };
    disposables?.push(disposable);
    return disposable;
  };

  private fire(): void {
    for (const listener of [...this.listeners]) {
      listener(undefined);
    }
  }

  /** Called when a new prompt starts: forget the previous session's files. */
  beginSession(root: string | undefined): void {
    this.workspaceRoot = root;
    this.records.clear();
    this.fire();
  }

  clear(): void {
    this.records.clear();
    this.fire();
  }

  list(): ChangeRecord[] {
    return [...this.records.values()].sort((a, b) => b.changedAt - a.changedAt);
  }

  record(uri: vscode.Uri, kind: ChangeKind, root: string | undefined): void {
    this.workspaceRoot = root ?? this.workspaceRoot;
    if (isIgnored(uri.fsPath, this.workspaceRoot)) {
      return;
    }
    this.records.set(uri.fsPath, { fsPath: uri.fsPath, kind, changedAt: Date.now(), gitStatus: null });
    this.fire();
    this.scheduleGitRefresh();
  }

  private scheduleGitRefresh(): void {
    const root = this.workspaceRoot;
    if (!root || this.gitTimer !== undefined) {
      return;
    }
    this.gitTimer = setTimeout(() => {
      this.gitTimer = undefined;
      void this.refreshGitStatus(root);
    }, 300);
  }

  private async refreshGitStatus(root: string): Promise<void> {
    const result = await runCommand('git -c core.quotepath=false status --porcelain', {
      cwd: root,
      timeoutMs: 15_000,
    });
    if (result.code !== 0 || this.records.size === 0) {
      return;
    }
    const statuses = parseGitStatus(result.stdout);
    for (const record of this.records.values()) {
      const relative = toPosix(path.relative(root, record.fsPath));
      record.gitStatus = statuses.get(relative) ?? null;
    }
    this.fire();
  }

  getTreeItem(record: ChangeRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(vscode.Uri.file(record.fsPath));
    item.id = record.fsPath;
    item.label = path.basename(record.fsPath);
    item.contextValue = 'changedFile';
    item.description = record.gitStatus
      ? `${record.gitStatus} ${toPosix(path.relative(this.workspaceRoot ?? '', record.fsPath))}`
      : KIND_LABEL[record.kind];
    item.tooltip = `${KIND_LABEL[record.kind]}: ${record.fsPath}`;
    item.iconPath = new vscode.ThemeIcon(KIND_ICON[record.kind]);
    item.command = {
      command: 'freebuff.openChange',
      title: 'Open Changed File',
      arguments: [record.fsPath],
    };
    return item;
  }

  getChildren(): ChangeRecord[] {
    return this.list();
  }

  dispose(): void {
    if (this.gitTimer !== undefined) {
      clearTimeout(this.gitTimer);
      this.gitTimer = undefined;
    }
    this.listeners.length = 0;
  }
}

/** Virtual scheme holding the HEAD version of a file for diffing. */
export const HEAD_SCHEME = 'freebuff-head';

export class HeadContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();

  set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
}

/** Open a working-tree file side by side with its HEAD version. */
export async function openDiff(
  fsPath: string,
  root: string | undefined,
  provider: HeadContentProvider,
): Promise<void> {
  const relative = root ? toPosix(path.relative(root, fsPath)) : path.basename(fsPath);
  const result = root
    ? await runCommand(`git -c core.quotepath=false show HEAD:"${relative}"`, {
        cwd: root,
        timeoutMs: 20_000,
      })
    : { code: -1, stdout: '', stderr: 'no workspace root' };

  if (result.code !== 0) {
    await openFile(fsPath);
    void vscode.window.showInformationMessage(
      `No HEAD version for ${relative}; opened the file instead.`,
    );
    return;
  }

  const headUri = vscode.Uri.from({ scheme: HEAD_SCHEME, path: `/${relative}` });
  provider.set(headUri, result.stdout);
  await vscode.commands.executeCommand(
    'vscode.diff',
    headUri,
    vscode.Uri.file(fsPath),
    `HEAD: ${relative} → working tree`,
  );
}

export async function openFile(fsPath: string): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(fsPath);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch {
    void vscode.window.showWarningMessage(`File no longer exists: ${fsPath}`);
  }
}
