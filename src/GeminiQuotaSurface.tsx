import { GeminiTwinChambers } from "./GeminiTwinChambers";
import { geminiPoolNotes, getGeminiReading, summarizeGeminiReadings } from "./geminiQuotaReadout";
import "./GeminiQuotaSurface.css";
import type { FluidMotionSample } from "./fluidPhysics";
import type { GeminiPool } from "./geminiQuota";
import { useEffect, useRef, useState } from "react";

const names = ["Web", "AG Gemini", "AG Claude/GPT"];
const itemCounts = ["零", "一", "两", "三", "四", "五", "六"];

function quotaFeedback(pools: GeminiPool[], refreshed: boolean) {
  const { fresh, stale, missing } = summarizeGeminiReadings(pools);
  if (stale > 0) return { label: `含${itemCounts[stale]}项上次读数`, tone: "warning" };
  if (fresh === 6) return { label: refreshed ? "6/6 已更新" : "6/6 已读取", tone: "normal" };
  const failure = pools.find(pool => pool.state === "failed");
  if (fresh === 0 && failure) return { label: `读取失败 · ${failure.diagnostic?.code ?? "QGM-204"}`, tone: "error" };
  if (fresh > 0) return { label: `已读 ${fresh}/6 · ${itemCounts[missing]}项未读`, tone: "warning" };
  const needsDetails = pools.some(pool => ["unreadable", "ambiguous", "unsupported"].includes(pool.state));
  return { label: needsDetails ? "查看额度详情" : "查看额度连接", tone: "warning" };
}

function narrowDescription(pools: GeminiPool[]) {
  return [1, 2, 0].flatMap(index => (["weekly", "fiveHour"] as const).map(period => {
    const { value, stale } = getGeminiReading(pools[index], period);
    const amount = value === null ? "未读" : `${stale ? "上次剩余 " : "剩余 "}${Number(value.toFixed(1))}%`;
    return `${names[index]} ${period === "weekly" ? "一周" : "5 小时"}${amount}`;
  })).join("，");
}

export function GeminiQuotaSurface({ pools, firstReadPending, reading, refresh, motion, reducedMotion, collapsed,
  settingsOpen, restoredHeight, onRestore, onDetails }: {
  pools: GeminiPool[]; firstReadPending: boolean; reading: boolean; refresh: () => void; motion: FluidMotionSample;
  reducedMotion: boolean; collapsed: boolean; settingsOpen: boolean; restoredHeight: number;
  onRestore: () => void; onDetails: () => void;
}) {
  const [refreshed, setRefreshed] = useState(false);
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
  const feedback = quotaFeedback(pools, refreshed);
  return <div key={surfaceRevision} className="gemini-twin-surface">
    {chambers}
    <footer className="gemini-twin-footer">
      <button type="button" aria-label="查看 Gemini 额度详情" onClick={onDetails}
        title={pools.map((pool, i) => [names[i], ...geminiPoolNotes(pool, i)].join(" · ")).join("\n")}><b>GEMINI</b> · 详情</button>
      <span role="status" data-tone={reading ? "normal" : feedback.tone}>{reading ? "正在读取…" : feedback.label}</span>
      <button type="button" disabled={reading} onClick={() => { setRefreshed(true); refresh(); }}>{feedback.tone === "error" ? "重试" : "刷新"}</button>
    </footer>
  </div>;
}
