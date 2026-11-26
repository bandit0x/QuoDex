import { GeminiTwinChambers } from "./GeminiTwinChambers";
import { getGeminiReading } from "./geminiQuotaReadout";
import "./GeminiQuotaSurface.css";
import type { FluidMotionSample } from "./fluidPhysics";
import type { GeminiPool } from "./geminiQuota";
import { useEffect, useRef, useState } from "react";

const names = ["Web", "Gemini", "Claude/GPT"];

function narrowDescription(pools: GeminiPool[]) {
  return [1, 2, 0].flatMap(index => (["weekly", "fiveHour"] as const).map(period => {
    const { value, stale } = getGeminiReading(pools[index], period);
    const amount = value === null ? "未读" : `${stale ? "上次剩余 " : "剩余 "}${Number(value.toFixed(1))}%`;
    return `${names[index]} ${period === "weekly" ? "一周" : "5 小时"}${amount}`;
  })).join("，");
}

export function GeminiQuotaSurface({ pools, firstReadPending, motion, reducedMotion, collapsed,
  settingsOpen, restoredHeight, onRestore }: {
  pools: GeminiPool[]; firstReadPending: boolean; motion: FluidMotionSample;
  reducedMotion: boolean; collapsed: boolean; settingsOpen: boolean; restoredHeight: number;
  onRestore: () => void;
}) {
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const returningFromSettings = useRef(false);
  useEffect(() => {
    if (settingsOpen) {
      returningFromSettings.current = true;
      return;
    }
    if (!returningFromSettings.current) return;
    let frame = 0;
    // The native close promise and the WebView viewport resize can arrive in either order.
    function repaintWhenRestored() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (Math.abs(window.innerHeight - restoredHeight) > 1) return;
        window.removeEventListener("resize", repaintWhenRestored);
        returningFromSettings.current = false;
        setSurfaceRevision(previous => previous + 1);
      });
    }
    window.addEventListener("resize", repaintWhenRestored);
    repaintWhenRestored();
    return () => {
      window.removeEventListener("resize", repaintWhenRestored);
      window.cancelAnimationFrame(frame);
    };
  }, [settingsOpen, restoredHeight]);
  const chambers = <GeminiTwinChambers pools={pools} firstReadPending={firstReadPending}
    collapsed={collapsed} motion={motion} reducedMotion={reducedMotion} />;
  if (collapsed) return <button key={surfaceRevision} className="gemini-twin-surface gemini-twin-surface--narrow" type="button" data-window-drag-surface
    aria-label="恢复标准视图" aria-description={narrowDescription(pools)} onClick={onRestore}>{chambers}</button>;
  return <div key={surfaceRevision} className="gemini-twin-surface">
    {chambers}
  </div>;
}
