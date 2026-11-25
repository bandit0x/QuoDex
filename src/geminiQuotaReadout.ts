import type { GeminiPool } from "./geminiQuota";

export const geminiPeriods = ["fiveHour", "weekly"] as const;
export type GeminiPeriod = typeof geminiPeriods[number];
export interface GeminiReading {
  value: number | null;
  stale: boolean;
}

export function getGeminiReading(pool: GeminiPool, period: GeminiPeriod): GeminiReading {
  const available = pool.state === "available";
  const retained = pool.observedAtMs !== null && (pool.state === "absent" || pool.state === "failed");
  const window = pool.windows.find(window => window.period === period);
  if ((!available && !retained) || !window || !Number.isFinite(window.remainingPercent) ||
      window.remainingPercent < 0 || window.remainingPercent > 100) {
    return { value: null, stale: false };
  }
  return { value: window.remainingPercent, stale: !available || window.stale === true };
}

export function summarizeGeminiReadings(pools: readonly GeminiPool[]) {
  const counts = { fresh: 0, stale: 0, missing: 0 };
  for (const pool of pools) {
    for (const period of geminiPeriods) {
      const reading = getGeminiReading(pool, period);
      if (reading.value === null) counts.missing++;
      else if (reading.stale) counts.stale++;
      else counts.fresh++;
    }
  }
  return counts;
}

export function geminiPoolNotes(pool: GeminiPool, index: number): string[] {
  const notes: string[] = [];
  if (pool.observedAtMs !== null) {
    const time = new Date(pool.observedAtMs).toLocaleString("zh-CN", { hour12: false });
    const current = pool.state === "available" && pool.windows.some(window => !window.stale);
    notes.push(`${current ? "读取于" : "上次读数"} ${time}`);
    for (const window of pool.windows) {
      if (window.stale && window.observedAtMs !== undefined && (current || window.observedAtMs !== pool.observedAtMs)) {
        const at = new Date(window.observedAtMs).toLocaleString("zh-CN", { hour12: false });
        notes.push(`${window.period === "weekly" ? "一周" : "5 小时"}上次读数 ${at}`);
      }
    }
  }
  if (pool.source) notes.push(`来源：${{ panel: "可见面板", background: "独立网页登录", desktop: "AG 后台" }[pool.source]}`);
  if (pool.diagnostic) {
    notes.push(`${pool.diagnostic.message} · ${pool.diagnostic.code}`);
    return notes;
  }
  if (pool.state === "absent") notes.push(index === 0
    ? "请连接 Gemini Web 账号后刷新 · QGM-201"
    : "请在 Antigravity 登录账号后刷新 · QGM-202");
  if (pool.state === "unreadable") notes.push("未取得可识别的周期和百分比 · QGM-203");
  if (pool.state === "failed") notes.push("额度读取失败，请稍后刷新 · QGM-204");
  if (pool.state === "ambiguous") notes.push("无法确认额度归属，请确认登录账号后刷新 · QGM-205");
  if (pool.state === "unsupported") notes.push("请在 Windows 浮窗中读取 · QGM-206");
  return notes;
}
