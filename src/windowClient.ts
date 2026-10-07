import { invoke, isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";

export type OverlayLayout = "collapsed" | "compact" | "expanded";

export const overlayLayoutSizes: Record<OverlayLayout, { width: number; height: number }> = {
  collapsed: { width: 260, height: 48 },
  compact: { width: 300, height: 130 },
  expanded: { width: 300, height: 160 },
};

// Floating dock: 36px lenses + 6px gap + 116px controls (three rows, incl. the
// usage entry row) + 6px quota gap.
export const SETTINGS_WINDOW_EXTRA_HEIGHT = 164;
export const SETTINGS_ERROR_EXTRA_HEIGHT = 24;

/** 设置坞额外高度：基础预算 + 每条可见错误轨 24px（保存失败与用量打开失败各自独立）。 */
export function planSettingsExtraHeight(saveErrorVisible: boolean, usageErrorVisible: boolean): number {
  return SETTINGS_WINDOW_EXTRA_HEIGHT
    + (saveErrorVisible ? SETTINGS_ERROR_EXTRA_HEIGHT : 0)
    + (usageErrorVisible ? SETTINGS_ERROR_EXTRA_HEIGHT : 0);
}
export const TASK_ROW_HEIGHT = 44;
export const TASK_POPOVER_HEIGHT = 160;

// 指针是否悬停在任务条/浮层上，由 webview 自己的 pointermove 维护。
// 之前用原生 cursorPosition−innerPosition 换算 + elementFromPoint 判定，
// 窗口为 popover 扩展/回落期间换算系统性偏差，稳定悬停也被判为离开。
// 只听 pointermove（真实指针移动才派发）而非 pointerover：布局变化时
// WebKit 会按过渡帧几何合成 pointerover 命中空白，把标志错误刷成 false。
// 移出窗口后事件投给别的 app、leave 事件不再可靠，出窗与否由 Rust 端
// 的 NSEvent mouseLocation 原生查询兜底。
let pointerOverTaskArea = false;
let lastRealPointerMoveAt = 0;
if (typeof document !== "undefined") {
  const markInside = (event: Event) => {
    pointerOverTaskArea = event.target instanceof Element && event.target.closest(".task-strip,.task-popover") !== null;
    lastRealPointerMoveAt = performance.now();
  };
  document.addEventListener("pointermove", markInside, { capture: true, passive: true });
  const markOutside = () => { pointerOverTaskArea = false; };
  document.documentElement.addEventListener("pointerleave", markOutside);
  document.documentElement.addEventListener("mouseleave", markOutside);
}
async function isCursorInWindow(): Promise<boolean> {
  if (!isTauri()) return true;
  return invoke<boolean>("is_cursor_inside_window").catch(() => true);
}
export async function isOverlayTaskPointerInside(): Promise<boolean> {
  if (!pointerOverTaskArea) return false;
  return isCursorInWindow();
}

// 悬停补偿：overlay 非激活（用户在其他 app 前台）时 macOS 不投递鼠标移动，
// WKWebView 的 hover 完全失灵。轮询原生光标位置，命中任务区且真实事件流
// 已停摆时，向命中元素补发 mouse 事件驱动同一套 React 处理。
if (typeof document !== "undefined" && isTauri()) {
  window.setInterval(() => {
    void (async () => {
      if (performance.now() - lastRealPointerMoveAt < 400) return;
      const position = await invoke<[number, number] | null>("cursor_viewport_position").catch(() => null);
      if (!position) return;
      const target = document.elementFromPoint(position[0], position[1]);
      const hit = target !== null && target.closest(".task-strip,.task-popover") !== null;
      // 窗口内但不在任务区：真实事件流停摆时无人更新标志，这里负责归 false，
      // 打开期间的仲裁轮询据此收起浮层。
      pointerOverTaskArea = hit;
      if (!hit) return;
      const options = { clientX: position[0], clientY: position[1], bubbles: true };
      target.dispatchEvent(new MouseEvent("mousemove", options));
      target.dispatchEvent(new MouseEvent("mouseover", options));
    })();
  }, 200);
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
