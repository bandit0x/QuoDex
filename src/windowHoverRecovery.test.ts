import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

it("recovers task hover from native coordinates and clears it when the pointer belongs to another window", async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockReturnValue(1000);
  let position: [number, number] | null = [100, 190];
  vi.mocked(invoke).mockImplementation(async command => (
    command === "cursor_viewport_position" ? position : true
  ) as never);
  document.body.innerHTML = '<section class="task-strip"><button>task</button></section>';
  const button = document.querySelector("button")!;
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => button) });
  const hovered = vi.fn();
  button.addEventListener("mouseover", hovered);
  const { isOverlayTaskPointerInside } = await import("./windowClient");
  await vi.advanceTimersByTimeAsync(200);
  expect(hovered).toHaveBeenCalledTimes(1);
  expect(await isOverlayTaskPointerInside()).toBe(true);
  position = null;
  await vi.advanceTimersByTimeAsync(200);
  expect(await isOverlayTaskPointerInside()).toBe(false);
});
