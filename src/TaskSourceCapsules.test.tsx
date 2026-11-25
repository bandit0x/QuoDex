import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TaskStatusStrip } from "./TaskStatusStrip";
import type { ChatTask, TaskSourceStatus } from "./taskStatusTypes";

const now = 1_800_000_000_000;
const web: ChatTask = { source: "geminiWeb", id: "web:chat", turnId: "turn", title: "整理资料", state: "running", completedAtMs: null, detail: null };
const ag: ChatTask = { ...web, source: "antigravity", id: "ag:chat", title: "检查布局", state: "waiting" };
const zcode: ChatTask = { ...web, source: "zcode", id: "z:chat", title: "应用异常", state: "failed" };
const gemini = () => screen.getByRole("button", { name: /^查看 Gemini 全部/ });

it("lists Gemini Web and Antigravity together with per-chat origins", () => {
  const open = vi.fn();
  render(<TaskStatusStrip tasks={[web, ag, zcode]} now={now} onOpen={open} onDismiss={vi.fn()} />);
  fireEvent.click(gemini());
  const list = screen.getByRole("dialog", { name: "Gemini 任务列表" });
  expect(within(list).getByText("Gemini / Antigravity · 等待你操作")).toBeInTheDocument();
  expect(within(list).getByText("Gemini / Web · 运行中")).toBeInTheDocument();
  expect(within(list).queryByText("应用异常")).toBeNull();
  fireEvent.click(within(list).getByRole("button", { name: /整理资料/ }));
  expect(open).toHaveBeenCalledWith(web);
});

it("shows an unavailable Web source beside an available Antigravity task", () => {
  const status: TaskSourceStatus = { source: "geminiWeb", observedAtMs: now, health: "unavailable", diagnostic: { code: "QDT-641", message: "打开网页聊天后读取", detail: null } };
  render(<TaskStatusStrip tasks={[ag]} now={now} sources={[status]} onOpen={vi.fn()} onDismiss={vi.fn()} />);
  expect(gemini()).toHaveAccessibleName(/状态未知/);
  fireEvent.click(gemini());
  expect(screen.getByText(/Gemini \/ Web · 打开网页聊天后读取 · QDT-641/)).toBeInTheDocument();
  expect(screen.getByText("检查布局")).toBeInTheDocument();
});

it("opens the selected chat when the Web and Antigravity titles are identical", () => {
  const onOpen = vi.fn();
  const webChat = { ...web, title: "同名聊天" };
  const agChat = { ...ag, title: "同名聊天" };
  render(<TaskStatusStrip tasks={[webChat, agChat]} now={now} onOpen={onOpen} onDismiss={vi.fn()} />);
  for (const [origin, expected] of [["Antigravity", agChat], ["Web", webChat]] as const) {
    fireEvent.click(gemini());
    const list = screen.getByRole("dialog", { name: "Gemini 任务列表" });
    fireEvent.click(within(list).getByRole("button", { name: new RegExp(`同名聊天.+Gemini / ${origin}`) }));
    expect(onOpen).toHaveBeenLastCalledWith(expected);
  }
});

it("keeps each agent's status and its diagnostics together when a running chat also needs attention", () => {
  const dismiss = vi.fn();
  const failed = { ...ag, id: "failed", state: "failed" as const, title: "应用异常" };
  const completed = { ...ag, id: "done", state: "completed" as const, completedAtMs: now };
  const props = { now, diagnostic: { code: "QDT-613", message: "检查配置目录权限", detail: null }, onOpen: vi.fn(), onDismiss: dismiss };
  const { rerender } = render(<TaskStatusStrip {...props} tasks={[web, ag, failed, zcode]} />);
  const strip = screen.getByRole("region", { name: "聊天任务" });
  expect(within(strip).getAllByRole("button")).toHaveLength(2);
  expect(strip.textContent).not.toMatch(/\p{Script=Han}/u);
  expect(gemini()).toHaveAttribute("data-spinning");
  expect(gemini()).toHaveAccessibleDescription("运行中，执行报错");
  fireEvent.mouseEnter(gemini());
  const list = screen.getByRole("dialog", { name: "Gemini 任务列表" });
  expect(within(list).getByText(/检查配置目录权限 · QDT-613/)).toBeInTheDocument();
  fireEvent.click(within(list).getByRole("button", { name: "移除 应用异常 的报错提醒" }));
  expect(dismiss).toHaveBeenCalledWith(failed);
  const older = { ...completed, id: "older", completedAtMs: now - 180_000 };
  rerender(<TaskStatusStrip {...props} tasks={[web, older, completed]} reducedMotion />);
  expect(gemini()).not.toHaveAttribute("data-spinning");
  expect(gemini()).toHaveAccessibleDescription("运行中，最近完成于 0 分钟前");
  expect(within(gemini()).getByText("0m")).toBeInTheDocument();
});
