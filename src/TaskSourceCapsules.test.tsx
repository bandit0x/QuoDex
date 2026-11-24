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

it("counts and filters attention across sources and keeps shared diagnostics accessible", () => {
  const dismiss = vi.fn();
  render(<TaskStatusStrip tasks={[web, ag, zcode]} now={now} diagnostic={{ code: "QDT-613", message: "检查配置目录权限", detail: null }} onOpen={vi.fn()} onDismiss={dismiss} />);
  const region = screen.getByRole("region", { name: "聊天任务" });
  expect(within(region).getAllByRole("button")[0]).toHaveAccessibleName("查看 2 项已知报错和等待");
  fireEvent.click(within(region).getAllByRole("button")[0]);
  const attention = screen.getByRole("dialog", { name: "报错和等待" });
  expect(within(attention).getByText("检查布局")).toBeInTheDocument();
  expect(within(attention).queryByText("整理资料")).toBeNull();
  fireEvent.click(within(attention).getByRole("button", { name: "移除 应用异常 的报错提醒" }));
  expect(dismiss).toHaveBeenCalledWith(zcode);
  fireEvent.click(screen.getByRole("button", { name: "公共任务诊断" }));
  expect(within(screen.getByRole("dialog", { name: "公共任务诊断" })).getByText(/检查配置目录权限 · QDT-613/)).toBeInTheDocument();
});
