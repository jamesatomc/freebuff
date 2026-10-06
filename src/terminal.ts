import * as vscode from "vscode";
import { delay, isFreebuffCliRunning } from "./freebuff";

export interface SendResult {
  sent: boolean;
  freshStart: boolean;
}

interface TerminalSettings {
  name: string;
  startupDelayMs: number;
  submitSequence: string;
  revealOnSend: boolean;
  executable: string;
}

/**
 * Owns the single integrated terminal that runs the Freebuff TUI.
 *
 * The Freebuff CLI has no non-interactive mode, so prompts are typed into its
 * terminal. Before each prompt we make sure the CLI is actually alive; if it
 * is not, it gets restarted instead of letting the prompt fall through to an
 * idle shell.
 */
export class FreebuffTerminal implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly getConfiguration: () => vscode.WorkspaceConfiguration,
    private readonly getWorkspaceRoot: () => string | undefined,
  ) {
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        if (terminal === this.terminal) {
          this.terminal = undefined;
        }
      }),
    );
  }

  private settings(): TerminalSettings {
    const config = this.getConfiguration();
    return {
      name: config.get<string>("terminal.name", "Freebuff"),
      startupDelayMs: Math.max(
        0,
        config.get<number>("terminal.startupDelayMs", 1200),
      ),
      submitSequence: config.get<string>("terminal.submitSequence", "\n"),
      revealOnSend: config.get<boolean>("terminal.revealOnSend", true),
      executable: config.get<string>("executable", "").trim(),
    };
  }

  get isRunning(): boolean {
    return (
      this.terminal !== undefined && this.terminal.exitStatus === undefined
    );
  }

  private launchCommand(extraArgs: string[] = []): string {
    const { executable } = this.settings();
    const base = executable && executable.length > 0 ? executable : "freebuff";
    const quoted = executable.includes(" ") ? `"${executable}"` : base;
    return [quoted, ...extraArgs].join(" ").trim();
  }

  /** Create the terminal (or reuse a live one) and launch Freebuff in it. */
  start(extraArgs: string[] = []): vscode.Terminal {
    if (this.isRunning && extraArgs.length === 0) {
      return this.terminal as vscode.Terminal;
    }
    if (!this.isRunning) {
      const settings = this.settings();
      this.terminal = vscode.window.createTerminal({
        name: settings.name,
        cwd: this.getWorkspaceRoot(),
      });
    }
    const terminal = this.terminal as vscode.Terminal;
    terminal.sendText(this.launchCommand(extraArgs), true);
    return terminal;
  }

  /** Focus the terminal, starting Freebuff first when nothing is running. */
  show(extraArgs: string[] = []): vscode.Terminal {
    if (extraArgs.length > 0) {
      // Relaunch so flags are not typed into an already-running TUI.
      return this.restart(extraArgs);
    }
    const terminal = this.start();
    terminal.show(false);
    return terminal;
  }

  restart(extraArgs: string[] = [], focus = true): vscode.Terminal {
    if (this.terminal) {
      const closing = this.terminal;
      this.terminal = undefined;
      closing.dispose();
    }
    const terminal = this.start(extraArgs);
    if (focus) {
      terminal.show(false);
    }
    return terminal;
  }

  /**
   * Type a prompt into the TUI and submit it. Returns whether Freebuff had to
   * be (re)started first, which callers surface as a note in the chat panel.
   */
  async sendPrompt(text: string): Promise<SendResult> {
    const settings = this.settings();
    let freshStart = false;

    if (!this.isRunning) {
      this.start();
      freshStart = true;
    } else if ((await isFreebuffCliRunning(this.launchCommand())) === false) {
      // The terminal is alive but the TUI is gone; relaunch before typing.
      // An `undefined` result means the process query failed, so we assume the
      // TUI is still up rather than typing launch text into a live chat.
      (this.terminal as vscode.Terminal).sendText(this.launchCommand(), true);
      freshStart = true;
    }

    const terminal = this.terminal as vscode.Terminal;
    if (freshStart && settings.startupDelayMs > 0) {
      await delay(settings.startupDelayMs);
    }
    terminal.sendText(`${text}${settings.submitSequence}`, false);
    if (settings.revealOnSend) {
      terminal.show(true);
    }
    return { sent: true, freshStart };
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.terminal = undefined;
  }
}
