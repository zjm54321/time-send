import { describe, expect, test } from "bun:test";
import { defaultConfig, loadConfig, parseConfig, resolveConfigPath, TimedSendConfigError } from "../src/config.js";

describe("config parsing", () => {
  test("missing fields use defaults", () => {
    const cfg = parseConfig("{}");
    expect(cfg).toEqual(defaultConfig);
  });

  test("custom JSON config overrides the default window", () => {
    const cfg = parseConfig('{"enabled":true,"start":"03:00","end":"08:30","statusFile":"state.json","display":{"promptRight":false,"appBottom":true}}');
    expect(cfg.start).toBe("03:00");
    expect(cfg.end).toBe("08:30");
    expect(cfg.statusFile).toBe("state.json");
    expect(cfg.display).toEqual({ promptRight: false, appBottom: true });
  });

  test("display config no longer preserves icon text", () => {
    const cfg = parseConfig('{"display":{"promptRight":false,"appBottom":true,"icon":"clock"}}');
    expect(cfg.display).toEqual({ promptRight: false, appBottom: true });
  });

  test("malformed JSON fails closed", () => {
    expect(() => parseConfig("{")).toThrow();
  });

  test("invalid start and end values fail closed", () => {
    expect(() => parseConfig('{"start":"2am"}')).toThrow(TimedSendConfigError);
    expect(() => parseConfig('{"start":"02:00","end":"02:00"}')).toThrow("different");
  });

  test("loadConfig uses defaults when the JSON file is missing", async () => {
    const cfg = await loadConfig({ readText: async () => undefined });
    expect(cfg).toEqual(defaultConfig);
  });

  test("resolveConfigPath prefers an explicit JSON config path", () => {
    const resolved = resolveConfigPath({ configPath: "timed.json", directory: "C:/Users/Zhang/.config/opencode-oc/opencode" });
    expect(resolved.replaceAll("\\", "/")).toEndWith("/opencode/timed.json");
  });
});
