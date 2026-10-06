import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export interface ToolView {
  id: string;
  name: string;
  summary: string;
  output: string;
  running: boolean;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant" | "error" | "agent";
  text: string;
  thinking: string;
  tools: ToolView[];
  agentName?: string;
  timestamp?: string;
  running: boolean;
}

type RawBlock = Record<string, unknown> & { type?: unknown };
type RawMessage = Record<string, unknown> & {
  variant?: unknown;
  content?: unknown;
  blocks?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function blocksOf(message: RawMessage): RawBlock[] {
  return Array.isArray(message.blocks)
    ? (message.blocks as RawBlock[]).filter(
        (block) => block && typeof block === "object",
      )
    : [];
}

/** One-line human summary of a tool call, mirroring how the TUI labels rows. */
export function summarizeToolCall(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? input.slice(0, 120) : "";
  }
  const record = input as Record<string, unknown>;
  for (const key of [
    "command",
    "path",
    "file_path",
    "filePath",
    "pattern",
    "query",
    "url",
    "agentName",
    "prompt",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value.length > 140 ? `${value.slice(0, 137)}...` : value;
    }
  }
  try {
    const json = JSON.stringify(record);
    return json.length > 140 ? `${json.slice(0, 137)}...` : json;
  } catch {
    return "";
  }
}

function blockRunning(block: RawBlock, message: RawMessage): boolean {
  if (block.status === "running") {
    return true;
  }
  if (block.type === "text" && block.status === "running") {
    return true;
  }
  return (
    asString(message.isComplete) === "false" || message.isComplete === false
  );
}

/**
 * Parse the CLI's `chat-messages.json` (an array of ChatMessage records with
 * `variant` / `content` / `blocks`) into a view model for the panel.
 *
 * Unknown shapes are tolerated: anything unparseable is skipped rather than
 * failing the whole transcript.
 */
export function parseTranscript(raw: string): ChatMessageView[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const messages: ChatMessageView[] = [];
  parsed.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const message = entry as RawMessage;
    const variant =
      typeof message.variant === "string"
        ? message.variant
        : message.role === "user"
          ? "user"
          : "assistant";
    const id = asString(message.id) || `transcript-${index}`;
    const content = asString(message.content);
    const timestamp = asString(message.timestamp);
    const blocks = blocksOf(message);

    if (variant === "user") {
      messages.push({
        id,
        role: "user",
        text: content,
        thinking: "",
        tools: [],
        timestamp,
        running: false,
      });
      return;
    }

    if (variant === "error") {
      const text =
        content || asString(message.userError) || "Freebuff reported an error.";
      messages.push({
        id,
        role: "error",
        text,
        thinking: "",
        tools: [],
        timestamp,
        running: false,
      });
      return;
    }

    if (variant === "agent") {
      const agent =
        message.agent && typeof message.agent === "object"
          ? (message.agent as Record<string, unknown>)
          : undefined;
      const agentName =
        asString(agent?.agentName ?? message.agentName) || "agent";
      if (!content && blocks.length === 0) {
        return;
      }
      messages.push({
        id,
        role: "agent",
        text: content,
        thinking: "",
        tools: [],
        agentName,
        timestamp,
        running: false,
      });
      return;
    }

    // variant === 'ai'
    const thinkingParts: string[] = [];
    const textParts: string[] = [];
    const tools: ToolView[] = [];
    let running = message.isComplete === false;

    if (content.trim().length > 0) {
      textParts.push(content);
    }

    blocks.forEach((block, blockIndex) => {
      if (block.type === "text") {
        const blockContent = asString(block.content);
        if (block.textType === "reasoning") {
          if (blockContent.trim().length > 0) {
            thinkingParts.push(blockContent);
          }
        } else if (blockContent.trim().length > 0) {
          textParts.push(blockContent);
        }
        if (block.status === "running") {
          running = true;
        }
        return;
      }
      if (block.type === "plan") {
        const planContent = asString(block.content);
        if (planContent.trim().length > 0) {
          textParts.push(planContent);
        }
        return;
      }
      if (block.type === "tool") {
        const toolName = asString(block.toolName) || "tool";
        const isRunning =
          block.status === "running" ||
          (!asString(block.output) && block.output !== undefined
            ? false
            : false);
        tools.push({
          id: asString(block.toolCallId) || `${id}-tool-${blockIndex}`,
          name: toolName,
          summary: summarizeToolCall(toolName, block.input),
          output: asString(block.output),
          running: isRunning && block.status === "running",
        });
        if (block.status === "running") {
          running = true;
        }
        return;
      }
      if (block.type === "agent") {
        const agentName = asString(block.agentName) || "agent";
        const status = asString(block.status);
        tools.push({
          id: asString(block.agentId) || `${id}-agent-${blockIndex}`,
          name: `agent:${agentName}`,
          summary: asString(block.content),
          output: "",
          running: status === "running" || status === "",
        });
        if (status === "running" || status === "") {
          running = true;
        }
        return;
      }
      if (block.type === "image") {
        textParts.push("[image attachment]");
      }
    });

    const text = textParts.join("\n").trim();
    if (text.length === 0 && tools.length === 0 && thinkingParts.length === 0) {
      return;
    }

    messages.push({
      id,
      role: "assistant",
      text,
      thinking: thinkingParts.join("\n"),
      tools,
      timestamp,
      running,
    });
  });

  return messages;
}

/** `D:\work\My Project` -> `my-project` (the CLI's project folder name). */
export function projectSlug(root: string): string {
  const base = path.basename(root).toLowerCase();
  const slug = base.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "default";
}

