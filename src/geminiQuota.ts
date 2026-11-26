import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

type ReadState = "available" | "absent" | "ambiguous" | "unreadable" | "unsupported" | "failed" | "pending" | "authRequired" | "notConnected" | "blocked";
type GeminiSource = "web" | "desktop" | "panel";
export type GeminiPoolSource = "statusline" | "cli" | "desktop" | "background" | "panel";
interface GeminiWindow {
  period: "fiveHour" | "weekly";
  remainingPercent: number;
  reset: string | null;
  observedAtMs?: number;
  stale?: boolean;
}
interface ReadPool {
  state: ReadState;
  windows: GeminiWindow[];
  source?: GeminiPoolSource;
  accountKey?: string | null;
  observedAtMs?: number | null;
  diagnostic?: { code: string; message: string } | null;
}
export interface GeminiSnapshot { observedAtMs: number; pools: [ReadPool, ReadPool, ReadPool] }
export interface GeminiPool extends ReadPool { observedAtMs: number | null }
export const readGeminiQuota = (source?: GeminiSource, manual?: boolean) => {
  if (source && manual) return invoke<GeminiSnapshot>("read_gemini_quota", { source, manual: true });
  if (source) return invoke<GeminiSnapshot>("read_gemini_quota", { source });
  if (manual) return invoke<GeminiSnapshot>("read_gemini_quota", { manual: true });
  return invoke<GeminiSnapshot>("read_gemini_quota");
};

const PANEL_STALE_AFTER_MS = 5 * 60_000;
const EVENT_STALE_AFTER_MS = 35 * 60_000;
/** Low-frequency safety fallback for AG (30 min) — primary updates are event-driven. */
export const AG_FALLBACK_INTERVAL_MS = 30 * 60_000;
/** Delay after an Antigravity task completes so backend quota counters settle. */
export const AG_COMPLETION_DELAY_MS = 3_000;
/** Pure local UIA check for visible Gemini Web usage tab (zero network traffic). */
const WEB_PASSIVE_UIA_INTERVAL_MS = 60_000;

const emptyPools: GeminiPool[] = Array.from({ length: 3 }, () => ({
  state: "absent", windows: [], observedAtMs: null,
}));

function isEventDrivenAgSource(source?: GeminiPoolSource): boolean {
  return source === "statusline" || source === "cli" || source === "desktop";
}

function staleWindowMs(source?: GeminiPoolSource): number {
  return isEventDrivenAgSource(source) ? EVENT_STALE_AFTER_MS : PANEL_STALE_AFTER_MS;
}

function sameSourceFamily(a?: GeminiPoolSource, b?: GeminiPoolSource): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return isEventDrivenAgSource(a) && isEventDrivenAgSource(b);
}

function mergePool(previous: GeminiPool | undefined, pool: ReadPool, index: number,
  snapshotTime: number, readTime: number): GeminiPool {
  const priorPanel = pool.source === "panel" && previous?.source === "panel" ? previous : undefined;
  const observedAtMs = pool.observedAtMs ?? snapshotTime;
  const maxAge = staleWindowMs(pool.source);
  const windows: (GeminiWindow & { observedAtMs: number; stale: boolean })[] = [];
  if (pool.state === "available") {
    for (const item of pool.windows) {
      const at = item.observedAtMs ?? observedAtMs;
      const stale = item.stale === true || readTime - at >= maxAge;
      windows.push({ ...item, observedAtMs: at, stale, reset: stale ? null : item.reset });
    }
  }
  const unavailable = pool.state === "absent" || pool.state === "failed";
  const sameBackground = previous?.accountKey && sameSourceFamily(pool.source, previous.source) &&
    pool.source !== "panel" && (pool.accountKey === previous.accountKey || (unavailable && !pool.accountKey));
  // A closed panel can show its last reading. Only AG identifies model groups
  // across partial reads. A new Web observation must supply its own periods.
  const partialAgRead = index > 0 && pool.state === "available" && priorPanel?.state === "available";
  let retained: GeminiPool | undefined;
  if (unavailable || partialAgRead) retained = priorPanel;
  if (sameBackground && (unavailable || pool.state === "available")) retained = previous;
  if (retained) {
    for (const item of retained.windows) {
      const at = item.observedAtMs ?? retained.observedAtMs;
      if (at !== null && !windows.some(current => current.period === item.period)) {
        windows.push({ ...item, observedAtMs: at, stale: true, reset: null });
      }
    }
  }
  return { ...pool, accountKey: pool.accountKey ?? retained?.accountKey, windows,
    observedAtMs: windows.length ? Math.max(...windows.map(w => w.observedAtMs)) : null };
}

export function mergeGeminiSnapshot(previous: GeminiPool[], snapshot: GeminiSnapshot,
  readTime = snapshot.observedAtMs): GeminiPool[] {
  return snapshot.pools.map((pool, index) => mergePool(previous[index], pool, index, snapshot.observedAtMs, readTime));
}

