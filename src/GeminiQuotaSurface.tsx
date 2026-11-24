import { GeminiChambers } from "./GeminiChambers";
import type { FluidMotionSample } from "./fluidPhysics";
import type { GeminiPool } from "./geminiQuota";

const names = ["Web", "AG Gemini", "AG Claude/GPT"];
function describe(pool: GeminiPool, index: number) {
  const values = pool.windows.map(w => `${w.period === "weekly" ? "每周" : "5 小时"}剩余 ${Number(w.remainingPercent.toFixed(1))}%${w.reset ? " · " + w.reset : ""}`);
  if (pool.observedAtMs !== null) {
    const time = new Date(pool.observedAtMs).toLocaleString("zh-CN", { hour12: false });
    values.push(`${pool.state === "available" ? "读取于" : "上次读数"} ${time}`);
  }
  if (pool.state === "absent") values.push(index === 0
    ? "在 Chrome 或 Edge 打开 Gemini → 设置 → 使用限额 · QGM-201"
    : "在 Antigravity 打开 Settings → Models 或 View Usage · QGM-202");
  if (pool.state === "unreadable") values.push("面板未给出可识别的周期和百分比 · QGM-203");
  if (pool.state === "failed") values.push("无法读取窗口，请重新打开额度面板 · QGM-204");
  if (pool.state === "ambiguous") values.push("检测到多个面板，请保留一个 · QGM-205");
  if (pool.state === "unsupported") values.push("请在 Windows 浮窗中读取 · QGM-206");
  return values.join(" · ");
}

export function GeminiQuotaDetails({ pools }: { pools: GeminiPool[] }) {
  return <div>{pools.map((pool, i) => <div key={names[i]}><b>{names[i]}</b> · {describe(pool, i)}</div>)}</div>;
}

export function GeminiQuotaSurface({ pools, reading, refresh, motion, reducedMotion, collapsed, onRestore, onDetails }: {
  pools: GeminiPool[]; reading: boolean; refresh: () => void; motion: FluidMotionSample;
  reducedMotion: boolean; collapsed: boolean; onRestore: () => void; onDetails: () => void;
}) {
  const titles = pools.map(describe);
  const levels = pools.map(pool => pool.windows.length ? Math.min(...pool.windows.map(w => w.remainingPercent)) : null);
  const chambers = <GeminiChambers levels={levels} motion={motion} reducedMotion={reducedMotion} titles={titles}
    stale={pools.map(p => p.observedAtMs !== null && p.state !== "available")} collapsed={collapsed} />;
  if (collapsed) return <button className="gemini-restore" type="button" data-window-drag-surface
    aria-label="恢复标准视图" onClick={onRestore}>{chambers}</button>;
  const count = pools.filter(pool => pool.state === "available").length;
  const stale = pools.some(p => p.windows.length && p.state !== "available");
  let status = count === 3 ? "三仓已读取" : count ? `${count}/3 仓已读取` : "请打开额度面板";
  if (pools.some(p => ["unreadable", "ambiguous", "failed", "unsupported"].includes(p.state))) status = "查看额度详情";
  if (stale) status = "含上次读数";
  return <>{chambers}<footer className="status-footer gemini-live-footer">
    <button className="gemini-details-link" type="button" aria-label="查看 Gemini 额度详情" onClick={onDetails}
      title={titles.map((t, i) => names[i] + " · " + t).join("\n")}><b>GEMINI</b> · {reading ? "正在读取" : status}</button>
    <button type="button" onClick={refresh} disabled={reading}>刷新</button>
  </footer></>;
}
