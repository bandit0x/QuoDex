import { useEffect, useState } from "react";
import type { Diagnostic } from "./capacityTypes";
import { readyTaskSources, type TaskStatusSnapshot } from "./taskStatusTypes";

// Codex publishes on a 2 s heartbeat and gives owner replies 3 s; allow the
// heartbeat, reply deadline, frontend poll and a 2 s margin independently per source.
const SOURCE_HEARTBEAT_LIMIT_MS = 8000;

function withFreshSources(snapshot: TaskStatusSnapshot, now: number): TaskStatusSnapshot {
  const stale = new Set(snapshot.sources.filter(source => source.health === "ready" && source.observedAtMs > 0 && now - source.observedAtMs > SOURCE_HEARTBEAT_LIMIT_MS).map(source => source.source));
  if (stale.size === 0) return snapshot;
  const diagnostic = (source: string): Diagnostic => ({ code: "QDT-632", message: `${source === "codex" ? "Codex" : "ZCode"} 任务状态超过 8 秒未更新；等待通道自动恢复`, detail: null });
  return {
    ...snapshot,
    sources: snapshot.sources.map(source => stale.has(source.source) ? { ...source, health: "unavailable", diagnostic: diagnostic(source.source) } : source),
    tasks: snapshot.tasks.map(task => stale.has(task.source) && task.state !== "completed" && task.state !== "failed" ? { ...task, state: "unknown", detail: `${diagnostic(task.source).message} · QDT-632` } : task),
  };
}

export function useTaskStatus(load: () => Promise<TaskStatusSnapshot>) {
  const [snapshot, setSnapshot] = useState<TaskStatusSnapshot>({ tasks: [], sources: readyTaskSources(0).map(source => ({ ...source, health: "loading" })), observedAtMs: 0, diagnostic: null });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    const refresh = async () => {
      try {
        const next = await load();
        if (!stopped) setSnapshot(next);
      } catch (error) {
        const supplied = error as Partial<Diagnostic> | null;
        const diagnostic: Diagnostic = { code: supplied?.code ?? "QDT-601", message: supplied?.message ?? "任务状态通道已断开；稍后自动重连", detail: null };
        if (!stopped) setSnapshot(previous => ({
          ...previous,
          tasks: previous.tasks.map(task => task.state === "completed" || task.state === "failed" ? task : ({ ...task, state: "unknown", detail: `${diagnostic.message} · ${diagnostic.code}` })),
          sources: previous.sources.map(source => ({ ...source, health: "unavailable", diagnostic })),
          observedAtMs: Date.now(), diagnostic,
        }));
      }
      if (!stopped) timer = window.setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { stopped = true; if (timer !== null) window.clearTimeout(timer); window.clearInterval(clock); };
  }, [load]);
  return { snapshot: withFreshSources(snapshot, now), now, setSnapshot };
}
