import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTaskMaterial } from "./useTaskMaterial";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn(async () => undefined) }));
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.clearAllMocks(); });

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
  vi.stubGlobal("requestAnimationFrame", (callback: () => undefined) => { draw = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  document.body.innerHTML = '<main class="app-frame"><aside class="task-popover" style="border-radius:18px"></aside><button class="task-common-diagnostic"></button></main>';
  const popover = document.querySelector<HTMLElement>(".task-popover")!;
  let height = 40;
  Object.defineProperty(popover, "offsetWidth", { get: () => 200 });
  popover.getBoundingClientRect = () => ({ x: 10, y: 10, width: 200, height }) as DOMRect;
  const diagnostic = document.querySelector<HTMLElement>(".task-common-diagnostic")!;
  diagnostic.getBoundingClientRect = () => ({ x: 240, y: 50, width: 12, height: 14 }) as DOMRect;
  const { unmount } = renderHook(() => useTaskMaterial("unchanged-layout", vi.fn()));
  await act(async () => { draw(); await Promise.resolve(); });
  const lastPayload = () => vi.mocked(invoke).mock.calls[vi.mocked(invoke).mock.calls.length - 1]?.[1];
  expect(lastPayload()).toMatchObject({ regions: [{ width: 200, height: 40 }] });
  expect(lastPayload()).toMatchObject({ visibleRegions: [{ width: 200, height: 40 }, { x: 240, y: 50, width: 12, height: 14 }] });
  height = 120;
  await act(async () => {
    if (observed.has(popover)) notify([{ target: popover, contentRect: popover.getBoundingClientRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], {} as ResizeObserver);
    draw(); await Promise.resolve();
  });
  expect(lastPayload()).toMatchObject({ regions: [{ width: 200, height: 120 }] });
  unmount();
});
