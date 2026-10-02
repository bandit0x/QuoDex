import type { Diagnostic } from "./capacityTypes";

export type ChatTaskState = "running" | "waiting" | "completed" | "failed" | "unknown";

export interface ChatTask {
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
  observedAtMs: number;
  diagnostic: Diagnostic | null;
}
