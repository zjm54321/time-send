import {
	type LoadConfigOptions,
	loadConfigWithPath,
	resolveStatusPath,
} from "./config.js";
import {
	readStatus,
	removeStatus,
	type TimedSendStatus,
	writeStatus,
} from "./status.js";
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
	readonly event: (input: ServerEventInput) => Promise<void>;
}

export interface ServerEventInput {
	readonly event: unknown;
}

export interface TimedSendServerOptions {
	readonly configPath?: string;
	readonly env?: LoadConfigOptions["env"];
	readonly now?: () => Date;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly readText?: LoadConfigOptions["readText"];
	readonly readStatus?: (path: string) => Promise<TimedSendStatus | undefined>;
	readonly writeStatus?: (
		path: string,
		status: TimedSendStatus,
	) => Promise<void>;
	readonly removeStatus?: (path: string) => Promise<void>;
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
	const releasedSessions = new Map<string, string>();
	return {
		"chat.params": async (
			chatInput: ChatParamsInput,
			_output: ChatParamsOutput,
		): Promise<void> => {
			const directory = input.directory;
			const loadOptions = toLoadConfigOptions(directory, options);
			const { config, configPath } = await loadConfigWithPath(loadOptions);
			const statusPath = resolveStatusPath(config, configPath);
			const now = options.now?.() ?? new Date();
			const existingStatus = await (options.readStatus ?? readStatus)(
				statusPath,
			);
			if (isManualReleaseForSession(existingStatus, chatInput.sessionID)) {
				releasedSessions.set(chatInput.sessionID, statusPath);
				return;
			}

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
				releasedSessions.set(chatInput.sessionID, statusPath);
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
		event: async ({ event }: ServerEventInput): Promise<void> => {
			const sessionID = interruptedSessionID(event);
			if (sessionID === undefined) {
				return;
			}
			const statusPath = releasedSessions.get(sessionID);
			if (statusPath === undefined) {
				return;
			}
			releasedSessions.delete(sessionID);
			await (options.removeStatus ?? removeStatus)(statusPath);
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
		if (isManualReleaseForSession(status, sessionID)) {
			return true;
		}
		remainingMs -= stepMs;
	}
	return false;
}

function isManualReleaseForSession(
	status: TimedSendStatus | undefined,
	sessionID: string,
): boolean {
	return (
		status?.state === "released" &&
		status.sessionID === sessionID &&
		status.reason === "manual"
	);
}

function interruptedSessionID(event: unknown): string | undefined {
	if (!isPlainObject(event)) {
		return undefined;
	}
	if (event.type !== "session.deleted" && event.type !== "session.error") {
		return undefined;
	}
	const properties = event.properties;
	if (!isPlainObject(properties)) {
		return undefined;
	}
	return typeof properties.sessionID === "string"
		? properties.sessionID
		: undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
		...(options.env === undefined ? {} : { env: options.env }),
		...(options.readText === undefined ? {} : { readText: options.readText }),
	};
}
