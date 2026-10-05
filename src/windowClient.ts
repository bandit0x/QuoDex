import { currentMonitor, cursorPosition, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

export type OverlayLayout = "collapsed" | "compact" | "expanded";

export const overlayLayoutSizes: Record<OverlayLayout, { width: number; height: number }> = {
  collapsed: { width: 260, height: 48 },
  compact: { width: 300, height: 130 },
  expanded: { width: 300, height: 160 },
};

// Floating dock: 36px lenses + 6px gap + 76px controls + 6px quota gap.
export const SETTINGS_WINDOW_EXTRA_HEIGHT = 124;
export const SETTINGS_ERROR_EXTRA_HEIGHT = 24;
export const TASK_ROW_HEIGHT = 44;
export const TASK_POPOVER_HEIGHT = 160;

export async function isOverlayTaskPointerInside(): Promise<boolean> {
  if (!isTauri()) return false;
  const appWindow = getCurrentWindow();
  const [cursor, origin, scale] = await Promise.all([cursorPosition(), appWindow.innerPosition(), appWindow.scaleFactor()]);
  const target = document.elementFromPoint((cursor.x - origin.x) / scale, (cursor.y - origin.y) / scale);
  return target?.closest(".task-strip,.task-popover") !== null && target !== null;
}
let taskWindowSpace = 0;
let taskWindowAboveSpace = 0;
export type TaskPopoverPlacement = "above" | "below";
export function chooseTaskPopoverPlacement(position: OverlayPosition, area: OverlayWorkArea): TaskPopoverPlacement {
  return position.y - area.top >= TASK_POPOVER_HEIGHT ? "above" : "below";
}
let resizeQueue: Promise<unknown> = Promise.resolve();

function serializeWindowChange<T>(change: () => Promise<T>): Promise<T> {
  const result = resizeQueue.then(change, change);
  resizeQueue = result.catch(() => undefined);
  return result;
}

export interface OverlayPosition {
  x: number;
  y: number;
}

export interface OverlayWorkArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SettingsWindowPresentation {
  baseLayout: OverlayLayout;
  placement: "above" | "below";
  windowPosition: OverlayPosition;
  windowSize: { width: number; height: number };
  restore: {
    layout: OverlayLayout;
    position: OverlayPosition;
    taskSpace?: number;
  };
}

export function planSettingsWindowPresentation(
  layout: OverlayLayout,
  position: OverlayPosition,
  workArea: OverlayWorkArea,
  taskSpace = 0,
  extraHeight = SETTINGS_WINDOW_EXTRA_HEIGHT,
): SettingsWindowPresentation {
  const baseLayout = layout;
  const originalSize = overlayLayoutSizes[baseLayout];
  const baseSize = { ...originalSize, height: originalSize.height + taskSpace };
  const workAreaRight = workArea.left + workArea.width;
  const workAreaBottom = workArea.top + workArea.height;
  const maximumY = workAreaBottom - baseSize.height - extraHeight;
  const maximumX = workAreaRight - baseSize.width;

  return {
    baseLayout,
    placement: "below",
    windowPosition: {
      x: Math.max(workArea.left, Math.min(maximumX, position.x)),
      y: Math.max(workArea.top, Math.min(maximumY, position.y)),
    },
    windowSize: {
      width: baseSize.width,
      height: baseSize.height + extraHeight,
    },
    restore: { layout, position, ...(taskSpace > 0 ? { taskSpace } : {}) },
  };
}

export async function setOverlayWindowLayout(layout: OverlayLayout): Promise<void> {
  const { width, height } = overlayLayoutSizes[layout];
  await serializeWindowChange(() => getCurrentWindow().setSize(new LogicalSize(width, height + taskWindowSpace)));
}

export function planTaskWindowPresentation(layout: OverlayLayout, position: OverlayPosition, area: OverlayWorkArea, previousSpace: number, nextSpace: number, baseHeight = overlayLayoutSizes[layout].height, previousAbove = previousSpace, nextAbove = nextSpace) {
  const size = { width: overlayLayoutSizes[layout].width, height: baseHeight + nextSpace };
  return { size, position: { x: Math.max(area.left, Math.min(area.left + area.width - size.width, position.x)), y: Math.max(area.top, Math.min(area.top + area.height - size.height, position.y + previousAbove - nextAbove)) } };
}

export function setOverlayTaskSpace(layout: OverlayLayout, nextSpace: number, placement: TaskPopoverPlacement = "above"): Promise<void> {
  return serializeWindowChange(async () => {
    const nextAbove = placement === "below" && nextSpace > TASK_ROW_HEIGHT ? TASK_ROW_HEIGHT : nextSpace;
    if (nextSpace === taskWindowSpace && nextAbove === taskWindowAboveSpace) return;
    const appWindow = getCurrentWindow();
    const [position, area, physicalSize, scale] = await Promise.all([getOverlayWindowPosition(), getOverlayWorkArea(), appWindow.innerSize(), appWindow.scaleFactor()]);
    const size = physicalSize.toLogical(scale);
    const plan = planTaskWindowPresentation(layout, position, area, taskWindowSpace, nextSpace, size.height - taskWindowSpace, taskWindowAboveSpace, nextAbove);
    try {
      await appWindow.setPosition(new LogicalPosition(plan.position.x, plan.position.y));
      await appWindow.setSize(new LogicalSize(plan.size.width, plan.size.height));
      taskWindowSpace = nextSpace;
      taskWindowAboveSpace = nextAbove;
    } catch (error) {
      await Promise.allSettled([appWindow.setPosition(new LogicalPosition(position.x, position.y)), appWindow.setSize(new LogicalSize(size.width, size.height))]);
      throw error;
    }
  });
}

export async function getOverlayWindowPosition(): Promise<OverlayPosition> {
  const window = getCurrentWindow();
  const [position, scaleFactor] = await Promise.all([window.outerPosition(), window.scaleFactor()]);
  return position.toLogical(scaleFactor);
}

export async function setOverlayWindowPosition(position: OverlayPosition): Promise<void> {
  await getCurrentWindow().setPosition(new LogicalPosition(position.x, position.y));
}

export async function getOverlayWorkArea(): Promise<OverlayWorkArea> {
  // WKWebView 不暴露 Chromium 专属的 screen.availLeft/availTop，优先用 Tauri
  // 的 currentMonitor 拿跨平台工作区；坐标统一折算成逻辑像素。
  const monitor = await currentMonitor().catch(() => null);
  if (monitor) {
    const scale = monitor.scaleFactor || 1;
    return {
      left: monitor.workArea.position.x / scale,
      top: monitor.workArea.position.y / scale,
      width: monitor.workArea.size.width / scale,
      height: monitor.workArea.size.height / scale,
    };
  }
  const screenWithOffsets = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    left: screenWithOffsets.availLeft ?? 0,
    top: screenWithOffsets.availTop ?? 0,
    width: screenWithOffsets.availWidth,
    height: screenWithOffsets.availHeight,
  };
}

