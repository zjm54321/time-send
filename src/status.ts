import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type TimedSendState =
	| "waiting"
	| "released"
	| "open"
	| "error"
	| "disabled";

export interface TimedSendStatus {
	readonly schemaVersion: 1;
	readonly state: TimedSendState;
	readonly sessionID?: string;
	readonly startedAt: string;
	readonly nextStartAt?: string;
	readonly windowStart: string;
	readonly windowEnd: string;
	readonly configPath: string;
	readonly reason?: string;
	readonly message?: string;
}

const pendingStatusWrites = new Map<string, Promise<void>>();

export async function writeStatus(
	path: string,
	status: TimedSendStatus,
): Promise<void> {
	const previous = pendingStatusWrites.get(path) ?? Promise.resolve();
	const next = previous.then(
		() => writeStatusFile(path, status),
		() => writeStatusFile(path, status),
	);
	const tracked = next.finally(() => {
		if (pendingStatusWrites.get(path) === tracked) {
			pendingStatusWrites.delete(path);
		}
	});
	pendingStatusWrites.set(path, tracked);
	return next;
}

export async function removeStatus(path: string): Promise<void> {
	await rm(path, { force: true });
}

async function writeStatusFile(
	path: string,
	status: TimedSendStatus,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
	await replaceFile(tempPath, path);
}

async function replaceFile(tempPath: string, path: string): Promise<void> {
	try {
		await rename(tempPath, path);
	} catch (error: unknown) {
		if (
			!isNodeError(error) ||
			(error.code !== "EEXIST" && error.code !== "EPERM")
		) {
			throw error;
		}
		await rm(path, { force: true });
		await rename(tempPath, path);
	}
}

export async function readStatus(
	path: string,
): Promise<TimedSendStatus | undefined> {
	try {
		const text = await readFile(path, "utf8");
		const parsed: unknown = JSON.parse(text);
		return parseStatus(parsed);
	} catch (error: unknown) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

export function parseStatus(value: unknown): TimedSendStatus {
	if (!isPlainObject(value)) {
		throw new Error("timed-send status must be a JSON object");
	}
	if (value.schemaVersion !== 1) {
		throw new Error("timed-send status schemaVersion must be 1");
	}
	const status: TimedSendStatus = {
		schemaVersion: 1,
		state: readState(value.state),
		startedAt: readString(value.startedAt, "startedAt"),
		windowStart: readString(value.windowStart, "windowStart"),
		windowEnd: readString(value.windowEnd, "windowEnd"),
		configPath: readString(value.configPath, "configPath"),
	};
	const sessionID = readOptionalString(value.sessionID, "sessionID");
	const nextStart = readOptionalString(value.nextStartAt, "nextStartAt");
	const reason = readOptionalString(value.reason, "reason");
	const message = readOptionalString(value.message, "message");
	return {
		...status,
		...(sessionID === undefined ? {} : { sessionID }),
		...(nextStart === undefined ? {} : { nextStartAt: nextStart }),
		...(reason === undefined ? {} : { reason }),
		...(message === undefined ? {} : { message }),
	};
}

function readState(value: unknown): TimedSendState {
	if (
		value === "waiting" ||
		value === "released" ||
		value === "open" ||
		value === "error" ||
		value === "disabled"
	) {
		return value;
	}
	throw new Error("timed-send status state is invalid");
}

function readString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`timed-send status ${field} must be a non-empty string`);
	}
	return value;
}

function readOptionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return readString(value, field);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(
	error: unknown,
): error is Error & { readonly code: string } {
	return (
		error instanceof Error && "code" in error && typeof error.code === "string"
	);
}
