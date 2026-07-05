// @bun
// src/config.ts
import { readFile } from "fs/promises";
import { dirname, isAbsolute, join, resolve } from "path";

class TimedSendConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimedSendConfigError";
  }
}
var TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
var DEFAULT_CONFIG = {
  enabled: true,
  start: "02:00",
  end: "09:00",
  statusFile: "opencode-timed-send.status.json",
  display: {
    promptRight: true,
    appBottom: true
  }
};
function parseConfig(json) {
  const parsed = JSON.parse(json);
  return parseConfigValue(parsed);
}
async function loadConfigWithPath(options = {}) {
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
    configPath: configPaths[0] ?? resolve(process.cwd(), "opencode-timed-send.json")
  };
}
function resolveConfigPathCandidates(options) {
  const envPath = options.env?.OPENCODE_TIMED_SEND_CONFIG;
  const rawPath = options.configPath ?? envPath ?? "opencode-timed-send.json";
  if (isAbsolute(rawPath)) {
    return [rawPath];
  }
  const paths = [];
  addResolvedPath(paths, options.directory ?? process.cwd(), rawPath);
  for (const directory of openCodeConfigDirectories(options.env ?? process.env)) {
    addResolvedPath(paths, directory, rawPath);
  }
  return paths;
}
function openCodeConfigDirectories(env) {
  const directories = [];
  if (env.OPENCODE_CONFIG_DIR !== undefined && env.OPENCODE_CONFIG_DIR.length > 0) {
    directories.push(env.OPENCODE_CONFIG_DIR);
  }
  if (env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME.length > 0) {
    directories.push(join(env.XDG_CONFIG_HOME, "opencode"));
  }
  return directories;
}
function addResolvedPath(paths, directory, rawPath) {
  const candidate = resolve(directory, rawPath);
  if (!paths.includes(candidate)) {
    paths.push(candidate);
  }
}
function resolveStatusPath(config, configPath) {
  if (isAbsolute(config.statusFile)) {
    return config.statusFile;
  }
  return join(dirname(configPath), config.statusFile);
}
function parseConfigValue(value) {
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
    display: parseDisplayConfig(value.display)
  };
}
function parseDisplayConfig(value) {
  if (value === undefined) {
    return DEFAULT_CONFIG.display;
  }
  if (!isPlainObject(value)) {
    throw new TimedSendConfigError("opencode-timed-send display must be a JSON object");
  }
  return {
    promptRight: readBoolean(value.promptRight, DEFAULT_CONFIG.display.promptRight, "display.promptRight"),
    appBottom: readBoolean(value.appBottom, DEFAULT_CONFIG.display.appBottom, "display.appBottom")
  };
}
function readTime(value, fallback, field) {
  const text = readString(value, fallback, field);
  if (!TIME_PATTERN.test(text)) {
    throw new TimedSendConfigError(`opencode-timed-send ${field} must use HH:mm 24-hour format`);
  }
  return text;
}
function readString(value, fallback, field) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new TimedSendConfigError(`opencode-timed-send ${field} must be a non-empty string`);
  }
  return value;
}
function readBoolean(value, fallback, field) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new TimedSendConfigError(`opencode-timed-send ${field} must be a boolean`);
  }
  return value;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readFileIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
