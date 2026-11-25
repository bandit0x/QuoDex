import { describe, expect, it } from "vitest";
import { mergeGeminiSnapshot, type GeminiPool } from "./geminiQuota";
import { geminiPoolNotes, getGeminiReading, summarizeGeminiReadings } from "./geminiQuotaReadout";

const complete: GeminiPool = {
  state: "available", source: "panel", observedAtMs: 100,
  windows: [
    { period: "weekly", remainingPercent: 0, reset: null },
    { period: "fiveHour", remainingPercent: 99.9, reset: null },
  ],
};

describe("Gemini readings by period", () => {
  it("uses just the reported periods after a successful read and keeps a prior panel read after it closes", () => {
    const weeklyOnly = { ...complete, windows: complete.windows.slice(0, 1) };
    const pools = mergeGeminiSnapshot([complete, weeklyOnly, complete], {
      observedAtMs: 200, pools: [
        { ...weeklyOnly, observedAtMs: 180 },
        { state: "absent", source: "panel", windows: [] },
        complete,
      ],
    });
    expect(getGeminiReading(pools[0], "weekly")).toEqual({ value: 0, stale: false });
    expect(getGeminiReading(pools[0], "fiveHour")).toEqual({ value: null, stale: false });
    expect(getGeminiReading(pools[1], "weekly")).toEqual({ value: 0, stale: true });
    expect(getGeminiReading(pools[1], "fiveHour")).toEqual({ value: null, stale: false });
    expect(getGeminiReading(pools[2], "fiveHour")).toEqual({ value: 99.9, stale: false });
    expect(summarizeGeminiReadings(pools)).toEqual({ fresh: 3, stale: 1, missing: 2 });
  });

  it("clears readings when a provider changes or requires authentication", () => {
    const background: GeminiPool = { ...complete, source: "background" };
    const pools = mergeGeminiSnapshot([background, complete, background], {
      observedAtMs: 200, pools: [
        { state: "authRequired", source: "background", windows: [] },
        { state: "failed", source: "background", windows: [] },
        { state: "absent", source: "panel", windows: [] },
      ],
    });
    expect(summarizeGeminiReadings(pools)).toEqual({ fresh: 0, stale: 0, missing: 6 });
  });

  it("retains only a missing AG period within consecutive observations of its panel", () => {
    const first = { ...complete, windows: complete.windows.map(w => ({ ...w, reset: "Tomorrow" })) };
    const partial = { ...complete, observedAtMs: 200, windows: complete.windows.slice(1) };
    const next = mergeGeminiSnapshot([first, first, first], { observedAtMs: 200, pools: [partial, partial, partial] });
    expect(getGeminiReading(next[0], "weekly")).toEqual({ value: null, stale: false });
    expect(getGeminiReading(next[1], "fiveHour")).toEqual({ value: 99.9, stale: false });
    expect(next[1].windows.find(w => w.period === "weekly")).toEqual({
      period: "weekly", remainingPercent: 0, observedAtMs: 100, stale: true, reset: null,
    });
    expect(geminiPoolNotes(next[1], 1)).toContain("一周上次读数 " + new Date(100).toLocaleString("zh-CN", { hour12: false }));
    const later = mergeGeminiSnapshot(next, { observedAtMs: 300, pools: [partial, partial, partial] });
    expect(later[1].windows.find(w => w.period === "weekly")?.observedAtMs).toBe(100);
    const renewed = { ...first, observedAtMs: 400 };
    const full = mergeGeminiSnapshot(later, { observedAtMs: 400, pools: [renewed, renewed, renewed] });
    expect(full[1].windows.find(w => w.period === "weekly")).toMatchObject({ stale: false, observedAtMs: 400, reset: "Tomorrow" });
  });

  it.each(["ambiguous", "authRequired", "notConnected", "absent", "failed"] as const)(
    "does not fill a newly opened partial panel from a session interrupted by %s", state => {
      const stop: GeminiPool = { state, windows: [], source: "panel", observedAtMs: null };
      const closed = mergeGeminiSnapshot([complete, complete, complete], { observedAtMs: 200, pools: [stop, stop, stop] });
      expect(getGeminiReading(closed[0], "weekly")).toEqual(state === "failed" || state === "absent"
        ? { value: 0, stale: true } : { value: null, stale: false });
      const partial = { ...complete, observedAtMs: 300, windows: complete.windows.slice(1) };
      const reopened = mergeGeminiSnapshot(closed, { observedAtMs: 300, pools: [partial, partial, partial] });
      expect(getGeminiReading(reopened[0], "weekly").value).toBeNull();
      expect(getGeminiReading(reopened[1], "weekly").value).toBeNull();
    });

  it("shows expired upstream observations as last readings with their original timestamp", () => {
    const sampled = { ...complete, observedAtMs: 400_000 };
    const delayed = mergeGeminiSnapshot([], { observedAtMs: 400_100, pools: [sampled, sampled, sampled] }, 710_000);
    expect(summarizeGeminiReadings(delayed)).toEqual({ fresh: 0, stale: 6, missing: 0 });
    expect(delayed[0].windows[0]).toMatchObject({ observedAtMs: 400_000, stale: true, reset: null });
  });

  it.each([Number.NaN, Infinity, -1, 100.1])("shows invalid percentage %s as unknown", value => {
    const pool: GeminiPool = { ...complete, windows: [{ period: "weekly", remainingPercent: value, reset: null }] };
    expect(getGeminiReading(pool, "weekly")).toEqual({ value: null, stale: false });
  });
});
