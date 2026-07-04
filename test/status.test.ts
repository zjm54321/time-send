import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStatus, writeStatus, type TimedSendStatus } from "../src/status.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("status", () => {
  test("waiting status writes and reads nextStartAt and window fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-timed-send-"));
    tempDirs.push(dir);
    const path = join(dir, "status.json");
    const waiting: TimedSendStatus = {
      schemaVersion: 1,
      state: "waiting",
      sessionID: "ses_test",
      startedAt: "2026-07-01T01:59:00.000Z",
      nextStartAt: "2026-07-01T02:00:00.000Z",
      windowStart: "02:00",
      windowEnd: "09:00",
      configPath: join(dir, "opencode-timed-send.json"),
      reason: "outside_window",
    };
    await writeStatus(path, waiting);
    await expect(readStatus(path)).resolves.toEqual(waiting);
  });

  test("missing status file reads as undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-timed-send-"));
    tempDirs.push(dir);
    await expect(readStatus(join(dir, "missing-status.json"))).resolves.toBeUndefined();
  });

  test("concurrent status writes use distinct temp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opencode-timed-send-"));
    tempDirs.push(dir);
    const path = join(dir, "status.json");
    const first: TimedSendStatus = {
      schemaVersion: 1,
      state: "waiting",
      startedAt: "2026-07-01T01:00:00.000Z",
      nextStartAt: "2026-07-01T02:00:00.000Z",
      windowStart: "02:00",
      windowEnd: "09:00",
      configPath: join(dir, "opencode-timed-send.json"),
      reason: "outside_window",
    };
    const second: TimedSendStatus = {
      schemaVersion: 1,
      state: "open",
      startedAt: "2026-07-01T02:01:00.000Z",
      windowStart: "02:00",
      windowEnd: "09:00",
      configPath: join(dir, "opencode-timed-send.json"),
    };

    await Promise.all([writeStatus(path, first), writeStatus(path, second)]);
    const stored = await readStatus(path);

    expect(stored === undefined ? undefined : ["waiting", "open"].includes(stored.state)).toBe(true);
  });
});
