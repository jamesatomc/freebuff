import * as vscode from "vscode";

export type ChatAction = "new" | "history" | "model" | "terminal" | "check";

export interface ChatHandlers {
  onSend(text: string): void;
  onAction(action: ChatAction): void;
  onQueryFiles(query: string, token: number): void;
  onSelectModel(modelId: string): void;
  /** Called when the webview is ready to receive its initial state. */
  onReady(): void;
}

/** A file offered by the host for @-mentions. */
export interface FileOption {
  label: string;
  description?: string;
}

/**
 * Copilot-style chat sidebar: header controls, message transcript with
 * markdown + tool/thinking rows, and a composer with @file and /command
 * popups. The host streams transcript updates in; this side only renders.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "freebuff.chat";

  private view: vscode.WebviewView | undefined;

  constructor(private readonly handlers: ChatHandlers) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = { enableScripts: true, localResourceRoots: [] };
    webview.html = this.html(webview.cspSource);
    webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== "object") {
        return;
      }
      const payload = message as {
        type?: unknown;
        text?: unknown;
        action?: unknown;
        query?: unknown;
        token?: unknown;
        id?: unknown;
      };
      if (payload.type === "send" && typeof payload.text === "string") {
        this.handlers.onSend(payload.text);
      } else if (
        payload.type === "action" &&
        typeof payload.action === "string"
      ) {
        this.handlers.onAction(payload.action as ChatAction);
      } else if (
        payload.type === "queryFiles" &&
        typeof payload.query === "string" &&
        typeof payload.token === "number"
      ) {
        this.handlers.onQueryFiles(payload.query, payload.token);
      } else if (
        payload.type === "selectModel" &&
        typeof payload.id === "string"
      ) {
        this.handlers.onSelectModel(payload.id);
      } else if (payload.type === "ready") {
        this.handlers.onReady();
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
  :root { --radius: 8px; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; display: flex; flex-direction: column;
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }

  /* ---------- header ---------- */
  header { display: flex; align-items: center; gap: 6px; padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border); position: relative; }
  #modelMenu { position: absolute; top: 100%; right: 4px; min-width: 250px; max-height: 300px;
    overflow-y: auto; background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-sideBarSectionHeader-border));
    border-radius: 6px; box-shadow: 0 6px 16px rgba(0,0,0,0.4); z-index: 30; display: none;
    padding: 4px 0; }
  #modelMenu.open { display: block; }
  .mitem { display: flex; align-items: baseline; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
  .mitem:hover, .mitem.sel { background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground); }
  .mitem .mname { flex: none; min-width: 148px; }
  .mitem .mtag { color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .mitem:hover .mtag, .mitem.sel .mtag { color: inherit; opacity: 0.85; }
  .mitem .mcheck { margin-left: auto; color: var(--vscode-charts-green); visibility: hidden; flex: none; }
  .mitem.current .mcheck { visibility: visible; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none;
    background: var(--vscode-descriptionForeground); }
  .dot.ok { background: var(--vscode-charts-green); }
  .dot.busy { background: var(--vscode-charts-yellow); animation: pulse 1.2s ease-in-out infinite; }
  .dot.error { background: var(--vscode-charts-red); }
  @keyframes pulse { 50% { opacity: 0.35; } }
  #statusText { flex: 1; min-width: 0; font-size: 11px; color: var(--vscode-descriptionForeground);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hbtn { display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    height: 22px; min-width: 22px; padding: 0 5px; border: none; border-radius: 4px; cursor: pointer;
    background: transparent; color: var(--vscode-foreground); font-size: 11px; font-family: inherit; }
  .hbtn:hover { background: var(--vscode-toolbar-hoverBackground); }
  .hbtn svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.7; }

  /* ---------- messages ---------- */
  #messages { flex: 1; overflow-y: auto; padding: 10px 12px 6px; scroll-behavior: auto; }
  .msg { margin-bottom: 14px; }
  .msg-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
    font-size: 11px; color: var(--vscode-descriptionForeground); }
  .avatar { width: 16px; height: 16px; border-radius: 3px; display: inline-flex;
    align-items: center; justify-content: center; font-size: 10px; font-weight: 600; flex: none; }
  .avatar.user { background: var(--vscode-charts-blue); color: #fff; }
  .avatar.bot { background: color-mix(in srgb, var(--vscode-charts-green) 30%, transparent);
    color: var(--vscode-charts-green); border: 1px solid var(--vscode-charts-green); }
  .msg.user .body { background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: var(--radius); padding: 8px 10px; white-space: pre-wrap; word-break: break-word; }
  .msg.assistant .body, .msg.error .body, .msg.agent .body { word-break: break-word; }
  .body p { margin: 0 0 8px; } .body p:last-child { margin-bottom: 0; }
  .body h1, .body h2, .body h3, .body h4 { font-size: 1.1em; margin: 10px 0 6px; }
  .body ul, .body ol { margin: 4px 0 8px; padding-left: 20px; }
  .body li { margin: 2px 0; }
  .body blockquote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid var(--vscode-textBlockQuote-border, #666);
    color: var(--vscode-textBlockQuote-foreground, inherit); }
  .body a { color: var(--vscode-textLink-foreground); }
  .body hr { border: none; border-top: 1px solid var(--vscode-sideBarSectionHeader-border); margin: 10px 0; }
  .body code { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.25));
    padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
  .codeblock { margin: 8px 0; border: 1px solid var(--vscode-panel-border, transparent);
    border-radius: 6px; overflow: hidden; background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12)); }
  .codeblock .cb-head { display: flex; justify-content: space-between; align-items: center;
    padding: 3px 8px; font-size: 10px; color: var(--vscode-descriptionForeground);
    background: var(--vscode-sideBarSectionHeader-background); }
  .codeblock .cb-head button { border: none; background: transparent; cursor: pointer;
    color: var(--vscode-foreground); font-size: 10px; font-family: inherit; padding: 1px 4px; border-radius: 3px; }
  .codeblock .cb-head button:hover { background: var(--vscode-toolbar-hoverBackground); }
  .codeblock pre { margin: 0; padding: 8px 10px; overflow-x: auto;
    font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.45; }

  details.thinking, details.agent { margin: 6px 0; border: 1px solid var(--vscode-sideBarSectionHeader-border);
    border-radius: 6px; background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.08)); }
  details > summary { cursor: pointer; padding: 5px 8px; font-size: 11px;
    color: var(--vscode-descriptionForeground); list-style: none; user-select: none; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary::before { content: '▸ '; }
  details[open] > summary::before { content: '▾ '; }
  details .dbody { padding: 0 10px 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word;
    color: var(--vscode-descriptionForeground); }

  .tool { margin: 4px 0; border: 1px solid var(--vscode-sideBarSectionHeader-border); border-radius: 6px; }
  .tool-head { display: flex; align-items: center; gap: 6px; width: 100%; border: none; cursor: pointer;
    background: transparent; color: var(--vscode-foreground); font-family: inherit; font-size: 11px;
    padding: 4px 8px; text-align: left; }
  .tool-head:hover { background: var(--vscode-toolbar-hoverBackground); }
  .tool-name { font-family: var(--vscode-editor-font-family); color: var(--vscode-charts-blue); flex: none; }
  .tool-sum { color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; min-width: 0; flex: 1; }
  .spin { width: 9px; height: 9px; border: 1.5px solid var(--vscode-charts-green);
    border-top-color: transparent; border-radius: 50%; animation: spin 0.9s linear infinite; flex: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tool-out { display: none; margin: 0; padding: 6px 8px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
    font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; word-break: break-word;
    max-height: 200px; overflow: auto; }
  .tool.open .tool-out { display: block; }

  .msg.error .body { color: var(--vscode-errorForeground); }
  .sysline { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 6px 0;
    padding: 4px 8px; border-left: 2px solid var(--vscode-sideBarSectionHeader-border); }
  .sysline.error { color: var(--vscode-errorForeground); border-left-color: var(--vscode-charts-red); }

  .cursor { display: inline-block; width: 7px; height: 1em; background: var(--vscode-foreground);
    vertical-align: text-bottom; animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  /* ---------- empty state ---------- */
  #empty { padding: 24px 14px; text-align: center; color: var(--vscode-descriptionForeground); }
  #empty .logo { font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--vscode-foreground); }
  #empty .hint { font-size: 11px; margin-bottom: 14px; }
  .suggest { display: block; width: 100%; text-align: left; margin: 6px 0; padding: 8px 10px;
    border: 1px solid var(--vscode-sideBarSectionHeader-border); border-radius: 6px; cursor: pointer;
    background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-foreground);
    font-family: inherit; font-size: 12px; }
  .suggest:hover { border-color: var(--vscode-focusBorder); }

  /* ---------- composer ---------- */
  footer { border-top: 1px solid var(--vscode-sideBarSectionHeader-border); padding: 8px;
    position: relative; }
  .context-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; padding: 2px 7px;
    border-radius: 10px; border: 1px solid var(--vscode-sideBarSectionHeader-border);
    color: var(--vscode-descriptionForeground); cursor: pointer; background: transparent; font-family: inherit; }
  .chip.on { border-color: var(--vscode-charts-blue); color: var(--vscode-foreground);
    background: color-mix(in srgb, var(--vscode-charts-blue) 18%, transparent); }
  #composerBox { border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 6px; background: var(--vscode-input-background); }
  #composerBox:focus-within { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  #input { display: block; width: 100%; border: none; outline: none; resize: none; padding: 8px 8px 4px;
    background: transparent; color: var(--vscode-input-foreground);
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); min-height: 40px; max-height: 180px; }
  .comp-actions { display: flex; align-items: center; gap: 6px; padding: 2px 6px 6px; }
  .comp-actions .spacer { flex: 1; }
  .mini { border: none; background: transparent; cursor: pointer; color: var(--vscode-descriptionForeground);
    font-size: 14px; padding: 2px 4px; border-radius: 4px; font-family: inherit; }
  .mini:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
  #send { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
    border: none; border-radius: 5px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #send:disabled { opacity: 0.45; cursor: default; }
  #send svg { width: 14px; height: 14px; fill: currentColor; }

  /* ---------- popups ---------- */
  #popup { position: absolute; left: 8px; right: 8px; bottom: calc(100% - 4px);
    max-height: 220px; overflow-y: auto; background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-sideBarSectionHeader-border));
    border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.35); display: none; z-index: 20; }
  #popup.open { display: block; }
  .pitem { display: flex; gap: 8px; align-items: baseline; padding: 6px 10px; cursor: pointer; font-size: 12px; }
  .pitem.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .pitem .key { font-family: var(--vscode-editor-font-family); min-width: 90px; color: var(--vscode-charts-blue); }
  .pitem.sel .key { color: inherit; }
  .pitem .desc { color: var(--vscode-descriptionForeground); font-size: 11px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pitem.sel .desc { color: inherit; opacity: 0.85; }
</style>
</head>
<body>
<header>
  <span id="dot" class="dot"></span>
  <span id="statusText">Freebuff</span>
  <button class="hbtn" id="btnNew" title="New chat (/new)"><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke-linecap="round"/></svg></button>
  <button class="hbtn" id="btnHistory" title="Chat history"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.4" stroke-linecap="round"/></svg></button>
  <button class="hbtn" id="btnModel" title="Choose model"><svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 6h4M6 9h4"/></svg><span id="modelLabel">Model</span></button>
  <button class="hbtn" id="btnTerminal" title="Focus terminal"><svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M5 7l2 1.5L5 10M8.5 10.5h3" stroke-linecap="round"/></svg></button>
</header>
<div id="modelMenu" role="listbox" aria-label="Model"></div>

<main id="messages"></main>
<div id="empty">
  <div class="logo">Freebuff</div>
  <div class="hint">Ask anything about your code — edits happen in the workspace.</div>
  <button class="suggest" data-fill="Explain this codebase">Explain this codebase</button>
  <button class="suggest" data-fill="Find opportunities to refactor">Find opportunities to refactor</button>
  <button class="suggest" data-fill="Improve my test coverage">Improve my test coverage</button>
</div>

<footer>
  <div id="popup"></div>
  <div class="context-row" id="contextRow" style="display:none">
    <button class="chip" id="ctxChip" title="Include this file as context"></button>
  </div>
  <div id="composerBox">
    <textarea id="input" rows="1" placeholder="Ask Freebuff (Enter to send, @ file, / command)"></textarea>
    <div class="comp-actions">
      <button class="mini" id="btnFiles" title="Mention a file (@)">@</button>
      <button class="mini" id="btnSlash" title="Slash command (/)">/</button>
      <span class="spacer"></span>
      <button id="send" title="Send message"><svg viewBox="0 0 16 16"><path d="M2 8l12-5-4.2 12L7.6 9.4 2 8z"/></svg></button>
    </div>
  </div>
</footer>

<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const emptyEl = document.getElementById('empty');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const statusText = document.getElementById('statusText');
  const dot = document.getElementById('dot');
  const popup = document.getElementById('popup');
  const contextRow = document.getElementById('contextRow');
  const ctxChip = document.getElementById('ctxChip');

  const state = {
    messages: [],
    notes: [],
    errors: [],
    models: [],
    currentModel: '',
    activeFile: null,
    attach: false,
    open: new Set(),      // expanded tool/thinking ids
    token: 0,
    items: [],
    sel: 0,
    kind: null,           // 'slash' | 'files'
    query: '',
  };

  const SLASH = [
    ['/new', 'Start a new chat'],
    ['/model', 'Switch the model'],
    ['/history', 'Browse past chats'],
    ['/plan', 'Plan a change first'],
    ['/review', 'Review the current changes'],
    ['/todo', 'Show the todo list'],
    ['/usage', 'Freebucks usage'],
    ['/export', 'Export the conversation'],
    ['/copy', 'Copy the conversation'],
    ['/bash', 'Open a shell command'],
    ['/reasoning', 'Toggle reasoning display'],
    ['/queue', 'Inspect the message queue'],
    ['/init', 'Initialize agents for this repo'],
    ['/diagnostics', 'Runtime diagnostics'],
    ['/image', 'Generate an image'],
    ['/help', 'Show help'],
    ['/login', 'Sign in'],
    ['/logout', 'Sign out'],
    ['/exit', 'Exit Freebuff'],
  ];

  /* ---------- markdown (safe subset) ---------- */
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inline(s) {
    return s
      .replace(/\x60([^\x60]+)\x60/g, function (_, c) { return '<code>' + c + '</code>'; })
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\\*([^*\\n]+)\\*/g, '$1<em>$2</em>')
      .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }
  function block(lines) {
    let html = '';
    let list = null;
    const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    for (const raw of lines) {
      const line = raw;
      let m;
      if ((m = line.match(/^\\s*\x60\x60\x60/))) { continue; }
      if ((m = line.match(/^(#{1,4})\\s+(.*)/))) { closeList(); html += '<h' + (m[1].length + 1) + '>' + inline(esc(m[2])) + '</h' + (m[1].length + 1) + '>'; continue; }
      if (/^\\s*(-{3,}|\\*{3,})\\s*$/.test(line)) { closeList(); html += '<hr>'; continue; }
      if ((m = line.match(/^\\s*[-*]\\s+(.*)/))) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += '<li>' + inline(esc(m[1])) + '</li>'; continue; }
      if ((m = line.match(/^\\s*\\d+[.)]\\s+(.*)/))) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += '<li>' + inline(esc(m[1])) + '</li>'; continue; }
      if ((m = line.match(/^>\\s?(.*)/))) { closeList(); html += '<blockquote>' + inline(esc(m[1])) + '</blockquote>'; continue; }
      if (line.trim() === '') { closeList(); continue; }
      closeList();
      html += '<p>' + inline(esc(line)) + '</p>';
    }
    closeList();
    return html;
  }
  function renderMarkdown(text) {
    const parts = String(text).split(/\x60\x60\x60/);
    let html = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const nl = parts[i].indexOf('\\n');
        const lang = nl >= 0 ? parts[i].slice(0, nl).trim() : '';
        const code = nl >= 0 ? parts[i].slice(nl + 1) : parts[i];
        const body = esc(code.replace(/\\n$/, ''));
        html += '<div class="codeblock"><div class="cb-head"><span>' + esc(lang || 'code') +
          '</span><button data-copy="' + encodeURIComponent(code.replace(/\\n$/, '')) + '">Copy</button></div><pre>' +
          body + '</pre></div>';
      } else {
        html += block(parts[i].split('\\n'));
      }
    }
    return html;
  }

  /* ---------- rendering ---------- */
  function toolHtml(tool) {
    const open = state.open.has(tool.id) ? ' open' : '';
    const spin = tool.running ? '<span class="spin"></span>' : '';
    const out = tool.output
      ? '<pre class="tool-out">' + esc(tool.output) + '</pre>'
      : '';
    return '<div class="tool' + open + '" data-tool="' + esc(tool.id) + '">' +
      '<button class="tool-head" data-toggle="' + esc(tool.id) + '">' + spin +
      '<span class="tool-name">' + esc(tool.name) + '</span>' +
      '<span class="tool-sum">' + esc(tool.summary || '') + '</span>' +
      '<span>›</span></button>' + out + '</div>';
  }

  function messageHtml(msg) {
    if (msg.role === 'user') {
      return '<div class="msg user" data-id="' + esc(msg.id) + '">' +
        '<div class="msg-head"><span class="avatar user">U</span><span>You</span></div>' +
        '<div class="body">' + esc(msg.text) + '</div></div>';
    }
    if (msg.role === 'error') {
      return '<div class="msg error" data-id="' + esc(msg.id) + '">' +
        '<div class="body">' + renderMarkdown(msg.text) + '</div></div>';
    }
    if (msg.role === 'agent') {
      const summary = msg.text || 'working…';
      const openId = 'agent-' + msg.id;
      const open = state.open.has(openId) ? ' open' : '';
      return '<div class="msg agent" data-id="' + esc(msg.id) + '">' +
        '<details class="agent' + open + '" data-open="' + esc(openId) + '">' +
        '<summary>' + esc(msg.agentName || 'agent') + ' — ' + esc(summary.slice(0, 120)) + '</summary>' +
        '<div class="dbody">' + esc(msg.text) + '</div></details></div>';
    }

    let html = '<div class="msg assistant" data-id="' + esc(msg.id) + '">' +
      '<div class="msg-head"><span class="avatar bot">F</span><span>Freebuff</span></div>';
    if (msg.thinking) {
      const openId = 'think-' + msg.id;
      const open = state.open.has(openId) ? ' open' : '';
      html += '<details class="thinking" data-open="' + esc(openId) + '"><summary>Thought process</summary>' +
        '<div class="dbody">' + esc(msg.thinking) + '</div></details>';
    }
    html += '<div class="body">' + renderMarkdown(msg.text);
    if (msg.running) { html += ' <span class="cursor"></span>'; }
    html += '</div>';
    for (const tool of msg.tools || []) { html += toolHtml(tool); }
    html += '</div>';
    return html;
  }

  function render(forceBottom) {
    const wasBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 70;
    let html = '';
    for (const msg of state.messages) { html += messageHtml(msg); }
    for (const note of state.notes) { html += '<div class="sysline">' + esc(note) + '</div>'; }
    for (const err of state.errors) { html += '<div class="sysline error">' + esc(err) + '</div>'; }
    messagesEl.innerHTML = html;
    emptyEl.style.display = state.messages.length || state.notes.length || state.errors.length ? 'none' : 'block';
    if (forceBottom || wasBottom) { messagesEl.scrollTop = messagesEl.scrollHeight; }
  }

  function setStatus(text, tone) {
    statusText.textContent = text;
    dot.className = 'dot' + (tone ? ' ' + tone : '');
  }

  /* ---------- popup (slash + files) ---------- */
  function closePopup() { popup.classList.remove('open'); state.kind = null; state.items = []; state.sel = 0; }
  function showPopup() {
    popup.classList.add('open');
    state.sel = 0;
    renderPopup();
  }
  function renderPopup() {
    let html = '';
    state.items.forEach((item, i) => {
      html += '<div class="pitem' + (i === state.sel ? ' sel' : '') + '" data-idx="' + i + '">' +
        '<span class="key">' + esc(item.label) + '</span>' +
        '<span class="desc">' + esc(item.description || '') + '</span></div>';
    });
    popup.innerHTML = html;
    if (!state.items.length) { popup.classList.remove('open'); }
    const sel = popup.querySelector('.pitem.sel');
    if (sel) { sel.scrollIntoView({ block: 'nearest' }); }
  }
  function acceptItem(idx) {
    const item = state.items[idx];
    if (!item) { return; }
    const value = input.value;
    const caret = input.selectionStart;
    const before = value.slice(0, caret);
    const tokenStart = before.search(state.kind === 'slash' ? /\\/[\\w:-]*$/ : /@[\\w./\\\\-]*$/);
    if (tokenStart < 0) { closePopup(); return; }
    const insert = (state.kind === 'slash' ? item.label + ' ' : '@' + item.label + ' ');
    input.value = value.slice(0, tokenStart) + insert + value.slice(caret);
    const nextCaret = tokenStart + insert.length;
    input.setSelectionRange(nextCaret, nextCaret);
    closePopup();
    input.focus();
    autosize();
  }
  function detectPopup() {
    const caret = input.selectionStart;
    const before = input.value.slice(0, caret);
    if (/\\/[\\w:-]*$/.test(before) && !/\\S.*\\//.test(before)) {
      const q = (before.match(/\\/([\\w:-]*)$/) || [])[1] || '';
      state.kind = 'slash';
      state.query = q;
      state.items = SLASH.filter(function (s) { return s[0].slice(1).startsWith(q); })
        .map(function (s) { return { label: s[0], description: s[1] }; });
      if (state.items.length) { showPopup(); return; }
    }
    if (/@[\\w./\\\\-]*$/.test(before) && !/\\S.*@/.test(before)) {
      const q = (before.match(/@([\\w./\\\\-]*)$/) || [])[1] || '';
      state.kind = 'files';
      state.query = q;
      state.token += 1;
      vscode.postMessage({ type: 'queryFiles', query: q, token: state.token });
      if (state.items.length) { showPopup(); }
      return;
    }
    closePopup();
  }

  /* ---------- composer ---------- */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(180, Math.max(40, input.scrollHeight)) + 'px';
    sendBtn.disabled = !input.value.trim();
  }
  function send() {
    const raw = input.value.trim();
    if (!raw) { return; }
    let text = raw;
    if (state.attach && state.activeFile && raw.indexOf('@' + state.activeFile) < 0) {
      text = '@' + state.activeFile + ' ' + raw;
    }
    input.value = '';
    autosize();
    closePopup();
    vscode.postMessage({ type: 'send', text: text });
    render(true);
    input.focus();
  }

  input.addEventListener('input', function () { autosize(); detectPopup(); });
  input.addEventListener('keydown', function (event) {
    if (popup.classList.contains('open')) {
      if (event.key === 'ArrowDown') { event.preventDefault(); state.sel = Math.min(state.items.length - 1, state.sel + 1); renderPopup(); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); state.sel = Math.max(0, state.sel - 1); renderPopup(); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); acceptItem(state.sel); return; }
      if (event.key === 'Escape') { event.preventDefault(); closePopup(); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
  });
  sendBtn.addEventListener('click', send);
  document.getElementById('btnFiles').addEventListener('click', function () {
    input.value += (input.value && !input.value.endsWith(' ') ? ' ' : '') + '@';
    input.focus(); autosize(); detectPopup();
  });
  document.getElementById('btnSlash').addEventListener('click', function () {
    input.value += (input.value && !input.value.endsWith(' ') ? ' ' : '') + '/';
    input.focus(); autosize(); detectPopup();
  });
  popup.addEventListener('mousedown', function (event) {
    const item = event.target.closest('.pitem');
    if (item) { event.preventDefault(); acceptItem(Number(item.getAttribute('data-idx'))); }
  });

  // ---------- model menu ----------
  const modelMenu = document.getElementById('modelMenu');
  function closeModelMenu() { modelMenu.classList.remove('open'); }
  function labelForModel(id) {
    for (let i = 0; i < state.models.length; i++) {
      if (state.models[i].id === id) { return state.models[i].label; }
    }
    return id || 'Model';
  }
  function renderModelMenu() {
    document.getElementById('modelLabel').textContent = labelForModel(state.currentModel);
    if (!state.models.length) { return; }
    let html = '';
    for (let i = 0; i < state.models.length; i++) {
      const model = state.models[i];
      const current = model.id === state.currentModel ? ' current' : '';
      html += '<div class="mitem' + current + '" data-model="' + esc(model.id) + '">' +
        '<span class="mname">' + esc(model.label) + '</span>' +
        '<span class="mtag">' + esc(model.tagline || '') + '</span>' +
        '<span class="mcheck">&#10003;</span></div>';
    }
    modelMenu.innerHTML = html;
  }

  document.getElementById('btnNew').addEventListener('click', function () { vscode.postMessage({ type: 'action', action: 'new' }); });
  document.getElementById('btnHistory').addEventListener('click', function () { vscode.postMessage({ type: 'action', action: 'history' }); });
  document.getElementById('btnModel').addEventListener('click', function (event) {
    event.stopPropagation();
    if (modelMenu.classList.contains('open')) { closeModelMenu(); }
    else { renderModelMenu(); modelMenu.classList.add('open'); }
  });
  document.getElementById('btnTerminal').addEventListener('click', function () { vscode.postMessage({ type: 'action', action: 'terminal' }); });

  document.addEventListener('click', function (event) {
    if (!event.target.closest('#modelMenu') && !event.target.closest('#btnModel')) { closeModelMenu(); }
    const mitem = event.target.closest('[data-model]');
    if (mitem) {
      vscode.postMessage({ type: 'selectModel', id: mitem.getAttribute('data-model') });
      closeModelMenu();
      return;
    }
    const fill = event.target.closest('[data-fill]');
    if (fill) { input.value = fill.getAttribute('data-fill'); input.focus(); autosize(); return; }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard && navigator.clipboard.writeText(decodeURIComponent(copy.getAttribute('data-copy')));
      copy.textContent = 'Copied';
      setTimeout(function () { copy.textContent = 'Copy'; }, 1200);
      return;
    }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.getAttribute('data-toggle');
      const box = toggle.closest('.tool');
      if (state.open.has(id)) { state.open.delete(id); box.classList.remove('open'); }
      else { state.open.add(id); box.classList.add('open'); }
      return;
    }
    const details = event.target.closest('details[data-open]');
    if (details && details.open) { state.open.add(details.getAttribute('data-open')); }
    else if (details) { state.open.delete(details.getAttribute('data-open')); }
  });

  ctxChip.addEventListener('click', function () {
    state.attach = !state.attach;
    ctxChip.classList.toggle('on', state.attach);
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message) { return; }
    if (message.type === 'messages' && Array.isArray(message.messages)) {
      state.messages = message.messages;
      state.notes = [];
      state.errors = [];
      render(false);
    } else if (message.type === 'status') {
      setStatus(message.text, message.tone);
    } else if (message.type === 'note') {
      state.notes.push(message.text);
      render(false);
    } else if (message.type === 'error') {
      state.errors.push(message.text);
      setStatus(message.text, 'error');
      render(true);
    } else if (message.type === 'fileResults' && message.token === state.token) {
      state.items = (message.items || []).map(function (item) {
        return { label: item.label, description: item.description || '' };
      });
      if (state.kind === 'files') { if (state.items.length) { showPopup(); } else { closePopup(); } }
    } else if (message.type === 'models') {
      state.models = message.options || [];
      state.currentModel = message.current || '';
      renderModelMenu();
    } else if (message.type === 'activeFile') {
      state.activeFile = message.path || null;
      if (state.activeFile) {
        contextRow.style.display = 'flex';
        ctxChip.textContent = '@include ' + state.activeFile;
        ctxChip.classList.add('on');
        state.attach = true;
      } else {
        contextRow.style.display = 'none';
        state.attach = false;
      }
    }
  });

  autosize();
  setStatus('Freebuff', '');
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
