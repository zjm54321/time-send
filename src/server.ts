import {
	type LoadConfigOptions,
	loadConfig,
	resolveConfigPath,
	resolveStatusPath,
} from "./config.js";
import { readStatus, type TimedSendStatus, writeStatus } from "./status.js";
import { evaluateWindow } from "./time-window.js";

export const PLUGIN_ID = "opencode-timed-send";

export interface ServerPluginInput {
	readonly directory?: string;
}

export interface ChatParamsInput {
	readonly sessionID: string;
	readonly [key: string]: unknown;
}

export type ChatParamsOutput = Record<string, unknown>;

export interface ServerHooks {
	readonly "chat.params": (
		input: ChatParamsInput,
		output: ChatParamsOutput,
	) => Promise<void>;
}

export interface TimedSendServerOptions {
	readonly configPath?: string;
	readonly now?: () => Date;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly readText?: LoadConfigOptions["readText"];
	readonly readStatus?: (path: string) => Promise<TimedSendStatus | undefined>;
	readonly writeStatus?: (
		path: string,
		status: TimedSendStatus,
	) => Promise<void>;
}

const RELEASE_POLL_MS = 1000;

export interface ServerModule {
	readonly id: typeof PLUGIN_ID;
	readonly server: (
		input: ServerPluginInput,
		options?: TimedSendServerOptions,
	) => Promise<ServerHooks>;
}

export async function timedSendServer(
	input: ServerPluginInput,
	options: TimedSendServerOptions = {},
): Promise<ServerHooks> {
	return {
		"chat.params": async (
			chatInput: ChatParamsInput,
			_output: ChatParamsOutput,
		): Promise<void> => {
			const directory = input.directory;
			const loadOptions = toLoadConfigOptions(directory, options);
			const configPath = resolveConfigPath(loadOptions);
			const config = await loadConfig(loadOptions);
			const statusPath = resolveStatusPath(config, configPath);
			const now = options.now?.() ?? new Date();

			if (!config.enabled) {
				await writeCurrentStatus(options, statusPath, {
					schemaVersion: 1,
					state: "disabled",
					sessionID: chatInput.sessionID,
					startedAt: now.toISOString(),
					windowStart: config.start,
					windowEnd: config.end,
					configPath,
				});
				return;
			}

			const evaluation = evaluateWindow(now, config);
			if (evaluation.state === "open") {
				await writeCurrentStatus(options, statusPath, {
					schemaVersion: 1,
					state: "open",
					sessionID: chatInput.sessionID,
					startedAt: now.toISOString(),
					windowStart: config.start,
					windowEnd: config.end,
					configPath,
				});
				return;
			}

			await writeCurrentStatus(options, statusPath, {
				schemaVersion: 1,
				state: "waiting",
				sessionID: chatInput.sessionID,
				startedAt: now.toISOString(),
				nextStartAt: evaluation.nextStartAt.toISOString(),
				windowStart: config.start,
				windowEnd: config.end,
				configPath,
				reason: "outside_window",
			});
			const released = await waitForWindowOrRelease(
				options,
				statusPath,
				chatInput.sessionID,
				evaluation.waitMs,
			);
			if (released) {
				return;
			}
			await writeCurrentStatus(options, statusPath, {
				schemaVersion: 1,
				state: "released",
				sessionID: chatInput.sessionID,
				startedAt: new Date().toISOString(),
				windowStart: config.start,
				windowEnd: config.end,
				configPath,
			});
		},
	};
}

const serverModule: ServerModule = {
	id: PLUGIN_ID,
	server: timedSendServer,
};

export default serverModule;

async function defaultSleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function writeCurrentStatus(
	options: TimedSendServerOptions,
	path: string,
	status: TimedSendStatus,
): Promise<void> {
	await (options.writeStatus ?? writeStatus)(path, status);
}

async function waitForWindowOrRelease(
	options: TimedSendServerOptions,
	statusPath: string,
	sessionID: string,
	waitMs: number,
): Promise<boolean> {
	const sleep = options.sleep ?? defaultSleep;
	const readStatusFn = options.readStatus ?? readStatus;
	let remainingMs = waitMs;
	while (remainingMs > 0) {
		const stepMs = Math.min(remainingMs, RELEASE_POLL_MS);
		await sleep(stepMs);
		const status = await readStatusFn(statusPath);
		if (status?.state === "released" && status.sessionID === sessionID) {
			return true;
		}
		remainingMs -= stepMs;
	}
	return false;
}

function toLoadConfigOptions(
	directory: string | undefined,
	options: TimedSendServerOptions,
): LoadConfigOptions {
	return {
		...(options.configPath === undefined
			? {}
			: { configPath: options.configPath }),
		...(directory === undefined ? {} : { directory }),
		...(options.readText === undefined ? {} : { readText: options.readText }),
	};
}
