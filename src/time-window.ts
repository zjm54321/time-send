import type { TimedSendConfig } from "./config.js";

export interface TimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

export interface OpenWindow {
  readonly state: "open";
  readonly windowStartAt: Date;
  readonly windowEndAt: Date;
}

export interface WaitingWindow {
  readonly state: "waiting";
  readonly nextStartAt: Date;
  readonly waitMs: number;
}

export type WindowEvaluation = OpenWindow | WaitingWindow;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE_MS = 60 * 1000;

export function parseHHMM(value: string): TimeOfDay {
  const match = TIME_PATTERN.exec(value);
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
    minute: Number.parseInt(minuteText, 10),
  };
}

export function isInWindow(now: Date, config: TimedSendConfig): boolean {
  return evaluateWindow(now, config).state === "open";
}

export function nextStartAt(now: Date, config: TimedSendConfig): Date {
  const evaluation = evaluateWindow(now, config);
  return evaluation.state === "waiting" ? evaluation.nextStartAt : evaluation.windowStartAt;
}

export function evaluateWindow(now: Date, config: TimedSendConfig): WindowEvaluation {
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

export function formatCountdown(ms: number): string {
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

function evaluateSameDayWindow(now: Date, start: TimeOfDay, end: TimeOfDay): WindowEvaluation {
  const todayStart = localTimeOnDay(now, start, 0);
  const todayEnd = localTimeOnDay(now, end, 0);
  if (now.getTime() >= todayStart.getTime() && now.getTime() < todayEnd.getTime()) {
    return { state: "open", windowStartAt: todayStart, windowEndAt: todayEnd };
  }
  const nextStart = now.getTime() < todayStart.getTime() ? todayStart : localTimeOnDay(now, start, 1);
  return { state: "waiting", nextStartAt: nextStart, waitMs: nextStart.getTime() - now.getTime() };
}

function evaluateOvernightWindow(now: Date, start: TimeOfDay, end: TimeOfDay): WindowEvaluation {
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

function localTimeOnDay(anchor: Date, time: TimeOfDay, dayOffset: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + dayOffset, time.hour, time.minute, 0, 0);
}

function minuteOfDay(time: TimeOfDay): number {
  return time.hour * 60 + time.minute;
}
