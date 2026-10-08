import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTaskMaterial } from "./useTaskMaterial";
import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { TaskStatusStrip, visibleChatTasks } from "./TaskStatusStrip";
import { useTaskStatus } from "./useTaskStatus";
import { readTaskStatus, openTaskChat, dismissTaskFailure } from "./taskStatusClient";
import type { ChatTask, TaskStatusSnapshot } from "./taskStatusTypes";
import { FluidReservoir } from "./FluidReservoir";
import { ProQuotaSurface, type CodexPresentation } from "./ProQuotaSurface";
import { OpticalShell } from "./OpticalShell";
import { SettingsDock, type PreferenceSaveState, type UsageEntryState } from "./SettingsDock";
import {
  enableTemporaryClickThrough,
  loadDisplayPreferences,
  quitApplication,
  readCapacitySnapshot,
  saveDisplayPreferences,
} from "./capacityClient";
import { readTomatoConnection } from "./tomatoClient";
import { openUsagePage } from "./usageClient";
import { readZcodeQuotaSnapshot } from "./zcodeClient";
import type {
  CapacitySnapshot,
  Diagnostic,
  DisplayPreferences,
  FullResetCredits,
  MeterSource,
  QuotaWindow,
  SourceSelection,
  TomatoConnectionSnapshot,
  ZCodePlanPreference,
  ZCodeQuotaSnapshot,
} from "./capacityTypes";
import {
  createFluidSessionSeed,
  deriveChamberSeed,
  IDLE_FLUID_MOTION,
  type FluidMotionSample,
} from "./fluidPhysics";
import type { FluidAccent } from "./opticalFluidRenderer";
import {
  closeOverlaySettings,
  getOverlayWindowPosition,
  getOverlayWorkArea,
  openOverlaySettings,
  resizeOverlaySettings,
  overlayLayoutSizes,
  setOverlayWindowLayout,
  setOverlayWindowPosition,
  setOverlayTaskSpace,
  TASK_ROW_HEIGHT,
  TASK_POPOVER_HEIGHT,
  planSettingsExtraHeight,
  type OverlayLayout,
  type OverlayPosition,
  type OverlayWorkArea,
  type SettingsWindowPresentation,
} from "./windowClient";

export type CapacityLoader = () => Promise<CapacitySnapshot>;
export type ZcodeSnapshotLoader = (preferredPlan: ZCodePlanPreference) => Promise<ZCodeQuotaSnapshot>;
export type TomatoConnectionLoader = () => Promise<TomatoConnectionSnapshot>;

interface AppProps {
  loadTaskStatus?: () => Promise<TaskStatusSnapshot>;
  openChat?: (id: string) => Promise<void>;
  dismissFailure?: (id: string, turnId: string) => Promise<void>;
  setTaskSpace?: (layout: OverlayLayout, space: number) => Promise<void>;
  codexPresentation?: CodexPresentation;
  initialLayout?: OverlayLayout;
  loadSnapshot?: CapacityLoader;
  loadZcodeSnapshot?: ZcodeSnapshotLoader;
  loadTomatoConnection?: TomatoConnectionLoader;
  loadPreferences?: () => Promise<DisplayPreferences>;
  loadPinStartupDiagnostic?: () => Promise<Diagnostic | null>;
  readPinState?: () => Promise<boolean>;
  savePreferences?: (preferences: DisplayPreferences) => Promise<void>;
  enableClickThrough?: (durationMs?: number) => Promise<void>;
  setWindowLayout?: (layout: OverlayLayout) => Promise<void>;
  getWindowPosition?: () => Promise<OverlayPosition>;
  setWindowPosition?: (position: OverlayPosition) => Promise<void>;
  openSettingsWindow?: (layout: OverlayLayout) => Promise<SettingsWindowPresentation>;
  closeSettingsWindow?: (presentation: SettingsWindowPresentation) => Promise<void>;
  resizeSettingsWindow?: (presentation: SettingsWindowPresentation, extraHeight: number) => Promise<SettingsWindowPresentation>;
  quitApp?: () => Promise<void>;
  motionSessionSeed?: number;
}

type ViewState<S> =
  | { kind: "loading" }
  | { kind: "healthy"; snapshot: S }
  | { kind: "failed"; diagnostic: Diagnostic };

interface SourceSlot<S> {
  view: ViewState<S>;
  lastSnapshot: S | null;
  isRefreshing: boolean;
  load: () => Promise<void>;
}

const sourceLabels: Record<MeterSource, string> = {
  codex: "Codex",
  zcode: "ZCode",
};

const sourceFailureHints: Record<MeterSource, string> = {
  codex: "检查 Codex 是否已安装并登录",
  zcode: "检查 ZCode 是否已登录",
};

function normalizeSourceSelection(value: SourceSelection | undefined): SourceSelection {
  return value === "zcode" || value === "codex" ? value : "carousel";
}

const defaultPreferences: DisplayPreferences = {
  opacity: 0.92,
  reducedMotion: false,
  alwaysOnTop: true,
  x: null,
  y: null,
  source: "carousel",
};

async function readPinStartupDiagnostic(): Promise<Diagnostic | null> {
  return isTauri() ? invoke("read_window_pin_startup_diagnostic") : null;
}

async function readWindowPinState(): Promise<boolean> {
  const result = await invoke<{ snapshot: { enabled: boolean } }>("read_window_pin_diagnostics");
  if (typeof result?.snapshot?.enabled !== "boolean") throw new Error("窗口置顶读回缺少 enabled 状态");
  return result.snapshot.enabled;
}
const REFRESH_INTERVAL_MS = 5_000;
const CAROUSEL_INTERVAL_MS = 10_000;
const CLICK_THROUGH_DURATION_MS = 10_000;
const ROUTE_HEALTHY_INTERVAL_MS = 5_000;
const ROUTE_BLOCKED_INTERVAL_MS = 1_000;
const ROUTE_FAILURE_THRESHOLD = 2;

function formatPercent(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatCredits(window: { quotaRemaining: number; quotaTotal: number }): string {
  return `${window.quotaRemaining} / ${window.quotaTotal}`;
}

function formatReset(timestamp: number, includeWeekday: boolean): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: includeWeekday ? "short" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

function formatExpiry(timestamp?: number | null): string {
  if (!timestamp) return "到期时间不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

function formatFreshness(observedAtMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - observedAtMs) / 1000));
  if (seconds < 5) return "Updated now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds / 60)}m ago`;
}

function normalizeDiagnostic(error: unknown, sourceLabel: string): Diagnostic {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<Diagnostic>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return {
        code: candidate.code,
        message: candidate.message,
        detail: candidate.detail ?? null,
        accountId: candidate.accountId ?? null,
      };
    }
  }

  return {
    code: "CRV-100",
    message: `无法读取 ${sourceLabel} 配额`,
    detail: error instanceof Error ? error.message : String(error),
    accountId: null,
  };
}

/**
 * 套餐 → 展示模式映射。只有协议明确披露的 pro 档套餐（pro/prolite 等）才进入
 * Pro 单仓；套餐未知（planType 为 null，包括 fiveHour 缺失的情况）一律保持双仓，
 * 不从额度窗口形状反推套餐。
 */
export function deriveCodexPresentation(snapshot: CapacitySnapshot | null): CodexPresentation {
  const planType = snapshot?.planType?.trim().toLowerCase();
  return planType && planType.startsWith("pro") ? { mode: "pro-weekly" } : { mode: "dual" };
}

/** Codex 缓存数据的归属标识：同一次读取中与额度同批产生的账户 ID。 */
function codexSnapshotIdentity(snapshot: CapacitySnapshot): string | null {
  return snapshot.accountId ?? null;
}

