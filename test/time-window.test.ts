import { describe, expect, test } from "bun:test";
import { evaluateWindow, formatCountdown, isInWindow, nextStartAt } from "../src/time-window.js";
import { defaultConfig } from "../src/config.js";

describe("time window", () => {
  test("02:01 is inside the default 02:00-09:00 send window", () => {
    const now = new Date(2026, 6, 1, 2, 1, 0);
    expect(isInWindow(now, defaultConfig)).toBe(true);
  });

  test("08:59 is inside the default send window", () => {
    const now = new Date(2026, 6, 1, 8, 59, 0);
    expect(isInWindow(now, defaultConfig)).toBe(true);
  });

  test("01:59 waits until today's 02:00", () => {
    const now = new Date(2026, 6, 1, 1, 59, 0);
    const evaluation = evaluateWindow(now, defaultConfig);
    expect(isInWindow(now, defaultConfig)).toBe(false);
    expect(evaluation.state).toBe("waiting");
    if (evaluation.state === "waiting") {
      expect(evaluation.waitMs).toBe(60_000);
      expect(evaluation.nextStartAt).toEqual(new Date(2026, 6, 1, 2, 0, 0));
    }
  });

  test("09:00 waits until the next local 02:00", () => {
    const now = new Date(2026, 6, 1, 9, 0, 0);
    const next = nextStartAt(now, defaultConfig);
    expect(next.getHours()).toBe(2);
    expect(next.getDate()).toBe(now.getDate() + 1);
  });

  test("next local start is DST-safe across fall-back nights", () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const now = new Date(2026, 9, 31, 14, 0, 0);
      const evaluation = evaluateWindow(now, defaultConfig);
      expect(evaluation.state).toBe("waiting");
      if (evaluation.state === "waiting") {
        expect(evaluation.waitMs).toBe(46_800_000);
      }
    } finally {
      if (originalTZ === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTZ;
      }
    }
  });

  test("invalid time strings reject", () => {
    expect(() => evaluateWindow(new Date(2026, 6, 1, 1, 0, 0), { ...defaultConfig, start: "2am" })).toThrow("HH:mm");
  });

  test("countdown formatting rounds up to visible minutes", () => {
    expect(formatCountdown(89_000)).toBe("2m");
    expect(formatCountdown(5 * 60 * 60 * 1000)).toBe("5h");
    expect(formatCountdown(5 * 60 * 60 * 1000 + 12 * 60 * 1000)).toBe("5h 12m");
  });
});
