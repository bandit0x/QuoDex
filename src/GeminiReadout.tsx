import "./GeminiReadout.css";

// Single-line lettering for the three fixed legends. Open counters and clipped
// corners keep the engraving recognizable at the overlay's half-scale.
const sourceMark = "M1 11 3.9 2H5.4L8.2 11 M2.5 7.4H6.9 M17.7 3.5 16.3 2H12L10.4 3.7V9.3L12 11H16.5L18 9.3V6.9H14.5";
const legends = {
  web: {
    name: "Web", width: 33,
    strokes: "M1 2 3.5 11H5L7 5.8 9 11H10.5L13 2 M22 2H16V11H22 M16 6.4H20.7 M25.4 11V2H30L31.7 3.6V5L30.3 6.3H25.4 M30.3 6.3 32 7.9V9.3L30.3 11H25.4",
  },
  gemini: {
    name: "AG Gemini", width: 50,
    strokes: "M8.4 3.5 7 2H3L1.4 3.7V9.3L3 11H7.2L8.7 9.4V6.8H5.4 M18.6 2H12.4V11H18.6 M12.4 6.4H17.3 M22 11V2L26 7.8 30 2V11 M33.8 2V11 M37.5 11V2L44 11V2 M47.8 2V11",
  },
  partner: {
    name: "AG Claude/GPT", width: 96,
    strokes: "M7.8 3.4 6.4 2H3L1.3 3.8V9.2L3 11H6.5L8 9.4 M11.6 2V11H17.2 M19.5 11 22.5 2H24L27 11 M20.8 7.5H25.7 M30 2V9.1L31.8 11H35L36.8 9.1V2 M40.4 11V2H44L47 4.8V8.2L44 11Z M56.5 2H50.6V11H56.5 M50.6 6.4H55.4 M59.8 11.4 64.7 1.6 M74.5 3.5 73 2H69.4L67.7 3.7V9.3L69.4 11H73.1L74.8 9.4V6.8H71.5 M78.2 11V2H83L84.6 3.6V5.4L83 7H78.2 M86.4 2H94.2 M90.3 2V11",
  },
} as const;

interface GeminiReadoutProps {
  pool: keyof typeof legends;
  remainingPercent: number | null;
}

export function GeminiReadout({ pool, remainingPercent }: GeminiReadoutProps) {
  const legend = legends[pool];
  const hasPrefix = pool !== "web";
  const known = remainingPercent !== null && Number.isFinite(remainingPercent)
    && remainingPercent >= 0 && remainingPercent <= 100;
  const value = known ? Number(remainingPercent.toFixed(1)).toString() : "—";
  const offset = hasPrefix ? 20 : 0;
  const width = legend.width + offset;
  return (
    <div className={`gemini-readout gemini-readout--${pool}`}
      role="img" aria-label={`${legend.name}，${known ? `剩余 ${value}%` : "额度未知"}`}>
      <svg className="gemini-readout__legend" viewBox={`0 0 ${width} 14`}
        width={width * 1.28} height="22" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {hasPrefix && <path className="gemini-readout__source" d={sourceMark} transform="translate(0 2) scale(.78)" />}
        <path d={legend.strokes} transform={`translate(${offset} 0)`} />
      </svg>
      <span className="gemini-readout__value" aria-hidden="true">
        {value}{known && <span className="gemini-readout__unit">%</span>}
      </span>
    </div>
  );
}
