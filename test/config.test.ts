import { describe, expect, test } from "bun:test";
import {
	defaultConfig,
	loadConfig,
	loadConfigWithPath,
	parseConfig,
	resolveConfigPath,
	TimedSendConfigError,
} from "../src/config.js";

describe("config parsing", () => {
	test("missing fields use defaults", () => {
		const cfg = parseConfig("{}");
		expect(cfg).toEqual(defaultConfig);
	});

	test("custom JSON config overrides the default window", () => {
		const cfg = parseConfig(
			'{"enabled":true,"start":"03:00","end":"08:30","statusFile":"state.json","display":{"promptRight":false,"appBottom":true}}',
		);
		expect(cfg.start).toBe("03:00");
		expect(cfg.end).toBe("08:30");
		expect(cfg.statusFile).toBe("state.json");
		expect(cfg.display).toEqual({ promptRight: false, appBottom: true });
	});

	test("display config no longer preserves icon text", () => {
		const cfg = parseConfig(
			'{"display":{"promptRight":false,"appBottom":true,"icon":"clock"}}',
		);
		expect(cfg.display).toEqual({ promptRight: false, appBottom: true });
	});

	test("malformed JSON fails closed", () => {
		expect(() => parseConfig("{")).toThrow();
	});

	test("invalid start and end values fail closed", () => {
		expect(() => parseConfig('{"start":"2am"}')).toThrow(TimedSendConfigError);
		expect(() => parseConfig('{"start":"02:00","end":"02:00"}')).toThrow(
			"different",
		);
	});

	test("loadConfig uses defaults when the JSON file is missing", async () => {
		const cfg = await loadConfig({ readText: async () => undefined });
		expect(cfg).toEqual(defaultConfig);
	});

	test("resolveConfigPath prefers an explicit JSON config path", () => {
		const resolved = resolveConfigPath({
			configPath: "timed.json",
			directory: "C:/Users/Zhang/.config/opencode-oc/opencode",
		});
		expect(resolved.replaceAll("\\", "/")).toEndWith("/opencode/timed.json");
	});

	test("resolveConfigPath treats OpenCode config file paths as their directory", () => {
		const resolved = resolveConfigPath({
			directory: "C:/Users/Zhang/.config/opencode-oc/opencode/opencode.json",
		});
		expect(resolved.replaceAll("\\", "/")).toBe(
			"C:/Users/Zhang/.config/opencode-oc/opencode/opencode-timed-send.json",
		);
	});

	test("loadConfigWithPath keeps directory-relative config ahead of OpenCode config fallback", async () => {
		const reads: string[] = [];
		const result = await loadConfigWithPath({
			configPath: "opencode-timed-send.json",
			directory: "C:/Users/Zhang/project",
			env: { XDG_CONFIG_HOME: "C:/Users/Zhang/.config/opencode-oc" },
			readText: async (path) => {
				reads.push(path.replaceAll("\\", "/"));
				if (
					path
						.replaceAll("\\", "/")
						.endsWith("/project/opencode-timed-send.json")
				) {
					return '{"start":"03:00","end":"08:30"}';
				}
				if (
					path
						.replaceAll("\\", "/")
						.endsWith("/opencode/opencode-timed-send.json")
				) {
					return '{"start":"01:30","end":"09:30"}';
				}
				return undefined;
			},
		});

		expect(result.config.start).toBe("03:00");
		expect(result.configPath.replaceAll("\\", "/")).toEndWith(
			"/project/opencode-timed-send.json",
		);
		expect(reads).toEqual(["C:/Users/Zhang/project/opencode-timed-send.json"]);
	});

	test("loadConfigWithPath falls back to the OpenCode XDG config directory", async () => {
		const reads: string[] = [];
		const result = await loadConfigWithPath({
			configPath: "opencode-timed-send.json",
			directory: "C:/Users/Zhang/project",
			env: { XDG_CONFIG_HOME: "C:/Users/Zhang/.config/opencode-oc" },
			readText: async (path) => {
				const normalized = path.replaceAll("\\", "/");
				reads.push(normalized);
				if (normalized.endsWith("/opencode/opencode-timed-send.json")) {
					return '{"start":"01:30","end":"09:30"}';
				}
				return undefined;
			},
		});

		expect(result.config.start).toBe("01:30");
		expect(result.config.end).toBe("09:30");
		expect(result.configPath.replaceAll("\\", "/")).toEndWith(
			"/opencode/opencode-timed-send.json",
		);
		expect(reads).toEqual([
			"C:/Users/Zhang/project/opencode-timed-send.json",
			"C:/Users/Zhang/.config/opencode-oc/opencode/opencode-timed-send.json",
		]);
	});

	test("loadConfigWithPath prefers OPENCODE_CONFIG_DIR over XDG fallback", async () => {
		const result = await loadConfigWithPath({
			configPath: "opencode-timed-send.json",
			directory: "C:/Users/Zhang/project",
			env: {
				OPENCODE_CONFIG_DIR: "C:/Users/Zhang/custom-opencode",
				XDG_CONFIG_HOME: "C:/Users/Zhang/.config/opencode-oc",
			},
			readText: async (path) => {
				if (
					path
						.replaceAll("\\", "/")
						.endsWith("/custom-opencode/opencode-timed-send.json")
				) {
					return '{"start":"04:00","end":"08:00"}';
				}
				return undefined;
			},
		});

		expect(result.config.start).toBe("04:00");
		expect(result.configPath.replaceAll("\\", "/")).toEndWith(
			"/custom-opencode/opencode-timed-send.json",
		);
	});
});
