import { describe, expect, it } from "vitest";
import {
  overlayLayoutSizes,
  planSettingsWindowPresentation,
  planSettingsWindowRestore,
  TASK_ROW_HEIGHT,
} from "./windowClient";

describe("half-scale overlay layouts", () => {
  it.each(["compact", "expanded", "collapsed"] as const)("adds the approved 124px dock below tasks and quota from %s", (layout) => {
    for (const y of [30, 700]) {
      const presentation = planSettingsWindowPresentation(
        layout,
        { x: 100, y },
        { left: 0, top: 0, width: 1920, height: 1040 },
        TASK_ROW_HEIGHT,
      );
      const settingsBudget = presentation.windowSize.height
        - overlayLayoutSizes[presentation.baseLayout].height - TASK_ROW_HEIGHT;
      expect(settingsBudget).toBe(124); // 36px lenses + 6px gap + 76px controls + 6px quota gap
      expect(presentation.placement).toBe("below");
      expect(presentation.baseLayout).toBe(layout);
      expect(presentation.restore).toEqual({ layout, position: { x: 100, y }, taskSpace: TASK_ROW_HEIGHT });
      expect(presentation.windowPosition.y + presentation.windowSize.height).toBeLessThanOrEqual(1040);
    }
  });

  it("keeps every approved window state at exactly half its previous size", () => {
    expect(overlayLayoutSizes).toEqual({
      collapsed: { width: 260, height: 48 },
      compact: { width: 300, height: 130 },
      expanded: { width: 300, height: 160 },
    });
  });

  it("moves the whole window up at the screen bottom while keeping settings below quota", () => {
    const presentation = planSettingsWindowPresentation(
      "compact",
      { x: 1480, y: 840 },
      { left: 0, top: 0, width: 1920, height: 1040 },
    );

    expect(presentation.placement).toBe("below");
    expect(presentation.windowPosition).toEqual({
      x: 1480,
      y: 786,
    });
    expect(presentation.windowSize).toEqual({
      width: 300,
      height: 254,
    });
    expect(presentation.restore).toEqual({
      layout: "compact",
      position: { x: 1480, y: 840 },
    });
  });

  it("opens settings below the shell when the screen top has no room", () => {
    const presentation = planSettingsWindowPresentation(
      "collapsed",
      { x: 32, y: 20 },
      { left: 0, top: 0, width: 1920, height: 1040 },
    );

    expect(presentation.placement).toBe("below");
    expect(presentation.baseLayout).toBe("collapsed");
    expect(presentation.windowSize).toEqual({ width: 260, height: 172 });
    expect(presentation.windowPosition).toEqual({ x: 32, y: 20 });
    expect(presentation.restore.layout).toBe("collapsed");
  });

  it("keeps the original 260px narrow width at the screen right edge", () => {
    const presentation = planSettingsWindowPresentation(
      "collapsed",
      { x: 1660, y: 20 },
      { left: 0, top: 0, width: 1920, height: 1040 },
    );

    expect(presentation.windowPosition.x).toBe(1660);
    expect(presentation.restore.position).toEqual({ x: 1660, y: 20 });
  });

  it("grows the error rail inside the screen without widening the narrow quota", () => {
    const plan = planSettingsWindowPresentation("collapsed", { x: 1660, y: 950 },
      { left: 0, top: 0, width: 1920, height: 1040 }, 36, 148);
    expect(plan.windowSize).toEqual({ width: 260, height: 232 });
    expect(plan.windowPosition).toEqual({ x: 1660, y: 808 });
  });

  it("restores the original anchor but preserves a user's drag while settings are open", () => {
    const area = { left: 0, top: 0, width: 1920, height: 1040 };
    const plan = planSettingsWindowPresentation("compact", { x: 1480, y: 840 }, area);
    expect(planSettingsWindowRestore(plan, plan.windowPosition, area, 0)).toEqual({ x: 1480, y: 840 });
    expect(planSettingsWindowRestore(plan, { x: 1500, y: 850 }, area, 0)).toEqual({ x: 1500, y: 904 });
  });
});
