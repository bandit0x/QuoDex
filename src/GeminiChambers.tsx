import { FluidReservoir } from "./FluidReservoir";
import { GeminiReadout } from "./GeminiReadout";
import type { FluidMotionSample } from "./fluidPhysics";
import "./GeminiChambers.css";

const chambers = [
  { pool: "web", accent: "iris", seed: 0.23 },
  { pool: "gemini", accent: "indigo", seed: 0.46 },
  { pool: "partner", accent: "orchid", seed: 0.72 },
] as const;

interface GeminiChambersProps {
  levels: readonly (number | null)[];
  motion: FluidMotionSample;
  reducedMotion: boolean;
  titles?: readonly string[];
  stale?: readonly boolean[];
  collapsed?: boolean;
}

export function GeminiChambers({
  levels, motion, reducedMotion, titles, stale, collapsed = false,
}: GeminiChambersProps) {
  return (
    <div className={`quota-grid gemini-chambers${collapsed ? " gemini-chambers--collapsed" : ""}`}>
      {chambers.map(({ pool, accent, seed }, index) => {
        const level = levels[index];
        const remaining = typeof level === "number" && Number.isFinite(level)
          && level >= 0 && level <= 100 ? level : null;
        return (
          <div key={pool} className="quota-cell gemini-chamber" data-pool={pool} data-stale={stale?.[index] || undefined} title={titles?.[index]}>
            {remaining !== null && (
              <FluidReservoir accent={accent} remainingPercent={remaining} motion={motion}
                motionSeed={seed} reducedMotion={reducedMotion} />
            )}
            <GeminiReadout pool={pool} remainingPercent={remaining} stale={stale?.[index]} />
          </div>
        );
      })}
    </div>
  );
}
