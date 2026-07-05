import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TuiCommand, TuiSlotPlugin } from "@opencode-ai/plugin/tui";
import { testRender } from "@opentui/solid";
import type { TimedSendStatus } from "../src/status.js";
import type { TuiApi } from "../src/tui.js";
import {
	formatStatusLine,
	TimedSendSidebar,
	timedSendTui,
} from "../src/tui.js";

describe("tui formatting", () => {
	const waiting: TimedSendStatus = {
		schemaVersion: 1,
		state: "waiting",
		sessionID: "ses_test",
		startedAt: "2026-07-01T00:30:00.000Z",
		nextStartAt: new Date(2026, 6, 1, 1, 30, 0).toISOString(),
		windowStart: "01:30",
		windowEnd: "09:30",
		configPath:
			"C:/Users/Zhang/.config/opencode-oc/opencode/opencode-timed-send.json",
		reason: "outside_window",
	};

	test("waiting status formats as start time plus countdown without a prefix", () => {
		const formatted = formatStatusLine(waiting, new Date(2026, 6, 1, 0, 0, 0));
		expect(formatted).toBe("01:30 in 1h 30m");
		expect(formatted).not.toContain("[alarm]");
	});

	test("open status formats as the remaining cutoff time", () => {
		const open: TimedSendStatus = {
			schemaVersion: 1,
			state: "open",
			sessionID: "ses_test",
			startedAt: "2026-07-01T02:00:00.000Z",
			windowStart: "01:30",
			windowEnd: "09:30",
			configPath:
				"C:/Users/Zhang/.config/opencode-oc/opencode/opencode-timed-send.json",
		};

		const formatted = formatStatusLine(open, new Date(2026, 6, 1, 3, 0, 0));

		expect(formatted).toBe("window open until 09:30");
		expect(formatted).not.toContain("[alarm]");
		expect(formatted).not.toContain("01:30-09:30");
	});

	test("tui plugin registers sidebar content and plugin-owned commands", async () => {
		const slotNames: string[] = [];
		const commands: TuiCommand[] = [];
		const toastMessages: string[] = [];
		const commandSelections: Promise<void>[] = [];
		const api: TuiApi = {
			slots: {
				register: (plugin: TuiSlotPlugin) => {
					slotNames.push(...Object.keys(plugin.slots));
					return "opencode-timed-send";
				},
			},
			command: {
				register: (getCommands: () => TuiCommand[]) => {
					const registered = getCommands();
					commands.push(...registered);
					const selected = registered[0]?.onSelect?.();
					if (selected instanceof Promise) {
						commandSelections.push(selected);
					}
					return () => undefined;
				},
			},
			ui: {
				toast: (input) => {
					toastMessages.push(input.message);
				},
			},
			lifecycle: {
				onDispose: (dispose) => {
					dispose();
					return () => undefined;
				},
			},
		};

		await timedSendTui(api, {
			readText: async () => '{"start":"01:30","end":"09:30"}',
			readStatus: async () => waiting,
			now: () => new Date(2026, 6, 1, 0, 0, 0),
		});
		await Promise.all(commandSelections);

		expect(slotNames).toEqual(["sidebar_content"]);
		expect(
			commands.flatMap((command) =>
				command.slash === undefined ? [] : [command.slash.name],
			),
		).toEqual(["timed-send-status", "time-send-now"]);
		expect(toastMessages).toEqual(["01:30 in 1h 30m"]);
	});

	test("time-send-now releases a waiting status through the shared status file", async () => {
		const commands: TuiCommand[] = [];
		const toastMessages: string[] = [];
		const writtenStatuses: TimedSendStatus[] = [];
		const api: TuiApi = {
			slots: {
				register: () => "opencode-timed-send",
			},
			command: {
				register: (getCommands: () => TuiCommand[]) => {
					commands.push(...getCommands());
					return () => undefined;
				},
			},
			ui: {
				toast: (input) => {
					toastMessages.push(input.message);
				},
			},
			lifecycle: {
				onDispose: () => () => undefined,
			},
		};

		await timedSendTui(api, {
			readText: async () => '{"start":"01:30","end":"09:30"}',
			readStatus: async () => writtenStatuses.at(-1) ?? waiting,
			writeStatus: async (_path, status) => {
				writtenStatuses.push(status);
			},
			now: () => new Date(2026, 6, 1, 0, 0, 0),
		});
		const sendNow = commands.find(
			(command) => command.slash?.name === "time-send-now",
		);

		await sendNow?.onSelect?.();

		expect(writtenStatuses.map((status) => status.state)).toEqual(["released"]);
		expect(writtenStatuses.map((status) => status.reason)).toEqual(["manual"]);
		expect(toastMessages).toEqual(["timed-send released now"]);
	});

	test("display flags disable sidebar only when both legacy locations are disabled", async () => {
		const slotNames: string[] = [];
		const api: TuiApi = {
			slots: {
				register: (plugin: TuiSlotPlugin) => {
					slotNames.push(...Object.keys(plugin.slots));
					return "opencode-timed-send";
				},
			},
			ui: {
				toast: () => undefined,
			},
			lifecycle: {
				onDispose: (dispose) => {
					dispose();
					return () => undefined;
				},
			},
		};

		await timedSendTui(api, {
			readText: async () =>
				'{"start":"01:30","end":"09:30","display":{"promptRight":false,"appBottom":true}}',
			readStatus: async () => waiting,
			now: () => new Date(2026, 6, 1, 0, 0, 0),
		});

		expect(slotNames).toEqual(["sidebar_content"]);

		slotNames.length = 0;
		await timedSendTui(api, {
			readText: async () =>
				'{"start":"01:30","end":"09:30","display":{"promptRight":false,"appBottom":false}}',
			readStatus: async () => waiting,
			now: () => new Date(2026, 6, 1, 0, 0, 0),
		});

		expect(slotNames).toEqual([]);
	});

	test("slot implementation is sidebar-based, reactive, and wraps text nodes", async () => {
		const source = await readFile(
			join(process.cwd(), "src", "tui.tsx"),
			"utf8",
		);

		expect(source).toContain('import { onCleanup } from "solid-js"');
		expect(source).toContain("type StatusSubscription");
		expect(source).toContain("statusText.content = value");
		expect(source).toContain("container.requestRender()");
		expect(source).toContain("statusText.requestRender()");
		expect(source).toContain("subscribe={subscribe}");
		expect(source).toContain("sidebar_content");
		expect(source).toContain("Timed send");
		expect(source).not.toContain('import { createSignal } from "solid-js"');
		expect(source).not.toContain("createMemo");
		expect(source).not.toContain("<Show");
		expect(source).not.toContain("statusLine()");
		expect(source).not.toContain("children: () => renderSidebarContent");
		expect(source).not.toContain("<Show when={statusLine().length > 0}>");
		expect(source).not.toContain("<text>{statusLine()}</text>");
		expect(source).not.toContain("const statusLine = createMemo(props.render)");
		expect(source).not.toContain("const statusLine = renderSlot(props.render)");
		expect(source).not.toContain("let cachedStatus");
		expect(source).not.toContain("cachedStatus = await");
		expect(source).not.toContain("session_prompt_right: render");
		expect(source).not.toContain("app_bottom: render");
		expect(source).not.toContain("session_prompt_right");
		expect(source).not.toContain("app_bottom");
	});

	test("sidebar render updates when the status subscription publishes", async () => {
		let line = "01:30 in 1h 30m";
		const subscribers = new Set<() => void>();
		const setup = await testRender(
			() =>
				TimedSendSidebar({
					render: () => line,
					subscribe: (subscriber) => {
						subscribers.add(subscriber);
						subscriber();
						return () => {
							subscribers.delete(subscriber);
						};
					},
				}),
			{ width: 80, height: 6 },
		);
		try {
			await setup.flush();
			expect(setup.captureCharFrame()).toContain("1h 30m");

			line = "01:30 in 1h";
			for (const subscriber of subscribers) {
				subscriber();
			}
			await setup.renderOnce();
			await setup.flush();
			const updatedFrame = setup.captureCharFrame();
			expect(updatedFrame).toContain("1h");
			expect(updatedFrame).not.toContain("1h 30m");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("sidebar hides when the status subscription publishes an empty line", async () => {
		let line = "01:30 in 1h 30m";
		const subscribers = new Set<() => void>();
		const setup = await testRender(
			() =>
				TimedSendSidebar({
					render: () => line,
					subscribe: (subscriber) => {
						subscribers.add(subscriber);
						subscriber();
						return () => {
							subscribers.delete(subscriber);
						};
					},
				}),
			{ width: 80, height: 6 },
		);
		try {
			await setup.flush();
			expect(setup.captureCharFrame()).toContain("Timed send");

			line = "";
			for (const subscriber of subscribers) {
				subscriber();
			}
			await setup.renderOnce();
			await setup.flush();

			expect(setup.captureCharFrame()).not.toContain("Timed send");
			expect(setup.captureCharFrame()).not.toContain("[alarm]");
		} finally {
			setup.renderer.destroy();
		}
	});
});
