import { useEffect, useState } from "react";
import { GeminiChambers } from "./GeminiChambers";
import { OpticalShell } from "./OpticalShell";
import { IDLE_FLUID_MOTION } from "./fluidPhysics";
import "./GeminiMaterialPreview.css";

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
        <GeminiChambers levels={sampleLevels[sample]} motion={IDLE_FLUID_MOTION} reducedMotion={reducedMotion} />
        <footer className="status-footer gemini-study-footer">
          <span><b>GEMINI</b> · 材质预览</span>
          <button type="button" onClick={() => setSample(i => (i + 1) % sampleLevels.length)}>切换样例</button>
        </footer>
      </div>
    </main>
  );
}
