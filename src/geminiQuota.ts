import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

type ReadState = "available" | "absent" | "ambiguous" | "unreadable" | "unsupported" | "failed";
interface GeminiWindow {
  period: "fiveHour" | "weekly";
  remainingPercent: number;
  reset: string | null;
}
interface ReadPool { state: ReadState; windows: GeminiWindow[] }
export interface GeminiSnapshot { observedAtMs: number; pools: [ReadPool, ReadPool, ReadPool] }
export interface GeminiPool extends ReadPool { observedAtMs: number | null }
export const readGeminiQuota = () => invoke<GeminiSnapshot>("read_gemini_quota");

const emptyPools = (): GeminiPool[] => Array.from({ length: 3 }, () => ({
  state: "absent", windows: [], observedAtMs: null,
}));

export function mergeGeminiSnapshot(previous: GeminiPool[], snapshot: GeminiSnapshot): GeminiPool[] {
  return snapshot.pools.map((pool, index) => {
    if (pool.state === "available") return { ...pool, observedAtMs: snapshot.observedAtMs };
    if (pool.state === "absent" || pool.state === "failed") return { ...previous[index], state: pool.state };
    return { ...pool, observedAtMs: null };
  });
}

export function useGeminiQuota(enabled: boolean, load: () => Promise<GeminiSnapshot>) {
  const [pools, setPools] = useState(emptyPools);
  const [reading, setReading] = useState(false);
  const trigger = useRef<() => void>(() => {});
  const refresh = useCallback(() => trigger.current(), []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let busy = false;
    async function poll() {
      if (busy) return;
      busy = true;
      setReading(true);
      try {
        const snapshot = await load();
        if (!cancelled) setPools(previous => mergeGeminiSnapshot(previous, snapshot));
      } catch {
        if (!cancelled) setPools(previous => previous.map(pool => ({ ...pool, state: "failed" })));
      } finally {
        busy = false;
        if (!cancelled) setReading(false);
      }
    }
    trigger.current = poll;
    void poll();
    const timer = window.setInterval(poll, 15_000);
    return () => { cancelled = true; trigger.current = () => {}; window.clearInterval(timer); };
  }, [enabled, load]);
  return { pools, reading: enabled && reading, refresh };
}
