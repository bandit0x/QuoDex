import { describe, expect, it } from "vitest";
import { planTaskWindowPresentation, chooseTaskPopoverPlacement } from "./windowClient";

describe("native task space", () => {
  it("adds and removes space above the cockpit without moving its screen position", () => {
    const area = { left: 0, top: 0, width: 1920, height: 1040 };
    expect(planTaskWindowPresentation("compact", { x: 100, y: 400 }, area, 0, 36)).toEqual({ position: { x: 100, y: 364 }, size: { width: 300, height: 166 } });
    expect(planTaskWindowPresentation("compact", { x: 100, y: 364 }, area, 36, 0)).toEqual({ position: { x: 100, y: 400 }, size: { width: 300, height: 130 } });
  });
});


it("opens task details below near the top edge without moving the cockpit", () => {
  const area = { left: 0, top: 25, width: 1440, height: 875 };
  expect(chooseTaskPopoverPlacement({ x: 100, y: 40 }, area)).toBe("below");
  expect(planTaskWindowPresentation("compact", { x: 100, y: 40 }, area, 36, 196, 130, 36, 36)).toEqual({ position: { x: 100, y: 40 }, size: { width: 300, height: 326 } });
  expect(chooseTaskPopoverPlacement({ x: 100, y: 400 }, area)).toBe("above");
});
