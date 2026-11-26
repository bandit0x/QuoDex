import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AG_COMPLETION_DELAY_MS,
  AG_FALLBACK_INTERVAL_MS,
  readGeminiQuota,
  useGeminiQuota,
  type GeminiSnapshot,
} from "./geminiQuota";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

afterEach(() => { cleanup(); vi.useRealTimers(); invoke.mockReset(); });

function makeSnapshot(percent: number, source: "cli" | "statusline" | "desktop" = "cli"): GeminiSnapshot {
  const pool = {
    state: "available" as const,
    source,
    accountKey: "test-account",
    observedAtMs: Date.now(),
    windows: [{ period: "weekly" as const, remainingPercent: percent, reset: null }],
  };
  return {
    observedAtMs: Date.now(),
    pools: [{ state: "absent", windows: [] }, pool, pool],
  };
}

it("does NOT poll AG every two minutes, and refreshes AG once after a task completes", async () => {
  vi.useFakeTimers();
  let agReads = 0;
  invoke.mockImplementation((_command, { source }) => {
    if (source === "web") return new Promise(() => {});
    agReads++;
    return Promise.resolve(makeSnapshot(agReads === 1 ? 72 : 68, "cli"));
  });

  const { result, rerender } = renderHook(
    ({ completionKey }: { completionKey: string | null }) =>
      useGeminiQuota(true, readGeminiQuota, completionKey),
    { initialProps: { completionKey: null as string | null } },
  );

  await act(async () => {});
  expect(result.current.pools[1].windows[0].remainingPercent).toBe(72);
  expect(agReads).toBe(1);

  // Advancing 10 minutes must NOT trigger any automatic AG polling (eliminates 2-min hammering).
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(agReads).toBe(1);

  // When a local Antigravity task completes, AG refreshes once after the settle delay.
  rerender({ completionKey: "antigravity:1:turn-1:1000" });
  await act(async () => { await vi.advanceTimersByTimeAsync(AG_COMPLETION_DELAY_MS); });
  expect(agReads).toBe(2);
  expect(result.current.pools[1].windows[0].remainingPercent).toBe(68);
});

it("passes manual=true on user refresh and still runs the 30-minute safety fallback", async () => {
  vi.useFakeTimers();
  let agReads = 0;
  invoke.mockImplementation((_command, { source }) => {
    if (source === "web") return Promise.resolve({
      observedAtMs: Date.now(),
      pools: [{ state: "absent", source: "panel", windows: [] }, { state: "absent", windows: [] }, { state: "absent", windows: [] }],
    });
    agReads++;
    return Promise.resolve(makeSnapshot(100 - agReads, "statusline"));
  });

  const { result } = renderHook(() => useGeminiQuota(true, readGeminiQuota, null));
  await act(async () => {});
  expect(agReads).toBe(1);

  await act(async () => { result.current.refresh(); });
  expect(agReads).toBe(2);
  expect(invoke).toHaveBeenCalledWith("read_gemini_quota", { source: "desktop", manual: true });

  await act(async () => { await vi.advanceTimersByTimeAsync(AG_FALLBACK_INTERVAL_MS); });
  expect(agReads).toBe(3);
});
