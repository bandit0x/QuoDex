import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TaskStatusStrip } from "./TaskStatusStrip";

const now = 1_800_000_000_000;
it("keeps each source visible and opens only its own task list when it overflows", () => {
  const codex = Array.from({ length: 6 }, (_, i) => ({ source: "codex" as const, id: `chat-${i}`, turnId: "turn", title: `Codex 聊天 ${i}`, state: "completed" as const, completedAtMs: now - 120_000, detail: null }));
  const zcode = { ...codex[0], source: "zcode" as const, title: "ZCode 同名标识", projectPath: "/example" };
  const open = vi.fn();
  render(<TaskStatusStrip tasks={[...codex, zcode]} now={now} onOpen={open} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
  const left = screen.getByRole("group", { name: "Codex 任务" });
  const right = screen.getByRole("group", { name: "ZCode 任务" });
  expect(within(left).getAllByText("2m")).toHaveLength(5);
  expect(within(right).getByText("2m")).toBeInTheDocument();
  fireEvent.click(within(left).getByRole("button", { name: "Codex：其余 1 个任务" }));
  const list = screen.getByRole("dialog", { name: "Codex 任务列表" });
  expect(within(list).getByText("Codex · 全部 6 项")).toBeInTheDocument();
  expect(within(list).queryByText("ZCode 同名标识")).toBeNull();
  fireEvent.click(within(list).getByRole("button", { name: /^Codex 聊天 5/ }));
  expect(open).toHaveBeenCalledWith(codex[5]);
  fireEvent.click(within(right).getByRole("button", { name: /ZCode 同名标识/ }));
  expect(open).toHaveBeenLastCalledWith(zcode);
});

it("shows an unavailable source beside healthy tasks and distinguishes its empty state from no tasks", () => {
  const task = { source: "codex" as const, id: "one", turnId: "new", title: "仍在运行", state: "running" as const, completedAtMs: null, detail: null };
  render(<TaskStatusStrip tasks={[task]} now={now} sources={[
    { source: "codex", observedAtMs: now, health: "ready", diagnostic: null },
    { source: "zcode", observedAtMs: now - 5000, health: "unavailable", diagnostic: { code: "QDT-622", message: "ZCode 任务格式不受支持；请更新 QuoDex 适配器", detail: null } },
  ]} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
  expect(within(screen.getByRole("group", { name: "Codex 任务" })).getByRole("button", { name: "仍在运行 · 运行中" })).toBeInTheDocument();
  const right = screen.getByRole("group", { name: "ZCode 任务" });
  expect(within(right).getByText("连接异常")).toBeInTheDocument();
  expect(within(right).queryByText("暂无任务")).toBeNull();
  fireEvent.click(within(right).getByRole("button"));
  expect(screen.getByText(/请更新 QuoDex 适配器 · QDT-622/)).toBeInTheDocument();
});

it("keeps a common reminder-store diagnostic reachable even when both sources are healthy and empty", () => {
  render(<TaskStatusStrip tasks={[]} now={now} diagnostic={{ code: "QDT-613", message: "提醒记录无法读取；请检查数据目录权限", detail: null }} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "公共任务诊断" }));
  expect(within(screen.getByRole("dialog", { name: "公共任务诊断" })).getByText(/请检查数据目录权限 · QDT-613/)).toBeInTheDocument();
  expect(screen.getAllByText("暂无任务")).toHaveLength(2);
});

it("dismisses a failed turn from its source overflow list without opening the task", () => {
  const tasks = Array.from({ length: 6 }, (_, i) => ({ source: "zcode" as const, id: `chat-${i}`, turnId: `turn-${i}`, title: `项目任务 ${i}`, state: i === 5 ? "failed" as const : "running" as const, completedAtMs: null, detail: null }));
  const dismiss = vi.fn();
  const open = vi.fn();
  render(<TaskStatusStrip tasks={tasks} now={now} onOpen={open} onDismiss={dismiss} onPopoverChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "ZCode：其余 1 个任务" }));
  fireEvent.click(screen.getByRole("button", { name: "移除 项目任务 5 的报错提醒" }));
  expect(dismiss).toHaveBeenCalledWith(tasks[5]);
  expect(open).not.toHaveBeenCalled();
});