function normalizeRouteFailure(error: unknown): TomatoConnectionSnapshot {
  const diagnostic = normalizeDiagnostic(error, "Codex");
  return {
    state: "blocked",
    countryCode: null,
    latencyMs: null,
    observedAtMs: Date.now(),
    diagnostic: {
      ...diagnostic,
      code: diagnostic.code === "CRV-100" ? "CRV-405" : diagnostic.code,
      message: "TomatoCloud route is unavailable",
    },
  };
}

function routeStatusText(route: TomatoConnectionSnapshot | null): string {
  if (!route) return "Checking route…";
  if (route.state === "blocked") return "Route blocked · retrying";
  const country = route.countryCode ?? "—";
  const latency = route.latencyMs === null ? "—" : `${route.latencyMs}`;
  return `${country} · ${latency} ms`;
}

export interface RouteGateState {
  visible: TomatoConnectionSnapshot | null;
  consecutiveFailures: number;
}

export function applyRouteGate(
  current: RouteGateState,
  next: TomatoConnectionSnapshot,
): RouteGateState {
  if (next.state === "healthy") {
    return { visible: next, consecutiveFailures: 0 };
  }

  const consecutiveFailures = current.consecutiveFailures + 1;
  if (consecutiveFailures < ROUTE_FAILURE_THRESHOLD) {
    return { visible: current.visible, consecutiveFailures };
  }

  return { visible: next, consecutiveFailures };
}

function useSourceSlot<S>(
  loader: () => Promise<S>,
  sourceLabel: string,
  identityOf?: (snapshot: S) => string | null,
): SourceSlot<S> {
  const [view, setView] = useState<ViewState<S>>({ kind: "loading" });
  const [lastSnapshot, setLastSnapshot] = useState<S | null>(null);
  const lastSnapshotRef = useRef<S | null>(null);
  const generationRef = useRef(0);
  const inFlightRef = useRef<{ loader: () => Promise<S>; promise: Promise<void> } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback((): Promise<void> => {
    if (inFlightRef.current?.loader === loader) return inFlightRef.current.promise;
    const generation = ++generationRef.current;
    if (lastSnapshotRef.current !== null) setIsRefreshing(true);
    else setView({ kind: "loading" });

    const request = Promise.resolve().then(async () => {
      try {
        const snapshot = await loader();
        if (generation !== generationRef.current) return;
        lastSnapshotRef.current = snapshot;
        setLastSnapshot(snapshot);
        setView({ kind: "healthy", snapshot });
      } catch (error) {
        if (generation !== generationRef.current) return;
        const diagnostic = normalizeDiagnostic(error, sourceLabel);
        const cached = lastSnapshotRef.current;
        if (cached && identityOf) {
          const cachedIdentity = identityOf(cached);
          if ((diagnostic.accountId ?? null) !== cachedIdentity) {
            // 失败时的登录身份与缓存数据的归属账户不同（切换账户或退出登录）：
            // 丢弃旧账户的额度与套餐标识，不把它展示给当前登录状态。
            lastSnapshotRef.current = null;
            setLastSnapshot(null);
          }
        }
        setView({ kind: "failed", diagnostic });
      } finally {
        if (generation === generationRef.current) setIsRefreshing(false);
      }
    }).finally(() => {
      if (inFlightRef.current?.promise === request) inFlightRef.current = null;
    });
    inFlightRef.current = { loader, promise: request };
    return request;
  }, [loader, sourceLabel, identityOf]);

  useEffect(() => {
    void load();
  }, [load]);

  return { view, lastSnapshot, isRefreshing, load };
}

function Icon({ name }: { name: "chevron" | "settings" | "close" }) {
  if (name === "settings") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" />
        <path d="M19.2 13.4a7.8 7.8 0 0 0 .1-1.4 7.8 7.8 0 0 0-.1-1.4l2-1.5-2-3.4-2.4 1a8.6 8.6 0 0 0-2.4-1.4L14 2.8h-4l-.4 2.5a8.6 8.6 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.5A7.8 7.8 0 0 0 4.7 12c0 .5 0 .9.1 1.4l-2 1.5 2 3.4 2.4-1a8.6 8.6 0 0 0 2.4 1.4l.4 2.5h4l.4-2.5a8.6 8.6 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.5Z" />
      </svg>
    );
  }

  if (name === "close") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7.5 7.5 9 9m0-9-9 9" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 9.5 4 4 4-4" />
    </svg>
  );
}

const SCALE_TICKS = Array.from({ length: 21 }, (_, index) => index);

function QuotaCell({
  label,
  window,
  accent,
  credits,
  motion,
  motionSeed,
  reducedMotion,
}: {
  label: "5 HOUR" | "WEEK";
  window: QuotaWindow | null;
  accent: FluidAccent;
  credits?: string;
  motion: FluidMotionSample;
  motionSeed: number;
  reducedMotion: boolean;
}) {
  const remaining = window?.remainingPercent ?? 0;

  return (
    <section
      className={`quota-cell quota-cell--${accent} ${label === "WEEK" ? "quota-cell--week " : ""}${window ? "" : "quota-cell--unavailable"}`}
      aria-label={`${label} quota${window ? "" : " unavailable"}`}
      role="group"
    >
      {window && (
        <FluidReservoir
          remainingPercent={remaining}
          accent={accent}
          motion={motion}
          motionSeed={motionSeed}
          reducedMotion={reducedMotion}
        />
      )}
      <span className="quota-cell__bezel" aria-hidden="true" />
      <div className="cell-content">
        <span className="quota-label">{label}</span>
        <div className="capacity-value">
          <span>{window ? `${formatPercent(remaining)}%` : "—"}</span>
          {window && <small>LEFT</small>}
        </div>
        {window && credits && <span className="quota-credits">{credits}</span>}
        <span className="reset-time">
          {window
            ? window.resetsAt === null
              ? "Resets —"
              : `Resets ${formatReset(window.resetsAt, label === "WEEK")}`
            : "Data unavailable"}
        </span>
        <div className="scale-line" aria-hidden="true">
          <span className="scale-line__axis" />
          <span className="scale-line__ticks">
            {SCALE_TICKS.map((index) => (
              <span
                className={index % 5 === 0 ? "scale-tick scale-tick--major" : "scale-tick"}
                key={index}
              />
            ))}
          </span>
          <span className="scale-line__marker" style={{ top: `${100 - remaining}%` }} />
        </div>
      </div>
    </section>
  );
}

function LoadingSurface({ label }: { label: string }) {
  return (
    <div className="loading-surface" role="status" aria-live="polite" aria-label={`正在读取 ${label} 配额`}>
      <span className="loading-scan" aria-hidden="true" />
      {["5 HOUR", "WEEK"].map((windowLabel) => (
        <section className="loading-cell" key={windowLabel}>
          <span className="quota-label">{windowLabel}</span>
          <span className="skeleton skeleton--large" />
          <span className="skeleton skeleton--medium" />
          <span className="skeleton skeleton--small" />
        </section>
      ))}
    </div>
  );
}

function FailedSurface({
  diagnostic,
  source,
  onRetry,
}: {
  diagnostic: Diagnostic;
  source: MeterSource;
  onRetry: () => void;
}) {
  const title = `无法读取 ${sourceLabels[source]} 配额`;
  const reason = diagnostic.message.trim();
  return (
    <section className="failed-surface" aria-live="assertive">
      <span className="error-mark" aria-hidden="true">!</span>
      <strong>{title}</strong>
      <span>{reason && reason !== title ? reason : sourceFailureHints[source]} · 诊断码 {diagnostic.code}</span>
      <button type="button" onClick={onRetry}>重试</button>
    </section>
  );
}

