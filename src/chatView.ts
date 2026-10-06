import * as vscode from 'vscode';

export type ChatAction = 'start' | 'restart' | 'continue' | 'check';

export interface ChatHandlers {
  onSend(text: string): void;
  onAction(action: ChatAction): void;
}

/** Sidebar webview: a prompt box that forwards messages to the Freebuff TUI. */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'freebuff.chat';

  private view: vscode.WebviewView | undefined;

  constructor(private readonly handlers: ChatHandlers) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = { enableScripts: true, localResourceRoots: [] };
    webview.html = this.html(webview.cspSource);
    webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      const payload = message as { type?: unknown; text?: unknown; action?: unknown };
      if (payload.type === 'send' && typeof payload.text === 'string') {
        this.handlers.onSend(payload.text);
      } else if (payload.type === 'action' && typeof payload.action === 'string') {
        this.handlers.onAction(payload.action as ChatAction);
      }
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
  }

  post(message: unknown): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }

  private html(cspSource: string): string {
    const nonce = createNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column;
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
  header { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    font-size: 11px; color: var(--vscode-descriptionForeground); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-descriptionForeground); flex: none; }
  .dot.ok { background: var(--vscode-charts-green); }
  .dot.busy { background: var(--vscode-charts-yellow); }
  .dot.error { background: var(--vscode-charts-red); }
  #log { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .bubble { padding: 6px 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
  .bubble.user { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  .bubble.note, .bubble.error { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .bubble.error { color: var(--vscode-errorForeground); }
  .empty { font-size: 12px; color: var(--vscode-descriptionForeground); }
  footer { padding: 8px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border); display: flex; flex-direction: column; gap: 6px; }
  textarea { resize: none; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 6px; min-height: 54px; }
  textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .buttons { display: flex; gap: 6px; flex-wrap: wrap; }
  button { font-family: inherit; font-size: 11px; padding: 4px 8px; border-radius: 3px; cursor: pointer;
    color: var(--vscode-button-foreground); background: var(--vscode-button-secondaryBackground);
    border: 1px solid var(--vscode-button-border, transparent); }
  button.primary { background: var(--vscode-button-background); }
  button:hover { filter: brightness(1.1); }
</style>
</head>
<body>
<header><span id="dot" class="dot"></span><span id="statusText">Checking Freebuff…</span></header>
<main id="log"><div class="empty">Type a task and press Enter. Freebuff replies in the integrated terminal.</div></main>
<footer>
  <textarea id="input" rows="3" placeholder="Ask Freebuff to do something…"></textarea>
  <div class="buttons">
    <button id="send" class="primary">Send</button>
    <button id="start">Terminal</button>
    <button id="continue">Continue</button>
    <button id="check">Check</button>
  </div>
</footer>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const statusText = document.getElementById('statusText');
  const dot = document.getElementById('dot');
  let seeded = false;

  function addBubble(kind, text) {
    if (!seeded) { log.innerHTML = ''; seeded = true; }
    const div = document.createElement('div');
    div.className = 'bubble ' + kind;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function setStatus(text, tone) {
    statusText.textContent = text;
    dot.className = 'dot ' + (tone || '');
  }

  function send() {
    const text = input.value.trim();
    if (!text) { return; }
    input.value = '';
    vscode.postMessage({ type: 'send', text: text });
  }

  document.getElementById('send').addEventListener('click', send);
  document.getElementById('start').addEventListener('click', () => vscode.postMessage({ type: 'action', action: 'start' }));
  document.getElementById('continue').addEventListener('click', () => vscode.postMessage({ type: 'action', action: 'continue' }));
  document.getElementById('check').addEventListener('click', () => vscode.postMessage({ type: 'action', action: 'check' }));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) { return; }
    if (message.type === 'status') { setStatus(message.text, message.tone); }
    else if (message.type === 'echo') { addBubble('user', message.text); }
    else if (message.type === 'note') { addBubble('note', message.text); }
    else if (message.type === 'error') { addBubble('error', message.text); }
  });
</script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
