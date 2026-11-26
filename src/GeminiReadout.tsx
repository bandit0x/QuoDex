import "./GeminiReadout.css";

const legends = {
  web: { name: "Web", label: "WEB" },
  gemini: { name: "Gemini", label: "GEMINI" },
  partner: { name: "Claude/GPT", label: "CLAUDE/GPT" },
} as const;

interface GeminiReadoutProps {
  pool: keyof typeof legends;
  remainingPercent: number | null;
  stale?: boolean;
}

export function GeminiReadout({ pool, remainingPercent, stale }: GeminiReadoutProps) {
  const legend = legends[pool];
  const known = remainingPercent !== null && Number.isFinite(remainingPercent)
    && remainingPercent >= 0 && remainingPercent <= 100;
  const value = known ? Number(remainingPercent.toFixed(1)).toString() : "—";
  return (
    <div className="gemini-readout" role="img"
      aria-label={`${legend.name}，${known ? `${stale ? "上次" : ""}剩余 ${value}%` : "额度未知"}`}>
      <div className="gemini-readout__legend" aria-hidden="true">
        <span>{legend.label}</span>
      </div>
      <div className="gemini-readout__value" aria-hidden="true">
        <span>{value}</span>
        {known && <span className="gemini-readout__unit">%</span>}
      </div>
    </div>
  );
}
