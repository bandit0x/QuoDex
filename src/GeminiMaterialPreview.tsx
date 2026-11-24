import { useEffect, useState } from "react";
import { FluidReservoir } from "./FluidReservoir";
import { GeminiReadout } from "./GeminiReadout";
import { OpticalShell } from "./OpticalShell";
import { IDLE_FLUID_MOTION } from "./fluidPhysics";
import "./GeminiMaterialPreview.css";

const chambers = [
  { pool: "web", accent: "iris", seed: 0.23 },
  { pool: "gemini", accent: "indigo", seed: 0.46 },
  { pool: "partner", accent: "orchid", seed: 0.72 },
] as const;

const sampleLevels = [
  [72, 46, 12],
  [0, 100, null],
  [100, 1, 0],
] as const;

export function GeminiMaterialPreview() {
  const [sample, setSample] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return (
    <main className="app-frame gemini-study" aria-label="Gemini 三仓材质预览">
      <div className="glass-shell">
        <OpticalShell opacity={0.96} dragging={false} reducedMotion={reducedMotion} />
        <div className="quota-grid gemini-chambers">
          {chambers.map(({ pool, accent, seed }, index) => {
            const remaining = sampleLevels[sample][index];
            return (
              <section key={pool} className="quota-cell gemini-chamber" data-pool={pool}>
                {remaining !== null && (
                  <FluidReservoir accent={accent} remainingPercent={remaining} motion={IDLE_FLUID_MOTION}
                    motionSeed={seed} reducedMotion={reducedMotion} />
                )}
                <GeminiReadout pool={pool} remainingPercent={remaining} />
              </section>
            );
          })}
        </div>
        <footer className="status-footer gemini-study-footer">
          <span><b>GEMINI</b> · 材质预览</span>
          <button type="button" onClick={() => setSample(i => (i + 1) % sampleLevels.length)}>切换样例</button>
        </footer>
      </div>
    </main>
  );
}
