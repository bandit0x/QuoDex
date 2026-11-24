import { useEffect, useMemo, useRef } from "react";
import {
  ambientBreezeOffset,
  deriveFluidDynamics,
  FLUID_TAIL_EXTENSION,
  FluidBodyMomentum,
  FluidSurface,
  type FluidMotionSample,
  linearLiquidLevel,
} from "./fluidPhysics";
import { OpticalFluidRenderer, isGeminiFluid, type FluidAccent } from "./opticalFluidRenderer";

interface FluidReservoirProps {
  remainingPercent: number;
  accent: FluidAccent;
  motion: FluidMotionSample;
  motionSeed: number;
  reducedMotion: boolean;
}

interface Palette {
  top: string;
  middle: string;
  bottom: string;
  deep: string;
  edge: string;
  caustic: string;
}

const palettes: Record<FluidReservoirProps["accent"], Palette> = {
  iris: {
    top: "#957cda", middle: "#6545a2", bottom: "#39205f", deep: "#251638",
    edge: "#ead8ff", caustic: "rgba(176, 114, 255, .28)",
  },
  indigo: {
    top: "#708de2", middle: "#365cad", bottom: "#23376b", deep: "#181e43",
    edge: "#cadfff", caustic: "rgba(90, 148, 255, .28)",
  },
  orchid: {
    top: "#bf84be", middle: "#904f91", bottom: "#592f61", deep: "#371d40",
    edge: "#fbd7fa", caustic: "rgba(238, 132, 227, .28)",
  },
  cyan: {
    top: "rgba(116, 236, 255, .98)",
    middle: "rgba(8, 156, 208, .94)",
    bottom: "rgba(0, 52, 87, .99)",
    deep: "rgba(0, 18, 42, .99)",
    edge: "rgba(218, 251, 255, .96)",
    caustic: "rgba(138, 239, 255, .22)",
  },
  mint: {
    top: "rgba(148, 255, 231, .98)",
    middle: "rgba(12, 177, 147, .94)",
    bottom: "rgba(0, 72, 68, .99)",
    deep: "rgba(0, 29, 34, .99)",
    edge: "rgba(226, 255, 247, .96)",
    caustic: "rgba(156, 255, 231, .22)",
  },
  moonlight: {
    top: "rgba(236, 249, 253, .98)",
    middle: "rgba(116, 155, 170, .94)",
    bottom: "rgba(33, 77, 96, .99)",
    deep: "rgba(7, 30, 41, .99)",
    edge: "rgba(242, 252, 255, .96)",
    caustic: "rgba(206, 240, 247, .22)",
  },
  emerald: {
    top: "rgba(170, 255, 216, .98)",
    middle: "rgba(24, 174, 116, .94)",
    bottom: "rgba(0, 72, 53, .99)",
    deep: "rgba(0, 29, 26, .99)",
    edge: "rgba(224, 255, 241, .96)",
    caustic: "rgba(131, 255, 206, .22)",
  },
};

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function traceSurface(
  context: CanvasRenderingContext2D,
  nodes: Float32Array,
  x: number,
  width: number,
  baseY: number,
  time: number,
  active: boolean,
  ambientMotion: boolean,
  phaseOffset: number,
) {
  const last = nodes.length - 1;
  const meniscus = Array.from(nodes, (node, index) => {
    const normalized = index / last;
    const wallRise = -4.2 * (Math.exp(-normalized * 18) + Math.exp(-(1 - normalized) * 18));
    const breeze = ambientMotion
      ? ambientBreezeOffset(normalized, time, active, phaseOffset)
      : 0;
    return node + wallRise + breeze;
  });
  const meniscusMean = meniscus.reduce((sum, value) => sum + value, 0) / meniscus.length;
  context.moveTo(x, baseY + meniscus[0] - meniscusMean);
  for (let index = 1; index <= last; index += 1) {
    const previousX = x + ((index - 1) / last) * width;
    const previousY = baseY + meniscus[index - 1] - meniscusMean;
    const nextX = x + (index / last) * width;
    const nextY = baseY + meniscus[index] - meniscusMean;
    context.quadraticCurveTo(previousX, previousY, (previousX + nextX) / 2, (previousY + nextY) / 2);
  }
  context.lineTo(x + width, baseY + meniscus[last] - meniscusMean);
}

