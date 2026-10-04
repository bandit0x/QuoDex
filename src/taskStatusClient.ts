import { invoke, isTauri } from "@tauri-apps/api/core";
import { readyTaskSources, type TaskStatusSnapshot } from "./taskStatusTypes";

export async function readTaskStatus(): Promise<TaskStatusSnapshot> {
  if (!isTauri()) {
    const diagnostic = { code: "QDT-601", message: "任务监测需要 QuoDex 桌面应用", detail: null };
    return { tasks: [], sources: readyTaskSources(0).map(source => ({ ...source, health: "unavailable", diagnostic })), observedAtMs: Date.now(), diagnostic };
  }
  return invoke("read_task_status");
}
export function openTaskChat(id: string): Promise<void> { return invoke("open_task_chat", { id }); }
export function dismissTaskFailure(id: string, turnId: string): Promise<void> { return invoke("dismiss_task_failure", { id, turnId }); }
