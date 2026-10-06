import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ModelOption {
  /** Wire id written to `settings.json` under `freebuffModel`. */
  id: string;
  label: string;
  tagline: string;
}

/**
 * The CLI's regular model picker. Ids are the wire ids exported by
 * `common/src/constants/freebuff-models.ts` in the Freebuff repo; the CLI
 * validates whatever is in settings and falls back to the default when a
 * model is unavailable to the account, so a stale id degrades gracefully.
 */
export const FREEBUFF_MODELS: ModelOption[] = [
  {
    id: "mimo/mimo-v2.5",
    label: "MiMo 2.6 Flash",
    tagline: "Balanced · default",
  },
  {
    id: "z-ai/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    tagline: "Deepest reasoning, unmetered",
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    tagline: "Fast coding, unmetered",
  },
  {
    id: "deepseek/deepseek-v4-flash-fast",
    label: "DeepSeek V4.1 Flash Fast",
    tagline: "Parallel subagents",
  },
  {
    id: "openai/gpt-6-luna",
    label: "GPT-6 Luna",
    tagline: "Strong all-around",
  },
  {
    id: "mimo/mimo-v2.6-pro",
    label: "MiMo 2.6 Pro",
    tagline: "Stronger reasoning",
  },
  {
    id: "upstage/solar-mini4",
    label: "Solar Mini 4",
    tagline: "Fast, 524K context",
  },
  {
    id: "upstage/solar-pro4",
    label: "Solar Pro 4",
    tagline: "Strong, 524K context",
  },
  {
    id: "stealth/space-bunny-alpha",
    label: "Space Bunny Alpha",
    tagline: "Beta, 1M context",
  },
  {
    id: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    tagline: "1M context, audio/video",
  },
  {
    id: "meta/muse-spark-1.3-contributor",
    label: "Muse Spark 1.3",
    tagline: "Agentic coding, 1M",
  },
  {
    id: "openai/gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    tagline: "Flagship, 1M context",
  },
];

export const DEFAULT_MODEL_ID = "mimo/mimo-v2.5";

export function settingsPath(): string {
  return path.join(os.homedir(), ".config", "manicode", "settings.json");
}

export function parseSettings(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Unreadable settings must not block the picker; treat as empty.
  }
  return {};
}

/** Merge-write helper: keeps every other CLI setting intact. */
export function mergeModelPreference(
  settings: Record<string, unknown>,
  modelId: string,
): Record<string, unknown> {
  return { ...settings, freebuffModel: modelId };
}

export function serializeSettings(settings: Record<string, unknown>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export function modelLabel(modelId: string): string {
  return (
    FREEBUFF_MODELS.find((model) => model.id === modelId)?.label ?? modelId
  );
}

/** Current pick from a settings payload; defaults to the CLI default. */
export function modelFromSettings(settings: Record<string, unknown>): string {
  const stored = settings["freebuffModel"];
  if (typeof stored === "string" && stored.length > 0) {
    return stored;
  }
  return DEFAULT_MODEL_ID;
}

export function readCurrentModel(filePath = settingsPath()): string {
  try {
    return modelFromSettings(parseSettings(fs.readFileSync(filePath, "utf8")));
  } catch {
    return DEFAULT_MODEL_ID;
  }
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

/** Persist the pick so the next Freebuff start (or restart) uses it. */
export function writeModelPreference(
  modelId: string,
  filePath = settingsPath(),
): WriteResult {
  try {
    let settings: Record<string, unknown> = {};
    try {
      settings = parseSettings(fs.readFileSync(filePath, "utf8"));
    } catch {
      // First run: no settings file yet, create it below.
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      serializeSettings(mergeModelPreference(settings, modelId)),
      "utf8",
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