function drawReservoir(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  percent: number,
  surface: FluidSurface,
  flowOffset: readonly [number, number],
  palette: Palette,
  time: number,
  active: boolean,
  ambientMotion: boolean,
  phaseOffset: number,
  flowScale: number,
  gemini: boolean,
) {
  context.clearRect(0, 0, width, height);
  const insetX = 5;
  const insetTop = 5;
  const insetBottom = 5;
  const innerWidth = width - insetX * 2;
  const clipHeight = height - insetTop - insetBottom;
  const chamberHeight = Math.max(clipHeight - (gemini ? 0 : FLUID_TAIL_EXTENSION), 1);
  const liquidBottom = insetTop + clipHeight + 2;
  const baseY = linearLiquidLevel(percent, insetTop, chamberHeight);
  const liquidDepth = liquidBottom - baseY;
  const flowTime = time * flowScale;

  context.save();
  roundedRect(context, insetX, insetTop, innerWidth, clipHeight, 22);
  context.clip();

  const chamberLight = context.createRadialGradient(width * 0.5, -4, 4, width * 0.5, 0, width * 0.78);
  chamberLight.addColorStop(0, "rgba(205, 245, 255, .2)");
  chamberLight.addColorStop(0.48, "rgba(36, 94, 120, .07)");
  chamberLight.addColorStop(1, "rgba(0, 4, 10, .22)");
  context.fillStyle = chamberLight;
  context.fillRect(insetX, insetTop, innerWidth, clipHeight);
  if (gemini && percent <= 0) {
    context.restore();
    return;
  }

  context.beginPath();
  traceSurface(
    context,
    surface.heights,
    insetX,
    innerWidth,
    baseY,
    flowTime,
    active,
    ambientMotion,
    phaseOffset,
  );
  context.lineTo(insetX + innerWidth, liquidBottom);
  context.lineTo(insetX, liquidBottom);
  context.closePath();

  const body = context.createLinearGradient(0, baseY, 0, liquidBottom);
  body.addColorStop(0, palette.top);
  body.addColorStop(0.08, palette.top);
  body.addColorStop(0.3, palette.middle);
  body.addColorStop(0.82, palette.bottom);
  body.addColorStop(1, palette.deep);
  context.fillStyle = body;
  context.fill();

  const volumeGlow = context.createRadialGradient(
    width * 0.52,
    baseY + Math.max(12, liquidDepth * 0.2),
    2,
    width * 0.52,
    baseY + liquidDepth * 0.38,
    Math.max(40, width * 0.72),
  );
  volumeGlow.addColorStop(0, palette.caustic);
  volumeGlow.addColorStop(0.58, "rgba(255, 255, 255, .018)");
  volumeGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = volumeGlow;
  context.fillRect(insetX, baseY, innerWidth, liquidDepth);

  context.save();
  context.globalCompositeOperation = "screen";
  const lateralRefraction = context.createLinearGradient(insetX, 0, insetX + innerWidth, 0);
  lateralRefraction.addColorStop(0, "rgba(231, 253, 255, .3)");
  lateralRefraction.addColorStop(0.075, "rgba(83, 218, 255, .08)");
  lateralRefraction.addColorStop(0.45, "rgba(255, 255, 255, .015)");
  lateralRefraction.addColorStop(0.92, "rgba(72, 222, 203, .07)");
  lateralRefraction.addColorStop(1, "rgba(233, 255, 251, .28)");
  context.fillStyle = lateralRefraction;
  context.fillRect(insetX, baseY, innerWidth, liquidDepth);

  const causticHeight = Math.min(82, liquidDepth * 0.58);
  const causticStart = liquidBottom - causticHeight;
  context.filter = "blur(5px)";
  for (let plume = 0; plume < 7; plume += 1) {
    const seed = plume * 1.731 + phaseOffset;
    const drift = Math.sin(flowTime * (active ? 0.00044 : 0.00018) + seed) * 12
      + flowOffset[0] * 18;
    const centerX = insetX + ((plume + 0.45) / 7) * innerWidth + drift;
    const centerY = causticStart + (0.46 + ((plume * 0.29) % 0.42)) * causticHeight
      + flowOffset[1] * 10;
    const radius = 20 + (plume % 3) * 8;
    const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    glow.addColorStop(0, palette.caustic);
    glow.addColorStop(0.5, "rgba(160, 244, 255, .07)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  }
  context.restore();

  context.save();
  context.globalCompositeOperation = "screen";
  context.filter = "blur(6px)";
  context.globalAlpha = 0.38;
  for (let glow = 0; glow < 6; glow += 1) {
    const centerX = insetX + ((glow + 0.55) / 6) * innerWidth;
    const centerY = liquidBottom - 5 - (glow % 2) * 7;
    context.fillStyle = palette.caustic;
    context.beginPath();
    context.ellipse(centerX, centerY, 24 + (glow % 3) * 8, 5 + (glow % 2) * 2, -0.16 + glow * 0.05, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  context.save();
  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 38; index += 1) {
    const seedX = ((index * 47 + phaseOffset * 17) % 97) / 97;
    const seedY = ((index * 29 + 11 + phaseOffset * 13) % 101) / 101;
    const particleY = baseY + 8 + seedY * Math.max(0, liquidDepth - 16);
    if (particleY >= liquidBottom) continue;
    context.globalAlpha = 0.11 + (index % 5) * 0.028;
    context.fillStyle = "#eaffff";
    context.beginPath();
    context.arc(insetX + 8 + seedX * (innerWidth - 16), particleY, 0.35 + (index % 3) * 0.15, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  context.save();
  context.beginPath();
  traceSurface(
    context,
    surface.heights,
    insetX,
    innerWidth,
    baseY,
    flowTime,
    active,
    ambientMotion,
    phaseOffset,
  );
  context.strokeStyle = palette.edge;
  context.lineWidth = 2.1;
  context.shadowColor = palette.edge;
  context.shadowBlur = 10;
  context.stroke();
  context.translate(0, 4.5);
  context.strokeStyle = "rgba(0, 15, 26, .78)";
  context.lineWidth = 5;
  context.shadowBlur = 0;
  context.stroke();
  context.translate(0, -7);
  context.strokeStyle = "rgba(241, 255, 255, .28)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();

  const bubbleCount = percent < 8 ? 0 : percent > 70 ? 9 : 5;
  for (let index = 0; index < bubbleCount; index += 1) {
    const seed = (index * 0.61803398875 + phaseOffset / (Math.PI * 2)) % 1;
    const bubbleX = insetX + 18 + seed * (innerWidth - 36);
    const depth = 0.18 + ((index * 0.37) % 0.72);
    const travel = active
      ? ((flowTime * (0.003 + index * 0.00013) + index * 17 + phaseOffset * 11)
        % Math.max(10, liquidDepth - 8))
      : depth * liquidDepth;
    const bubbleY = liquidBottom - 7 - travel;
    if (bubbleY <= baseY + 7) continue;
    const radius = 0.7 + (index % 3) * 0.55;
    context.beginPath();
    context.arc(bubbleX, bubbleY, radius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(226, 255, 255, .42)";
    context.lineWidth = 0.65;
    context.stroke();
  }

  const frontLens = context.createLinearGradient(0, baseY, width, liquidBottom);
  frontLens.addColorStop(0, "rgba(230, 252, 255, .055)");
  frontLens.addColorStop(0.34, "rgba(255, 255, 255, 0)");
  frontLens.addColorStop(0.72, "rgba(167, 245, 233, .045)");
  frontLens.addColorStop(1, "rgba(255, 255, 255, .11)");
  context.fillStyle = frontLens;
  context.fillRect(insetX, baseY, innerWidth, liquidDepth);
  context.restore();
}

export function FluidReservoir({
  remainingPercent,
  accent,
  motion,
  motionSeed,
  reducedMotion,
}: FluidReservoirProps) {
  const webglCanvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef(new FluidSurface(56));
  const bodyMomentumRef = useRef(new FluidBodyMomentum());
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const drawRef = useRef<() => void>(() => undefined);
  const dynamics = useMemo(
    () => deriveFluidDynamics(remainingPercent, motionSeed),
    [motionSeed, remainingPercent],
  );

  useEffect(() => {
    surfaceRef.current.configure(dynamics);
    bodyMomentumRef.current.configure(dynamics);
  }, [dynamics]);

  useEffect(() => {
    const webglCanvas = webglCanvasRef.current;
    const fallbackCanvas = fallbackCanvasRef.current;
    if (!webglCanvas || !fallbackCanvas) return;
    const surface = surfaceRef.current;
    const bodyMomentum = bodyMomentumRef.current;
    const palette = palettes[accent];
    let opticalRenderer: OpticalFluidRenderer | null = null;
    let fallbackEnabled = false;

    try {
      opticalRenderer = new OpticalFluidRenderer(webglCanvas, accent);
      webglCanvas.dataset.renderer = "webgl";
      webglCanvas.style.display = "block";
      fallbackCanvas.style.display = "none";
    } catch (error) {
      console.warn("WebGL optical reservoir unavailable; using Canvas 2D fallback", error);
      fallbackEnabled = true;
      webglCanvas.dataset.renderer = "unavailable";
      fallbackCanvas.dataset.renderer = "canvas2d";
      webglCanvas.style.display = "none";
      fallbackCanvas.style.display = "block";
    }

    const render = (time = performance.now()) => {
      if (opticalRenderer) {
        opticalRenderer.render({
          remainingPercent,
          surface: surface.heights,
          flowOffset: bodyMomentum.offset,
          agitation: bodyMomentum.agitation,
          timeMs: time,
          active: surface.isActive,
          ambientMotion: !reducedMotion,
          phaseOffset: dynamics.phaseOffset,
          flowScale: dynamics.flowScale,
        });
        return;
      }
      if (!fallbackEnabled) return;
      const logicalWidth = fallbackCanvas.clientWidth;
      const logicalHeight = fallbackCanvas.clientHeight;
      if (logicalWidth <= 0 || logicalHeight <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(logicalWidth * ratio));
      const pixelHeight = Math.max(1, Math.round(logicalHeight * ratio));
      if (fallbackCanvas.width !== pixelWidth || fallbackCanvas.height !== pixelHeight) {
        fallbackCanvas.width = pixelWidth;
        fallbackCanvas.height = pixelHeight;
      }
      const context = fallbackCanvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawReservoir(
        context,
        logicalWidth,
        logicalHeight,
        remainingPercent,
        surface,
        bodyMomentum.offset,
        palette,
        time,
        surface.isActive,
        !reducedMotion,
        dynamics.phaseOffset,
        dynamics.flowScale,
        isGeminiFluid(accent),
      );
    };
    drawRef.current = () => render();
    render();

    let ambientFrame: number | null = null;
    let lastAmbientTime = 0;
    const animateAmbient = (time: number) => {
      if (time - lastAmbientTime >= 32) {
        lastAmbientTime = time;
        render(time);
      }
      ambientFrame = requestAnimationFrame(animateAmbient);
    };
    if (!reducedMotion) ambientFrame = requestAnimationFrame(animateAmbient);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => render());
    resizeObserver?.observe(opticalRenderer ? webglCanvas : fallbackCanvas);
    return () => {
      resizeObserver?.disconnect();
      if (ambientFrame !== null) cancelAnimationFrame(ambientFrame);
      opticalRenderer?.destroy();
    };
  }, [accent, dynamics.phaseOffset, reducedMotion, remainingPercent]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const bodyMomentum = bodyMomentumRef.current;
    if (reducedMotion) {
      surface.reset();
      bodyMomentum.reset();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      drawRef.current();
      return;
    }
    if (motion.sequence === 0) return;
    surface.disturb(motion.accelerationX, motion.accelerationY, motion.phase === "released");
    bodyMomentum.disturb(motion.accelerationX, motion.accelerationY, motion.phase === "released");
    if (frameRef.current !== null) return;
    lastTimeRef.current = performance.now();

    const animate = (time: number) => {
      const frameScale = Math.min(2, Math.max(0.35, (time - lastTimeRef.current) / 16.667));
      lastTimeRef.current = time;
      const surfaceActive = surface.step(frameScale);
      const bodyActive = bodyMomentum.step(frameScale);
      const active = surfaceActive || bodyActive;
      drawRef.current();
      frameRef.current = active ? requestAnimationFrame(animate) : null;
    };
    frameRef.current = requestAnimationFrame(animate);
  }, [motion, reducedMotion]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <>
      <canvas ref={webglCanvasRef} className="fluid-reservoir" aria-hidden="true" />
      <canvas
        ref={fallbackCanvasRef}
        className="fluid-reservoir"
        aria-hidden="true"
        style={{ display: "none" }}
      />
    </>
  );
}
