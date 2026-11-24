import atlasUrl from "./gemini-glass.webp";
import { ambientBreezeOffset } from "./fluidPhysics";

const wetTiles = { iris: 1, indigo: 2, orchid: 3 } as const;
export type GeminiAccent = keyof typeof wetTiles;
export function isGeminiAccent(accent: string): accent is GeminiAccent {
  return accent === "iris" || accent === "indigo" || accent === "orchid";
}

let atlasPromise: Promise<HTMLImageElement> | undefined;
export function loadGeminiGlass() {
  if (!atlasPromise) {
    const image = new Image();
    image.src = atlasUrl;
    atlasPromise = image.decode().then(() => image).catch(error => {
      atlasPromise = undefined;
      throw error;
    });
  }
  return atlasPromise;
}

// The atlas contains a dry cavity and three liquid exposures at the same
// camera angle. Keep the dry bevel fixed. The meniscus, body and foot have
// separate vertical mappings so a rising level never stretches the lens.
export function drawGeminiGlass(
  context: CanvasRenderingContext2D, atlas: HTMLImageElement, accent: GeminiAccent,
  width: number, height: number, percent: number, nodes: Float32Array,
  time: number, ambientMotion: boolean, phase: number,
) {
  const tile = atlas.naturalHeight;
  context.drawImage(atlas, 0, 0, tile, tile, 0, 0, width, height);
  const level = Math.max(0, Math.min(1, percent / 100));
  if (!level) return;

  const surfaceY = height * (0.94 - 0.80 * level);
  const halfDepth = height * Math.min(0.087, 0.39 * level, 0.035 + 0.4 * (1 - level));
  const tileX = wetTiles[accent] * tile;
  // Integer device-pixel columns share an edge without resampling seams.
  const pixels = context.canvas.width;
  const disturbed = nodes.some(offset => Math.abs(offset) > 0.05);
  const strips = Math.min(disturbed ? nodes.length - 1 : ambientMotion ? 12 : 1, pixels);
  context.save();
  context.globalAlpha = Math.min(1, level / 0.045);
  for (let i = 0; i < strips; i++) {
    const left = Math.round(i * pixels / strips) / pixels;
    const right = Math.round((i + 1) * pixels / strips) / pixels;
    const x = (left + right) * 0.5;
    const wave = nodes[Math.round(x * (nodes.length - 1))]
      + (ambientMotion ? ambientBreezeOffset(x, time, false, phase) : 0);
    const displacement = wave * Math.min(1, level * 9, (1 - level) * 9);
    const back = surfaceY - halfDepth + displacement;
    const front = surfaceY + halfDepth + displacement;
    const foot = Math.max(height * 0.79, front + 0.20 * (height - front));
    const paint = (from: number, to: number, top: number, bottom: number) => {
      context.drawImage(atlas, tileX + left * tile, from * tile, (right - left) * tile,
        (to - from) * tile, left * width, top, (right - left) * width, bottom - top);
    };
    paint(0.35, 0.54, back, front);
    paint(0.54, 0.79, front, foot);
    paint(0.79, 1, foot, height);
  }
  context.restore();
}
