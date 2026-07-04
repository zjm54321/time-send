import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

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

export async function loadConfig(options: LoadConfigOptions = {}): Promise<TimedSendConfig> {
  const configPath = resolveConfigPath(options);
  const readText = options.readText ?? readFileIfExists;
  const text = await readText(configPath);
  if (text === undefined) {
    return DEFAULT_CONFIG;
  }
  return parseConfig(text);
}

export function resolveConfigPath(options: LoadConfigOptions = {}): string {
  const envPath = options.env?.OPENCODE_TIMED_SEND_CONFIG;
  const rawPath = options.configPath ?? envPath ?? "opencode-timed-send.json";
  if (isAbsolute(rawPath)) {
    return rawPath;
  }
  const baseDirectory = options.directory ?? process.cwd();
  return resolve(baseDirectory, rawPath);
}

export function resolveStatusPath(config: TimedSendConfig, configPath: string): string {
  if (isAbsolute(config.statusFile)) {
    return config.statusFile;
  }
  return join(dirname(configPath), config.statusFile);
}

function parseConfigValue(value: unknown): TimedSendConfig {
  if (!isPlainObject(value)) {
    throw new TimedSendConfigError("opencode-timed-send config must be a JSON object");
  }

  const enabled = readBoolean(value.enabled, DEFAULT_CONFIG.enabled, "enabled");
  const start = readTime(value.start, DEFAULT_CONFIG.start, "start");
  const end = readTime(value.end, DEFAULT_CONFIG.end, "end");
  if (start === end) {
    throw new TimedSendConfigError("opencode-timed-send start and end must be different times");
  }

  return {
    enabled,
    start,
    end,
    statusFile: readString(value.statusFile, DEFAULT_CONFIG.statusFile, "statusFile"),
    display: parseDisplayConfig(value.display),
  };
}

function parseDisplayConfig(value: unknown): DisplayConfig {
  if (value === undefined) {
    return DEFAULT_CONFIG.display;
  }
  if (!isPlainObject(value)) {
    throw new TimedSendConfigError("opencode-timed-send display must be a JSON object");
  }
  return {
    promptRight: readBoolean(value.promptRight, DEFAULT_CONFIG.display.promptRight, "display.promptRight"),
    appBottom: readBoolean(value.appBottom, DEFAULT_CONFIG.display.appBottom, "display.appBottom"),
  };
}

function readTime(value: unknown, fallback: string, field: string): string {
  const text = readString(value, fallback, field);
  if (!TIME_PATTERN.test(text)) {
    throw new TimedSendConfigError(`opencode-timed-send ${field} must use HH:mm 24-hour format`);
  }
  return text;
}

function readString(value: unknown, fallback: string, field: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new TimedSendConfigError(`opencode-timed-send ${field} must be a non-empty string`);
  }
  return value;
}

function readBoolean(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new TimedSendConfigError(`opencode-timed-send ${field} must be a boolean`);
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

function isNodeError(error: unknown): error is Error & { readonly code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}
