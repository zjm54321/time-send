import { describe, expect, test } from "bun:test";
import { type ChatParamsOutput, timedSendServer } from "../src/server.js";
import type { TimedSendStatus } from "../src/status.js";

describe("server", () => {
	test("chat.params waits when outside the configured window", async () => {
		const delays: number[] = [];
		const statuses: TimedSendStatus[] = [];
		const hooks = await timedSendServer(
			{ directory: "C:/Users/Zhang/.config/opencode-oc/opencode" },
			{
				configPath: "opencode-timed-send.json",
				now: () => new Date(2026, 6, 1, 1, 59, 59),
				readText: async () => '{"start":"02:00","end":"09:00"}',
				sleep: async (ms: number) => {
					delays.push(ms);
				},
				writeStatus: async (_path: string, status: TimedSendStatus) => {
					statuses.push(status);
				},
			},
		);
		const output: ChatParamsOutput = { temperature: 0.3 };
		await hooks["chat.params"]({ sessionID: "ses_test" }, output);

		expect(delays).toEqual([1000]);
		expect(statuses.map((status) => status.state)).toEqual([
			"waiting",
			"released",
		]);
		expect(statuses[0]?.nextStartAt).toBe(
			new Date(2026, 6, 1, 2, 0, 0).toISOString(),
		);
		expect(output).toEqual({ temperature: 0.3 });
	});

	test("chat.params proceeds when a matching waiting status is released early", async () => {
		const delays: number[] = [];
		const statuses: TimedSendStatus[] = [];
		const hooks = await timedSendServer(
			{ directory: "C:/Users/Zhang/.config/opencode-oc/opencode" },
			{
				configPath: "opencode-timed-send.json",
				now: () => new Date(2026, 6, 1, 1, 58, 0),
				readText: async () => '{"start":"02:00","end":"09:00"}',
				sleep: async (ms: number) => {
					delays.push(ms);
					statuses.push({
						schemaVersion: 1,
						state: "released",
						sessionID: "ses_test",
						startedAt: "2026-07-01T01:58:01.000Z",
						windowStart: "02:00",
						windowEnd: "09:00",
						configPath:
							"C:/Users/Zhang/.config/opencode-oc/opencode/opencode-timed-send.json",
					});
				},
				readStatus: async () => statuses.at(-1),
				writeStatus: async (_path: string, status: TimedSendStatus) => {
					statuses.push(status);
				},
			},
		);
		await hooks["chat.params"]({ sessionID: "ses_test" }, {});

		expect(delays).toEqual([1000]);
		expect(statuses.map((status) => status.state)).toEqual([
			"waiting",
			"released",
		]);
	});

	test("chat.params resolves filename configPath from the OpenCode config directory", async () => {
		const writes: Array<{
			readonly path: string;
			readonly status: TimedSendStatus;
		}> = [];
		const hooks = await timedSendServer(
			{ directory: "C:/Users/Zhang/worktree" },
			{
				configPath: "opencode-timed-send.json",
				env: { XDG_CONFIG_HOME: "C:/Users/Zhang/.config/opencode-oc" },
				now: () => new Date(2026, 6, 1, 2, 1, 0),
				readText: async (path: string) => {
					if (
						path
							.replaceAll("\\", "/")
							.endsWith("/opencode/opencode-timed-send.json")
					) {
						return '{"start":"01:30","end":"09:30","statusFile":"opencode-timed-send.status.json"}';
					}
					return undefined;
				},
				writeStatus: async (path: string, status: TimedSendStatus) => {
					writes.push({ path: path.replaceAll("\\", "/"), status });
				},
			},
		);
		await hooks["chat.params"]({ sessionID: "ses_test" }, {});

		expect(writes).toHaveLength(1);
		expect(writes[0]?.path).toBe(
			"C:/Users/Zhang/.config/opencode-oc/opencode/opencode-timed-send.status.json",
		);
		expect(writes[0]?.status.windowStart).toBe("01:30");
		expect(writes[0]?.status.windowEnd).toBe("09:30");
		expect(writes[0]?.status.configPath.replaceAll("\\", "/")).toBe(
			"C:/Users/Zhang/.config/opencode-oc/opencode/opencode-timed-send.json",
		);
	});

	test("chat.params proceeds immediately inside the configured window", async () => {
		const delays: number[] = [];
		const statuses: TimedSendStatus[] = [];
		const hooks = await timedSendServer(
			{ directory: "C:/Users/Zhang/.config/opencode-oc/opencode" },
			{
				now: () => new Date(2026, 6, 1, 2, 1, 0),
				readText: async () => '{"start":"02:00","end":"09:00"}',
				sleep: async (ms: number) => {
					delays.push(ms);
				},
				writeStatus: async (_path: string, status: TimedSendStatus) => {
					statuses.push(status);
				},
			},
		);
		await hooks["chat.params"]({ sessionID: "ses_test" }, {});

		expect(delays).toEqual([]);
		expect(statuses.map((status) => status.state)).toEqual(["open"]);
	});

	test("malformed config rejects before sleeping", async () => {
		const delays: number[] = [];
		const hooks = await timedSendServer(
			{ directory: "C:/Users/Zhang/.config/opencode-oc/opencode" },
			{
				readText: async () => "{",
				sleep: async (ms: number) => {
					delays.push(ms);
				},
			},
		);
		await expect(
			hooks["chat.params"]({ sessionID: "ses_test" }, {}),
		).rejects.toThrow();
		expect(delays).toEqual([]);
	});
});
