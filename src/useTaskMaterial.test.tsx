import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTaskMaterial } from "./useTaskMaterial";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async () => undefined) }));
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("waits for positive native geometry during a viewport resize", async () => {
  let draw = () => undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: () => undefined) => { draw = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  let resized: ResizeObserverCallback = () => undefined;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resized = callback; }
    observe() {} unobserve() {} disconnect() {}
  });
  document.body.innerHTML = '<main class="app-frame"><section class="task-strip"></section><div class="glass-shell"></div></main>';
  const task = document.querySelector<HTMLElement>(".task-strip")!;
  task.getBoundingClientRect = () => ({ x: 10, y: 10, width: 200, height: 30 }) as DOMRect;
  const shell = document.querySelector<HTMLElement>(".glass-shell")!;
  let height = 0;
  shell.getBoundingClientRect = () => ({ x: 10, y: 46, width: 200, height }) as DOMRect;
  const onError = vi.fn();
  const { unmount } = renderHook(() => useTaskMaterial("resizing", onError));
  await act(async () => { draw(); await Promise.resolve(); });
  expect(invoke).not.toHaveBeenCalled();
  height = 110;
  await act(async () => { resized([], {} as ResizeObserver); draw(); await Promise.resolve(); });
  expect(invoke).toHaveBeenCalledWith("set_task_material_regions", expect.objectContaining({ visibleRegions: [{ x: 10, y: 10, width: 200, height: 30, radius: 0 }, { x: 10, y: 46, width: 200, height: 110, radius: 0 }] }));
  expect(onError).not.toHaveBeenCalled();
  unmount();
});

it("updates the native mask when an open popover grows without resizing the app frame", async () => {
  let notify: ResizeObserverCallback = () => undefined;
  const observed = new Set<Element>();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe(element: Element) { observed.add(element); }
    unobserve(element: Element) { observed.delete(element); }
    disconnect() { observed.clear(); }
  });
  let draw = () => undefined;
  const requestFrame = vi.fn((callback: () => undefined) => { draw = callback; return 1; });
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  document.body.innerHTML = '<main class="app-frame"><aside class="task-popover" style="border-radius:18px"></aside><button class="task-common-diagnostic"></button><aside class="dock-controls" style="border-top-left-radius:24px"></aside></main>';
  const popover = document.querySelector<HTMLElement>(".task-popover")!;
  let height = 40;
  Object.defineProperty(popover, "offsetWidth", { get: () => 200 });
  popover.getBoundingClientRect = () => ({ x: 10, y: 10, width: 200, height }) as DOMRect;
  const diagnostic = document.querySelector<HTMLElement>(".task-common-diagnostic")!;
  diagnostic.getBoundingClientRect = () => ({ x: 240, y: 50, width: 12, height: 14 }) as DOMRect;
  const settings = document.querySelector<HTMLElement>(".dock-controls")!;
  Object.defineProperty(settings, "offsetWidth", { get: () => 400 });
  settings.getBoundingClientRect = () => ({ x: 10, y: 200, width: 200, height: 78 }) as DOMRect;
  const { unmount } = renderHook(() => useTaskMaterial("unchanged-layout", vi.fn()));
  await act(async () => { draw(); await Promise.resolve(); });
  const lastPayload = () => vi.mocked(invoke).mock.calls[vi.mocked(invoke).mock.calls.length - 1]?.[1];
  expect(lastPayload()).toMatchObject({ regions: [{ width: 200, height: 40 }, { x: 10, y: 200, width: 200, height: 78, radius: 12 }] });
  expect(lastPayload()).toMatchObject({ visibleRegions: [{ width: 200, height: 40 }, { x: 240, y: 50, width: 12, height: 14 }, { width: 200, height: 78 }] });
  height = 120;
  await act(async () => {
    if (observed.has(popover)) notify([{ target: popover, contentRect: popover.getBoundingClientRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], {} as ResizeObserver);
    draw(); await Promise.resolve();
  });
  expect(lastPayload()).toMatchObject({ regions: [{ width: 200, height: 120 }, { width: 200, height: 78 }] });
  // CSS transforms do not notify ResizeObserver. The native material still
  // follows each frame of a lens transition, rather than jumping at its end.
  await act(async () => {
    settings.dispatchEvent(new Event("transitionrun", { bubbles: true }));
    draw(); await Promise.resolve();
  });
  settings.getBoundingClientRect = () => ({ x: 12, y: 202, width: 196, height: 76 }) as DOMRect;
  await act(async () => { draw(); await Promise.resolve(); });
  expect(lastPayload()).toMatchObject({ regions: [{ width: 200, height: 120 }, { x: 12, y: 202, width: 196, height: 76 }] });
  await act(async () => { settings.dispatchEvent(new Event("transitionend", { bubbles: true })); draw(); await Promise.resolve(); });
  await act(async () => { settings.dispatchEvent(new Event("transitionrun", { bubbles: true })); });
  settings.remove();
  await act(async () => { draw(); await Promise.resolve(); });
  // No cancelled event can bubble from the detached node. The frame loop stops.
  requestFrame.mockClear();
  await act(async () => { draw(); await Promise.resolve(); });
  expect(requestFrame).not.toHaveBeenCalled();
  unmount();
});
