import { useLayoutEffect, useRef } from "react";
import { clamp, DIAMETER, EDGE_WIDTH_MULTIPLIER, FRAME_INTERVAL, phaseSeed, TAU, waveAt } from "./taskRingWave";
import "./AgentTaskRing.css";

export type AgentRingAgent = "Codex" | "ZCode" | "Gemini";
export type AgentRingState = "idle" | "waiting" | "completed" | "failed" | "unknown";

interface RingProps {
  agent: AgentRingAgent;
  state: AgentRingState;
  running: boolean;
  minutes: number | null;
  reducedMotion: boolean;
}

const pigments = {
  Codex: [[113, 127, 139], [225, 235, 241], [255, 255, 255]],
  ZCode: [[4, 7, 10], [19, 25, 31], [133, 148, 157]],
  Gemini: [[16, 51, 112], [36, 113, 231], [184, 229, 255]],
} as const;

// Approved cross sections in 0.4.10's 20.4-unit ring coordinate system.
const profiles = {
  idle: { width: 1.85, reflectance: .66 },
  waiting: { width: 2.05, reflectance: .76 },
  completed: { width: 1.68, reflectance: .72 },
  failed: { width: 2.38, reflectance: .80 },
  unknown: { width: 1.65, reflectance: .56 },
};
const glyphs = {
  waiting: "M8 5v14M16 5v14",
  failed: "M12 4v10m0 4v2",
  unknown: "M8 8a4 4 0 1 1 7 3c-2 1-3 2-3 4m0 3v2",
};

function stillRim(radius: number, angle: number, profile: typeof profiles.idle) {
  const outer = DIAMETER / 2 - .15;
  const depth = clamp((outer - radius) / profile.width);
  const outward = 1 - 2 * depth;
  const towardViewer = Math.sqrt(1 - outward * outward);
  const towardWindow = Math.cos(angle + 3 * Math.PI / 4);
  const diffuse = clamp(.78 * towardViewer + .62 * outward * towardWindow);
  const reflection = (.5 + .5 * towardWindow) * (.28 + .72 * towardViewer);
  return { outer, inner: outer - profile.width, energy: .06 + .31 * diffuse + profile.reflectance * .72 * reflection };
}

function prepareImage(ctx: CanvasRenderingContext2D, size: number, dashed: boolean) {
  const scale = size / DIAMETER;
  const pixels = ctx.createImageData(size, size);
  const band: { offset: number; radius: number; angle: number; coverage: number }[] = [];
  const minRadius = DIAMETER / 2 - .34 - 1.2 * EDGE_WIDTH_MULTIPLIER - .5 / scale;
  const maxRadius = DIAMETER / 2 + .5 / scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + .5) / scale - DIAMETER / 2;
      const dy = (y + .5) / scale - DIAMETER / 2;
      const radius = Math.hypot(dx, dy);
      if (radius < minRadius || radius > maxRadius) continue;
      const angle = Math.atan2(dy, dx);
      let coverage = 1;
      if (dashed) {
        const phase = (angle / TAU + 1.25) * 12;
        const gapDistance = Math.abs(phase - Math.round(phase)) - .15;
        coverage = clamp(gapDistance * TAU * radius / 12 * scale + .5);
      }
      band.push({ offset: (y * size + x) * 4, radius, angle, coverage });
    }
  }
  return { scale, pixels, band };
}

export function AgentTaskRing({ agent, state, running, minutes, reducedMotion }: RingProps) {
  const surface = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  // A running rim is independent of which status glyph is in its centre.
  const materialState = running ? "idle" : state;
  useLayoutEffect(() => {
    const canvas = surface.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const seed = phaseSeed(agent.toLowerCase());
    const stops = pigments[agent];
    const profile = profiles[materialState];
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let image: ReturnType<typeof prepareImage> | undefined;
    let visible = true;
    let frame: number | null = null;
    let lastPaint = 0;

    function draw() {
      if (!image) return;
      const { scale, pixels, band } = image;
      for (const { offset, radius, angle, coverage } of band) {
        const { outer, inner, energy } = running ? waveAt(angle, elapsed.current, seed) : stillRim(radius, angle, profile);
        const step = energy < .45 ? 0 : 1;
        const mix = step === 0 ? energy / .45 : ((energy - .45) / .55) ** .65;
        for (let c = 0; c < 3; c++) {
          const base = stops[step][c];
          pixels.data[offset + c] = Math.round(base + (stops[step + 1][c] - base) * mix);
        }
        pixels.data[offset + 3] = Math.round(255 * coverage * clamp((outer - radius) * scale + .5) * clamp((radius - inner) * scale + .5));
      }
      ctx!.putImageData(pixels, 0, 0);
    }
    function resize() {
      const width = canvas!.getBoundingClientRect().width;
      const size = Math.ceil(width * Math.min(window.devicePixelRatio || 1, 2) * (running ? 1 : 2));
      if (size === 0 || image?.pixels.width === size) return;
      canvas!.width = canvas!.height = size;
      image = prepareImage(ctx!, size, materialState === "unknown");
      draw();
    }
    function tick(now: number) {
      if (now - lastPaint >= FRAME_INTERVAL) {
        elapsed.current += (now - lastPaint) / 1000;
        lastPaint = now;
        draw();
      }
      frame = window.requestAnimationFrame(tick);
    }
    function synchronize() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      if (running && visible && !document.hidden && !reducedMotion && !motion?.matches) {
        lastPaint = performance.now();
        frame = window.requestAnimationFrame(tick);
      }
    }
    resize();
    const sizing = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    sizing?.observe(canvas);
    window.addEventListener("resize", resize);
    const intersection = running && typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      synchronize();
    }) : null;
    if (running) {
      intersection?.observe(canvas);
      document.addEventListener("visibilitychange", synchronize);
      motion?.addEventListener("change", synchronize);
      synchronize();
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      sizing?.disconnect();
      intersection?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", synchronize);
      motion?.removeEventListener("change", synchronize);
    };
  }, [agent, materialState, running, reducedMotion]);

  return <span className="agent-task-ring" data-agent={agent} data-state={state} data-moving={running || undefined} aria-hidden="true">
    <canvas className="agent-task-ring__surface" ref={surface} />
    {state === "completed" && <svg className="agent-task-ring__completion" viewBox="0 0 40.8 40.8">
      <path d="m5 12 4 4 10-10" transform="translate(10.8 3.5) scale(.8)" strokeWidth="2.8" />
      {minutes !== null && <text x="20.4" y="29.8" textAnchor="middle">{minutes}m</text>}
    </svg>}
    {state !== "idle" && state !== "completed" && <svg className="agent-task-ring__glyph" viewBox="0 0 24 24">
      <path d={glyphs[state]} />
    </svg>}
  </span>;
}
