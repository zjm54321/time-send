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
async function loadConfig(options = {}) {
  const configPath = resolveConfigPath(options);
  const readText = options.readText ?? readFileIfExists;
  const text = await readText(configPath);
  if (text === undefined) {
    return DEFAULT_CONFIG;
  }
  return parseConfig(text);
}
function resolveConfigPath(options = {}) {
  const envPath = options.env?.OPENCODE_TIMED_SEND_CONFIG;
  const rawPath = options.configPath ?? envPath ?? "opencode-timed-send.json";
  if (isAbsolute(rawPath)) {
    return rawPath;
  }
  const baseDirectory = options.directory ?? process.cwd();
  return resolve(baseDirectory, rawPath);
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
import { dirname as dirname2 } from "path";
import { mkdir, readFile as readFile2, rename, rm, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
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
  return {
    "chat.params": async (chatInput, _output) => {
      const directory = input.directory;
      const loadOptions = toLoadConfigOptions(directory, options);
      const configPath = resolveConfigPath(loadOptions);
      const config = await loadConfig(loadOptions);
      const statusPath = resolveStatusPath(config, configPath);
      const now = options.now?.() ?? new Date;
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
    if (status?.state === "released" && status.sessionID === sessionID) {
      return true;
    }
    remainingMs -= stepMs;
  }
  return false;
}
function toLoadConfigOptions(directory, options) {
  return {
    ...options.configPath === undefined ? {} : { configPath: options.configPath },
    ...directory === undefined ? {} : { directory },
    ...options.readText === undefined ? {} : { readText: options.readText }
  };
}

// src/tui.tsx
import { onCleanup } from "solid-js";
import { jsxDEV } from "@opentui/solid/jsx-dev-runtime";
async function timedSendTui(api, options = {}) {
  const directory = options.directory ?? api.state?.path?.config ?? api.state?.path?.directory;
  const loadOptions = toLoadConfigOptions2(directory, options);
  const configPath = resolveConfigPath(loadOptions);
  const config = await loadConfig(loadOptions);
  const statusPath = resolveStatusPath(config, configPath);
  const readStatusFn = options.readStatus ?? readStatus;
  const currentDate = () => options.now?.() ?? new Date;
  let currentStatus = await readStatusFn(statusPath);
  let currentNow = currentDate();
  const subscribers = new Set;
  const render = () => formatStatusLine(currentStatus, currentNow);
  const subscribe = (subscriber) => {
    subscribers.add(subscriber);
    subscriber();
    return () => {
      subscribers.delete(subscriber);
    };
  };
  const notify = () => {
    for (const subscriber of subscribers) {
      subscriber();
    }
  };
  const slotPlugin = createSlotPlugin(config.display.promptRight || config.display.appBottom, render, subscribe);
  if (slotPlugin !== undefined) {
    api.slots.register(slotPlugin);
  }
  const refresh = async () => {
    currentNow = currentDate();
    currentStatus = await readStatusFn(statusPath);
    notify();
  };
  const releaseNow = async () => {
    await refresh();
    if (currentStatus?.state !== "waiting") {
      api.ui.toast({ message: render() });
      return;
    }
    const released = {
      schemaVersion: 1,
      state: "released",
      ...currentStatus.sessionID === undefined ? {} : { sessionID: currentStatus.sessionID },
      startedAt: currentDate().toISOString(),
      windowStart: currentStatus.windowStart,
      windowEnd: currentStatus.windowEnd,
      configPath
    };
    await (options.writeStatus ?? writeStatus)(statusPath, released);
    currentNow = currentDate();
    currentStatus = released;
    notify();
    api.ui.toast({ message: "timed-send released now" });
  };
  const disposeCommand = api.command?.register(() => [
    {
      title: "Timed send status",
      value: `${PLUGIN_ID}.status`,
      description: "Show the timed-send window and countdown status",
      category: "Timed Send",
      slash: { name: "timed-send-status" },
      onSelect: async () => {
        await refresh();
        api.ui.toast({ message: render() });
      }
    },
    {
      title: "Send now",
      value: `${PLUGIN_ID}.send-now`,
      description: "Release the current timed-send wait immediately",
      category: "Timed Send",
      slash: { name: "time-send-now" },
      onSelect: releaseNow
    }
  ]);
  const interval = setInterval(() => {
    refresh();
  }, 1000);
  api.lifecycle.onDispose(() => {
    clearInterval(interval);
    disposeCommand?.();
  });
}
function TimedSendSidebar(props) {
  let container;
  let statusText;
  let unsubscribe;
  const update = () => {
    const value = props.render();
    if (container !== undefined) {
      container.visible = value.length > 0;
      container.requestRender();
    }
    if (statusText !== undefined) {
      statusText.content = value;
      statusText.requestRender();
    }
  };
  const subscribeWhenReady = () => {
    if (unsubscribe === undefined && container !== undefined && statusText !== undefined) {
      unsubscribe = props.subscribe(update);
    }
  };
  onCleanup(() => {
    unsubscribe?.();
  });
  return /* @__PURE__ */ jsxDEV("box", {
    ref: (node) => {
      container = node;
      subscribeWhenReady();
    },
    flexDirection: "column",
    children: [
      /* @__PURE__ */ jsxDEV("text", {
        children: /* @__PURE__ */ jsxDEV("b", {
          children: "Timed send"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("text", {
        ref: (node) => {
          statusText = node;
          subscribeWhenReady();
        },
        children: props.render()
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function createSlotPlugin(showSidebar, render, subscribe) {
  if (!showSidebar) {
    return;
  }
  return {
    order: 150,
    slots: {
      sidebar_content: () => /* @__PURE__ */ jsxDEV(TimedSendSidebar, {
        render,
        subscribe
      }, undefined, false, undefined, this)
    }
  };
}
function formatStatusLine(status, now) {
  if (status === undefined) {
    return "";
  }
  if (status.state === "waiting" && status.nextStartAt !== undefined) {
    const nextStart = new Date(status.nextStartAt);
    const countdown = formatCountdown(nextStart.getTime() - now.getTime());
    return `${status.windowStart} in ${countdown}`;
  }
  if (status.state === "error") {
    return "timed-send error";
  }
  if (status.state === "open") {
    return `window open until ${status.windowEnd}`;
  }
  return "";
}
var formatStatus = formatStatusLine;
var tuiModule = {
  id: PLUGIN_ID,
  tui: timedSendTui
};
var tui_default = tuiModule;
function toLoadConfigOptions2(directory, options) {
  return {
    ...options.configPath === undefined ? {} : { configPath: options.configPath },
    ...directory === undefined ? {} : { directory },
    ...options.readText === undefined ? {} : { readText: options.readText }
  };
}
export {
  timedSendTui,
  formatStatusLine,
  formatStatus,
  tui_default as default,
  TimedSendSidebar
};
