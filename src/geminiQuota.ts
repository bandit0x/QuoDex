import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

type ReadState = "available" | "absent" | "ambiguous" | "unreadable" | "unsupported" | "failed" | "pending" | "authRequired" | "notConnected";
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
  source?: "background" | "panel";
  observedAtMs?: number | null;
  diagnostic?: { code: string; message: string } | null;
}
export interface GeminiSnapshot { observedAtMs: number; pools: [ReadPool, ReadPool, ReadPool] }
export interface GeminiPool extends ReadPool { observedAtMs: number | null }
export const readGeminiQuota = () => invoke<GeminiSnapshot>("read_gemini_quota");

const emptyPools = (): GeminiPool[] => Array.from({ length: 3 }, () => ({
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
  // A closed panel can show its last reading. Only AG identifies model groups
  // across partial reads. A new Web observation must supply its own periods.
  const partialAgRead = index > 0 && pool.state === "available" && priorPanel?.state === "available";
  if (priorPanel && (unavailable || partialAgRead)) {
    for (const item of priorPanel.windows) {
      const at = item.observedAtMs ?? priorPanel.observedAtMs;
      if (at !== null && !windows.some(current => current.period === item.period)) {
        windows.push({ ...item, observedAtMs: at, stale: true, reset: null });
      }
    }
  }
  return { ...pool, windows, observedAtMs: windows.length ? Math.max(...windows.map(w => w.observedAtMs)) : null };
}

export function mergeGeminiSnapshot(previous: GeminiPool[], snapshot: GeminiSnapshot,
  readTime = snapshot.observedAtMs): GeminiPool[] {
  return snapshot.pools.map((pool, index) => mergePool(previous[index], pool, index, snapshot.observedAtMs, readTime));
}

export function useGeminiQuota(enabled: boolean, load: () => Promise<GeminiSnapshot>) {
  const [pools, setPools] = useState(emptyPools);
  const [reading, setReading] = useState(false);
  const trigger = useRef<() => void>(() => {});
  const refresh = useCallback(() => trigger.current(), []);
  useEffect(() => {
    setPools(emptyPools());
    if (!enabled) return;
    let cancelled = false;
    let busy = false;
    async function poll() {
      if (busy) return;
      busy = true;
      setReading(true);
      try {
        const snapshot = await load();
        if (!cancelled) {
          const now = Date.now();
          setPools(previous => mergeGeminiSnapshot(previous, snapshot, now));
        }
      } catch {
        if (!cancelled) {
          const now = Date.now();
          setPools(previous => previous.map((pool, index) =>
            mergePool(pool, { state: "failed", source: pool.source, windows: [] }, index, now, now)));
        }
      } finally {
        busy = false;
        if (!cancelled) setReading(false);
      }
    }
    trigger.current = poll;
    void poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; trigger.current = () => {}; window.clearInterval(timer); };
  }, [enabled, load]);
  return { pools, reading: enabled && reading, refresh };
}
