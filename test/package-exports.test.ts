import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import serverModule from "../src/server.js";
import tuiModule from "../src/tui.js";

describe("package exports", () => {
	test("package metadata is ready for time-send publishing", async () => {
		const packageJson = await readFile(
			join(process.cwd(), "package.json"),
			"utf8",
		);

		expect(packageJson).toContain('"name": "time-send"');
		expect(packageJson).toContain('"version": "0.1.1"');
		expect(packageJson).toContain('"license": "MIT"');
		expect(packageJson).toContain('"publishConfig"');
		expect(packageJson).toContain('"access": "public"');
		expect(packageJson).toContain('"keywords"');
		expect(packageJson).toContain('"opencode"');
		expect(packageJson).toContain('"time-send"');
	});

	test("README documents staged time-send package installation", async () => {
		const readme = await readFile(join(process.cwd(), "README.md"), "utf8");

		expect(readme).toContain('"time-send@latest"');
		expect(readme).toContain('"file:///C:/Users/Zhang/opencode-timed-send"');
		expect(readme).toContain('"configPath": "opencode-timed-send.json"');
		expect(readme).not.toContain(
			'"configPath": "C:/Users/Zhang/.config/opencode-oc/opencode/opencode-timed-send.json"',
		);
		expect(readme).toContain(
			"After `npm view time-send@latest version` succeeds",
		);
		expect(readme).toContain(
			"Keep the local `file:///C:/Users/Zhang/opencode-timed-send` entry active",
		);
		expect(readme).toContain("Do not use `time-send/tui` in `tui.json`");
		expect(readme).toContain("time-send/server");
		expect(readme).toContain("time-send/tui");
		expect(readme).toContain("time-send/schema.json");
		expect(readme).not.toContain('"opencode-timed-send@latest"');
	});

	test("server target default export is server-only", () => {
		expect(serverModule.id).toBe("opencode-timed-send");
		expect(typeof serverModule.server).toBe("function");
		expect(Object.keys(serverModule).sort()).toEqual(["id", "server"]);
	});

	test("tui target default export is tui-only", () => {
		expect(tuiModule.id).toBe("opencode-timed-send");
		expect(typeof tuiModule.tui).toBe("function");
		expect(Object.keys(tuiModule).sort()).toEqual(["id", "tui"]);
	});

	test("package exports do not publish configPath defaults", async () => {
		const parsed: unknown = JSON.parse(
			await readFile(join(process.cwd(), "package.json"), "utf8"),
		);
		expect(JSON.stringify(parsed)).not.toContain('"configPath"');
	});

	test("published docs and schema do not expose icon configuration", async () => {
		const schema = await readFile(join(process.cwd(), "schema.json"), "utf8");
		const readme = await readFile(join(process.cwd(), "README.md"), "utf8");

		expect(schema).not.toContain("icon");
		expect(readme).not.toContain("display.icon");
		expect(readme).not.toContain("[alarm]");
	});
});
