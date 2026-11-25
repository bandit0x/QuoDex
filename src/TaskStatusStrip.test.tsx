import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskStatusStrip } from "./TaskStatusStrip";

const now = 1_800_000_000_000;
const success = { source: "codex" as const, id: "chat-1", turnId: "turn-1", title: "整理文档", state: "completed" as const, completedAtMs: now - 600_000, detail: null };

const openCodex = () => fireEvent.click(screen.getByRole("button", { name: /^查看 Codex 全部/ }));

describe("agent rings and chat details", () => {
  it("opens a source list for the agent ring and preserves the project-qualified chat identity", () => {
    const task = { ...success, projectName: "QuoDex", title: "任务状态显示" };
    const onOpen = vi.fn();
    render(<TaskStatusStrip tasks={[task]} now={now} onOpen={onOpen} onDismiss={vi.fn()} />);
    openCodex();
    const list = screen.getByRole("dialog", { name: "Codex 任务列表" });
    expect(within(list).getByText("10m")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "QuoDex：任务状态显示 · 已完成 · 10 分钟前" }));
    expect(onOpen).toHaveBeenCalledWith(task);
  });
  it("paints changing water pixels while running and freezes spatial motion for reduced motion", () => {
    const frames: Uint8ClampedArray[] = [];
    const context = {
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image: ImageData) => frames.push(image.data.slice()),
    };
    const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      return this.classList.contains("task-water-flow") ? context as unknown as CanvasRenderingContext2D : null;
    });
    const boundsSpy = vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 20.4 } as DOMRect);
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    const requestSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callbacks.set(++nextId, callback); return nextId; });
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { callbacks.delete(id); });
    const props = { now, onOpen: vi.fn(), onDismiss: vi.fn(), onPopoverChange: vi.fn() };
    const running = { ...success, state: "running" as const, completedAtMs: null };
    const { rerender, unmount } = render(<TaskStatusStrip {...props} tasks={[running]} />);
    try {
      openCodex();
      expect(frames).toHaveLength(1);
      expect(callbacks.size).toBe(1);
      const initial = frames[0];
      // The doubled rim reaches into the 7.3–8.1px annulus; the previous thin rim did not.
      const size = Math.sqrt(initial.length / 4);
      const innerHighlights = [...initial].filter((_, index) => {
        if (index % 4 !== 1) return false;
        const pixel = Math.floor(index / 4);
        const dx = (pixel % size + 0.5) / size * 20.4 - 10.2;
        const dy = (Math.floor(pixel / size) + 0.5) / size * 20.4 - 10.2;
        const radius = Math.hypot(dx, dy);
        return radius >= 7.3 && radius <= 8.1;
      });
      expect(Math.max(...innerHighlights)).toBeGreaterThan(100);
      act(() => {
        const callback = [...callbacks.values()][0]; callbacks.clear();
        callback(performance.now() + 250);
      });
      expect(frames[frames.length - 1]).not.toEqual(initial);
      rerender(<TaskStatusStrip {...props} tasks={[running]} reducedMotion />);
      expect(callbacks.size).toBe(0);
      const stationary = frames[frames.length - 1];
      rerender(<TaskStatusStrip {...props} tasks={[running]} reducedMotion />);
      expect(frames[frames.length - 1]).toEqual(stationary);
      rerender(<TaskStatusStrip {...props} tasks={[running]} reducedMotion={false} />);
      expect(callbacks.size).toBe(1);
      unmount();
      expect(callbacks.size).toBe(0);
    } finally {
      unmount(); contextSpy.mockRestore(); boundsSpy.mockRestore(); requestSpy.mockRestore(); cancelSpy.mockRestore();
    }
  });
  it("replaces running water motion with the completed check and time when that chat finishes", () => {
    const running = { ...success, state: "running" as const, completedAtMs: null };
    const props = { now, onOpen: vi.fn(), onDismiss: vi.fn(), onPopoverChange: vi.fn() };
    const { rerender } = render(<TaskStatusStrip {...props} tasks={[running]} />);
    expect(document.querySelector(".task-agent-orb[data-spinning]")).not.toBeNull();
    openCodex();
    const button = screen.getByRole("button", { name: "整理文档 · 运行中" });
    expect(button.querySelector("canvas")).not.toBeNull();
    expect(within(button).queryByText("10m")).toBeNull();
    rerender(<TaskStatusStrip {...props} tasks={[success]} />);
    expect(document.querySelector(".task-agent-orb[data-spinning]")).toBeNull();
    const completed = screen.getByRole("button", { name: "整理文档 · 已完成 · 10 分钟前" });
    expect(completed.querySelector("canvas")).toBeNull();
    expect(within(completed).getByText("10m")).toBeInTheDocument();
    expect(completed.querySelector("svg[data-check]")).not.toBeNull();
  });
  it("expires a previously completed chat even when its source becomes unknown", () => {
    const task = { ...success, state: "unknown" as const, expiresAtMs: now + 1_200_000 };
    const { rerender } = render(<TaskStatusStrip tasks={[task]} now={now + 1_199_999} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
    expect(screen.getByRole("region", { name: "聊天任务" })).toBeInTheDocument();
    rerender(<TaskStatusStrip tasks={[task]} now={now + 1_200_000} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "聊天任务" })).not.toBeInTheDocument();
  });
  it("keeps details during a resize-induced leave while the native pointer remains inside", async () => {
    vi.useFakeTimers();
    const isPointerInside = vi.fn().mockResolvedValue(true);
    render(<TaskStatusStrip tasks={[success]} now={now} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} isPointerInside={isPointerInside} />);
    openCodex();
    fireEvent.mouseLeave(screen.getByRole("region", { name: "聊天任务" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(170); });
    expect(screen.getByRole("dialog", { name: "Codex 任务列表" })).toBeInTheDocument();
    isPointerInside.mockResolvedValue(false);
    fireEvent.mouseLeave(screen.getByRole("region", { name: "聊天任务" }));
    // 400ms 的主动仲裁轮询可能在两段确认链中途重置计时；放宽推进量直到链走完。
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
  it("recovers when only the first close probe misreads the window-resize gap", async () => {
    vi.useFakeTimers();
    const isPointerInside = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<TaskStatusStrip tasks={[success]} now={now} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} isPointerInside={isPointerInside} />);
    openCodex();
    fireEvent.mouseLeave(screen.getByRole("region", { name: "聊天任务" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(170); });
    expect(isPointerInside).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect(screen.getByRole("dialog", { name: "Codex 任务列表" })).toBeInTheDocument();
    expect(isPointerInside).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it("shows unknown when the completion time is missing or in the future", () => {
    render(<TaskStatusStrip tasks={[{ ...success, completedAtMs: null }, { ...success, id: "future", title: "异常时间", completedAtMs: now + 1 }]} now={now} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
    openCodex();
    expect(screen.getByRole("button", { name: "整理文档 · 状态未知" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "异常时间 · 状态未知" })).toBeInTheDocument();
    expect(screen.queryByText("0m")).not.toBeInTheDocument();
    expect(document.querySelector("svg[data-check]")).toBeNull();
  });
  it("shows the green check and elapsed minutes inside the same completed circle", () => {
    render(<TaskStatusStrip tasks={[success]} now={now} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
    openCodex();
    const circle = screen.getByRole("button", { name: "整理文档 · 已完成 · 10 分钟前" });
    expect(within(circle).getByText("10m")).toBeInTheDocument();
    expect(circle.querySelector("svg[data-check]")).not.toBeNull();
    fireEvent.click(circle);
  });

  it("uses one ring for an agent and keeps every chat in its hover list", () => {
    const tasks = Array.from({ length: 13 }, (_, i) => ({ ...success, id: `chat-${i}`, title: `聊天 ${i}` }));
    const onOpen = vi.fn();
    const props = { tasks, now, onOpen, onDismiss: vi.fn() };
    const { rerender } = render(<TaskStatusStrip {...props} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    rerender(<TaskStatusStrip {...props} compact />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^查看 Codex/ }));
    const popup = screen.getByRole("dialog", { name: "Codex 任务列表" });
    expect(within(popup).getAllByText("10m")).toHaveLength(13);
    fireEvent.click(within(popup).getByRole("button", { name: "聊天 12 · 已完成 · 10 分钟前" }));
    expect(onOpen).toHaveBeenCalledWith(tasks[12]);
  });

  it("removes completed chats at thirty minutes and collapses the empty task area", () => {
    const { rerender } = render(<TaskStatusStrip tasks={[success]} now={now + 1_199_999} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
    openCodex();
    expect(within(screen.getByRole("dialog")).getByText("29m")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^查看 Codex 全部/ })).toHaveAccessibleDescription("最近完成于 29 分钟前");
    rerender(<TaskStatusStrip tasks={[success]} now={now + 1_200_000} onOpen={vi.fn()} onDismiss={vi.fn()} onPopoverChange={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "聊天任务" })).not.toBeInTheDocument();
  });

  it("keeps a failure reminder beyond thirty minutes and lets the user dismiss it from its details", () => {
    const failed = { ...success, state: "failed" as const, detail: "连接超时 · QDT-103" };
    const onDismiss = vi.fn();
    render(<TaskStatusStrip tasks={[failed]} now={now + 3_600_000} onOpen={vi.fn()} onDismiss={onDismiss} onPopoverChange={vi.fn()} />);
    openCodex();
    expect(screen.getByText("连接超时 · QDT-103")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^移除 整理文档/ }));
    expect(onDismiss).toHaveBeenCalledWith(failed);
  });

  it("lets the user dismiss a completed reminder from its details like a failure", () => {
    const onDismiss = vi.fn();
    render(<TaskStatusStrip tasks={[success]} now={now + 120_000} onOpen={vi.fn()} onDismiss={onDismiss} onPopoverChange={vi.fn()} />);
    openCodex();
    expect(screen.getByText(/已完成 · 12 分钟前/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^移除 整理文档/ }));
    expect(onDismiss).toHaveBeenCalledWith(success);
  });

  it("offers completed reminder removal in the overflow list with per-chat labels", () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({ ...success, id: `chat-${i}`, title: `聊天 ${i}` }));
    const onDismiss = vi.fn();
    render(<TaskStatusStrip tasks={tasks} now={now} onOpen={vi.fn()} onDismiss={onDismiss} onPopoverChange={vi.fn()} />);
    openCodex();
    const list = screen.getByRole("dialog", { name: "Codex 任务列表" });
    fireEvent.click(within(list).getByRole("button", { name: "移除 聊天 5 的完成提醒" }));
    expect(onDismiss).toHaveBeenCalledWith(tasks[5]);
  });
});
