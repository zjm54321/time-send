import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, win32 } from "node:path";

export interface DisplayConfig {
	readonly promptRight: boolean;
	readonly appBottom: boolean;
}

export interface TimedSendConfig {
	readonly enabled: boolean;
	readonly start: string;
	readonly end: string;
	readonly statusFile: string;
	readonly display: DisplayConfig;
}

export interface LoadConfigOptions {
	readonly configPath?: string;
	readonly directory?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly readText?: (path: string) => Promise<string | undefined>;
}

export interface LoadedConfig {
	readonly config: TimedSendConfig;
	readonly configPath: string;
}

export class TimedSendConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TimedSendConfigError";
	}
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_CONFIG: TimedSendConfig = {
	enabled: true,
	start: "02:00",
	end: "09:00",
	statusFile: "opencode-timed-send.status.json",
	display: {
		promptRight: true,
		appBottom: true,
	},
};

export const defaultConfig = DEFAULT_CONFIG;

export function parseConfig(json: string): TimedSendConfig {
	const parsed: unknown = JSON.parse(json);
	return parseConfigValue(parsed);
}

export async function loadConfig(
	options: LoadConfigOptions = {},
): Promise<TimedSendConfig> {
	return (await loadConfigWithPath(options)).config;
}

export async function loadConfigWithPath(
	options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
	const configPaths = resolveConfigPathCandidates(options);
	const readText = options.readText ?? readFileIfExists;
	for (const configPath of configPaths) {
		const text = await readText(configPath);
		if (text !== undefined) {
			return { config: parseConfig(text), configPath };
		}
	}
	return {
		config: DEFAULT_CONFIG,
		configPath:
			configPaths[0] ?? resolve(process.cwd(), "opencode-timed-send.json"),
	};
}

export function resolveConfigPath(options: LoadConfigOptions = {}): string {
	return (
		resolveConfigPathCandidates(options)[0] ??
		resolve(process.cwd(), "opencode-timed-send.json")
	);
}

function resolveConfigPathCandidates(
	options: LoadConfigOptions,
): readonly string[] {
	const envPath = options.env?.OPENCODE_TIMED_SEND_CONFIG;
	const rawPath = options.configPath ?? envPath ?? "opencode-timed-send.json";
	if (isAbsolutePath(rawPath)) {
		return [rawPath];
	}
	const paths: string[] = [];
	addResolvedPath(paths, options.directory ?? process.cwd(), rawPath);
	for (const directory of openCodeConfigDirectories(
		options.env ?? process.env,
	)) {
		addResolvedPath(paths, directory, rawPath);
	}
	return paths;
}

function openCodeConfigDirectories(
	env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
	const directories: string[] = [];
	if (
		env.OPENCODE_CONFIG_DIR !== undefined &&
		env.OPENCODE_CONFIG_DIR.length > 0
	) {
		directories.push(env.OPENCODE_CONFIG_DIR);
	}
	if (env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME.length > 0) {
		directories.push(join(env.XDG_CONFIG_HOME, "opencode"));
	}
	return directories;
}

function addResolvedPath(
	paths: string[],
	directory: string,
	rawPath: string,
): void {
	const candidate = resolvePath(configDirectory(directory), rawPath);
	if (!paths.includes(candidate)) {
		paths.push(candidate);
	}
}

function configDirectory(path: string): string {
	const name = basename(path).toLowerCase();
	if (
		name === "opencode.json" ||
		name === "opencode.jsonc" ||
		name === "tui.json"
	) {
		return dirname(path);
	}
	if (win32.basename(path).toLowerCase() === name) {
		return path;
	}
	const winName = win32.basename(path).toLowerCase();
	if (
		winName === "opencode.json" ||
		winName === "opencode.jsonc" ||
		winName === "tui.json"
	) {
		return win32.dirname(path);
	}
	return path;
}

export function resolveStatusPath(
	config: TimedSendConfig,
	configPath: string,
): string {
	if (isAbsolutePath(config.statusFile)) {
		return config.statusFile;
	}
	if (win32.isAbsolute(configPath)) {
		return win32.join(win32.dirname(configPath), config.statusFile);
	}
	return join(dirname(configPath), config.statusFile);
}

function resolvePath(directory: string, rawPath: string): string {
	if (win32.isAbsolute(directory)) {
		return win32.resolve(directory, rawPath);
	}
	return resolve(directory, rawPath);
}

function isAbsolutePath(path: string): boolean {
	return isAbsolute(path) || win32.isAbsolute(path);
}

function parseConfigValue(value: unknown): TimedSendConfig {
	if (!isPlainObject(value)) {
		throw new TimedSendConfigError(
			"opencode-timed-send config must be a JSON object",
		);
	}

	const enabled = readBoolean(value.enabled, DEFAULT_CONFIG.enabled, "enabled");
	const start = readTime(value.start, DEFAULT_CONFIG.start, "start");
	const end = readTime(value.end, DEFAULT_CONFIG.end, "end");
	if (start === end) {
		throw new TimedSendConfigError(
			"opencode-timed-send start and end must be different times",
		);
	}

	return {
		enabled,
		start,
		end,
		statusFile: readString(
			value.statusFile,
			DEFAULT_CONFIG.statusFile,
			"statusFile",
		),
		display: parseDisplayConfig(value.display),
	};
}

function parseDisplayConfig(value: unknown): DisplayConfig {
	if (value === undefined) {
		return DEFAULT_CONFIG.display;
	}
	if (!isPlainObject(value)) {
		throw new TimedSendConfigError(
			"opencode-timed-send display must be a JSON object",
		);
	}
	return {
		promptRight: readBoolean(
			value.promptRight,
			DEFAULT_CONFIG.display.promptRight,
			"display.promptRight",
		),
		appBottom: readBoolean(
			value.appBottom,
			DEFAULT_CONFIG.display.appBottom,
			"display.appBottom",
		),
	};
}

function readTime(value: unknown, fallback: string, field: string): string {
	const text = readString(value, fallback, field);
	if (!TIME_PATTERN.test(text)) {
		throw new TimedSendConfigError(
			`opencode-timed-send ${field} must use HH:mm 24-hour format`,
		);
	}
	return text;
}

function readString(value: unknown, fallback: string, field: string): string {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== "string" || value.length === 0) {
		throw new TimedSendConfigError(
			`opencode-timed-send ${field} must be a non-empty string`,
		);
	}
	return value;
}

function readBoolean(
	value: unknown,
	fallback: boolean,
	field: string,
): boolean {
	if (value === undefined) {
		return fallback;
	}
	if (typeof value !== "boolean") {
		throw new TimedSendConfigError(
			`opencode-timed-send ${field} must be a boolean`,
		);
	}
	return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readFileIfExists(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error: unknown) {
		if (isNodeError(error) && error.code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

function isNodeError(
	error: unknown,
): error is Error & { readonly code: string } {
	return (
		error instanceof Error && "code" in error && typeof error.code === "string"
	);
}