export function useGeminiQuota(
  enabled: boolean,
  load: () => Promise<GeminiSnapshot>,
  agCompletionKey?: string | null,
) {
  const [pools, setPools] = useState<GeminiPool[] | null>(null);
  const [reading, setReading] = useState(false);
  const trigger = useRef<() => void>(() => {});
  const refreshSource = useRef<(source: GeminiSource, manual?: boolean) => void>(() => {});
  const checkedResets = useRef<Partial<Record<GeminiSource, number>>>({});
  const lastCompletionKey = useRef<string | null | undefined>(undefined);
  const refresh = useCallback(() => trigger.current(), []);

  useEffect(() => {
    setPools(null);
    if (!enabled) return;
    let cancelled = false;
    const busy = new Set<GeminiSource | undefined>();
    const split = load === readGeminiQuota;
    let webGeneration = 0;
    let webConnecting = false;
    let webNeedsRead = false;

    async function poll(source?: GeminiSource, manual = false) {
      if (cancelled || busy.has(source) || (source === "web" && webConnecting)) return;
      const generation = webGeneration;
      const isCurrent = () => !cancelled && (source !== "web" || generation === webGeneration);
      busy.add(source);
      setReading(true);
      const applies = (index: number) => !source || (source === "web" ? index === 0 : index > 0);
      try {
        const snapshot = await (source ? readGeminiQuota(source, manual) : load());
        if (isCurrent()) {
          const now = Date.now();
          setPools(previous => (previous ?? emptyPools).map((pool, index) => applies(index)
            ? mergePool(pool, snapshot.pools[index], index, snapshot.observedAtMs, now) : pool));
        }
      } catch {
        if (isCurrent()) {
          const now = Date.now();
          setPools(previous => (previous ?? emptyPools).map((pool, index) =>
            applies(index) ? mergePool(pool, { state: "failed", source: pool.source, windows: [] }, index, now, now) : pool));
        }
      } finally {
        busy.delete(source);
        if (!cancelled) setReading(busy.size > 0);
        if (source === "web" && webNeedsRead) {
          webNeedsRead = false;
          void poll("web", false);
        }
      }
    }

    function refreshAll(manual = false) {
      if (split) {
        void poll("web", manual);
        void poll("desktop", manual);
      } else void poll(undefined, manual);
    }

    const connection = split ? listen<boolean>("gemini-web-session", ({ payload: opening }) => {
      if (cancelled) return;
      webConnecting = opening;
      if (opening) {
        webGeneration++;
        webNeedsRead = false;
        setPools(previous => (previous ?? emptyPools).map((pool, index) => index === 0
          ? { ...emptyPools[0], state: "pending", source: "panel" } : pool));
      } else if (busy.has("web")) webNeedsRead = true;
      else void poll("web", false);
    }).catch(() => undefined) : undefined;

    trigger.current = () => refreshAll(true);
    refreshSource.current = (source, manual = false) => { void poll(source, manual); };
    // Initial mount read (zero-network statusLine first, or single cooldown-gated read).
    refreshAll(false);

    // Safe cadence:
    // - AG: NO 2-minute polling and NO visibilitychange polling. Low-frequency 30-min fallback only;
    //   real-time updates come from task completion events, reset timers, or zero-network /statusline.
    // - Web: pure local Windows UIA check (0 network requests, 0 headless Chrome).
    const timers = split ? [
      window.setInterval(() => { void poll("web", false); }, WEB_PASSIVE_UIA_INTERVAL_MS),
      window.setInterval(() => { void poll("desktop", false); }, AG_FALLBACK_INTERVAL_MS),
    ] : [window.setInterval(() => refreshAll(false), AG_FALLBACK_INTERVAL_MS)];

    return () => {
      cancelled = true;
      trigger.current = () => {};
      refreshSource.current = () => {};
      timers.forEach(timer => window.clearInterval(timer));
      void connection?.then(unlisten => unlisten?.());
    };
  }, [enabled, load]);

  // Event-driven AG refresh: when a local Antigravity conversation finishes, refresh AG quota once
  // after a brief settle delay without opening the Models panel.
  useEffect(() => {
    if (!enabled) {
      lastCompletionKey.current = undefined;
      return;
    }
    if (lastCompletionKey.current === undefined) {
      lastCompletionKey.current = agCompletionKey ?? null;
      return;
    }
    if (!agCompletionKey || agCompletionKey === lastCompletionKey.current) return;
    lastCompletionKey.current = agCompletionKey;
    const timer = window.setTimeout(() => {
      if (load === readGeminiQuota) refreshSource.current("desktop", false);
      else trigger.current();
    }, AG_COMPLETION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, load, agCompletionKey]);

  // Reset-boundary trigger: refresh once shortly after a known quota window resets.
  useEffect(() => {
    if (!enabled || load !== readGeminiQuota || !pools) return;
    const now = Date.now();
    const timers = (["web", "desktop"] as const).flatMap((source, index) => {
      const sourcePools = index === 0 ? pools.slice(0, 1) : pools.slice(1);
      const resets = sourcePools.flatMap(pool => pool.windows.flatMap(reading => {
        if (reading.stale || !reading.reset || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(reading.reset)) return [];
        const reset = Date.parse(reading.reset);
        return reset >= now && reset !== checkedResets.current[source] ? [reset] : [];
      }));
      if (!resets.length) return [];
      const reset = Math.min(...resets);
      return window.setTimeout(() => {
        checkedResets.current[source] = reset;
        refreshSource.current(source, false);
      }, reset - now + 5_000);
    });
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [enabled, load, pools]);

  return { pools: pools ?? emptyPools, firstReadPending: pools === null, reading: enabled && reading, refresh };
}
