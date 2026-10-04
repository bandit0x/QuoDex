import type { Diagnostic } from "./capacityTypes";

export type ChatTaskState = "running" | "waiting" | "completed" | "failed" | "unknown";
export type TaskSource = "codex" | "zcode";

export interface TaskSourceStatus {
  source: TaskSource;
  observedAtMs: number;
  health: "loading" | "ready" | "unavailable";
  diagnostic: Diagnostic | null;
}

export function readyTaskSources(observedAtMs: number): TaskSourceStatus[] {
  return ["codex", "zcode"].map(source => ({ source: source as TaskSource, observedAtMs, health: "ready", diagnostic: null }));
}

export interface ChatTask {
  source: TaskSource;
  id: string;
  turnId: string;
  title: string;
  state: ChatTaskState;
  completedAtMs: number | null;
  expiresAtMs?: number | null;
  detail: string | null;
  projectPath?: string;
  projectName?: string;
}

export interface TaskStatusSnapshot {
  tasks: ChatTask[];
  sources: TaskSourceStatus[];
  observedAtMs: number;
  diagnostic: Diagnostic | null;
}
