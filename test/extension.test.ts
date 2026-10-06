/**
 * Smoke tests: drive activate() and the chat -> terminal path against a stub
 * of the `vscode` API, so registration and prompt typing are verified without
 * an Extension Development Host.
 */
import { describe, expect, mock, test } from 'bun:test';
import type * as vscode from 'vscode';

interface RegisteredCommand {
  name: string;
  callback: (...args: unknown[]) => unknown;
}

interface SentText {
  text: string;
  addNewLine: boolean;
}

const commands: RegisteredCommand[] = [];
const providers: Array<{ viewType: string }> = [];
const messages: string[] = [];
const sent: SentText[] = [];
let statusBar: { text: string; tooltip: string; show(): void } | undefined;

function makeWatcher(): {
  onDidCreate(listener: unknown): { dispose(): void };
  onDidChange(listener: unknown): { dispose(): void };
  onDidDelete(listener: unknown): { dispose(): void };
  dispose(): void;
} {
  const disposable = { dispose: () => undefined };
  return {
    onDidCreate: () => disposable,
    onDidChange: () => disposable,
    onDidDelete: () => disposable,
    dispose: () => undefined,
  };
}

const vscodeStub = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  RelativePattern: class {
    constructor(
      readonly base: unknown,
      readonly pattern: string,
    ) {}
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
    parse: (value: string) => ({ fsPath: value, path: value, scheme: 'https', toString: () => value }),
    from: (parts: { scheme: string; path: string }) => ({
      fsPath: parts.path,
      path: parts.path,
      scheme: parts.scheme,
      toString: () => `${parts.scheme}:${parts.path}`,
    }),
  },
  window: {
    createOutputChannel: () => ({
      append: () => undefined,
      appendLine: () => undefined,
      clear: () => undefined,
      show: () => undefined,
      dispose: () => undefined,
    }),
    createStatusBarItem: () => {
      statusBar = { text: '', tooltip: '', show: () => undefined };
      return statusBar;
    },
    createTreeView: () => ({ dispose: () => undefined }),
    registerWebviewViewProvider: (viewType: string) => {
      providers.push({ viewType });
      return { dispose: () => undefined };
    },
    createFileSystemWatcher: () => makeWatcher(),
    createTerminal: () => ({
      exitStatus: undefined,
      sendText: (text: string, addNewLine: boolean) => {
        sent.push({ text, addNewLine });
      },
      show: () => undefined,
      dispose: () => undefined,
    }),
    onDidCloseTerminal: () => ({ dispose: () => undefined }),
    showInformationMessage: async (message: string) => {
      messages.push(message);
      return undefined;
    },
    showWarningMessage: async (message: string) => {
      messages.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      messages.push(message);
      return undefined;
    },
    showInputBox: async (): Promise<string | undefined> => undefined,
    showQuickPick: async () => undefined,
    showTextDocument: async () => undefined,
  },
  workspace: {
    workspaceFolders: [] as unknown[],
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback,
    }),
    createFileSystemWatcher: () => makeWatcher(),
    registerTextDocumentContentProvider: () => ({ dispose: () => undefined }),
    openTextDocument: async () => ({}),
  },
  commands: {
    registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
      commands.push({ name, callback });
      return { dispose: () => undefined };
    },
    executeCommand: async () => undefined,
  },
  env: { openExternal: async () => true },
};

mock.module('vscode', () => vscodeStub);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const extension = require('../src/extension') as typeof import('../src/extension');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FreebuffTerminal } = require('../src/terminal') as typeof import('../src/terminal');

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function findCommand(name: string): RegisteredCommand {
  const found = commands.find((command) => command.name === name);
  if (!found) {
    throw new Error(`command not registered: ${name}`);
  }
  return found;
}

const EXPECTED_COMMANDS = [
  'freebuff.start',
  'freebuff.continue',
  'freebuff.restart',
  'freebuff.sendPrompt',
  'freebuff.check',
  'freebuff.install',
  'freebuff.clearChanges',
  'freebuff.openChange',
  'freebuff.diffChange',
];

describe('activate', () => {
  test('registers commands, chat view and status item', async () => {
    extension.activate({ subscriptions: [] } as unknown as vscode.ExtensionContext);
    await waitFor(() => (statusBar?.text ?? '').includes('Freebuff'), 20_000);
    for (const name of EXPECTED_COMMANDS) {
      expect(commands.map((command) => command.name)).toContain(name);
    }
    expect(providers.map((entry) => entry.viewType)).toContain('freebuff.chat');
    expect(statusBar?.text).toContain('Freebuff');
  }, 30_000);
});

describe('sendPrompt command', () => {
  test('sanitizes the prompt, launches the CLI and submits', async () => {
    vscodeStub.window.showInputBox = async () => '  fix  \n the bug  ';
    await findCommand('freebuff.sendPrompt').callback();

    // First write launches the TUI, second one types and submits the prompt.
    await waitFor(() => sent.length >= 2, 15_000);
    expect(sent[0]?.text).toBe('freebuff');
    expect(sent[0]?.addNewLine).toBe(true);
    expect(sent[1]?.text).toBe('fix the bug\r');
    expect(sent[1]?.addNewLine).toBe(false);
  }, 30_000);
});

describe('FreebuffTerminal', () => {
  test('relaunches the TUI when the previous process is gone', async () => {
    const config = () =>
      ({ get: (_key: string, fallback: unknown) => fallback }) as unknown as vscode.WorkspaceConfiguration;
    const terminal = new FreebuffTerminal(config, () => undefined);

    const before = sent.length;
    const result = await terminal.sendPrompt('hello from the test');
    expect(result.sent).toBe(true);

    await waitFor(() => sent.length > before, 15_000);
    const tail = sent.slice(before);
    // The final write is always the submitted prompt, whatever relaunch path
    // the process check selected.
    const last = tail[tail.length - 1];
    expect(last?.text).toBe('hello from the test\r');
    expect(tail.some((entry) => entry.text === 'freebuff' || entry.text.endsWith('freebuff'))).toBe(true);
    terminal.dispose();
  }, 40_000);
});