export function configHome(): string {
  return path.join(os.homedir(), ".config", "manicode");
}

function isChatDir(entry: fs.Dirent): boolean {
  return entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(entry.name);
}

/** Candidate `chats` folders for a workspace, most specific first. */
export function chatsRootCandidates(root: string | undefined): string[] {
  const projects = path.join(configHome(), "projects");
  const candidates: string[] = [];
  if (root) {
    candidates.push(path.join(projects, projectSlug(root), "chats"));
  }
  try {
    for (const entry of fs.readdirSync(projects, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const chats = path.join(projects, entry.name, "chats");
      if (!candidates.includes(chats)) {
        candidates.push(chats);
      }
    }
  } catch {
    // Config dir may not exist yet; the primary candidate is enough.
  }
  return candidates;
}

/**
 * The chat directory with the freshest activity: a resumed session rewrites
 * files inside an old directory, so file mtime (not directory mtime) wins.
 */
export function findActiveChatDir(
  root: string | undefined,
): string | undefined {
  for (const chatsRoot of chatsRootCandidates(root)) {
    const candidate = newestChatIn(chatsRoot);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function newestChatIn(chatsRoot: string): string | undefined {
  let best: { dir: string; mtimeMs: number } | undefined;
  try {
    for (const entry of fs.readdirSync(chatsRoot, { withFileTypes: true })) {
      if (!isChatDir(entry)) {
        continue;
      }
      const dir = path.join(chatsRoot, entry.name);
      const mtimeMs =
        statMtime(path.join(dir, "chat-messages.json")) ?? statMtime(dir) ?? 0;
      if (!best || mtimeMs > best.mtimeMs) {
        best = { dir, mtimeMs };
      }
    }
  } catch {
    return undefined;
  }
  return best?.dir;
}

function statMtime(filePath: string): number | undefined {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Recent chats for the history picker: id, first prompt, message count. */
export interface ChatHistoryEntry {
  chatId: string;
  firstPrompt: string;
  messageCount: number;
  mtimeMs: number;
}

export function listChats(
  root: string | undefined,
  limit = 20,
): ChatHistoryEntry[] {
  const entries: ChatHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const chatsRoot of chatsRootCandidates(root)) {
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(chatsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirEntry of dirEntries) {
      if (!isChatDir(dirEntry) || seen.has(dirEntry.name)) {
        continue;
      }
      seen.add(dirEntry.name);
      const dir = path.join(chatsRoot, dirEntry.name);
      const messagesPath = path.join(dir, "chat-messages.json");
      let firstPrompt = "";
      let messageCount = 0;
      const metaPath = path.join(dir, "chat-meta.json");
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
          firstPrompt?: string;
          messageCount?: number;
        };
        firstPrompt =
          typeof meta.firstPrompt === "string" ? meta.firstPrompt : "";
        messageCount =
          typeof meta.messageCount === "number" ? meta.messageCount : 0;
      } catch {
        // Meta is written alongside the transcript; fall back to reading it.
      }
      if (!firstPrompt) {
        try {
          const messages = parseTranscript(
            fs.readFileSync(messagesPath, "utf8"),
          );
          messageCount = messages.length;
          firstPrompt =
            messages.find((message) => message.role === "user")?.text ?? "";
        } catch {
          // Chat dir without a transcript (session never completed a message).
        }
      }
      const mtimeMs = statMtime(messagesPath) ?? statMtime(dir) ?? 0;
      entries.push({
        chatId: dirEntry.name,
        firstPrompt,
        messageCount,
        mtimeMs,
      });
    }
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

export interface TranscriptSnapshot {
  chatDir: string;
  signature: string;
  messages: ChatMessageView[];
}

export function readSnapshot(
  chatDir: string,
  previousSignature: string | undefined,
): TranscriptSnapshot | undefined {
  const filePath = path.join(chatDir, "chat-messages.json");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return undefined;
  }
  const signature = `${filePath}:${stat.size}:${stat.mtimeMs}`;
  if (signature === previousSignature) {
    return undefined;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  return { chatDir, signature, messages: parseTranscript(raw) };
}

/**
 * Polls the CLI's transcript location and reports changes, so the panel can
 * render the conversation (including streaming updates) like Copilot Chat.
 */
export class TranscriptWatcher {
  private timer: ReturnType<typeof setInterval> | undefined;
  private signature: string | undefined;
  private activeChatDir: string | undefined;
  private lastRoot: string | undefined;

  constructor(
    private readonly getRoot: () => string | undefined,
    private readonly onUpdate: (
      messages: ChatMessageView[],
      chatDir: string | undefined,
    ) => void,
    private readonly intervalMs = 500,
  ) {}

  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick();
  }

  /** Force a re-read, e.g. after the user starts a new chat. */
  refresh(): void {
    this.signature = undefined;
    this.tick();
  }

  private tick(): void {
    const root = this.getRoot();
    if (root !== this.lastRoot) {
      this.lastRoot = root;
      this.signature = undefined;
      this.activeChatDir = undefined;
    }
    const chatDir = findActiveChatDir(root);
    if (!chatDir) {
      if (this.activeChatDir !== undefined) {
        this.activeChatDir = undefined;
        this.signature = undefined;
        this.onUpdate([], undefined);
      }
      return;
    }
    if (chatDir !== this.activeChatDir) {
      this.activeChatDir = chatDir;
      this.signature = undefined;
    }
    const snapshot = readSnapshot(chatDir, this.signature);
    if (!snapshot) {
      return;
    }
    this.signature = snapshot.signature;
    this.onUpdate(snapshot.messages, snapshot.chatDir);
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
