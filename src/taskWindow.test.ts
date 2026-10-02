import { describe, expect, it } from "vitest";
import { planTaskWindowPresentation } from "./windowClient";

describe("native task space", () => {
  it("adds and removes space above the cockpit without moving its screen position", () => {
    const area = { left: 0, top: 0, width: 1920, height: 1040 };
    expect(planTaskWindowPresentation("compact", { x: 100, y: 400 }, area, 0, 36)).toEqual({ position: { x: 100, y: 364 }, size: { width: 300, height: 166 } });
    expect(planTaskWindowPresentation("compact", { x: 100, y: 364 }, area, 36, 0)).toEqual({ position: { x: 100, y: 400 }, size: { width: 300, height: 130 } });
  });
});
