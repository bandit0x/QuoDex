import { readyTaskSources } from "./taskStatusTypes";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "./App";

it("adds the approved task strip to the cockpit and removes its native space when the chat list becomes empty", async () => {
  let tasks = [{ source: "codex" as const, id: "sample-chat", turnId: "sample-turn", title: "整理文档", state: "completed" as const, completedAtMs: Date.now() - 600_000, detail: null }];
  const setTaskSpace = vi.fn(async () => undefined);
  const loadTaskStatus = async () => ({ tasks, sources: readyTaskSources(Date.now()), observedAtMs: Date.now(), diagnostic: null });
  const props = {
    loadSnapshot: async () => ({ sourceState: "healthy" as const, planType: null, accountId: null, fiveHour: null, weekly: null, fullResetCredits: null, observedAtMs: Date.now() }),
    loadZcodeSnapshot: async () => ({ sourceState: "healthy" as const, fiveHour: null, weekly: null, planLevel: null, planKind: "coding_plan" as const, resetCredits: null, resetCreditsDiagnostic: null, observedAtMs: Date.now() }),
    loadTomatoConnection: async () => ({ state: "healthy" as const, countryCode: "UK", latencyMs: 42, observedAtMs: Date.now(), diagnostic: null }),
    loadPreferences: async () => ({ opacity: .92, reducedMotion: false, x: null, y: null, source: "codex" as const }),
    setWindowLayout: async () => undefined,
    loadTaskStatus, setTaskSpace,
  };
  render(<App {...props} />);
  expect(await screen.findByText("10m")).toBeInTheDocument();
  await waitFor(() => expect(setTaskSpace).toHaveBeenCalledWith("compact", 44));
  tasks = [];
  await waitFor(() => expect(screen.queryByRole("region", { name: "聊天任务" })).not.toBeInTheDocument(), { timeout: 2500 });
  await waitFor(() => expect(setTaskSpace).toHaveBeenLastCalledWith("compact", 0));
});
