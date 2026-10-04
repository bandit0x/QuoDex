import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useTaskStatus } from "./useTaskStatus";
import { readyTaskSources, type TaskStatusSnapshot } from "./taskStatusTypes";

it("marks live tasks unknown on transport failure while preserving confirmed completion and each source timestamp", async () => {
  vi.useFakeTimers();
  const ended = Date.now() - 120_000;
  const observed = Date.now();
  const snapshot: TaskStatusSnapshot = {
    sources: readyTaskSources(observed), observedAtMs: observed, diagnostic: null,
    tasks: [
      { source: "codex", id: "same", turnId: "new", title: "Codex", state: "running", completedAtMs: null, detail: null },
      { source: "zcode", id: "same", turnId: "old", title: "ZCode", state: "completed", completedAtMs: ended, detail: null },
    ],
  };
  const load = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValue({ code: "QDT-601", message: "通道断开", detail: null });
  const { result, unmount } = renderHook(() => useTaskStatus(load));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.snapshot.tasks.map(task => task.state)).toEqual(["unknown", "completed"]);
  expect(result.current.snapshot.sources.map(source => source.observedAtMs)).toEqual([observed, observed]);
  expect(result.current.snapshot.sources.every(source => source.health === "unavailable")).toBe(true);
  unmount(); vi.useRealTimers();
});

it("expires only the stalled source heartbeat and restores its new turn after fresh observation", async () => {
  vi.useFakeTimers();
  const observed = Date.now();
  let codexObserved = observed;
  let turnId = "old-turn";
  const load = vi.fn(async (): Promise<TaskStatusSnapshot> => ({
    sources: readyTaskSources(Date.now()).map(source => source.source === "codex" ? { ...source, observedAtMs: codexObserved } : source),
    observedAtMs: Date.now(), diagnostic: null,
    tasks: [
      { source: "codex", id: "active", turnId, title: "停滞来源", state: "running", completedAtMs: null, detail: null },
      { source: "codex", id: "finished", turnId: "finished", title: "已确认完成", state: "completed", completedAtMs: observed - 120_000, detail: null },
      { source: "zcode", id: "active", turnId: "other", title: "健康来源", state: "running", completedAtMs: null, detail: null },
    ],
  }));
  const { result, unmount } = renderHook(() => useTaskStatus(load));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(result.current.snapshot.tasks[0].state).toBe("running");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.snapshot.tasks.map(task => task.state)).toEqual(["unknown", "completed", "running"]);
  expect(result.current.snapshot.sources[0].diagnostic?.code).toBe("QDT-632");
  expect(result.current.snapshot.sources[0].observedAtMs).toBe(observed);
  expect(result.current.snapshot.sources[1].health).toBe("ready");
  codexObserved = Date.now(); turnId = "new-turn";
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(result.current.snapshot.tasks[0]).toMatchObject({ state: "running", turnId: "new-turn" });
  expect(result.current.snapshot.sources[0].diagnostic).toBeNull();
  unmount(); vi.useRealTimers();
});
