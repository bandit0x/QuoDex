import standardAtlas from "./twin-glass-standard.webp";
import narrowAtlas from "./twin-glass-narrow.webp";
import reflectionAtlas from "./twin-glass-reflections.webp";
import waterlineAtlas from "./twin-glass-waterline.webp";
import cavityAtlas from "./twin-glass-cavity.webp";
import { cavityHalfWidth, twinMeniscusRatio, type GeminiCavityState } from "./geminiFluidPhysics";

const atlases = { standard: standardAtlas, narrow: narrowAtlas };
type Layout = keyof typeof atlases;
export interface TwinGlassTextures {
  frames: HTMLImageElement;
  reflections: HTMLImageElement;
  waterline: HTMLImageElement;
  cavity: HTMLImageElement;
}
const textures: Partial<Record<Layout, Promise<TwinGlassTextures>>> = {};
const loadedTextures: Partial<Record<Layout, TwinGlassTextures>> = {};
const tileWidth = 172;
const tileHeight = 108;
const columns = 9;
const rowsPerColor = 6;

async function decode(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

let highlights: Promise<[HTMLImageElement, HTMLImageElement, HTMLImageElement]> | undefined;
export function getLoadedTwinGlass(layout: Layout): TwinGlassTextures | undefined {
  return loadedTextures[layout];
}
export function loadTwinGlass(layout: Layout) {
  highlights ??= Promise.all([decode(reflectionAtlas), decode(waterlineAtlas), decode(cavityAtlas)]).catch(error => {
    highlights = undefined;
    throw error;
  });
  return textures[layout] ??= Promise.all([decode(atlases[layout]), highlights]).then(([frames, [reflections, waterline, cavity]]) => {
    const loaded = { frames, reflections, waterline, cavity };
    loadedTextures[layout] = loaded;
    return loaded;
  }).catch(error => {
    delete textures[layout];
    throw error;
  });
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const clingColors = {
  blue: {
    filmPeak: "rgba(118, 182, 255, 0.42)",
    filmMid: "rgba(68, 118, 214, 0.28)",
    filmFade: "rgba(52, 98, 196, 0)",
    lipBack: "rgba(165, 205, 255, 0.22)",
    lipCenter: "rgba(58, 96, 178, 0.36)",
    lipFront: "rgba(198, 238, 255, 0.44)",
    glint: "rgba(210, 244, 255, 0.52)",
  },
  violet: {
    filmPeak: "rgba(222, 148, 255, 0.42)",
    filmMid: "rgba(154, 86, 198, 0.28)",
    filmFade: "rgba(126, 58, 164, 0)",
    lipBack: "rgba(236, 188, 255, 0.22)",
    lipCenter: "rgba(116, 62, 148, 0.36)",
    lipFront: "rgba(252, 224, 255, 0.44)",
    glint: "rgba(255, 228, 255, 0.52)",
  },
};

function drawClingingFilm(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  narrow: boolean,
  violet: boolean,
  side: -1 | 1,
  wetV: number,
  edgeV: number,
  filmStrength: number,
) {
  const span = edgeV - wetV;
  if (span <= 0.012 || filmStrength <= 0.01) return;

  const palette = violet ? clingColors.violet : clingColors.blue;
  const vTop = clamp(wetV, -0.96, 0.94);
  const vRoot = clamp(edgeV + 0.04, -0.90, 0.98);
  const steps = 22;
  const outer: Array<[number, number]> = [];
  const inner: Array<[number, number]> = [];
  const sheenPts: Array<[number, number]> = [];
  const rootThickness = (narrow ? 0.125 : 0.105) * (0.4 + 0.6 * filmStrength);

  for (let i = 0; i <= steps; i += 1) {
    const s = i / steps;
    const v = vTop + (vRoot - vTop) * s;
    const hw = cavityHalfWidth(v, narrow);
    const wallX = cx + side * hw * rx;
    const wallY = cy + v * ry;
    outer.push([wallX + side * 4, wallY]);

    const sheetThickness = 0.024 * Math.sin(Math.PI * Math.min(1, s * 1.1)) * filmStrength;
    const filletFlare = rootThickness * Math.pow(s, 2.4);
    const inward = (sheetThickness + filletFlare) * rx;
    inner.push([wallX - side * inward, wallY]);
    sheenPts.push([wallX - side * inward * 0.42, wallY]);
  }

  context.save();
  // Soften the clinging film polygon edge so it melts into the dry glass instead of looking cut out.
  context.filter = `blur(${Math.max(0.8, rx * 0.014).toFixed(2)}px)`;
  context.beginPath();
  context.moveTo(outer[0][0], outer[0][1]);
  for (let i = 1; i <= steps; i += 1) context.lineTo(outer[i][0], outer[i][1]);
  for (let i = steps; i >= 0; i -= 1) context.lineTo(inner[i][0], inner[i][1]);
  context.closePath();

  // Horizontal wall-to-center fade + vertical tip/root fade (prevents any hard bottom or inner cut).
  const wallEdgeX = cx + side * rx * 0.95;
  const fadeEdgeX = wallEdgeX - side * rootThickness * rx * 1.15;
  const lateralGrad = context.createLinearGradient(wallEdgeX, 0, fadeEdgeX, 0);
  lateralGrad.addColorStop(0, palette.filmPeak);
  lateralGrad.addColorStop(0.55, palette.filmMid);
  lateralGrad.addColorStop(1, palette.filmFade);

  context.fillStyle = lateralGrad;
  context.globalAlpha = clamp(filmStrength * 0.85, 0, 0.85);
  context.fill();

  // Delicate, feathered wet-glass sheen inside the film (replaces the hard 2px stroke).
  context.beginPath();
  context.moveTo(sheenPts[0][0], sheenPts[0][1]);
  for (let i = 1; i <= steps; i += 1) context.lineTo(sheenPts[i][0], sheenPts[i][1]);
  const sheenGrad = context.createLinearGradient(0, cy + vTop * ry, 0, cy + vRoot * ry);
  sheenGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
  sheenGrad.addColorStop(0.32, palette.glint);
  sheenGrad.addColorStop(0.78, palette.lipBack);
  sheenGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.strokeStyle = sheenGrad;
  context.globalAlpha = clamp(filmStrength * 0.42, 0, 0.42);
  context.lineWidth = Math.max(0.9, rx * 0.016);
  context.stroke();
  context.restore();
}

export function drawBakedTwinGlass(
  context: CanvasRenderingContext2D, texture: TwinGlassTextures, layout: Layout, width: number, height: number,
  violet: boolean, percent: number, fluidState: GeminiCavityState | null, _time: number, _stir: number,
) {
  context.clearRect(0, 0, width, height);
  context.save();
  const narrow = layout === "narrow";
  const sampleMeniscus = tileHeight * twinMeniscusRatio(violet ? .24 : .82, narrow);
  const activeSurge = Boolean(fluidState?.active);

  if (!activeSurge) {
    // Stationary / level-transition path: always draw 1 cohesive optical frame without vertical slicing.
    const frame = Math.min(50, Math.max(0, percent / 2));
    const lower = Math.floor(frame);
    const upperAlpha = frame - lower;
    const paint = (tile: number, opacity: number) => {
      context.globalAlpha = opacity;
      const x = tile % columns * tileWidth;
      const y = (Math.floor(tile / columns) + (violet ? rowsPerColor : 0)) * tileHeight;
      context.drawImage(texture.frames, x, y, tileWidth, tileHeight, 0, 0, width, height);
    };
    paint(lower, 1);
    if (upperAlpha > 0) paint(lower + 1, upperAlpha);
    const position = twinMeniscusRatio(frame / 50, narrow);
    const meniscus = position * height;
    context.save();
    context.globalAlpha = narrow ? .96 : Math.min(1, frame / 3, (51 - frame) / 2);
    context.globalCompositeOperation = "source-atop";
    const cavityX = Number(violet) * tileWidth;
    const cavityY = narrow ? tileHeight : 0;
    if (meniscus > 0) {
      context.drawImage(texture.cavity, cavityX, cavityY, tileWidth, sampleMeniscus,
        0, 0, width, meniscus);
    }
    if (meniscus < height) {
      context.drawImage(texture.cavity, cavityX, cavityY + sampleMeniscus, tileWidth, tileHeight - sampleMeniscus,
        0, meniscus, width, height - meniscus);
    }
    context.restore();
    if (frame > 0 && frame < 50) {
      const power = narrow ? 4 : 2;
      const chord = Math.max(0, 1 - Math.abs(2 * position - 1) ** power) ** (1 / power);
      const span = width * chord;
      const depth = height * (narrow ? .115 : .11) * Math.min(1, frame / 5, (50 - frame) / 4);
      context.save();
      context.globalAlpha = narrow ? .5 : .19;
      context.globalCompositeOperation = "source-atop";
      const row = (narrow ? 2 : 0) + Number(violet);
      context.drawImage(texture.waterline, 0, row * 16, tileWidth, 16,
        (width - span) / 2, position * height - depth / 2, span, depth);
      context.restore();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-atop";
    const foot = 4 + (narrow ? 2 : 0) + Number(violet);
    const sampleHeight = height * (narrow ? .22 : .28);
    context.globalAlpha = Math.min(1, Math.max(0, percent / 21)) * (narrow ? 1 : .35);
    context.drawImage(texture.waterline, 0, foot * 16, tileWidth, 16,
      width * .07, height * .95 - sampleHeight, width * .86, sampleHeight);
    context.globalAlpha = narrow ? 1 : .34;
    context.drawImage(texture.reflections, violet ? tileWidth : 0, layout === "narrow" ? tileHeight : 0,
      tileWidth, tileHeight, 0, 0, width, height);
    context.restore();
    return;
  }

  // Active surge + curved-wall clinging composite sharing the exact baked optical cavity material.
  const level = clamp(percent / 100, 0, 1);
  const colorRowOffset = violet ? rowsPerColor : 0;
  const cavityX = Number(violet) * tileWidth;
  const cavityY = narrow ? tileHeight : 0;
  const cavityAlpha = narrow ? 0.96 : clamp(level * 12, 0.35, 1);
  const surgeBlend = clamp((fluidState?.intensity ?? 0) * 1.6, 0, 1);

  // Layer 1: Stationary dry cavity + baked dry optical material establishes the exact silhouette & glass tone.
  context.drawImage(texture.frames, 0, colorRowOffset * tileHeight, tileWidth, tileHeight, 0, 0, width, height);
  context.save();
  context.globalCompositeOperation = "source-atop";
  context.globalAlpha = cavityAlpha;
  context.drawImage(texture.cavity, cavityX, cavityY, tileWidth, sampleMeniscus, 0, 0, width, height);
  context.restore();

  if (level > 0.004 && fluidState) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const rx = width * 0.5;
    const ry = height * 0.5;
    const surfSteps = 32;
    const surfPts: Array<[number, number]> = [];
    let minSurfY = height;
    for (let i = 0; i <= surfSteps; i += 1) {
      const xi = -1 + (2 * i) / surfSteps;
      const sv = fluidState.surfaceV(xi);
      const hw = cavityHalfWidth(sv, narrow);
      const px = cx + xi * hw * rx;
      const py = cy + sv * ry;
      if (py < minSurfY) minSurfY = py;
      surfPts.push([px, py]);
    }

    // Layer 2: Continuous cohesive liquid body using 1:1 full-wet frame + baked wet cavity material.
    const bulkPath = new Path2D();
    bulkPath.moveTo(-4, surfPts[0][1]);
    for (let i = 0; i <= surfSteps; i += 1) bulkPath.lineTo(surfPts[i][0], surfPts[i][1]);
    bulkPath.lineTo(width + 4, surfPts[surfSteps][1]);
    bulkPath.lineTo(width + 4, height + 4);
    bulkPath.lineTo(-4, height + 4);
    bulkPath.closePath();

    context.save();
    context.clip(bulkPath);
    context.globalCompositeOperation = "source-atop";
    const fullTileX = (50 % columns) * tileWidth;
    const fullTileY = (Math.floor(50 / columns) + colorRowOffset) * tileHeight;
    context.globalAlpha = clamp(level / 0.045, 0.35, 1);
    context.drawImage(texture.frames, fullTileX, fullTileY, tileWidth, tileHeight, 0, 0, width, height);

    const wetTop = clamp(minSurfY - height * 0.02, 0, height - 1);
    context.globalAlpha = cavityAlpha;
    context.drawImage(texture.cavity, cavityX, cavityY + sampleMeniscus, tileWidth, tileHeight - sampleMeniscus,
      0, wetTop, width, height - wetTop);

    const foot = 4 + (narrow ? 2 : 0) + Number(violet);
    const sampleHeight = height * (narrow ? .22 : .28);
    const footShift = -fluidState.tilt * width * 0.08;
    context.globalAlpha = Math.min(1, Math.max(0, percent / 21)) * (narrow ? 1 : .35);
    context.drawImage(texture.waterline, 0, foot * 16, tileWidth, 16,
      width * .07 + footShift, height * .95 - sampleHeight, width * .86, sampleHeight);
    context.restore();

    // Layer 3: Asymmetric feathered wall-clinging films & intensity-blended meniscus band.
    context.save();
    context.globalCompositeOperation = "source-atop";
    drawClingingFilm(context, cx, cy, rx, ry, narrow, violet, -1, fluidState.wetL, fluidState.edgeL, fluidState.filmL);
    drawClingingFilm(context, cx, cy, rx, ry, narrow, violet, 1, fluidState.wetR, fluidState.edgeR, fluidState.filmR);

    if (surgeBlend > 0.01) {
      const palette = violet ? clingColors.violet : clingColors.blue;
      const bandHalf = Math.min(height * 0.075, height * 0.24 * level);
      const midY = surfPts[Math.floor(surfSteps / 2)][1];
      const lipPath = new Path2D();
      lipPath.moveTo(surfPts[0][0] - 2, surfPts[0][1]);
      for (let i = 1; i <= surfSteps; i += 1) {
        lipPath.lineTo(surfPts[i][0], surfPts[i][1] - bandHalf * Math.sin((i / surfSteps) * Math.PI));
      }
      lipPath.lineTo(surfPts[surfSteps][0] + 2, surfPts[surfSteps][1]);
      for (let i = surfSteps; i >= 0; i -= 1) {
        lipPath.lineTo(surfPts[i][0], surfPts[i][1] + bandHalf * Math.sin((i / surfSteps) * Math.PI));
      }
      lipPath.closePath();

      context.save();
      context.filter = `blur(${Math.max(1, height * 0.016).toFixed(2)}px)`;
      const lipGrad = context.createLinearGradient(0, midY - bandHalf, 0, midY + bandHalf);
      lipGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
      lipGrad.addColorStop(0.28, palette.lipBack);
      lipGrad.addColorStop(0.54, palette.lipCenter);
      lipGrad.addColorStop(0.78, palette.lipFront);
      lipGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.globalAlpha = Math.min(1, level * 5) * (narrow ? 0.64 : 0.48) * surgeBlend;
      context.fillStyle = lipGrad;
      context.fill(lipPath);
      context.restore();
    }

    // Sub-surface waterline texture rotated along the instantaneous free-surface tilt.
    const leftPt = surfPts[0];
    const rightPt = surfPts[surfSteps];
    const chordLen = Math.hypot(rightPt[0] - leftPt[0], rightPt[1] - leftPt[1]);
    const angle = Math.atan2(rightPt[1] - leftPt[1], rightPt[0] - leftPt[0]);
    const wlDepth = height * (narrow ? 0.115 : 0.11) * Math.min(1, level * 5);
    const wlRow = (narrow ? 2 : 0) + Number(violet);
    context.save();
    context.translate((leftPt[0] + rightPt[0]) * 0.5, (leftPt[1] + rightPt[1]) * 0.5);
    context.rotate(angle);
    context.globalAlpha = Math.min(1, level * 5) * (narrow ? 0.48 : 0.22);
    context.drawImage(texture.waterline, 0, wlRow * 16, tileWidth, 16,
      -chordLen * 0.5, -wlDepth * 0.5, chordLen, wlDepth);
    context.restore();
    context.restore();
  }

  // Layer 4: Stationary outer dome glass reflections.
  context.globalCompositeOperation = "source-atop";
  context.globalAlpha = narrow ? 1 : .34;
  context.drawImage(texture.reflections, violet ? tileWidth : 0, layout === "narrow" ? tileHeight : 0,
    tileWidth, tileHeight, 0, 0, width, height);
  context.restore();
}

type Stop = readonly [number, string];

const optics = {
  blue: { edge: "#aacaff", light: "#759fff", glint: "#cbf3ff", depth: "#111d47", surface: "#344eaa" },
  violet: { edge: "#eebfff", light: "#cf76fa", glint: "#ffe3ff", depth: "#28153a", surface: "#763d89" },
};

export function drawTwinGlass(
  context: CanvasRenderingContext2D, width: number, height: number, narrow: boolean,
  violet: boolean, percent: number, fluidState: GeminiCavityState | null, time: number, stir: number,
) {
  const color = violet ? optics.violet : optics.blue;
  const hull = new Path2D(narrow
    ? "M-39 -47 C-59 -47 -62 -31 -62 -10 L-62 13 C-62 35 -48 49 -21 50 L21 50 C48 49 62 35 62 13 L62 -10 C62 -31 59 -47 39 -47 Z"
    : "M0 -50 C37 -50 62 -29 62 0 S37 50 0 50 S-62 29 -62 0 S-37 -50 0 -50 Z");
  const linear = (x: number, y: number, endX: number, endY: number, stops: readonly Stop[]) => {
    const gradient = context.createLinearGradient(x, y, endX, endY);
    for (const [position, shade] of stops) gradient.addColorStop(position, shade);
    return gradient;
  };

  context.clearRect(0, 0, width, height);
  context.save();
  context.translate(width / 2, height / 2);
  context.scale(width / 124, height / 100);
  context.clip(hull);
  context.fillStyle = linear(0, -50, 0, 50, [
    [0, "#303940"], [.26, "#191e28"], [.53, "#141a21"], [.83, "#222b38"], [1, "#373c4b"],
  ]);
  context.fillRect(-62, -50, 124, 100);

  const level = Math.max(0, Math.min(1, percent / 100));
  if (level > 0) {
    const y = 48 - level * 96;
    const wobble = Math.sin(time / 44) * stir * 3;
    const depth = Math.min(4.3, level * 19, 1.4 + (1 - level) * 20);
    const liquid = new Path2D();
    const meniscus = new Path2D();

    if (fluidState?.active) {
      const steps = 28;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= steps; i += 1) {
        const xi = -1 + (2 * i) / steps;
        const sv = fluidState.surfaceV(xi);
        const hw = cavityHalfWidth(sv, narrow);
        pts.push([xi * hw * 62, sv * 50]);
      }
      liquid.moveTo(-64, pts[0][1]);
      for (const [px, py] of pts) liquid.lineTo(px, py);
      liquid.lineTo(64, pts[steps][1]);
      liquid.lineTo(64, 52);
      liquid.lineTo(-64, 52);
      liquid.closePath();

      meniscus.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= steps; i += 1) {
        meniscus.lineTo(pts[i][0], pts[i][1] - depth * 0.65 * Math.sin((i / steps) * Math.PI));
      }
      for (let i = steps; i >= 0; i -= 1) {
        meniscus.lineTo(pts[i][0], pts[i][1] + depth * 0.65 * Math.sin((i / steps) * Math.PI));
      }
      meniscus.closePath();
    } else {
      const back = y;
      const front = y;
      liquid.moveTo(-64, back);
      liquid.bezierCurveTo(-27, back - depth + wobble, 27, front - depth - wobble, 64, front);
      liquid.lineTo(64, 52);
      liquid.lineTo(-64, 52);
      liquid.closePath();

      meniscus.moveTo(-64, back);
      meniscus.bezierCurveTo(-27, back - depth + wobble, 27, front - depth - wobble, 64, front);
      meniscus.bezierCurveTo(29, front + depth - wobble, -29, back + depth + wobble, -64, back);
    }

    context.save();
    context.clip(liquid);
    context.fillStyle = linear(0, y - depth, 0, 51, [
      [0, color.surface], [.18, color.depth], [.55, color.depth], [.79, color.surface], [1, color.depth],
    ]);
    context.fillRect(-64, -50, 128, 102);
    // Side reflections travel with the wet wall, with weaker light transmitted through the lens.
    context.strokeStyle = linear(-62, 0, 62, 0, [
      [0, color.glint], [.065, color.light], [.24, "#ffffff05"], [.72, "#ffffff05"], [.955, color.edge], [1, color.glint],
    ]);
    for (const inset of [0.945, 0.875, 0.785]) {
      context.save();
      context.scale(inset, inset);
      context.globalAlpha = inset;
      context.lineWidth = inset > .9 ? 3.4 : 1.15;
      context.stroke(hull);
      context.restore();
    }
    for (const [x, brightness] of [[-34, .93], [37, .74]]) {
      context.save();
      context.translate(x, 39);
      context.rotate(x < 0 ? .42 : -.45);
      context.scale(1, .26);
      const light = context.createRadialGradient(0, 0, 0, 0, 0, 24);
      light.addColorStop(0, color.glint);
      light.addColorStop(.12, color.light);
      light.addColorStop(.32, color.surface);
      light.addColorStop(1, "#ffffff00");
      context.globalAlpha = brightness;
      context.globalCompositeOperation = "screen";
      context.fillStyle = light;
      context.fillRect(-24, -24, 48, 48);
      context.restore();
    }
    context.restore();

    if (fluidState?.active) {
      drawClingingFilm(context, 0, 0, 62, 50, narrow, violet, -1, fluidState.wetL, fluidState.edgeL, fluidState.filmL);
      drawClingingFilm(context, 0, 0, 62, 50, narrow, violet, 1, fluidState.wetR, fluidState.edgeR, fluidState.filmR);
    }

    context.fillStyle = linear(0, y - depth, 0, y + depth, [[0, color.edge], [.36, color.depth], [.77, color.light], [1, color.glint]]);
    context.fill(meniscus);
    context.strokeStyle = color.edge;
    context.lineWidth = .95;
    context.stroke(meniscus);
  }

  // Reflections at the outer glass boundary remain fixed as the liquid moves inside.
  context.strokeStyle = linear(-60, -22, 60, 48, [
    [0, "#f2f8ffda"], [.14, "#8293a8b0"], [.3, "#eff5ffac"], [.54, "#8d9fb029"],
    [.72, "#0d121a95"], [.87, "#e9f4ffbb"], [1, "#b5cbe1dd"],
  ]);
  context.lineWidth = 3.8;
  context.stroke(hull);
  context.scale(.955, .955);
  context.strokeStyle = linear(-57, -40, 48, 42, [[0, "#dcecffad"], [.33, "#a1b3c93a"], [.64, "#ffffff00"], [1, "#f1f6ff81"]]);
  context.lineWidth = 1.5;
  context.stroke(hull);
  context.restore();
}
