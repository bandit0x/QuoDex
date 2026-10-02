import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TaskStatusSnapshot } from "./taskStatusTypes";

export async function readTaskStatus(): Promise<TaskStatusSnapshot> {
  if (!isTauri()) return { tasks: [], observedAtMs: Date.now(), diagnostic: { code: "QDT-601", message: "任务监测需要 QuoDex 桌面应用", detail: null } };
  return invoke("read_task_status");
}
export function openTaskChat(id: string): Promise<void> { return invoke("open_codex_chat", { id }); }
export function dismissTaskFailure(id: string, turnId: string): Promise<void> { return invoke("dismiss_task_failure", { id, turnId }); }
