import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readGeminiQuota, useGeminiQuota, type GeminiSnapshot } from "./geminiQuota";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

afterEach(() => { cleanup(); vi.useRealTimers(); invoke.mockReset(); });

it("refreshes AG after two minutes while a Web read is still pending", async () => {
  vi.useFakeTimers();
  let reads = 0;
  invoke.mockImplementation((_command, { source }) => {
    if (source === "web") return new Promise(() => {});
    reads++;
    const pool = { state: "available", source: "desktop", accountKey: "test-account",
      observedAtMs: Date.now(), windows: [{ period: "weekly", remainingPercent: reads === 1 ? 72 : 63, reset: null }] };
    return Promise.resolve({ observedAtMs: Date.now(), pools: [
      { state: "absent", windows: [] }, pool, pool,
    ] } as GeminiSnapshot);
  });
  const { result } = renderHook(() => useGeminiQuota(true, readGeminiQuota));
  await act(async () => {});
  expect(result.current.pools[1].windows[0].remainingPercent).toBe(72);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(result.current.pools[1].windows[0].remainingPercent).toBe(63);
  expect(reads).toBe(2);
  expect(invoke.mock.calls.filter(([, args]) => args.source === "web")).toHaveLength(1);
});
