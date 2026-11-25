import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

type ReadState = "available" | "absent" | "ambiguous" | "unreadable" | "unsupported" | "failed" | "pending" | "authRequired" | "notConnected" | "blocked";
type GeminiSource = "web" | "desktop" | "panel";
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
  source?: "background" | "desktop" | "panel";
  accountKey?: string | null;
  observedAtMs?: number | null;
  diagnostic?: { code: string; message: string } | null;
}
export interface GeminiSnapshot { observedAtMs: number; pools: [ReadPool, ReadPool, ReadPool] }
export interface GeminiPool extends ReadPool { observedAtMs: number | null }
export const readGeminiQuota = (source?: GeminiSource) =>
  source ? invoke<GeminiSnapshot>("read_gemini_quota", { source }) : invoke<GeminiSnapshot>("read_gemini_quota");

const emptyPools: GeminiPool[] = Array.from({ length: 3 }, () => ({
  state: "absent", windows: [], observedAtMs: null,
}));

const POLL_INTERVAL_MS = 5 * 60_000;

function mergePool(previous: GeminiPool | undefined, pool: ReadPool, index: number,
  snapshotTime: number, readTime: number): GeminiPool {
  const priorPanel = pool.source === "panel" && previous?.source === "panel" ? previous : undefined;
  const observedAtMs = pool.observedAtMs ?? snapshotTime;
  const windows: (GeminiWindow & { observedAtMs: number; stale: boolean })[] = [];
  if (pool.state === "available") {
    for (const item of pool.windows) {
      const at = item.observedAtMs ?? observedAtMs;
      const stale = item.stale === true || readTime - at >= POLL_INTERVAL_MS;
      windows.push({ ...item, observedAtMs: at, stale, reset: stale ? null : item.reset });
    }
  }
  const unavailable = pool.state === "absent" || pool.state === "failed";
  const sameBackground = previous?.accountKey && pool.source === previous.source &&
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

export function useGeminiQuota(enabled: boolean, load: () => Promise<GeminiSnapshot>) {
  const [pools, setPools] = useState<GeminiPool[] | null>(null);
  const [reading, setReading] = useState(false);
  const trigger = useRef<() => void>(() => {});
  const refreshSource = useRef<(source: GeminiSource) => void>(() => {});
  const checkedResets = useRef<Partial<Record<GeminiSource, number>>>({});
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
    async function poll(source?: GeminiSource) {
      if (cancelled || busy.has(source) || (source === "web" && webConnecting)) return;
      const generation = webGeneration;
      const isCurrent = () => !cancelled && (source !== "web" || generation === webGeneration);
      busy.add(source);
      setReading(true);
      const applies = (index: number) => !source || (source === "web" ? index === 0 : index > 0);
      try {
        const snapshot = await (source ? readGeminiQuota(source) : load());
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
          void poll("web");
        }
      }
    }
    function refreshAll() {
      if (split) {
        void poll("web");
        void poll("desktop");
      } else void poll();
    }
    const onWake = () => { if (document.visibilityState === "visible") refreshAll(); };
    const connection = split ? listen<boolean>("gemini-web-session", ({ payload: opening }) => {
      if (cancelled) return;
      webConnecting = opening;
      if (opening) {
        webGeneration++;
        webNeedsRead = false;
        setPools(previous => (previous ?? emptyPools).map((pool, index) => index === 0
          ? { ...emptyPools[0], state: "pending", source: "background" } : pool));
      } else if (busy.has("web")) webNeedsRead = true;
      else void poll("web");
    }).catch(() => undefined) : undefined;
    trigger.current = refreshAll;
    refreshSource.current = source => { void poll(source); };
    refreshAll();
    const timers = split ? [
      window.setInterval(() => { void poll("web"); }, POLL_INTERVAL_MS),
      window.setInterval(() => { void poll("desktop"); }, 2 * 60_000),
    ] : [window.setInterval(refreshAll, POLL_INTERVAL_MS)];
    document.addEventListener("visibilitychange", onWake);
    return () => {
      cancelled = true;
      trigger.current = () => {};
      refreshSource.current = () => {};
      timers.forEach(timer => window.clearInterval(timer));
      document.removeEventListener("visibilitychange", onWake);
      void connection?.then(unlisten => unlisten?.());
    };
  }, [enabled, load]);
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
        refreshSource.current(source);
      }, reset - now + 3000);
    });
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [enabled, load, pools]);
  return { pools: pools ?? emptyPools, firstReadPending: pools === null, reading: enabled && reading, refresh };
}