function RouteAlert({ diagnostic, onRetry }: { diagnostic: Diagnostic | null; onRetry: () => void }) {
  return (
    <section className="route-alert" role="alert" aria-live="assertive">
      <span className="route-alert__mark" aria-hidden="true">!</span>
      <strong>TomatoCloud route is unavailable</strong>
      <span>{diagnostic?.code ?? "CRV-404"} · Retrying every second</span>
      <button type="button" onClick={onRetry}>Retry</button>
    </section>
  );
}

function ZCodeResetDetail({ label, credits }: {
  label: string;
  credits: FullResetCredits | undefined;
}) {
  const expiry = credits?.availableCount === 0 ? "无可用卡" : formatExpiry(credits?.nearestExpiryAt);
  return (
    <span className="reset-card-detail" title={`最近到期：${expiry}`}>
      {label} <b>{credits?.availableCount ?? "—"}</b> · {expiry}
    </span>
  );
}

function RouteStatus({ route, alert }: { route: TomatoConnectionSnapshot | null; alert: boolean }) {
  return (
    <span
      className={`route-status route-status--${route?.state ?? "probing"}`}
      role="status"
      aria-live={alert ? "assertive" : "polite"}
      aria-label={`TomatoCloud ${routeStatusText(route)}`}
    >
      <i className="route-status__lamp" aria-hidden="true" />
      <span>{routeStatusText(route)}</span>
    </span>
  );
}

function SourceBadge({ source, pro = false }: { source: MeterSource; pro?: boolean }) {
  return (
    <span className={`source-badge source-badge--${source}`}>
      <i aria-hidden="true" />
      {source === "codex" ? "CODEX" : "ZCODE"}
      {pro && <span className="source-badge__pro">PRO</span>}
    </span>
  );
}

function CollapsedSurface({
  source,
  pro,
  trial,
  fiveHourPercent,
  weeklyPercent,
  onRestore,
}: {
  pro?: boolean;
  trial?: boolean;
  source: MeterSource;
  fiveHourPercent: number | null;
  weeklyPercent: number | null;
  onRestore: () => void;
}) {
  if (pro) return <button className="collapsed-surface collapsed-surface--pro" type="button" data-window-drag-surface onClick={onRestore} aria-label="恢复标准视图">
    <span className="collapsed-pro-source">CODEX · PRO</span>
    <span>WEEK <strong>{weeklyPercent === null ? "—" : `${formatPercent(weeklyPercent)}%`}</strong></span>
    <i className="collapsed-dot collapsed-dot--pro" aria-hidden="true"/><Icon name="chevron"/>
  </button>;
  if (trial) return <button className="collapsed-surface collapsed-surface--pro collapsed-surface--zcode-trial" type="button" data-window-drag-surface onClick={onRestore} aria-label="恢复标准视图">
    <span className="collapsed-pro-source">ZCODE · START</span>
    <span>TRIAL <strong>{fiveHourPercent === null ? "—" : `${formatPercent(fiveHourPercent)}%`}</strong></span>
    <i className="collapsed-dot collapsed-dot--zcode-trial" aria-hidden="true"/><Icon name="chevron"/>
  </button>;
  return (
    <button
      className="collapsed-surface"
      type="button"
      data-window-drag-surface
      onClick={onRestore}
      aria-label="恢复标准视图"
    >
      <span>
        <strong>{fiveHourPercent === null ? "—" : `${formatPercent(fiveHourPercent)}%`}</strong>
        <i className={`collapsed-dot collapsed-dot--${source} collapsed-dot--${source}-five-hour`} aria-hidden="true" />
      </span>
      <span>
        <strong>{weeklyPercent === null ? "—" : `${formatPercent(weeklyPercent)}%`}</strong>
        <i className={`collapsed-dot collapsed-dot--${source} collapsed-dot--${source}-weekly`} aria-hidden="true" />
      </span>
    </button>
  );
}

function freshnessText(
  snapshot: Pick<CapacitySnapshot, "fiveHour" | "weekly" | "observedAtMs">,
  stale: boolean,
  diagnostic?: Diagnostic,
  options?: { weeklyOnly?: boolean; poolOnly?: boolean },
): string {
  const unavailable = [
    options?.weeklyOnly || snapshot.fiveHour ? null : "5-hour unavailable",
    options?.poolOnly || snapshot.weekly ? null : "Week unavailable",
  ].filter(Boolean);

  if (stale) return `STALE · ${diagnostic?.code ?? "cached snapshot"}`;
  if (unavailable.length > 0) return `${formatFreshness(snapshot.observedAtMs)} · ${unavailable.join(" · ")}`;
  return formatFreshness(snapshot.observedAtMs);
}

