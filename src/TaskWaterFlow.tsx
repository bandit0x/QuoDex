import { useEffect, useRef } from "react";
import { clamp, DIAMETER, EDGE_WIDTH_MULTIPLIER, FRAME_INTERVAL, phaseSeed, waveAt } from "./taskRingWave";

interface Pixel {
  radius: number;
  angle: number;
  coverage: number;
  red: number;
  green: number;
  blue: number;
}

interface Stream {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  seed: number;
  reducedMotion: boolean;
  visible: boolean;
  pixels: number;
  coordinates: Pixel[];
  image: ImageData | null;
}

const streams = new Set<Stream>();
let frame: number | null = null;
let previousTime = 0;
let paintedAt = 0;
let flowTime = 0;
let motionPreference: MediaQueryList | null = null;

function preparePixels(stream: Stream): number {
  const size = Math.max(1, Math.ceil(stream.canvas.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 2)));
  const scale = size / DIAMETER;
  if (stream.pixels === size) return scale;
  stream.pixels = size;
  stream.canvas.width = stream.canvas.height = size;
  stream.image = stream.context.createImageData(size, size);
  stream.coordinates = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / scale - DIAMETER / 2;
      const dy = (y + 0.5) / scale - DIAMETER / 2;
      const radius = Math.hypot(dx, dy);
      const rim = clamp((radius - 9) * scale + 0.5);
      stream.coordinates.push({ radius, angle: Math.atan2(dy, dx), coverage: clamp((10.2 - radius) * scale + 0.5), red: 7 + 29 * rim, green: 23 + 68 * rim, blue: 35 + 79 * rim });
    }
  }
  return scale;
}

function paint(stream: Stream): void {
  const scale = preparePixels(stream);
  const image = stream.image!;
  for (let index = 0; index < stream.coordinates.length; index++) {
    const pixel = stream.coordinates[index];
    let red = pixel.red, green = pixel.green, blue = pixel.blue;
    if (pixel.coverage && pixel.radius > DIAMETER / 2 - 0.34 - 1.2 * EDGE_WIDTH_MULTIPLIER - 0.5 / scale) {
      const wave = waveAt(pixel.angle, flowTime, stream.seed);
      const opacity = clamp((wave.outer - pixel.radius) * scale + 0.5) * clamp((pixel.radius - wave.inner) * scale + 0.5);
      let lightRed: number, lightGreen: number, lightBlue: number;
      if (wave.energy < 0.45) {
        const amount = wave.energy / 0.45;
        lightRed = 36 + 36 * amount; lightGreen = 91 + 126 * amount; lightBlue = 114 + 117 * amount;
      } else {
        const amount = ((wave.energy - 0.45) / 0.55) ** 0.65;
        lightRed = 72 + 168 * amount; lightGreen = 217 + 38 * amount; lightBlue = 231 + 19 * amount;
      }
      red += (lightRed - red) * opacity;
      green += (lightGreen - green) * opacity;
      blue += (lightBlue - blue) * opacity;
    }
    image.data[index * 4] = Math.round(red);
    image.data[index * 4 + 1] = Math.round(green);
    image.data[index * 4 + 2] = Math.round(blue);
    image.data[index * 4 + 3] = Math.round(255 * pixel.coverage);
  }
  stream.context.putImageData(image, 0, 0);
}

function isMoving(stream: Stream): boolean {
  return stream.visible && !stream.reducedMotion && !motionPreference?.matches && !document.hidden;
}

function animate(now: number): void {
  frame = null;
  flowTime += Math.max(0, now - previousTime) / 1000;
  previousTime = now;
  if (now - paintedAt >= FRAME_INTERVAL) {
    for (const stream of streams) if (isMoving(stream)) paint(stream);
    paintedAt = now;
  }
  frame = window.requestAnimationFrame(animate);
}

function synchronizeMotion(): void {
  if (frame !== null) window.cancelAnimationFrame(frame);
  frame = null;
  for (const stream of streams) {
    stream.canvas.dataset.flowPaused = String(!stream.visible || document.hidden);
    stream.canvas.dataset.flowReduced = String(stream.reducedMotion || Boolean(motionPreference?.matches));
  }
  if ([...streams].some(isMoving)) {
    previousTime = performance.now();
    frame = window.requestAnimationFrame(animate);
  }
}

function attach(canvas: HTMLCanvasElement, chatId: string, reducedMotion: boolean): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  if (streams.size === 0) {
    motionPreference = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    motionPreference?.addEventListener("change", synchronizeMotion);
    document.addEventListener("visibilitychange", synchronizeMotion);
  }
  const stream: Stream = { canvas, context, seed: phaseSeed(chatId), reducedMotion, visible: true, pixels: 0, coordinates: [], image: null };
  streams.add(stream);
  paint(stream);
  canvas.dataset.flowReady = "true";
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    stream.visible = entries.some(entry => entry.isIntersecting);
    synchronizeMotion();
  });
  observer?.observe(canvas);
  synchronizeMotion();
  return () => {
    observer?.disconnect();
    streams.delete(stream);
    synchronizeMotion();
    if (streams.size === 0) {
      document.removeEventListener("visibilitychange", synchronizeMotion);
      motionPreference?.removeEventListener("change", synchronizeMotion);
      motionPreference = null;
    }
  };
}

export function TaskWaterFlow({ chatId, reducedMotion }: { chatId: string; reducedMotion: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) return attach(canvas.current, chatId, reducedMotion);
  }, [chatId, reducedMotion]);
  return <canvas ref={canvas} className="task-water-flow" data-flow-reduced={reducedMotion} aria-hidden="true" />;
}
