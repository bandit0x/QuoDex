import { FluidReservoir } from "./FluidReservoir";
import type { QuotaWindow } from "./capacityTypes";
import type { FluidMotionSample } from "./fluidPhysics";

/** Presentation only. Account policy and low-quota thresholds belong to the caller. */
export interface CodexPresentation {
  mode: "dual" | "pro-weekly";
  weeklyLow?: boolean;
}

const SURFACE_COPY = {
  "codex-pro": {
    accent: "mint" as const,
    label: "WEEK",
    loading: "正在读取周额度…",
    failed: "周额度读取失败",
    unavailable: "周额度暂不可用",
    low: "周额度偏低",
  },
  "zcode-trial": {
    accent: "emerald" as const,
    label: "TRIAL",
    loading: "正在读取体验额度…",
    failed: "体验额度读取失败",
    unavailable: "体验额度暂不可用",
    low: "体验额度偏低",
  },
};

export function ProQuotaSurface({ window, motion, motionSeed, reducedMotion, resetLabel,
  status = "ready", low = false, diagnostic, onRetry, variant = "codex-pro",
}: {
  window: QuotaWindow | null;
  motion: FluidMotionSample;
  motionSeed: number;
  reducedMotion: boolean;
  resetLabel: string;
  status?: "ready" | "loading" | "failed" | "stale";
  low?: boolean;
  diagnostic?: { code: string; message: string };
  onRetry: () => void;
  /** zcode-trial：ZCode 体验套餐单池，翡翠绿液体与 Codex Pro 薄荷绿区分 */
  variant?: "codex-pro" | "zcode-trial";
}) {
  const copy = SURFACE_COPY[variant];
  const remaining = window?.remainingPercent ?? 0;
  const formatted = Number.isInteger(remaining) ? remaining.toFixed(0) : remaining.toFixed(1);
  return <div className="quota-grid quota-grid--single">
    <section className={`quota-cell quota-cell--${copy.accent} quota-cell--pro ${window ? "" : "quota-cell--unavailable"}`} role="group" aria-label={`${copy.label} quota`}>
      {window && <FluidReservoir remainingPercent={remaining} accent={copy.accent} motion={motion} motionSeed={motionSeed} reducedMotion={reducedMotion}/>}
      <span className="quota-cell__bezel" aria-hidden="true"/>
      <div className="cell-content">
        <span className="quota-label">{copy.label}</span>
        <div className="capacity-value"><span>{window ? `${formatted}%` : "—"}</span>{window && <small>LEFT</small>}</div>
        {window && (status === "stale" || low) && <span className="pro-quota-warning">{status === "stale" ? "上次有效数据" : copy.low}</span>}
        <span className="reset-time" role={status === "loading" ? "status" : undefined}>
          {status === "loading" ? copy.loading : status === "failed" ? copy.failed : window ? resetLabel : copy.unavailable}
        </span>
        {window && <div className="scale-line" aria-hidden="true"><span className="scale-line__ticks">{Array.from({length:21}, (_,i)=><span key={i} className={i%5===0 ? "scale-tick scale-tick--major" : "scale-tick"}/>)}</span><span className="scale-line__marker" style={{top:`${100-remaining}%`}}/></div>}
      </div>
      {(status === "failed" || (status === "stale" && diagnostic) || (status !== "loading" && !window)) && <div className="pro-quota-recovery" role="status">
        <span title={diagnostic?.message}>{diagnostic ? `${diagnostic.message} · ${diagnostic.code}` : copy.unavailable}</span>
        <button type="button" onClick={onRetry}>重试</button>
      </div>}
    </section>
  </div>;
}