export async function openOverlaySettings(
  layout: OverlayLayout,
): Promise<SettingsWindowPresentation> {
  return serializeWindowChange(async () => {
  const appWindow = getCurrentWindow();
  const [physicalPosition, scaleFactor] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.scaleFactor(),
  ]);
  const position = physicalPosition.toLogical(scaleFactor);
  const workArea = await getOverlayWorkArea();
  const presentation = planSettingsWindowPresentation(layout, position, workArea, taskWindowSpace);

  try {
    await appWindow.setPosition(new LogicalPosition(
      presentation.windowPosition.x,
      presentation.windowPosition.y,
    ));
    await appWindow.setSize(new LogicalSize(
      presentation.windowSize.width,
      presentation.windowSize.height,
    ));
    return presentation;
  } catch (error) {
    const restoreSize = overlayLayoutSizes[layout];
    await Promise.allSettled([
      appWindow.setSize(new LogicalSize(restoreSize.width, restoreSize.height + taskWindowSpace)),
      appWindow.setPosition(new LogicalPosition(position.x, position.y)),
    ]);
    throw error;
  }
  });
}

export async function closeOverlaySettings(
  presentation: SettingsWindowPresentation,
): Promise<void> {
  return serializeWindowChange(async () => {
  const appWindow = getCurrentWindow();
  const [currentPosition, area] = await Promise.all([getOverlayWindowPosition(), getOverlayWorkArea()]);
  const restoreSize = overlayLayoutSizes[presentation.restore.layout];
  const position = planSettingsWindowRestore(presentation, currentPosition, area, taskWindowSpace);
  await appWindow.setSize(new LogicalSize(restoreSize.width, restoreSize.height + taskWindowSpace));
  await appWindow.setPosition(new LogicalPosition(position.x, position.y));
  });
}

export function planSettingsWindowRestore(presentation: SettingsWindowPresentation, currentPosition: OverlayPosition, area: OverlayWorkArea, taskSpace: number): OverlayPosition {
  const size = overlayLayoutSizes[presentation.restore.layout];
  return {
    x: Math.max(area.left, Math.min(area.left + area.width - size.width, presentation.restore.position.x + currentPosition.x - presentation.windowPosition.x)),
    y: Math.max(area.top, Math.min(area.top + area.height - size.height - taskSpace, presentation.restore.position.y + currentPosition.y - presentation.windowPosition.y)),
  };
}

export async function resizeOverlaySettings(presentation: SettingsWindowPresentation, extraHeight: number): Promise<SettingsWindowPresentation> {
  return serializeWindowChange(async () => {
    const appWindow = getCurrentWindow();
    const [position, area, physicalSize, scale] = await Promise.all([getOverlayWindowPosition(), getOverlayWorkArea(), appWindow.innerSize(), appWindow.scaleFactor()]);
    const size = physicalSize.toLogical(scale);
    const next = planSettingsWindowPresentation(presentation.baseLayout, position, area, taskWindowSpace, extraHeight);
    next.restore = {
      ...presentation.restore,
      taskSpace: taskWindowSpace,
      position: {
        x: presentation.restore.position.x + position.x - presentation.windowPosition.x,
        y: presentation.restore.position.y + position.y - presentation.windowPosition.y,
      },
    };
    try {
      await appWindow.setPosition(new LogicalPosition(next.windowPosition.x, next.windowPosition.y));
      await appWindow.setSize(new LogicalSize(next.windowSize.width, next.windowSize.height));
      return next;
    } catch (error) {
      await Promise.allSettled([appWindow.setPosition(new LogicalPosition(position.x, position.y)), appWindow.setSize(new LogicalSize(size.width, size.height))]);
      throw error;
    }
  });
}
