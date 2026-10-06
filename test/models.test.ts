import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_MODEL_ID,
  FREEBUFF_MODELS,
  mergeModelPreference,
  modelFromSettings,
  modelLabel,
  parseSettings,
  serializeSettings,
  writeModelPreference,
} from "../src/models";

describe("model catalog", () => {
  test("offers the regular picker with unique ids", () => {
    expect(FREEBUFF_MODELS).toHaveLength(12);
    const ids = FREEBUFF_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const model of FREEBUFF_MODELS) {
      expect(model.label.length).toBeGreaterThan(0);
      expect(model.id).toMatch(/^[a-z0-9-]+\/[a-z0-9._-]+$/i);
    }
    expect(ids).toContain(DEFAULT_MODEL_ID);
    expect(modelLabel(DEFAULT_MODEL_ID)).toBe("MiMo 2.6 Flash");
    expect(modelLabel("unknown/vendor-model")).toBe("unknown/vendor-model");
  });
});

describe("settings preference", () => {
  test("parses valid settings and tolerates broken ones", () => {
    expect(parseSettings('{"mode":"DEFAULT"}')).toEqual({ mode: "DEFAULT" });
    expect(parseSettings("not json")).toEqual({});
    expect(parseSettings("[1,2,3]")).toEqual({});
    expect(modelFromSettings({})).toBe(DEFAULT_MODEL_ID);
    expect(modelFromSettings({ freebuffModel: "z-ai/glm-5.3-flash" })).toBe(
      "z-ai/glm-5.3-flash",
    );
    expect(modelFromSettings({ freebuffModel: 42 })).toBe(DEFAULT_MODEL_ID);
  });

  test("merge keeps every other CLI setting intact", () => {
    const settings = parseSettings(
      '{"mode":"DEFAULT","adsEnabled":true,"freebuffReasoningEfforts":{}}',
    );
    const merged = mergeModelPreference(settings, "openai/gpt-6-luna");
    expect(merged).toEqual({
      mode: "DEFAULT",
      adsEnabled: true,
      freebuffReasoningEfforts: {},
      freebuffModel: "openai/gpt-6-luna",
    });
    expect(modelFromSettings(parseSettings(serializeSettings(merged)))).toBe(
      "openai/gpt-6-luna",
    );
  });

  test("writeModelPreference round-trips without clobbering existing keys", () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "fb-settings-")),
      "settings.json",
    );
    fs.writeFileSync(file, '{"mode":"DEFAULT","adsEnabled":false}', "utf8");

    const first = writeModelPreference("upstage/solar-mini4", file);
    expect(first.ok).toBe(true);
    const written = parseSettings(fs.readFileSync(file, "utf8"));
    expect(written).toEqual({
      mode: "DEFAULT",
      adsEnabled: false,
      freebuffModel: "upstage/solar-mini4",
    });

    const second = writeModelPreference("stealth/space-bunny-alpha", file);
    expect(second.ok).toBe(true);
    expect(
      modelFromSettings(parseSettings(fs.readFileSync(file, "utf8"))),
    ).toBe("stealth/space-bunny-alpha");
  });
});
