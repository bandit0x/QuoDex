import { useEffect, useRef } from "react";

const DIAMETER = 20.4;
const TAU = Math.PI * 2;
const FRAME_INTERVAL = 1000 / 30;

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

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function phaseSeed(chatId: string): number {
  let hash = 2166136261;
  for (const character of chatId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296 * TAU;
}

function packet(angle: number, phase: number, front: number, tail: number): number {
  const delta = Math.atan2(Math.sin(angle - phase), Math.cos(angle - phase));
  return Math.exp(-0.5 * (delta / (delta > 0 ? front : tail)) ** 2);
}

function waveAt(angle: number, time: number, seed: number) {
  const t = time + seed;
  const phaseA = TAU * t / 2.6 + 0.32 * Math.sin(t * 1.7);
  const phaseB = TAU * t / 3.9 + 2.3 + 0.4 * Math.sin(t * 1.13 + seed);
  const a = packet(angle, phaseA, 0.38 + 0.12 * Math.sin(t * 1.9), 1.13 + 0.32 * Math.sin(t * 1.07));
  const b = packet(angle, phaseB, 0.32 + 0.13 * Math.cos(t * 1.37), 0.88 + 0.26 * Math.sin(t * 1.61)) * (0.7 + 0.2 * Math.sin(t * 0.91));
  const energy = 1 - (1 - a) * (1 - b);
  const ripple = 0.5 * Math.sin(angle * 3 - t * 2.1 + Math.sin(angle + t * 0.83)) + 0.5 * Math.sin(angle * 5 + t * 1.7);
  const outer = DIAMETER / 2 - 0.17 * (1 + ripple);
  return { outer, inner: outer - 0.72 - 0.48 * energy, energy };
}

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
    if (pixel.coverage && pixel.radius > 8.2) {
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
