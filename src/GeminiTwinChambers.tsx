import { useLayoutEffect, useRef } from "react";
import { FluidReservoir } from "./FluidReservoir";
import type { FluidMotionSample } from "./fluidPhysics";
import type { GeminiPool } from "./geminiQuota";
import { geminiPeriods, getGeminiReading, type GeminiPeriod, type GeminiReading } from "./geminiQuotaReadout";
import "./GeminiTwinChambers.css";

const agGemini = { key: "gemini", name: "AG Gemini", index: 1, accent: "indigo", seed: 0.46 } as const;
const agPartner = { key: "partner", name: "AG Claude/GPT", index: 2, accent: "orchid", seed: 0.72 } as const;
const agSources = [agGemini, agPartner] as const;
const geminiWeb = { key: "web", name: "Gemini Web", index: 0 } as const;
type Source = typeof agGemini | typeof agPartner | typeof geminiWeb;
const periodLabel: Record<GeminiPeriod, string> = { fiveHour: "5 小时", weekly: "一周" };
const missingReading: GeminiReading = { value: null, stale: false };

interface GeminiTwinChambersProps {
  pools: GeminiPool[];
  firstReadPending: boolean;
  collapsed: boolean;
  motion: FluidMotionSample;
  reducedMotion: boolean;
}

function QuotaValue({ source, period, reading }: { source: Source; period: GeminiPeriod; reading: GeminiReading }) {
  const percent = reading.value === null ? null : Number(reading.value.toFixed(1)) + "%";
  const label = percent === null ? "未读" : (reading.stale ? "上次剩余 " : "剩余 ") + percent;
  return <span className="twin-value" data-group={source.key} data-period={period} role="img"
    aria-label={`${source.name} ${periodLabel[period]}，${label}`}>
    {percent ?? "—"}{reading.stale && percent !== null && <small className="twin-old">上次</small>}
  </span>;
}

// The engraved ticks and moving needle share the same elliptical coordinate system.
function dialPoint(fraction: number, inset: number) {
  const angle = Math.PI * (1 - fraction);
  const x = 67 + (61 - inset) * Math.cos(angle);
  const y = 51 - (46 - inset) * Math.sin(angle);
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}
const ticks = Array.from({ length: 21 }, (_, i) =>
  `M${dialPoint(i / 20, -1.1)} L${dialPoint(i / 20, i % 5 ? 0.9 : 2.6)}`).join(" ");
const standardArc = "M6,51 A61,46 0 0 1 128,51";
const narrowArc = "M1.5 12 C1.5 4.4 1.5 1.45 5.7 1.4 Q40 .8 74.3 1.4 C78.5 1.45 78.5 4.4 78.5 12";

function WeekScale({ reading, collapsed }: { reading: GeminiReading; collapsed: boolean }) {
  const { value, stale } = reading;
  const arc = collapsed ? narrowArc : standardArc;
  const fraction = (value ?? 0) / 100;
  return <svg className="twin-scale" aria-hidden="true" viewBox={collapsed ? "0 0 80 46" : "0 0 134 86"}
    preserveAspectRatio="none">
    <path className="twin-rail" d={arc} pathLength={collapsed ? 100 : undefined}
      strokeDasharray={value === null ? (collapsed ? "1.5 3" : "1.4 2.4") : undefined} />
    {value !== null && <g opacity={stale ? (collapsed ? 0.65 : 0.7) : 1}>
      {value > 0 && <path className="twin-fill" d={arc} pathLength={100} strokeDasharray={`${value} ${collapsed ? 101 : 100}`} />}
      {collapsed
        ? <path className="twin-marker" d={arc} pathLength={100} strokeDasharray=".25 110" strokeDashoffset={-Math.min(99.75, value)} />
        : <path className="twin-marker" d={`M${dialPoint(fraction, -2)} L${dialPoint(fraction, 5.3)}`} />}
    </g>}
    {!collapsed && <path className="twin-ticks" d={ticks} />}
  </svg>;
}

function SourceInstrument({ source, pools, firstReadPending, collapsed, motion, reducedMotion }: GeminiTwinChambersProps & { source: Source }) {
  const pool = pools[source.index];
  const five = pool ? getGeminiReading(pool, "fiveHour") : missingReading;
  const week = pool ? getGeminiReading(pool, "weekly") : missingReading;
  function row(period: GeminiPeriod, reading: GeminiReading) {
    return <span className={period === "weekly" ? "twin-week" : "twin-five"}>
      {!collapsed && <span className="twin-key">{periodLabel[period]}</span>}
      <QuotaValue source={source} period={period} reading={reading} />
    </span>;
  }
  const isWeb = source.key === "web";
  return <span className={isWeb ? "twin-plaque" : "twin-dial"} data-pool={source.key}>
    {source.key !== "web" && <>
      <span className="twin-cavity" aria-hidden="true">
        {!firstReadPending && <FluidReservoir key={five.value === null ? "dry" : "known"} remainingPercent={five.value ?? 0}
          accent={source.accent} motionSeed={source.seed} motion={motion} reducedMotion={reducedMotion || five.value === null} twinGauge />}
      </span>
      <WeekScale reading={week} collapsed={collapsed} />
    </>}
    <b className="twin-source">{isWeb && collapsed ? "Web" : source.name}</b>
    {collapsed ? <>{row("weekly", week)}{row("fiveHour", five)}</>
      : <>{row("fiveHour", five)}{row("weekly", week)}</>}
  </span>;
}

export function GeminiTwinChambers(props: GeminiTwinChambersProps) {
  const pairRef = useRef<HTMLSpanElement>(null);
  const previousReadings = useRef<string | null>(null);
  useLayoutEffect(() => {
    const pair = pairRef.current;
    const parent = pair?.parentNode;
    if (!pair || !parent) {
      previousReadings.current = null;
      return;
    }
    const readings = JSON.stringify(agSources.flatMap(({ index }) =>
      geminiPeriods.map(period => props.pools[index] ? getGeminiReading(props.pools[index], period) : missingReading)));
    const previous = previousReadings.current;
    previousReadings.current = readings;
    if (previous === null || previous === readings) return;
    // WebView2 can retain part of the old metal gradient after a partial repaint.
    // Invalidate the whole pair before paint, preserving both live liquid canvases.
    const next = pair.nextSibling;
    parent.removeChild(pair);
    parent.insertBefore(pair, next);
  }, [props.collapsed, props.pools]);
  const dials = agSources.map(source => <SourceInstrument key={source.key} source={source} {...props} />);
  return <span className={`gemini-twin ${props.collapsed ? "gemini-twin--narrow" : "gemini-twin--standard"}`}>
    <span className="twin-instruments">
      {props.collapsed && <span className="twin-periods" aria-hidden="true"><span>一周</span><span>5 小时</span></span>}
      {props.collapsed ? dials : <span className="twin-pair" ref={pairRef}>{dials}</span>}
      <SourceInstrument source={geminiWeb} {...props} />
    </span>
  </span>;
}
