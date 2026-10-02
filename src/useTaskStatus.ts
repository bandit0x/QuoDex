import { useEffect, useState } from "react";
import type { Diagnostic } from "./capacityTypes";
import type { TaskStatusSnapshot } from "./taskStatusTypes";

export function useTaskStatus(load: () => Promise<TaskStatusSnapshot>) {
  const [snapshot, setSnapshot] = useState<TaskStatusSnapshot>({ tasks: [], observedAtMs: 0, diagnostic: null });
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
        if (!stopped) setSnapshot(previous => ({ tasks: previous.tasks.map(task => ({ ...task, state: "unknown", detail: `${diagnostic.message} · ${diagnostic.code}` })), observedAtMs: Date.now(), diagnostic }));
      }
      if (!stopped) timer = window.setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { stopped = true; if (timer !== null) window.clearTimeout(timer); window.clearInterval(clock); };
  }, [load]);
  return { snapshot, now, setSnapshot };
}
