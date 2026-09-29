import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { FluidReservoir } from "./FluidReservoir";
import { ProQuotaSurface, type CodexPresentation } from "./ProQuotaSurface";
import { OpticalShell } from "./OpticalShell";
import {
  enableTemporaryClickThrough,
  loadDisplayPreferences,
  quitApplication,
  readCapacitySnapshot,
  saveDisplayPreferences,
} from "./capacityClient";
import { readTomatoConnection } from "./tomatoClient";
import { readZcodeQuotaSnapshot } from "./zcodeClient";
import type {
  CapacitySnapshot,
  Diagnostic,
  DisplayPreferences,
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
  setOverlayWindowLayout,
  setOverlayWindowPosition,
  type OverlayLayout,
  type OverlayPosition,
  type OverlayWorkArea,
  type SettingsWindowPresentation,
} from "./windowClient";

export type CapacityLoader = () => Promise<CapacitySnapshot>;
export type ZcodeSnapshotLoader = (preferredPlan: ZCodePlanPreference) => Promise<ZCodeQuotaSnapshot>;
export type TomatoConnectionLoader = () => Promise<TomatoConnectionSnapshot>;

interface AppProps {
  codexPresentation?: CodexPresentation;
  initialLayout?: OverlayLayout;
  loadSnapshot?: CapacityLoader;
  loadZcodeSnapshot?: ZcodeSnapshotLoader;
  loadTomatoConnection?: TomatoConnectionLoader;
  loadPreferences?: () => Promise<DisplayPreferences>;
  savePreferences?: (preferences: DisplayPreferences) => Promise<void>;
  enableClickThrough?: (durationMs?: number) => Promise<void>;
  setWindowLayout?: (layout: OverlayLayout) => Promise<void>;
  getWindowPosition?: () => Promise<OverlayPosition>;
  setWindowPosition?: (position: OverlayPosition) => Promise<void>;
  openSettingsWindow?: (layout: OverlayLayout) => Promise<SettingsWindowPresentation>;
  closeSettingsWindow?: (presentation: SettingsWindowPresentation) => Promise<void>;
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
  x: null,
  y: null,
  source: "carousel",
};
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    if (lastSnapshotRef.current !== null) setIsRefreshing(true);
    else setView({ kind: "loading" });

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
  return (
    <section className="failed-surface" aria-live="assertive">
      <span className="error-mark" aria-hidden="true">!</span>
      <strong>无法读取 {sourceLabels[source]} 配额</strong>
      <span>{sourceFailureHints[source]} · 诊断码 {diagnostic.code}</span>
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
  codexPresentation,
  initialLayout = "compact",
  loadSnapshot = readCapacitySnapshot,
  loadZcodeSnapshot = readZcodeQuotaSnapshot,
  loadTomatoConnection = readTomatoConnection,
  loadPreferences = loadDisplayPreferences,
  savePreferences = saveDisplayPreferences,
  enableClickThrough = enableTemporaryClickThrough,
  setWindowLayout = setOverlayWindowLayout,
  getWindowPosition = getOverlayWindowPosition,
  setWindowPosition = setOverlayWindowPosition,
  openSettingsWindow = openOverlaySettings,
  closeSettingsWindow = closeOverlaySettings,
  quitApp = quitApplication,
  motionSessionSeed,
}: AppProps) {
  const codexSlot = useSourceSlot(loadSnapshot, "Codex", codexSnapshotIdentity);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [layoutMode, setLayoutMode] = useState<OverlayLayout>(initialLayout);
  const [settingsPresentation, setSettingsPresentation] = useState<SettingsWindowPresentation | null>(null);
  const [preferences, setPreferences] = useState(defaultPreferences);
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
    void loadPreferences()
      .then((loaded) => setPreferences({ ...loaded, source: normalizeSourceSelection(loaded.source) }))
      .catch(() => undefined);
  }, [loadPreferences]);

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

  const updatePreferences = useCallback(
    (next: DisplayPreferences) => {
      setPreferences(next);
      void savePreferences(next).catch(() => setControlMessage("显示设置未保存 · CRV-303"));
    },
    [savePreferences],
  );

  const changeLayout = useCallback(
    (next: OverlayLayout) => {
      setLayoutMode(next);
      void setWindowLayout(next).catch(() => setControlMessage("窗口布局未能调整 · CRV-302"));
    },
    [setWindowLayout],
  );

  const openSettings = useCallback(async () => {
    if (settingsTransitionRef.current || settingsPresentation) return;
    settingsTransitionRef.current = true;
    stopWindowInertia();
    try {
      const presentation = await openSettingsWindow(layoutMode);
      setSettingsPresentation(presentation);
    } catch {
      setControlMessage("设置窗口未能打开 · CRV-302");
    } finally {
      settingsTransitionRef.current = false;
    }
  }, [layoutMode, openSettingsWindow, settingsPresentation, stopWindowInertia]);

  const closeSettings = useCallback(async () => {
    if (settingsTransitionRef.current || !settingsPresentation) return;
    settingsTransitionRef.current = true;
    try {
      await closeSettingsWindow(settingsPresentation);
      setSettingsPresentation(null);
      settingsButtonRef.current?.focus();
    } catch {
      setControlMessage("设置窗口未能复位 · CRV-302");
    } finally {
      settingsTransitionRef.current = false;
    }
  }, [closeSettingsWindow, settingsPresentation]);

  const toggleSettings = useCallback(async () => {
    if (settingsPresentation) {
      await closeSettings();
      return;
    }
    await openSettings();
  }, [closeSettings, openSettings, settingsPresentation]);

  // 与托盘"退出"一致：直接退出，不做二次确认（偏好已持久化，无会话数据可丢）
  const quitMeter = useCallback(() => {
    quitApp().catch(() => setControlMessage("退出未能执行 · CRV-307"));
  }, [quitApp]);

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
      className={`app-frame app-frame--${visibleLayout}${settingsPresentation ? ` app-frame--settings-${settingsPresentation.placement}` : ""} ${preferences.reducedMotion ? "reduce-motion" : ""} ${isWindowDragging ? "is-dragging" : ""}`}
      style={{ "--surface-opacity": preferences.opacity } as React.CSSProperties}
      onContextMenu={(event) => {
        event.preventDefault();
        void toggleSettings();
      }}
      onPointerDown={handleDragStart}
      onPointerMove={handleDragMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
    >
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
                        accent="emerald"
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

            <footer className={`status-footer ${expanded ? "status-footer--expanded" : ""}`}>
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
                  <span className={activeSlot.isRefreshing ? "freshness freshness--refreshing" : "freshness"}>
                    {activeSlot.isRefreshing ? "正在刷新" : freshnessText(zcodeSnapshot, stale, failureDiagnostic, { poolOnly: zcodeIsTrial })}
                  </span>
                </>
              )}
              {activeSnapshot && expanded && (
                <div className="detail-strip">
                  {activeIsZcode && zcodeSnapshot ? (
                    <>
                      {zcodeSnapshot.planLevel && (
                        <span className="plan-chip">{zcodeSnapshot.planLevel.toUpperCase()}</span>
                      )}
                      <span className={activeSlot.isRefreshing ? "freshness freshness--refreshing" : "freshness"}>
                        {activeSlot.isRefreshing ? "正在刷新" : freshnessText(zcodeSnapshot, stale, failureDiagnostic, { poolOnly: zcodeIsTrial })}
                      </span>
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

      </div>

      {settingsOpen && (
        <aside className="settings-popover" role="dialog" aria-modal="false" aria-labelledby="settings-title">
            <div className="settings-heading">
              <strong id="settings-title">显示设置</strong>
              <button type="button" aria-label="关闭设置" onClick={() => void closeSettings()}><Icon name="close" /></button>
            </div>
            <label>
              <span>透明度 {Math.round(preferences.opacity * 100)}%</span>
              <input
                aria-label="透明度"
                type="range"
                min="0.86"
                max="1"
                step="0.02"
                value={preferences.opacity}
                onChange={(event) => updatePreferences({ ...preferences, opacity: Number(event.target.value) })}
              />
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={preferences.reducedMotion}
                onChange={(event) => updatePreferences({ ...preferences, reducedMotion: event.target.checked })}
              />
              <span>减少动效</span>
            </label>
            <div className="source-row">
              <span>额度来源</span>
              <div className="source-segments" role="group" aria-label="额度来源">
                <button
                  className="source-segment source-segment--codex"
                  type="button"
                  aria-pressed={sourceSelection === "codex"}
                  onClick={() => updatePreferences({ ...preferences, source: "codex" })}
                >
                  Codex
                </button>
                <button
                  className="source-segment source-segment--zcode"
                  type="button"
                  aria-pressed={sourceSelection === "zcode"}
                  onClick={() => updatePreferences({ ...preferences, source: "zcode" })}
                >
                  Zcode
                </button>
                <button
                  className="source-segment source-segment--carousel"
                  type="button"
                  aria-pressed={sourceSelection === "carousel"}
                  onClick={() => updatePreferences({ ...preferences, source: "carousel" })}
                >
                  轮播
                </button>
              </div>
            </div>
            {sourceSelection === "zcode" && (
              <div className="source-row source-row--nested">
                <span>ZCode 套餐</span>
                <div
                  className="source-segments source-segments--nested"
                  role="group"
                  aria-label="ZCode 套餐"
                >
                  <button
                    className="source-segment source-segment--zcode-plan"
                    type="button"
                    aria-pressed={zcodePlanPreference === "start"}
                    onClick={() => updatePreferences({ ...preferences, zcodePlan: "start" satisfies ZCodePlanPreference })}
                  >
                    体验套餐
                  </button>
                  <button
                    className="source-segment source-segment--zcode-plan"
                    type="button"
                    aria-pressed={zcodePlanPreference === "coding"}
                    onClick={() => updatePreferences({ ...preferences, zcodePlan: "coding" satisfies ZCodePlanPreference })}
                  >
                    个人套餐
                  </button>
                </div>
              </div>
            )}
            <div className="quit-row">
              <button type="button" className="quit-button" onClick={quitMeter}>
                退出应用
              </button>
            </div>
        </aside>
      )}
      {controlMessage && <span className="control-message" role="status">{controlMessage}</span>}
    </main>
  );
}

export default App;
