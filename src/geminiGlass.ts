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

let twinCavity: { atlas: HTMLImageElement; ratio: number; canvas: HTMLCanvasElement } | undefined;
function standardTwinCavity(atlas: HTMLImageElement, ratio: number) {
  if (twinCavity?.atlas === atlas && twinCavity.ratio === ratio) return twinCavity.canvas;
  // Chromium chooses a downsampling level from the first draw of the atlas.
  // Both views use the standard dial's cavity as their material resolution.
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(141 * .86 * ratio);
  canvas.height = Math.round(81 * .79 * ratio);
  const edge = atlas.naturalHeight;
  canvas.getContext("2d")?.drawImage(atlas, 0, 0, edge, edge, 0, 0, canvas.width, canvas.height);
  twinCavity = { atlas, ratio, canvas };
  return canvas;
}

// The atlas contains a dry cavity and three liquid exposures at the same
// camera angle. Keep the dry bevel fixed. The meniscus, body and foot have
// separate vertical mappings so a rising level never stretches the lens.
export function drawGeminiGlass(
  context: CanvasRenderingContext2D, atlas: HTMLImageElement, accent: GeminiAccent,
  width: number, height: number, percent: number, nodes: Float32Array,
  time: number, ambientMotion: boolean, phase: number,
  flow: readonly [number, number], agitation: number, lateralMomentum: number,
  twin?: { pixelRatio: number; transitionStir: number },
) {
  const tile = atlas.naturalHeight;
  const pixelsPerLogicalUnit = twin?.pixelRatio ?? 1;
  const transitionStir = twin?.transitionStir ?? 0;
  const cavity = twin && standardTwinCavity(atlas, twin.pixelRatio);
  if (cavity && cavity.width === width && cavity.height === height) context.drawImage(cavity, 0, 0);
  else context.drawImage(atlas, 0, 0, tile, tile, 0, 0, width, height);
  const level = Math.max(0, Math.min(1, percent / 100));
  if (!level) return;

  const surfaceY = height * (0.94 - 0.80 * level);
  const halfDepth = height * Math.min(0.087, 0.39 * level, 0.035 + 0.4 * (1 - level));
  const tileX = wetTiles[accent] * tile;
  // Integer device-pixel columns share an edge without resampling seams.
  const pixels = context.canvas.width;
  const disturbed = nodes.some(offset => Math.abs(offset) > 0.05);
  const bands = disturbed || ambientMotion ? nodes.length - 1 : transitionStir > 0.01 ? 16 : 1;
  const strips = Math.min(bands, pixels);
  const tilt = (nodes[0] - nodes[nodes.length - 1]) * pixelsPerLogicalUnit / height;
  const seconds = ambientMotion ? time / 1000 : 0;
  const swell = Math.sin(seconds * 0.28 + phase);
  // Refract the photographed highlights through the moving surface normal.
  // Anchor both side walls: the lens and its bevel belong to the stationary glass.
  const refraction = ambientMotion
    ? Math.max(-0.12, Math.min(0.12, tilt * 0.52 + swell * 0.007 + lateralMomentum * 0.10))
    : 0;
  const refract = (x: number, strength: number) => x + Math.sin(Math.PI * x) * refraction * strength;
  context.save();
  context.globalAlpha = Math.min(1, level / 0.045);
  for (let i = 0; i < strips; i++) {
    const left = Math.round(i * pixels / strips) / pixels;
    const right = Math.round((i + 1) * pixels / strips) / pixels;
    const x = (left + right) * 0.5;
    const wave = nodes[Math.round(x * (nodes.length - 1))] * pixelsPerLogicalUnit
      + (ambientMotion ? ambientBreezeOffset(x, time, disturbed, phase) * pixelsPerLogicalUnit
        + height * (lateralMomentum * (1 - 2 * x) * 0.10
          + agitation * Math.sin(x * 8.5 - seconds * 1.8 + phase) * 0.035) : 0);
    // Even at 100% the lens has headroom above the photographed meniscus.
    const displacement = Math.min(surfaceY - halfDepth, Math.max(-surfaceY + halfDepth, wave))
      * Math.min(1, level * 9);
    const transitionWave = Math.sin(x * Math.PI * 2.2 + time * 0.013) * Math.sin(x * Math.PI) * height * .019 * transitionStir;
    const back = surfaceY - halfDepth + displacement + transitionWave;
    const front = surfaceY + halfDepth + displacement + transitionWave;
    const foot = Math.max(height * 0.79, front + 0.20 * (height - front));
    const paint = (from: number, to: number, top: number, bottom: number, strength: number) => {
      const start = refract(left, strength);
      const end = refract(right, strength);
      context.drawImage(atlas, tileX + start * tile, from * tile, (end - start) * tile,
        (to - from) * tile, left * width, top, (right - left) * width, bottom - top);
    };
    paint(0.35, 0.54, back, front, 1);
    paint(0.54, 0.79, front, foot, 0.65);
    paint(0.79, 1, foot, height, -0.32);
    if (ambientMotion && agitation > 0.008) {
      // Codex's traveling glint follows the local free surface.
      const glint = ((1 + Math.sin(x * 32 - seconds * 1.8 + phase)) / 2) ** 9;
      const sheen = context.createLinearGradient(0, back, 0, front + halfDepth);
      sheen.addColorStop(0, "transparent");
      sheen.addColorStop(0.56, `rgba(227,244,255,${glint * agitation * 0.42})`);
      sheen.addColorStop(1, "transparent");
      context.fillStyle = sheen;
      context.fillRect(left * width, back, (right - left) * width, front + halfDepth - back);
    }
  }
  if (ambientMotion && agitation > 0.008 && level > 0.08) {
    const top = surfaceY + halfDepth + 3 * pixelsPerLogicalUnit;
    const depth = height * 0.94 - top;
    context.lineWidth = 0.7 * pixelsPerLogicalUnit;
    for (let i = 0; i < 10 && depth > 0; i++) {
      const seed = (i * 0.61803398875 + phase / (2 * Math.PI)) % 1;
      const travel = (seed + seconds * (0.045 + seed * 0.035)) % 1;
      const x = width * (0.11 + seed * 0.78)
        + (Math.sin(seconds + i + travel * 5) * 1.5 + Math.sin(flow[0]) * 3) * pixelsPerLogicalUnit;
      context.beginPath();
      context.arc(x, top + depth * (1 - travel), (0.65 + seed * 0.65) * pixelsPerLogicalUnit, 0, Math.PI * 2);
      context.strokeStyle = `rgba(230,244,255,${Math.sin(travel * Math.PI) * agitation * 0.65})`;
      context.stroke();
    }
  }
  context.restore();
}
