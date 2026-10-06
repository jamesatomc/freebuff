var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/extension.ts
var exports_extension = {};
__export(exports_extension, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(exports_extension);
var import_node_child_process2 = require("node:child_process");
var vscode3 = __toESM(require("vscode"));

// src/chatView.ts
class ChatViewProvider {
  handlers;
  static viewType = "freebuff.chat";
  view;
  constructor(handlers) {
    this.handlers = handlers;
  }
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const webview = webviewView.webview;
    webview.options = { enableScripts: true, localResourceRoots: [] };
    webview.html = this.html(webview.cspSource);
    webview.onDidReceiveMessage((message) => {
      if (!message || typeof message !== "object") {
        return;
      }
      const payload = message;
      if (payload.type === "send" && typeof payload.text === "string") {
        this.handlers.onSend(payload.text);
      } else if (payload.type === "action" && typeof payload.action === "string") {
        this.handlers.onAction(payload.action);
      }
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
  }
  post(message) {
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }
  html(cspSource) {
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
function createNonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0;i < 32; i += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

// src/changes.ts
var path2 = __toESM(require("node:path"));
var vscode = __toESM(require("vscode"));

// src/freebuff.ts
var import_node_child_process = require("node:child_process");
var fs = __toESM(require("node:fs"));
var https = __toESM(require("node:https"));
var path = __toESM(require("node:path"));
function runCommand(command, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = import_node_child_process.spawn(command, { shell: true, cwd: opts.cwd, windowsHide: true });
    } catch (error) {
      finish({ code: -1, stdout: "", stderr: String(error) });
      return;
    }
    const timeoutMs = opts.timeoutMs ?? 20000;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish({ code: -1, stdout, stderr: `${stderr}
[timed out after ${timeoutMs}ms]` });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ code: -1, stdout, stderr: `${stderr}${String(error)}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code: code ?? -1, stdout, stderr });
    });
  });
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function parseVersion(text) {
  const match = text.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match?.[1] ?? null;
}
function compareVersions(a, b) {
  const [aMain = "", aPre = ""] = a.split("-", 2);
  const [bMain = "", bPre = ""] = b.split("-", 2);
  const aParts = aMain.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const bParts = bMain.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0;i < Math.max(aParts.length, bParts.length); i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  if (aPre === bPre) {
    return 0;
  }
  if (aPre === "") {
    return 1;
  }
  if (bPre === "") {
    return -1;
  }
  return aPre < bPre ? -1 : 1;
}
function toCommand(executable) {
  const trimmed = executable.trim();
  if (trimmed.includes(" ") && fs.existsSync(trimmed)) {
    return `"${trimmed}"`;
  }
  return trimmed;
}
async function detectFreebuff(executable = "freebuff") {
  const target = toCommand(executable);
  if (!target) {
    return { installed: false, version: null, binPath: null };
  }
  const result = await runCommand(`${target} --version`, { timeoutMs: 60000 });
  const version = parseVersion(`${result.stdout}
${result.stderr}`);
  if (result.code === 0 && version) {
    return { installed: true, version, binPath: await resolveExecutable(executable) };
  }
  return { installed: false, version: null, binPath: null };
}
async function resolveExecutable(executable) {
  const trimmed = executable.trim();
  if (trimmed.includes(" ") && fs.existsSync(trimmed)) {
    return trimmed;
  }
  const command = process.platform === "win32" ? `where.exe ${trimmed}` : `command -v ${trimmed}`;
  const result = await runCommand(command, { timeoutMs: 15000 });
  if (result.code !== 0) {
    return null;
  }
  const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
  return first ?? null;
}
function fetchLatestVersion(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const request = https.get("https://registry.npmjs.org/freebuff/latest", { timeout: timeoutMs }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        resolve(null);
        return;
      }
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve(typeof parsed.version === "string" ? parsed.version : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.on("error", () => resolve(null));
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
  });
}
var PACKAGE_MANAGERS = ["npm", "bun", "pnpm", "yarn"];
async function detectAvailablePackageManagers() {
  const available = [];
  for (const manager of PACKAGE_MANAGERS) {
    const result = await runCommand(`${manager} --version`, { timeoutMs: 1e4 });
    if (result.code === 0 && /\d/.test(result.stdout)) {
      available.push(manager);
    }
  }
  return available;
}
function installCommandFor(manager) {
  switch (manager) {
    case "npm":
      return "npm install -g freebuff";
    case "bun":
      return "bun add -g freebuff";
    case "pnpm":
      return "pnpm add -g freebuff";
    case "yarn":
      return "yarn global add freebuff";
  }
}
function sanitizePrompt(text) {
  return text.replace(/\r\n/g, `
`).split(`
`).map((line) => line.trim()).filter((line) => line.length > 0).join(" ").trim();
}
function parseGitStatus(output) {
  const statuses = new Map;
  for (const line of output.split(`
`)) {
    if (line.length < 4) {
      continue;
    }
    const code = line.slice(0, 2);
    let filePath = line.slice(3);
    if (filePath.includes(" -> ")) {
      filePath = filePath.split(" -> ").pop() ?? filePath;
    }
    filePath = filePath.replace(/^"|"$/g, "");
    statuses.set(filePath, code);
  }
  return statuses;
}
async function isFreebuffCliRunning(executable = "freebuff") {
  const marker = await resolveExecutable(executable);
  const separators = process.platform === "win32" ? /[/\\]/g : /\\/g;
  const lower = (value) => value.replace(separators, process.platform === "win32" ? "\\" : "/").toLowerCase();
  const markers = [];
  if (marker) {
    markers.push(lower(marker));
  }
  for (const extra of ["node_modules/freebuff", ".config/manicode/freebuff.exe", ".config/codebuff/freebuff.exe"]) {
    markers.push(lower(extra));
  }
  const processes = await listProcessCommands();
  if (processes === null) {
    return;
  }
  return processes.some((line) => {
    const candidate = lower(line);
    return markers.some((m) => candidate.includes(m));
  });
}
async function listProcessCommands() {
  if (process.platform === "win32") {
    const result2 = await runCommand('powershell -NoProfile -Command "(Get-CimInstance Win32_Process).CommandLine"', { timeoutMs: 15000 });
    if (result2.code !== 0) {
      return null;
    }
    return result2.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  }
  const result = await runCommand("ps -axo command=", { timeoutMs: 15000 });
  if (result.code !== 0) {
    return null;
  }
  return result.stdout.split(`
`).filter((line) => line.trim().length > 0);
}
function firstWorkspaceRoot(folders) {
  return folders?.[0]?.uri.fsPath;
}
function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

// src/changes.ts
var IGNORED_PREFIXES = [".git/", "node_modules/", "dist/"];
var KIND_LABEL = {
  created: "added",
  modified: "modified",
  deleted: "deleted"
};
var KIND_ICON = {
  created: "new-file",
  modified: "edit",
  deleted: "trash"
};
function isIgnored(fsPath, root) {
  const relative2 = root ? toPosixPath(path2.relative(root, fsPath)) : toPosixPath(fsPath);
  if (relative2.startsWith("..")) {
    return false;
  }
  return IGNORED_PREFIXES.some((prefix) => relative2 === prefix.slice(0, -1) || relative2.startsWith(prefix));
}

class ChangesTree {
  records = new Map;
  listeners = [];
  gitTimer;
  workspaceRoot;
  onDidChangeTreeData = (listener, thisArgs, disposables) => {
    const bound = thisArgs ? listener.bind(thisArgs) : listener;
    this.listeners.push(bound);
    const disposable = {
      dispose: () => {
        const index = this.listeners.indexOf(bound);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      }
    };
    disposables?.push(disposable);
    return disposable;
  };
  fire() {
    for (const listener of [...this.listeners]) {
      listener(undefined);
    }
  }
  beginSession(root) {
    this.workspaceRoot = root;
    this.records.clear();
    this.fire();
  }
  clear() {
    this.records.clear();
    this.fire();
  }
  list() {
    return [...this.records.values()].sort((a, b) => b.changedAt - a.changedAt);
  }
  record(uri, kind, root) {
    this.workspaceRoot = root ?? this.workspaceRoot;
    if (isIgnored(uri.fsPath, this.workspaceRoot)) {
      return;
    }
    this.records.set(uri.fsPath, { fsPath: uri.fsPath, kind, changedAt: Date.now(), gitStatus: null });
    this.fire();
    this.scheduleGitRefresh();
  }
  scheduleGitRefresh() {
    const root = this.workspaceRoot;
    if (!root || this.gitTimer !== undefined) {
      return;
    }
    this.gitTimer = setTimeout(() => {
      this.gitTimer = undefined;
      this.refreshGitStatus(root);
    }, 300);
  }
  async refreshGitStatus(root) {
    const result = await runCommand("git -c core.quotepath=false status --porcelain", {
      cwd: root,
      timeoutMs: 15000
    });
    if (result.code !== 0 || this.records.size === 0) {
      return;
    }
    const statuses = parseGitStatus(result.stdout);
    for (const record of this.records.values()) {
      const relative2 = toPosixPath(path2.relative(root, record.fsPath));
      record.gitStatus = statuses.get(relative2) ?? null;
    }
    this.fire();
  }
  getTreeItem(record) {
    const item = new vscode.TreeItem(vscode.Uri.file(record.fsPath));
    item.id = record.fsPath;
    item.label = path2.basename(record.fsPath);
    item.contextValue = "changedFile";
    item.description = record.gitStatus ? `${record.gitStatus} ${toPosixPath(path2.relative(this.workspaceRoot ?? "", record.fsPath))}` : KIND_LABEL[record.kind];
    item.tooltip = `${KIND_LABEL[record.kind]}: ${record.fsPath}`;
    item.iconPath = new vscode.ThemeIcon(KIND_ICON[record.kind]);
    item.command = {
      command: "freebuff.openChange",
      title: "Open Changed File",
      arguments: [record.fsPath]
    };
    return item;
  }
  getChildren() {
    return this.list();
  }
  dispose() {
    if (this.gitTimer !== undefined) {
      clearTimeout(this.gitTimer);
      this.gitTimer = undefined;
    }
    this.listeners.length = 0;
  }
}
var HEAD_SCHEME = "freebuff-head";

class HeadContentProvider {
  contents = new Map;
  set(uri, content) {
    this.contents.set(uri.toString(), content);
  }
  provideTextDocumentContent(uri) {
    return this.contents.get(uri.toString()) ?? "";
  }
}
async function openDiff(fsPath, root, provider) {
  const relative2 = root ? toPosixPath(path2.relative(root, fsPath)) : path2.basename(fsPath);
  const result = root ? await runCommand(`git -c core.quotepath=false show HEAD:"${relative2}"`, {
    cwd: root,
    timeoutMs: 20000
  }) : { code: -1, stdout: "", stderr: "no workspace root" };
  if (result.code !== 0) {
    await openFile(fsPath);
    vscode.window.showInformationMessage(`No HEAD version for ${relative2}; opened the file instead.`);
    return;
  }
  const headUri = vscode.Uri.from({ scheme: HEAD_SCHEME, path: `/${relative2}` });
  provider.set(headUri, result.stdout);
  await vscode.commands.executeCommand("vscode.diff", headUri, vscode.Uri.file(fsPath), `HEAD: ${relative2} → working tree`);
}
async function openFile(fsPath) {
  try {
    const document = await vscode.workspace.openTextDocument(fsPath);
    await vscode.window.showTextDocument(document, { preview: false });
  } catch {
    vscode.window.showWarningMessage(`File no longer exists: ${fsPath}`);
  }
}

// src/terminal.ts
var vscode2 = __toESM(require("vscode"));
class FreebuffTerminal {
  getConfiguration;
  getWorkspaceRoot;
  terminal;
  disposables = [];
  constructor(getConfiguration, getWorkspaceRoot) {
    this.getConfiguration = getConfiguration;
    this.getWorkspaceRoot = getWorkspaceRoot;
    this.disposables.push(vscode2.window.onDidCloseTerminal((terminal) => {
      if (terminal === this.terminal) {
        this.terminal = undefined;
      }
    }));
  }
  settings() {
    const config = this.getConfiguration();
    return {
      name: config.get("terminal.name", "Freebuff"),
      startupDelayMs: Math.max(0, config.get("terminal.startupDelayMs", 1200)),
      submitSequence: config.get("terminal.submitSequence", "\r"),
      revealOnSend: config.get("terminal.revealOnSend", true),
      executable: config.get("executable", "").trim()
    };
  }
  get isRunning() {
    return this.terminal !== undefined && this.terminal.exitStatus === undefined;
  }
  launchCommand(extraArgs = []) {
    const { executable } = this.settings();
    const base = executable && executable.length > 0 ? executable : "freebuff";
    const quoted = executable.includes(" ") ? `"${executable}"` : base;
    return [quoted, ...extraArgs].join(" ").trim();
  }
  start(extraArgs = []) {
    if (this.isRunning && extraArgs.length === 0) {
      return this.terminal;
    }
    if (!this.isRunning) {
      const settings = this.settings();
      this.terminal = vscode2.window.createTerminal({
        name: settings.name,
        cwd: this.getWorkspaceRoot()
      });
    }
    const terminal = this.terminal;
    terminal.sendText(this.launchCommand(extraArgs), true);
    return terminal;
  }
  show(extraArgs = []) {
    if (extraArgs.length > 0) {
      return this.restart(extraArgs);
    }
    const terminal = this.start();
    terminal.show(false);
    return terminal;
  }
  restart(extraArgs = []) {
    if (this.terminal) {
      const closing = this.terminal;
      this.terminal = undefined;
      closing.dispose();
    }
    const terminal = this.start(extraArgs);
    terminal.show(false);
    return terminal;
  }
  async sendPrompt(text) {
    const settings = this.settings();
    let freshStart = false;
    if (!this.isRunning) {
      this.start();
      freshStart = true;
    } else if (await isFreebuffCliRunning(this.launchCommand()) !== true) {
      this.terminal.sendText(this.launchCommand(), true);
      freshStart = true;
    }
    const terminal = this.terminal;
    if (freshStart && settings.startupDelayMs > 0) {
      await delay(settings.startupDelayMs);
    }
    terminal.sendText(`${text}${settings.submitSequence}`, false);
    if (settings.revealOnSend) {
      terminal.show(true);
    }
    return { sent: true, freshStart };
  }
  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.terminal = undefined;
  }
}

// src/extension.ts
function resolveFsPath(argument) {
  if (typeof argument === "string") {
    return argument;
  }
  if (argument && typeof argument === "object") {
    const candidate = argument;
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
  return;
}
function activate(context) {
  const configuration = () => vscode3.workspace.getConfiguration("freebuff");
  const root = () => firstWorkspaceRoot(vscode3.workspace.workspaceFolders);
  const executable = () => configuration().get("executable", "").trim() || "freebuff";
  const output = vscode3.window.createOutputChannel("Freebuff");
  const changes = new ChangesTree;
  const headContent = new HeadContentProvider;
  const terminal = new FreebuffTerminal(configuration, root);
  const statusItem = vscode3.window.createStatusBarItem("freebuff.status", vscode3.StatusBarAlignment.Right, 100);
  statusItem.command = "freebuff.check";
  const refreshStatus = async () => {
    const info = await detectFreebuff(executable());
    if (info.installed) {
      statusItem.text = `$(hubot) Freebuff ${info.version ?? ""}`.trim();
      statusItem.tooltip = info.binPath ? `Freebuff ${info.version ?? ""} — ${info.binPath}` : "Freebuff CLI";
    } else {
      statusItem.text = "$(warning) Freebuff: not installed";
      statusItem.tooltip = 'Freebuff CLI was not found. Run "Freebuff: Install or Update".';
    }
    statusItem.show();
    chat.post({
      type: "status",
      text: info.installed ? `Freebuff ${info.version ?? ""}`.trim() : "Freebuff not installed",
      tone: info.installed ? "ok" : "error"
    });
  };
  const chat = new ChatViewProvider({
    onSend: (text) => {
      handleSend(text);
    },
    onAction: (action) => {
      handleAction(action);
    }
  });
  const handleSend = async (raw) => {
    const text = sanitizePrompt(raw);
    if (!text) {
      return;
    }
    changes.beginSession(root());
    chat.post({ type: "echo", text });
    chat.post({ type: "status", text: "Sending…", tone: "busy" });
    try {
      const result = await terminal.sendPrompt(text);
      chat.post({
        type: "status",
        text: "Sent — the reply appears in the terminal",
        tone: "ok"
      });
      if (result.freshStart) {
        chat.post({
          type: "note",
          text: "Freebuff was (re)started in the integrated terminal; the first prompt waited for it to boot."
        });
      }
    } catch (error) {
      chat.post({ type: "error", text: String(error) });
    }
    refreshStatus();
  };
  const handleAction = async (action) => {
    switch (action) {
      case "start":
        terminal.show();
        break;
      case "restart":
        terminal.restart();
        chat.post({ type: "note", text: "Freebuff restarted in the integrated terminal." });
        break;
      case "continue":
        terminal.show(["--continue"]);
        chat.post({ type: "note", text: "Continuing the last conversation in the terminal." });
        break;
      case "check":
        await checkInstallation();
        break;
    }
  };
  const install = async () => {
    const managers = await detectAvailablePackageManagers();
    if (managers.length === 0) {
      vscode3.window.showErrorMessage("No package manager found (npm, bun, pnpm or yarn). Install one, then retry.");
      return;
    }
    const configured = configuration().get("packageManager", "");
    let manager = managers.includes(configured) ? configured : undefined;
    if (!manager && managers.length > 1) {
      const picked = await vscode3.window.showQuickPick(managers.map((pm) => ({ label: pm })), { placeHolder: "Choose a package manager to install Freebuff" });
      manager = picked ? picked.label : undefined;
    }
    manager ??= managers[0];
    if (!manager) {
      return;
    }
    const command = installCommandFor(manager);
    output.clear();
    output.show(true);
    output.appendLine(`$ ${command}
`);
    const child = import_node_child_process2.spawn(command, { shell: true, cwd: root(), windowsHide: true });
    child.stdout?.on("data", (chunk) => output.append(chunk.toString()));
    child.stderr?.on("data", (chunk) => output.append(chunk.toString()));
    child.on("close", (code) => {
      output.appendLine(code === 0 ? `
Done.` : `
Failed with exit code ${String(code)}.`);
      if (code === 0) {
        vscode3.window.showInformationMessage("Freebuff installed. Ready to run.");
      }
      refreshStatus();
    });
    child.on("error", (error) => {
      output.appendLine(`
${String(error)}`);
    });
  };
  const checkInstallation = async () => {
    chat.post({ type: "status", text: "Checking Freebuff…", tone: "busy" });
    const info = await detectFreebuff(executable());
    if (!info.installed) {
      chat.post({ type: "status", text: "Freebuff not installed", tone: "error" });
      const choice2 = await vscode3.window.showWarningMessage("Freebuff CLI is not installed yet.", "Install", "Open Website");
      if (choice2 === "Install") {
        await install();
      } else if (choice2 === "Open Website") {
        await vscode3.env.openExternal(vscode3.Uri.parse("https://freebuff.com"));
      }
      return;
    }
    const latest = await fetchLatestVersion();
    if (latest && info.version && compareVersions(info.version, latest) < 0) {
      chat.post({
        type: "note",
        text: `Update available: ${info.version} → ${latest}`
      });
      const choice2 = await vscode3.window.showInformationMessage(`Freebuff ${info.version} is installed; ${latest} is available.`, "Update", "Later");
      if (choice2 === "Update") {
        await install();
      }
      return;
    }
    chat.post({ type: "status", text: `Freebuff ${info.version ?? ""}`.trim(), tone: "ok" });
    const choice = await vscode3.window.showInformationMessage(`Freebuff ${info.version ?? ""} is up to date.`.trim(), "Start Freebuff");
    if (choice === "Start Freebuff") {
      terminal.show();
    }
    refreshStatus();
  };
  const watchers = [];
  for (const folder of vscode3.workspace.workspaceFolders ?? []) {
    const watcher = vscode3.workspace.createFileSystemWatcher(new vscode3.RelativePattern(folder, "**/*"));
    watcher.onDidCreate((uri) => changes.record(uri, "created", root()));
    watcher.onDidChange((uri) => changes.record(uri, "modified", root()));
    watcher.onDidDelete((uri) => changes.record(uri, "deleted", root()));
    watchers.push(watcher);
  }
  context.subscriptions.push(output, changes, terminal, statusItem, ...watchers, vscode3.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, headContent), vscode3.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
    webviewOptions: { retainContextWhenHidden: true }
  }), vscode3.window.createTreeView("freebuff.changes", { treeDataProvider: changes }), vscode3.commands.registerCommand("freebuff.start", () => {
    terminal.show();
    refreshStatus();
  }), vscode3.commands.registerCommand("freebuff.continue", () => {
    terminal.show(["--continue"]);
    refreshStatus();
  }), vscode3.commands.registerCommand("freebuff.restart", () => {
    terminal.restart();
    refreshStatus();
  }), vscode3.commands.registerCommand("freebuff.sendPrompt", async () => {
    const text = await vscode3.window.showInputBox({
      prompt: "Message for Freebuff",
      placeHolder: "Describe the task…"
    });
    if (text) {
      await handleSend(text);
    }
  }), vscode3.commands.registerCommand("freebuff.check", () => checkInstallation()), vscode3.commands.registerCommand("freebuff.install", () => install()), vscode3.commands.registerCommand("freebuff.clearChanges", () => changes.clear()), vscode3.commands.registerCommand("freebuff.openChange", async (argument) => {
    const fsPath = resolveFsPath(argument) ?? await pickChange(changes);
    if (fsPath) {
      await openFile(fsPath);
    }
  }), vscode3.commands.registerCommand("freebuff.diffChange", async (argument) => {
    const fsPath = resolveFsPath(argument) ?? await pickChange(changes);
    if (fsPath) {
      await openDiff(fsPath, root(), headContent);
    }
  }));
  refreshStatus();
}
async function pickChange(changes) {
  const records = changes.list();
  if (records.length === 0) {
    vscode3.window.showInformationMessage("No changed files recorded yet.");
    return;
  }
  const picked = await vscode3.window.showQuickPick(records.map((record) => ({ label: record.fsPath, description: record.kind })), { placeHolder: "Choose a changed file" });
  return picked?.label;
}
function deactivate() {}

//# debugId=FB25C6A6DF2A283F64756E2164756E21
//# sourceMappingURL=extension.js.map