function isNodeError(error) {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

// src/status.ts
import { randomUUID } from "crypto";
import { mkdir, readFile as readFile2, rename, rm, writeFile } from "fs/promises";
import { dirname as dirname2 } from "path";
var pendingStatusWrites = new Map;
async function writeStatus(path, status) {
  const previous = pendingStatusWrites.get(path) ?? Promise.resolve();
  const next = previous.then(() => writeStatusFile(path, status), () => writeStatusFile(path, status));
  const tracked = next.finally(() => {
    if (pendingStatusWrites.get(path) === tracked) {
      pendingStatusWrites.delete(path);
    }
  });
  pendingStatusWrites.set(path, tracked);
  return next;
}
async function removeStatus(path) {
  await rm(path, { force: true });
}
async function writeStatusFile(path, status) {
  await mkdir(dirname2(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(status, null, 2)}
`, "utf8");
  await replaceFile(tempPath, path);
}
async function replaceFile(tempPath, path) {
  try {
    await rename(tempPath, path);
  } catch (error) {
    if (!isNodeError2(error) || error.code !== "EEXIST" && error.code !== "EPERM") {
      throw error;
    }
    await rm(path, { force: true });
    await rename(tempPath, path);
  }
}
async function readStatus(path) {
  try {
    const text = await readFile2(path, "utf8");
    const parsed = JSON.parse(text);
    return parseStatus(parsed);
  } catch (error) {
    if (isNodeError2(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
function parseStatus(value) {
  if (!isPlainObject2(value)) {
    throw new Error("timed-send status must be a JSON object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("timed-send status schemaVersion must be 1");
  }
  const status = {
    schemaVersion: 1,
    state: readState(value.state),
    startedAt: readString2(value.startedAt, "startedAt"),
    windowStart: readString2(value.windowStart, "windowStart"),
    windowEnd: readString2(value.windowEnd, "windowEnd"),
    configPath: readString2(value.configPath, "configPath")
  };
  const sessionID = readOptionalString(value.sessionID, "sessionID");
  const nextStart = readOptionalString(value.nextStartAt, "nextStartAt");
  const reason = readOptionalString(value.reason, "reason");
  const message = readOptionalString(value.message, "message");
  return {
    ...status,
    ...sessionID === undefined ? {} : { sessionID },
    ...nextStart === undefined ? {} : { nextStartAt: nextStart },
    ...reason === undefined ? {} : { reason },
    ...message === undefined ? {} : { message }
  };
}
function readState(value) {
  if (value === "waiting" || value === "released" || value === "open" || value === "error" || value === "disabled") {
    return value;
  }
  throw new Error("timed-send status state is invalid");
}
function readString2(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`timed-send status ${field} must be a non-empty string`);
  }
  return value;
}
function readOptionalString(value, field) {
  if (value === undefined) {
    return;
  }
  return readString2(value, field);
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNodeError2(error) {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

// src/time-window.ts
var TIME_PATTERN2 = /^([01]\d|2[0-3]):([0-5]\d)$/;
var MINUTE_MS = 60 * 1000;
function parseHHMM(value) {
  const match = TIME_PATTERN2.exec(value);
  if (match === null) {
    throw new Error("time must use HH:mm 24-hour format");
  }
  const hourText = match[1];
  const minuteText = match[2];
  if (hourText === undefined || minuteText === undefined) {
    throw new Error("time must use HH:mm 24-hour format");
  }
  return {
    hour: Number.parseInt(hourText, 10),
    minute: Number.parseInt(minuteText, 10)
  };
}
function evaluateWindow(now, config) {
  const start = parseHHMM(config.start);
  const end = parseHHMM(config.end);
  const startMinute = minuteOfDay(start);
  const endMinute = minuteOfDay(end);
  if (startMinute === endMinute) {
    throw new Error("start and end must be different times");
  }
  if (startMinute < endMinute) {
    return evaluateSameDayWindow(now, start, end);
  }
  return evaluateOvernightWindow(now, start, end);
}
function formatCountdown(ms) {
  const totalMinutes = Math.max(0, Math.ceil(ms / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}
function evaluateSameDayWindow(now, start, end) {
  const todayStart = localTimeOnDay(now, start, 0);
  const todayEnd = localTimeOnDay(now, end, 0);
  if (now.getTime() >= todayStart.getTime() && now.getTime() < todayEnd.getTime()) {
    return { state: "open", windowStartAt: todayStart, windowEndAt: todayEnd };
  }
  const nextStart = now.getTime() < todayStart.getTime() ? todayStart : localTimeOnDay(now, start, 1);
  return { state: "waiting", nextStartAt: nextStart, waitMs: nextStart.getTime() - now.getTime() };
}
function evaluateOvernightWindow(now, start, end) {
  const todayStart = localTimeOnDay(now, start, 0);
  const todayEnd = localTimeOnDay(now, end, 0);
  if (now.getTime() < todayEnd.getTime()) {
    return { state: "open", windowStartAt: localTimeOnDay(now, start, -1), windowEndAt: todayEnd };
  }
  if (now.getTime() >= todayStart.getTime()) {
    return { state: "open", windowStartAt: todayStart, windowEndAt: localTimeOnDay(now, end, 1) };
  }
  return { state: "waiting", nextStartAt: todayStart, waitMs: todayStart.getTime() - now.getTime() };
}
function localTimeOnDay(anchor, time, dayOffset) {
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dayOffset, time.hour, time.minute, 0, 0);
}
function minuteOfDay(time) {
  return time.hour * 60 + time.minute;
}

// src/server.ts
var PLUGIN_ID = "opencode-timed-send";
var RELEASE_POLL_MS = 1000;
async function timedSendServer(input, options = {}) {
  const releasedSessions = new Map;
  return {
    "chat.params": async (chatInput, _output) => {
      const directory = input.directory;
      const loadOptions = toLoadConfigOptions(directory, options);
      const { config, configPath } = await loadConfigWithPath(loadOptions);
      const statusPath = resolveStatusPath(config, configPath);
      const now = options.now?.() ?? new Date;
      const existingStatus = await (options.readStatus ?? readStatus)(statusPath);
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
          configPath
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
          configPath
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
        reason: "outside_window"
      });
      const released = await waitForWindowOrRelease(options, statusPath, chatInput.sessionID, evaluation.waitMs);
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
        configPath
      });
    },
    event: async ({ event }) => {
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
    }
  };
}
var serverModule = {
  id: PLUGIN_ID,
  server: timedSendServer
};
var server_default = serverModule;
async function defaultSleep(ms) {
  await new Promise((resolve2) => {
    setTimeout(resolve2, ms);
  });
}
async function writeCurrentStatus(options, path, status) {
  await (options.writeStatus ?? writeStatus)(path, status);
}
async function waitForWindowOrRelease(options, statusPath, sessionID, waitMs) {
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
function isManualReleaseForSession(status, sessionID) {
  return status?.state === "released" && status.sessionID === sessionID && status.reason === "manual";
}
function interruptedSessionID(event) {
  if (!isPlainObject3(event)) {
    return;
  }
  if (event.type !== "session.deleted" && event.type !== "session.error") {
    return;
  }
  const properties = event.properties;
  if (!isPlainObject3(properties)) {
    return;
  }
  return typeof properties.sessionID === "string" ? properties.sessionID : undefined;
}
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toLoadConfigOptions(directory, options) {
  return {
    ...options.configPath === undefined ? {} : { configPath: options.configPath },
    ...directory === undefined ? {} : { directory },
    ...options.env === undefined ? {} : { env: options.env },
    ...options.readText === undefined ? {} : { readText: options.readText }
  };
}
export {
  timedSendServer,
  server_default as default,
  PLUGIN_ID
};