export function App({
  loadTaskStatus = readTaskStatus,
  openChat = openTaskChat,
  dismissFailure = dismissTaskFailure,
  setTaskSpace = setOverlayTaskSpace,
  codexPresentation,
  initialLayout = "compact",
  loadSnapshot = readCapacitySnapshot,
  loadZcodeSnapshot = readZcodeQuotaSnapshot,
  loadTomatoConnection = readTomatoConnection,
  loadPreferences = loadDisplayPreferences,
  loadPinStartupDiagnostic = readPinStartupDiagnostic,
  readPinState = readWindowPinState,
  savePreferences = saveDisplayPreferences,
  enableClickThrough = enableTemporaryClickThrough,
  setWindowLayout = setOverlayWindowLayout,
  getWindowPosition = getOverlayWindowPosition,
  setWindowPosition = setOverlayWindowPosition,
  openSettingsWindow = openOverlaySettings,
  closeSettingsWindow = closeOverlaySettings,
  resizeSettingsWindow = resizeOverlaySettings,
  quitApp = quitApplication,
  motionSessionSeed,
}: AppProps) {
  const taskStatus = useTaskStatus(loadTaskStatus);
  const [taskStripGeneration, setTaskStripGeneration] = useState(0);
  const tasks = visibleChatTasks(taskStatus.snapshot.tasks, taskStatus.now);
  const hasTaskArea = tasks.length > 0 || taskStatus.snapshot.sources.some(source => source.health !== "ready") || taskStatus.snapshot.diagnostic !== null;
  // 任务浮层空间常驻预留（任务行+浮层区），浮层开合只是窗口内一层的显隐：
  // 窗口尺寸变化与界面重绘分属两个进程，任何开合缩放都会产生可见的不同步帧。
  const taskSpace = hasTaskArea ? TASK_ROW_HEIGHT + TASK_POPOVER_HEIGHT : 0;
  const codexSlot = useSourceSlot(loadSnapshot, "Codex", codexSnapshotIdentity);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [layoutMode, setLayoutMode] = useState<OverlayLayout>(initialLayout);
  const [settingsPresentation, setSettingsPresentation] = useState<SettingsWindowPresentation | null>(null);
  const settingsNativePresentation = useRef<SettingsWindowPresentation | null>(null);
  useEffect(() => {
    if (taskStatus.snapshot.observedAtMs === 0) return;
    void setTaskSpace(settingsPresentation?.baseLayout ?? layoutMode, taskSpace).catch(() => setControlMessage("任务区域无法调整；请重新打开 QuoDex · QDT-612"));
  }, [taskSpace, setTaskSpace, layoutMode, settingsPresentation?.baseLayout, taskStatus.snapshot.observedAtMs === 0]);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [confirmedAlwaysOnTop, setConfirmedAlwaysOnTop] = useState<boolean | null>(true);
  const confirmedPinRef = useRef<boolean | null>(true);
  const pinRetryRequest = useRef<boolean | null>(null);
  const pinRetryDiagnostic = useRef<Diagnostic | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [preferenceSaveState, setPreferenceSaveState] = useState<PreferenceSaveState>("idle");
  const [pendingPreferenceSaves, setPendingPreferenceSaves] = useState(0);
  const [preferenceSaveError, setPreferenceSaveError] = useState<Diagnostic | null>(null);
  // 用量统计入口：idle → opening（防重复派发）→ requested（1.6s 后复位）；失败走独立错误轨。
  const [usageEntryState, setUsageEntryState] = useState<UsageEntryState>("idle");
  const [usageOpenError, setUsageOpenError] = useState<Diagnostic | null>(null);
  const usageEntryTimer = useRef<number | null>(null);
  const openUsagePageEntry = useCallback(() => {
    if (usageEntryState === "opening") return;
    setUsageOpenError(null);
    setUsageEntryState("opening");
    openUsagePage().then(() => {
      setUsageEntryState("requested");
      if (usageEntryTimer.current !== null) window.clearTimeout(usageEntryTimer.current);
      usageEntryTimer.current = window.setTimeout(() => setUsageEntryState("idle"), 1600);
    }).catch((error: unknown) => {
      setUsageEntryState("idle");
      setUsageOpenError(normalizeDiagnostic(error, "用量统计"));
    });
  }, [usageEntryState]);
  useEffect(() => () => {
    if (usageEntryTimer.current !== null) window.clearTimeout(usageEntryTimer.current);
  }, []);
  const preferenceSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const preferenceSaveResult = useRef<Promise<unknown>>(Promise.resolve());
  const preferenceSaveGeneration = useRef(0);
  const opacityDirty = useRef(false);
  const acceptPinState = useCallback((applied: boolean | null) => {
    confirmedPinRef.current = applied;
    setConfirmedAlwaysOnTop(applied);
    if (applied !== null) {
      const current = { ...preferencesRef.current, alwaysOnTop: applied };
      preferencesRef.current = current;
      setPreferences(current);
    }
  }, []);
  const settingsResizeGeneration = useRef(0);
  const settingsResizeRequest = useRef<Promise<SettingsWindowPresentation> | null>(null);
  const zcodePlanPreference = preferences.zcodePlan ?? "start";
  const loadZcodeSnapshotWithPlan = useCallback(
    () => loadZcodeSnapshot(zcodePlanPreference),
    [loadZcodeSnapshot, zcodePlanPreference],
  );
  const zcodeSlot = useSourceSlot(loadZcodeSnapshotWithPlan, "ZCode");
  const [carouselSource, setCarouselSource] = useState<MeterSource>("codex");
  const [clickThroughSeconds, setClickThroughSeconds] = useState(0);
  const [routeConnection, setRouteConnection] = useState<TomatoConnectionSnapshot | null>(null);
  const routeProbeInFlightRef = useRef<Promise<TomatoConnectionSnapshot> | null>(null);
  const routeGateRef = useRef<RouteGateState>({ visible: null, consecutiveFailures: 0 });
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [fluidMotion, setFluidMotion] = useState<FluidMotionSample>(IDLE_FLUID_MOTION);
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const dragRef = useRef({
    pointerId: -1,
    ready: false,
    lastPointerX: 0,
    lastPointerY: 0,
    lastTime: 0,
    positionX: 0,
    positionY: 0,
    velocityX: 0,
    velocityY: 0,
    pendingDeltaX: 0,
    pendingDeltaY: 0,
    startPointerX: 0,
    startPointerY: 0,
    moved: false,
    fromCollapsedSurface: false,
  });
  const inertiaFrameRef = useRef<number | null>(null);
  const dragWorkAreaRef = useRef<OverlayWorkArea>({
    left: 0,
    top: 0,
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  });
  const motionSequenceRef = useRef(0);
  const previousMotionVelocityRef = useRef({ x: 0, y: 0 });
  const suppressCollapsedRestoreUntilRef = useRef(0);
  const settingsTransitionRef = useRef(false);
  const [fluidChamberSeeds] = useState(() => {
    const sessionSeed = motionSessionSeed ?? createFluidSessionSeed();
    return {
      codexFiveHour: deriveChamberSeed(sessionSeed, "codex-five-hour"),
      codexWeekly: deriveChamberSeed(sessionSeed, "codex-weekly"),
      zcodeFiveHour: deriveChamberSeed(sessionSeed, "zcode-five-hour"),
      zcodeWeekly: deriveChamberSeed(sessionSeed, "zcode-weekly"),
    };
  });

  const refreshAll = useCallback(() => {
    void codexSlot.load();
    void zcodeSlot.load();
  }, [codexSlot.load, zcodeSlot.load]);

  const probeRoute = useCallback((): Promise<TomatoConnectionSnapshot> => {
    if (routeProbeInFlightRef.current) return routeProbeInFlightRef.current;

    const probe = loadTomatoConnection()
      .catch(normalizeRouteFailure)
      .then((connection) => {
        const nextGate = applyRouteGate(routeGateRef.current, connection);
        routeGateRef.current = nextGate;
        setRouteConnection(nextGate.visible);
        return connection;
      })
      .finally(() => {
        routeProbeInFlightRef.current = null;
      });
    routeProbeInFlightRef.current = probe;
    return probe;
  }, [loadTomatoConnection]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void codexSlot.load();
      void zcodeSlot.load();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [codexSlot.load, zcodeSlot.load]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const scheduleProbe = async () => {
      const connection = await probeRoute();
      if (cancelled) return;
      const interval = connection.state === "blocked"
        ? ROUTE_BLOCKED_INTERVAL_MS
        : ROUTE_HEALTHY_INTERVAL_MS;
      timer = window.setTimeout(() => void scheduleProbe(), interval);
    };

    void scheduleProbe();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [probeRoute]);

  const sourceSelection = normalizeSourceSelection(preferences.source);

  useEffect(() => {
    if (sourceSelection !== "carousel") return;
    let timer: number | null = null;
    const scheduleToggle = () => {
      timer = window.setTimeout(() => {
        setCarouselSource((value) => (value === "codex" ? "zcode" : "codex"));
        scheduleToggle();
      }, CAROUSEL_INTERVAL_MS);
    };
    scheduleToggle();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [sourceSelection]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadPreferences();
        if (cancelled) return;
        const alwaysOnTop = loaded.alwaysOnTop ?? true;
        const restored = { ...loaded, alwaysOnTop, source: normalizeSourceSelection(loaded.source) };
        preferencesRef.current = restored;
        setPreferences(restored);
        acceptPinState(alwaysOnTop);
        const diagnostic = await loadPinStartupDiagnostic();
        if (cancelled || !diagnostic) return;
        pinRetryRequest.current = alwaysOnTop;
        pinRetryDiagnostic.current = diagnostic;
        setPreferenceSaveError(diagnostic);
        setPreferenceSaveState("failed");
        try {
          const applied = await readPinState();
          if (!cancelled) acceptPinState(applied);
        } catch {
          if (!cancelled) {
            acceptPinState(null);
            const unconfirmed = { ...diagnostic, message: "窗口置顶状态未确认；请重试或重新打开 QuoDex" };
            pinRetryDiagnostic.current = unconfirmed;
            setPreferenceSaveError(unconfirmed);
          }
        }
      } catch (error) {
        if (cancelled) return;
        const diagnostic = error as Partial<Diagnostic> | null;
        setPreferenceSaveError({
          code: typeof diagnostic?.code === "string" ? diagnostic.code : "CRV-309",
          message: typeof diagnostic?.message === "string" ? diagnostic.message : "无法恢复显示设置；请重新打开 QuoDex",
          detail: diagnostic?.detail ?? null,
        });
        setPreferenceSaveState("failed");
      }
    })();
    return () => { cancelled = true; };
  }, [loadPreferences, loadPinStartupDiagnostic, readPinState, acceptPinState]);

  useEffect(() => {
    if (clickThroughSeconds <= 0) return;
    const timer = window.setInterval(
      () => setClickThroughSeconds((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [clickThroughSeconds]);

  useEffect(() => () => {
    if (inertiaFrameRef.current !== null) cancelAnimationFrame(inertiaFrameRef.current);
  }, []);

  const publishFluidMotion = useCallback(
    (velocityX: number, velocityY: number, phase: FluidMotionSample["phase"]) => {
      const previous = previousMotionVelocityRef.current;
      const accelerationX = (velocityX - previous.x) * 8;
      const accelerationY = (velocityY - previous.y) * 8;
      previousMotionVelocityRef.current = { x: velocityX, y: velocityY };
      motionSequenceRef.current += 1;
      setFluidMotion({ sequence: motionSequenceRef.current, accelerationX, accelerationY, phase });
    },
    [],
  );

  const stopWindowInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) cancelAnimationFrame(inertiaFrameRef.current);
    inertiaFrameRef.current = null;
  }, []);

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const fromCollapsedSurface = target.closest("[data-window-drag-surface]") !== null;
    if (target.closest("button, input, [role='dialog']") && !fromCollapsedSurface) return;
    event.preventDefault();
    stopWindowInertia();
    void getOverlayWorkArea().then((area) => {
      dragWorkAreaRef.current = area;
    });
    // Keep clicks on the collapsed button while pointer moves still bubble to the drag handler.
    const captureTarget = target.closest<HTMLElement>("[data-window-drag-surface]") ?? event.currentTarget;
    captureTarget.setPointerCapture?.(event.pointerId);
    const drag = dragRef.current;
    drag.pointerId = event.pointerId;
    drag.ready = false;
    drag.lastPointerX = event.screenX;
    drag.lastPointerY = event.screenY;
    drag.startPointerX = event.screenX;
    drag.startPointerY = event.screenY;
    drag.lastTime = performance.now();
    drag.velocityX = 0;
    drag.velocityY = 0;
    drag.pendingDeltaX = 0;
    drag.pendingDeltaY = 0;
    drag.moved = false;
    drag.fromCollapsedSurface = fromCollapsedSurface;
    previousMotionVelocityRef.current = { x: 0, y: 0 };
    setIsWindowDragging(true);

    void getWindowPosition()
      .then((position) => {
        if (drag.pointerId !== event.pointerId) return;
        drag.positionX = position.x + drag.pendingDeltaX;
        drag.positionY = position.y + drag.pendingDeltaY;
        drag.ready = true;
        if (drag.pendingDeltaX !== 0 || drag.pendingDeltaY !== 0) {
          void setWindowPosition({ x: drag.positionX, y: drag.positionY });
        }
      })
      .catch(() => {
        drag.pointerId = -1;
        setIsWindowDragging(false);
        setControlMessage("窗口无法拖动 · CRV-307");
      });
  }, [getWindowPosition, setWindowPosition, stopWindowInertia]);

  const handleDragMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const elapsed = Math.max(8, now - drag.lastTime);
    const deltaX = event.screenX - drag.lastPointerX;
    const deltaY = event.screenY - drag.lastPointerY;
    const sampleX = deltaX / elapsed;
    const sampleY = deltaY / elapsed;
    if (Math.hypot(event.screenX - drag.startPointerX, event.screenY - drag.startPointerY) >= 3) {
      drag.moved = true;
    }
    drag.velocityX = drag.velocityX * 0.38 + sampleX * 0.62;
    drag.velocityY = drag.velocityY * 0.38 + sampleY * 0.62;
    if (drag.ready) {
      drag.positionX += deltaX;
      drag.positionY += deltaY;
    } else {
      drag.pendingDeltaX += deltaX;
      drag.pendingDeltaY += deltaY;
    }
    drag.lastPointerX = event.screenX;
    drag.lastPointerY = event.screenY;
    drag.lastTime = now;
    if (drag.ready) void setWindowPosition({ x: drag.positionX, y: drag.positionY });
    publishFluidMotion(drag.velocityX, drag.velocityY, "dragging");
  }, [publishFluidMotion, setWindowPosition]);

  const handleDragEnd = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (drag.fromCollapsedSurface && drag.moved) {
      suppressCollapsedRestoreUntilRef.current = performance.now() + 250;
    }
    drag.pointerId = -1;
    drag.ready = false;
    setIsWindowDragging(false);
    const staleSample = performance.now() - drag.lastTime > 90;
    let velocityX = staleSample || preferences.reducedMotion ? 0 : drag.velocityX;
    let velocityY = staleSample || preferences.reducedMotion ? 0 : drag.velocityY;
    publishFluidMotion(velocityX, velocityY, "released");
    if (Math.hypot(velocityX, velocityY) < 0.035) return;

    let positionX = drag.positionX;
    let positionY = drag.positionY;
    let lastFrame = performance.now();
    const workArea = dragWorkAreaRef.current;
    const minimumX = workArea.left;
    const minimumY = workArea.top;
    const maximumX = minimumX + workArea.width - window.outerWidth;
    const maximumY = minimumY + workArea.height - window.outerHeight;

    const glide = (time: number) => {
      const elapsed = Math.min(32, Math.max(8, time - lastFrame));
      lastFrame = time;
      const friction = Math.exp(-elapsed / 145);
      velocityX *= friction;
      velocityY *= friction;
      positionX += velocityX * elapsed;
      positionY += velocityY * elapsed;
      const nextX = Math.max(minimumX, Math.min(maximumX, positionX));
      const nextY = Math.max(minimumY, Math.min(maximumY, positionY));
      if (nextX !== positionX) velocityX = 0;
      if (nextY !== positionY) velocityY = 0;
      positionX = nextX;
      positionY = nextY;
      void setWindowPosition({ x: positionX, y: positionY });
      publishFluidMotion(velocityX, velocityY, "dragging");
      if (Math.hypot(velocityX, velocityY) < 0.018) {
        inertiaFrameRef.current = null;
        publishFluidMotion(0, 0, "idle");
        return;
      }
      inertiaFrameRef.current = requestAnimationFrame(glide);
    };
    inertiaFrameRef.current = requestAnimationFrame(glide);
  }, [preferences.reducedMotion, publishFluidMotion, setWindowPosition]);

  const persistPreferences = useCallback((next: DisplayPreferences, requestedPin?: boolean) => {
    const generation = ++preferenceSaveGeneration.current;
    setPreferenceSaveState("saving");
    setPendingPreferenceSaves(count => count + 1);
    const write = preferenceSaveQueue.current.then(async () => {
      const attemptedPin = requestedPin ?? confirmedPinRef.current ?? next.alwaysOnTop ?? true;
      try {
        if (requestedPin === undefined && confirmedPinRef.current === null) {
          throw { code: "CRV-308", message: "窗口置顶状态未确认；请点击重试或重新打开 QuoDex", detail: null };
        }
        const accepted = { ...next, alwaysOnTop: requestedPin ?? confirmedPinRef.current! };
        await savePreferences(accepted);
        acceptPinState(accepted.alwaysOnTop);
        if (requestedPin !== undefined) {
          pinRetryRequest.current = null;
          pinRetryDiagnostic.current = null;
        }
        if (generation !== preferenceSaveGeneration.current) return;
        setPreferenceSaveError(pinRetryDiagnostic.current);
        setPreferenceSaveState(pinRetryRequest.current !== null ? "failed" : opacityDirty.current ? "idle" : "saved");
      } catch (error) {
        const failure = error as Partial<Diagnostic> | null;
        const structured = typeof failure?.code === "string" && typeof failure?.message === "string";
        let diagnostic: Diagnostic = { code: structured ? failure.code! : "CRV-303", message: structured ? failure.message! : "本地写入失败", detail: structured ? failure.detail ?? null : "检查本地存储空间和配置目录写入权限后重试" };
        if (requestedPin !== undefined) {
          pinRetryRequest.current = requestedPin;
        } else if (diagnostic.code === "CRV-308" && pinRetryRequest.current === null) {
          pinRetryRequest.current = attemptedPin;
        }
        if (diagnostic.code === "CRV-308") {
          acceptPinState(null);
          try {
            acceptPinState(await readPinState());
          } catch {
            diagnostic = { ...diagnostic, message: "窗口置顶状态未确认；请重试或重新打开 QuoDex" };
          }
        } else {
          acceptPinState(confirmedPinRef.current);
        }
        if (requestedPin !== undefined || diagnostic.code === "CRV-308") {
          pinRetryDiagnostic.current = diagnostic;
        }
        if (generation === preferenceSaveGeneration.current || requestedPin !== undefined) {
          setPreferenceSaveError(diagnostic);
          setPreferenceSaveState("failed");
        }
        throw diagnostic;
      } finally {
        setPendingPreferenceSaves(count => count - 1);
      }
    });
    preferenceSaveResult.current = write;
    preferenceSaveQueue.current = write.catch(() => undefined);
  }, [savePreferences, readPinState, acceptPinState]);

  const updatePreferences = useCallback((next: DisplayPreferences) => {
    const requestedPin = (next.alwaysOnTop ?? true) !== (preferencesRef.current.alwaysOnTop ?? true) ? next.alwaysOnTop ?? true : undefined;
    preferencesRef.current = next;
    setPreferences(next);
    opacityDirty.current = false;
    persistPreferences(next, requestedPin);
  }, [persistPreferences]);

  const previewOpacity = useCallback((opacity: number) => {
    preferencesRef.current = { ...preferencesRef.current, opacity };
    setPreferences(preferencesRef.current);
    opacityDirty.current = true;
    setPreferenceSaveState(current => current === "failed" ? "failed" : "idle");
  }, []);
  const commitOpacity = useCallback(() => {
    if (!opacityDirty.current) return;
    opacityDirty.current = false;
    persistPreferences(preferencesRef.current);
  }, [persistPreferences]);

  const retryPreferences = useCallback(() => {
    const requestedPin = pinRetryRequest.current;
    const next = { ...preferencesRef.current, alwaysOnTop: requestedPin ?? preferencesRef.current.alwaysOnTop };
    preferencesRef.current = next;
    setPreferences(next);
    opacityDirty.current = false;
    persistPreferences(next, requestedPin ?? undefined);
  }, [persistPreferences]);

  useEffect(() => {
    if (preferenceSaveState !== "saved") return;
    const timer = window.setTimeout(() => setPreferenceSaveState("idle"), 1_600);
    return () => window.clearTimeout(timer);
  }, [preferenceSaveState]);

  const openSettings = useCallback(async () => {
    if (settingsTransitionRef.current || settingsPresentation) return;
    settingsTransitionRef.current = true;
    stopWindowInertia();
    try {
      setTaskStripGeneration(value => value + 1);
      await setTaskSpace(layoutMode, hasTaskArea ? TASK_ROW_HEIGHT + TASK_POPOVER_HEIGHT : 0);
      const presentation = await openSettingsWindow(layoutMode);
      settingsNativePresentation.current = presentation;
      setSettingsPresentation(presentation);
    } catch {
      setControlMessage("设置窗口未能打开 · CRV-302");
    } finally {
      settingsTransitionRef.current = false;
    }
  }, [layoutMode, openSettingsWindow, settingsPresentation, stopWindowInertia, hasTaskArea, setTaskSpace]);

  const closeSettings = useCallback(async () => {
    if (settingsTransitionRef.current) return false;
    if (!settingsPresentation) return true;
    settingsTransitionRef.current = true;
    settingsResizeGeneration.current += 1;
    commitOpacity();
    try {
      const presentation = settingsResizeRequest.current
        ? await settingsResizeRequest.current.catch(() => settingsNativePresentation.current ?? settingsPresentation)
        : settingsNativePresentation.current ?? settingsPresentation;
      await closeSettingsWindow(presentation);
      settingsNativePresentation.current = null;
      setSettingsPresentation(null);
      settingsButtonRef.current?.focus({ preventScroll: true });
      return true;
    } catch {
      setControlMessage("设置窗口未能复位 · CRV-302");
      return false;
    } finally {
      settingsTransitionRef.current = false;
    }
  }, [closeSettingsWindow, settingsPresentation, commitOpacity]);

  const settingsExtraHeight = planSettingsExtraHeight(Boolean(preferenceSaveError), Boolean(usageOpenError));
  useEffect(() => {
    const generation = ++settingsResizeGeneration.current;
    if (!settingsPresentation || settingsTransitionRef.current) return;
    const currentExtra = settingsPresentation.windowSize.height - overlayLayoutSizes[settingsPresentation.baseLayout].height - (settingsPresentation.restore.taskSpace ?? 0);
    const previous = settingsResizeRequest.current;
    if (currentExtra === settingsExtraHeight && !previous) return;
    const request = (previous ? previous.catch(() => settingsNativePresentation.current ?? settingsPresentation) : Promise.resolve(settingsNativePresentation.current ?? settingsPresentation))
      .then(current => resizeSettingsWindow(current, settingsExtraHeight))
      .then(next => {
        settingsNativePresentation.current = next;
        return next;
      });
    settingsResizeRequest.current = request;
    void request.then(next => {
      if (generation === settingsResizeGeneration.current) setSettingsPresentation(next);
    }).catch(() => {
      if (generation === settingsResizeGeneration.current) setControlMessage("设置窗口未能调整；请收起后重试 · CRV-302");
    }).finally(() => {
      if (settingsResizeRequest.current === request) settingsResizeRequest.current = null;
    });
    return () => { settingsResizeGeneration.current += 1; };
  }, [settingsPresentation, settingsExtraHeight, resizeSettingsWindow]);

  // 任务浮层与设置形态互斥：悬停/展开任务列表时先收起设置（纯界面态，无窗口操作）。
  const changeTaskPopover = useCallback((open: boolean) => {
    if (open && settingsPresentation) void closeSettings();
  }, [settingsPresentation, closeSettings]);

  const changeLayout = useCallback(async (next: OverlayLayout) => {
    if (!await closeSettings()) return;
    setLayoutMode(next);
    void setWindowLayout(next).catch(() => setControlMessage("窗口布局未能调整 · CRV-302"));
  }, [closeSettings, setWindowLayout]);

  const toggleSettings = useCallback(async () => {
    if (settingsPresentation) {
      await closeSettings();
      return;
    }
    await openSettings();
  }, [closeSettings, openSettings, settingsPresentation]);

  // 退出前提交预览并等待最后一笔串行写入；保存失败沿用控制坞的重试入口。
  const quitMeter = useCallback(async () => {
    commitOpacity();
    try {
      await preferenceSaveResult.current;
    } catch {
      return;
    }
    quitApp().catch(() => setControlMessage("退出未能执行 · CRV-307"));
  }, [commitOpacity, quitApp]);

  useEffect(() => {
    if (!settingsPresentation) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void closeSettings();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeSettings, settingsPresentation]);

  const restoreCollapsedLayout = useCallback(() => {
    if (performance.now() < suppressCollapsedRestoreUntilRef.current) return;
    changeLayout("compact");
  }, [changeLayout]);

  const startClickThrough = useCallback(async () => {
    try {
      await enableClickThrough(CLICK_THROUGH_DURATION_MS);
      setClickThroughSeconds(CLICK_THROUGH_DURATION_MS / 1_000);
    } catch {
      setControlMessage("穿透模式未能开启 · CRV-304");
    }
  }, [enableClickThrough]);

  const activeSource: MeterSource = sourceSelection === "carousel" ? carouselSource : sourceSelection;
  const activeSlot = activeSource === "codex" ? codexSlot : zcodeSlot;
  const activeIsZcode = activeSource === "zcode";
  const codexSnapshot = codexSlot.view.kind === "healthy" ? codexSlot.view.snapshot : codexSlot.lastSnapshot;
  const zcodeSnapshot = zcodeSlot.view.kind === "healthy" ? zcodeSlot.view.snapshot : zcodeSlot.lastSnapshot;
  const activeSnapshot = activeIsZcode ? zcodeSnapshot : codexSnapshot;
  // 体验套餐（Start Plan）没有 5h/周窗口，额度聚合为单池，复用 Pro 单舱形态
  const zcodeIsTrial = zcodeSnapshot?.planKind === "start_plan";
  const zcodeTrialSurface = activeIsZcode && zcodeIsTrial;
  // 显式传入的 codexPresentation 仅供测试与设计验证入口覆盖；生产从不传参，
  // 展示模式由最新快照里的协议套餐字段派生（未知套餐保持双仓）。
  const effectiveCodexPresentation = codexPresentation ?? deriveCodexPresentation(codexSnapshot);
  const activeIsPro = !activeIsZcode && effectiveCodexPresentation.mode === "pro-weekly";
  const staleFromFailure = activeSlot.view.kind === "failed" && activeSnapshot !== null;
  const stale = staleFromFailure || activeSnapshot?.sourceState === "stale";
  const failureDiagnostic = activeSlot.view.kind === "failed" ? activeSlot.view.diagnostic : undefined;
  const routeBlocked = routeConnection?.state === "blocked";
  const visibleLayout = settingsPresentation?.baseLayout ?? layoutMode;
  const settingsOpen = settingsPresentation !== null;
  const collapsed = visibleLayout === "collapsed" && activeSnapshot !== null;
  const expanded = visibleLayout === "expanded";
  useTaskMaterial(`${visibleLayout}:${hasTaskArea}:${settingsPresentation?.placement ?? "closed"}:${controlMessage !== null}`, setControlMessage);

  const openTask = (task: ChatTask) => {
    void openChat(task.id).catch(error => {
      const diagnostic = error as Partial<Diagnostic> | null;
      setControlMessage(diagnostic?.message ? `${diagnostic.message} · ${diagnostic.code ?? "QDT-611"}` : "无法打开聊天或项目；确认对应桌面应用已安装 · QDT-611");
    });
  };
  const removeFailure = (task: ChatTask) => {
    void dismissFailure(task.id, task.turnId).then(() => taskStatus.setSnapshot(previous => ({ ...previous, tasks: previous.tasks.filter(item => item.source !== task.source || item.id !== task.id || item.turnId !== task.turnId) })))
      .catch(() => setControlMessage("无法保存提醒移除操作；检查本地配置目录权限 · QDT-613"));
  };

  const detailActions = (
    <div className="detail-actions">
      <button type="button" onClick={() => void refreshAll()} disabled={activeSlot.isRefreshing}>
        {activeSlot.isRefreshing ? "刷新中" : "刷新"}
      </button>
      <button type="button" onClick={() => void startClickThrough()}>
        {clickThroughSeconds > 0 ? `穿透 ${clickThroughSeconds}s` : "穿透 10 秒"}
      </button>
      <button type="button" onClick={() => changeLayout("collapsed")}>收起为窄条</button>
      <button ref={settingsButtonRef} type="button" onClick={() => void toggleSettings()}>
        <Icon name="settings" />
        <span>设置</span>
      </button>
    </div>
  );

  return (
    <main
      className={`app-frame app-frame--${visibleLayout}${hasTaskArea ? " app-frame--has-tasks" : ""}${settingsPresentation ? ` app-frame--settings-${settingsPresentation.placement}` : ""} ${preferences.reducedMotion ? "reduce-motion" : ""} ${isWindowDragging ? "is-dragging" : ""}`}
      style={{ "--surface-opacity": preferences.opacity, "--settings-space": `${settingsExtraHeight * 2}px` } as React.CSSProperties}
      onContextMenu={(event) => {
        event.preventDefault();
        void toggleSettings();
      }}
      onPointerDown={handleDragStart}
      onPointerMove={handleDragMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
    >
      <TaskStatusStrip key={taskStripGeneration} tasks={tasks} now={taskStatus.now} sources={taskStatus.snapshot.sources} diagnostic={taskStatus.snapshot.diagnostic} reducedMotion={preferences.reducedMotion} onOpen={openTask} onDismiss={removeFailure} onPopoverChange={changeTaskPopover} />
      <div className={`glass-shell glass-shell--${visibleLayout} ${stale ? "glass-shell--stale" : ""} ${routeBlocked && !activeIsZcode ? "glass-shell--route-blocked" : ""}`}>
        <OpticalShell
          dragging={isWindowDragging}
          reducedMotion={preferences.reducedMotion}
          opacity={preferences.opacity}
        />
        {/* TomatoCloud 只承载 Codex 路由，ZCode 直连 bigmodel 不受路由阻断影响 */}
        {routeBlocked && !activeIsZcode && <span className="route-alert-halo" aria-hidden="true" />}
        <div className="drag-rail" aria-hidden="true" />
        {!collapsed && <SourceBadge source={activeSource} pro={activeIsPro} />}

        {collapsed && activeSnapshot ? (
          <CollapsedSurface
            source={activeSource}
            pro={activeIsPro}
            trial={zcodeTrialSurface}
            fiveHourPercent={activeSnapshot.fiveHour?.remainingPercent ?? null}
            weeklyPercent={activeSnapshot.weekly?.remainingPercent ?? null}
            onRestore={restoreCollapsedLayout}
          />
        ) : (
          <>
            {!activeIsPro && !zcodeTrialSurface && activeSlot.view.kind === "loading" && <LoadingSurface label={sourceLabels[activeSource]} />}
            {!activeIsPro && !zcodeTrialSurface && activeSlot.view.kind === "failed" && !activeSnapshot && (
              <FailedSurface diagnostic={activeSlot.view.diagnostic} source={activeSource} onRetry={() => void refreshAll()} />
            )}
            {(activeIsPro || zcodeTrialSurface) && <ProQuotaSurface
              variant={zcodeTrialSurface ? "zcode-trial" : "codex-pro"}
              window={zcodeTrialSurface ? zcodeSnapshot?.fiveHour ?? null : codexSnapshot?.weekly ?? null}
              motion={fluidMotion}
              motionSeed={zcodeTrialSurface ? fluidChamberSeeds.zcodeFiveHour : fluidChamberSeeds.codexWeekly}
              reducedMotion={preferences.reducedMotion}
              resetLabel={zcodeTrialSurface
                ? (zcodeSnapshot?.fiveHour?.resetsAt == null ? "Expires —" : `Expires ${formatReset(zcodeSnapshot.fiveHour.resetsAt, true)}`)
                : (codexSnapshot?.weekly?.resetsAt == null ? "Resets —" : `Resets ${formatReset(codexSnapshot.weekly.resetsAt, true)}`)}
              status={stale ? "stale" : activeSlot.view.kind === "loading" ? "loading" : activeSlot.view.kind === "failed" ? "failed" : "ready"}
              low={zcodeTrialSurface ? false : effectiveCodexPresentation.weeklyLow}
              diagnostic={failureDiagnostic}
              onRetry={() => void refreshAll()}
            />}
            {!activeIsPro && !zcodeTrialSurface && activeSnapshot && (
              <div
                key={activeSource}
                className={`quota-grid source-stage${activeIsZcode && !zcodeSnapshot?.weekly ? " quota-grid--single" : ""}`}
              >
                {activeIsZcode && zcodeSnapshot ? (
                  <>
                    <QuotaCell
                      label="5 HOUR"
                      window={zcodeSnapshot.fiveHour}
                      accent="moonlight"
                      credits={zcodeSnapshot.fiveHour ? formatCredits(zcodeSnapshot.fiveHour) : undefined}
                      motion={fluidMotion}
                      motionSeed={fluidChamberSeeds.zcodeFiveHour}
                      reducedMotion={preferences.reducedMotion}
                    />
                    {zcodeSnapshot.weekly && (
                      <QuotaCell
                        label="WEEK"
                        window={zcodeSnapshot.weekly}
                        accent="moonlight"
                        credits={formatCredits(zcodeSnapshot.weekly)}
                        motion={fluidMotion}
                        motionSeed={fluidChamberSeeds.zcodeWeekly}
                        reducedMotion={preferences.reducedMotion}
                      />
                    )}
                  </>
                ) : !activeIsZcode && codexSnapshot ? (
                  <>
                    <QuotaCell label="5 HOUR" window={codexSnapshot.fiveHour} accent="cyan" motion={fluidMotion} motionSeed={fluidChamberSeeds.codexFiveHour} reducedMotion={preferences.reducedMotion} />
                    <QuotaCell label="WEEK" window={codexSnapshot.weekly} accent="mint" motion={fluidMotion} motionSeed={fluidChamberSeeds.codexWeekly} reducedMotion={preferences.reducedMotion} />
                  </>
                ) : null}
              </div>
            )}

            {routeBlocked && !activeIsZcode && <RouteAlert diagnostic={routeConnection.diagnostic} onRetry={() => void probeRoute()} />}

            <footer className={`status-footer ${expanded ? "status-footer--expanded" : ""} ${activeIsZcode && !zcodeIsTrial ? "status-footer--zcode" : ""}`}>
              {activeSlot.view.kind === "loading" && <span>Reading {sourceLabels[activeSource]}…</span>}
              {activeSlot.view.kind === "failed" && !activeSnapshot && <span>数据不可用 · {activeSlot.view.diagnostic.code}</span>}
              {!activeSnapshot && !activeIsZcode && <RouteStatus route={routeConnection} alert={routeBlocked} />}
              {activeSnapshot && !expanded && !activeIsZcode && codexSnapshot && (
                <>
                  <span>FULL RESETS <b>{codexSnapshot.fullResetCredits?.availableCount ?? "—"}</b></span>
                  <RouteStatus route={routeConnection} alert={routeBlocked} />
                  <span className={activeSlot.isRefreshing ? "freshness freshness--refreshing" : "freshness"}>
                    {activeSlot.isRefreshing ? "正在刷新" : freshnessText(codexSnapshot, stale, failureDiagnostic, { weeklyOnly: activeIsPro })}
                  </span>
                </>
              )}
              {activeSnapshot && !expanded && activeIsZcode && zcodeSnapshot && (
                <>
                  {zcodeSnapshot.planLevel && (
                    <span className="plan-chip">{zcodeSnapshot.planLevel.toUpperCase()}</span>
                  )}
                  {!zcodeIsTrial && (
                    <span className="reset-card-counts" aria-label="ZCode 可用重置卡" title="可用的 5 小时重置卡 / 周重置卡">
                      5H <b>{zcodeSnapshot.resetCredits?.fiveHour.availableCount ?? "—"}</b>
                      {" · "}W <b>{zcodeSnapshot.resetCredits?.weekly.availableCount ?? "—"}</b>
                    </span>
                  )}
                  <span className={activeSlot.isRefreshing ? "freshness freshness--refreshing" : "freshness"}>
                    {!zcodeIsTrial && zcodeSnapshot.resetCreditsDiagnostic
                      ? <span title={zcodeSnapshot.resetCreditsDiagnostic.message}>{zcodeSnapshot.resetCreditsDiagnostic.code}</span>
                      : activeSlot.isRefreshing ? "正在刷新" : freshnessText(zcodeSnapshot, stale, failureDiagnostic, { poolOnly: zcodeIsTrial })}
                  </span>
                </>
              )}
              {activeSnapshot && expanded && (
                <div className="detail-strip">
                  {activeIsZcode && zcodeSnapshot ? (
                    <>
                      {zcodeIsTrial ? (
                        <>
                          {zcodeSnapshot.planLevel && <span className="plan-chip">{zcodeSnapshot.planLevel.toUpperCase()}</span>}
                          <span className={activeSlot.isRefreshing ? "freshness freshness--refreshing" : "freshness"}>
                            {activeSlot.isRefreshing ? "正在刷新" : freshnessText(zcodeSnapshot, stale, failureDiagnostic, { poolOnly: zcodeIsTrial })}
                          </span>
                        </>
                      ) : zcodeSnapshot.resetCreditsDiagnostic ? (
                        <>
                          <span className="reset-card-detail">5H RESETS — · WEEK RESETS —</span>
                          <span className="reset-card-detail" title={zcodeSnapshot.resetCreditsDiagnostic.message}>
                            {zcodeSnapshot.resetCreditsDiagnostic.code} · {zcodeSnapshot.resetCreditsDiagnostic.message}
                          </span>
                        </>
                      ) : (
                        <>
                          <ZCodeResetDetail label="5H RESETS" credits={zcodeSnapshot.resetCredits?.fiveHour} />
                          <ZCodeResetDetail label="WEEK RESETS" credits={zcodeSnapshot.resetCredits?.weekly} />
                        </>
                      )}
                    </>
                  ) : codexSnapshot ? (
                    <>
                      <span>FULL RESET EXPIRES <b>{formatExpiry(codexSnapshot.fullResetCredits?.nearestExpiryAt)}</b></span>
                      <RouteStatus route={routeConnection} alert={routeBlocked} />
                    </>
                  ) : null}
                  {stale && <span className="stale-warning">STALE · {failureDiagnostic?.code ?? "cached snapshot"}</span>}
                  {detailActions}
                </div>
              )}
              <button
                className="expand-button"
                type="button"
                aria-label={expanded ? "收起重置详情" : "展开重置详情"}
                aria-expanded={expanded}
                title={expanded ? "收起重置详情" : "展开重置详情"}
                onClick={() => changeLayout(expanded ? "compact" : "expanded")}
                disabled={!activeSnapshot}
              >
                <Icon name="chevron" />
              </button>
            </footer>
          </>
        )}

        {collapsed && <button ref={settingsButtonRef} className="collapsed-settings" type="button" aria-label="设置" onClick={() => void toggleSettings()}><Icon name="settings" /></button>}
      </div>

      {settingsOpen && <SettingsDock
        preferences={preferences}
        appliedAlwaysOnTop={confirmedAlwaysOnTop ?? undefined}
        pinStateUnconfirmed={confirmedAlwaysOnTop === null}
        source={sourceSelection}
        dragging={isWindowDragging}
        saveState={pendingPreferenceSaves > 0 ? "saving" : preferenceSaveState}
        saveError={preferenceSaveError}
        onChange={updatePreferences}
        onPreviewOpacity={previewOpacity}
        onCommitOpacity={commitOpacity}
        onRetry={retryPreferences}
        usageEntryState={usageEntryState}
        usageError={usageOpenError}
        onOpenUsage={openUsagePageEntry}
        onClose={() => void closeSettings()}
        onQuit={quitMeter}
      />}
      {controlMessage && <span className="control-message" role="status">{controlMessage}</span>}
    </main>
  );
}

export default App;
