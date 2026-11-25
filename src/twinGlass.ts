import standardAtlas from "./twin-glass-standard.webp";
import narrowAtlas from "./twin-glass-narrow.webp";
import reflectionAtlas from "./twin-glass-reflections.webp";
import waterlineAtlas from "./twin-glass-waterline.webp";
import cavityAtlas from "./twin-glass-cavity.webp";

const atlases = { standard: standardAtlas, narrow: narrowAtlas };
type Layout = keyof typeof atlases;
export interface TwinGlassTextures {
  frames: HTMLImageElement;
  reflections: HTMLImageElement;
  waterline: HTMLImageElement;
  cavity: HTMLImageElement;
}
const textures: Partial<Record<Layout, Promise<TwinGlassTextures>>> = {};
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
export function loadTwinGlass(layout: Layout) {
  highlights ??= Promise.all([decode(reflectionAtlas), decode(waterlineAtlas), decode(cavityAtlas)]).catch(error => {
    highlights = undefined;
    throw error;
  });
  return textures[layout] ??= Promise.all([decode(atlases[layout]), highlights]).then(([frames, [reflections, waterline, cavity]]) => ({
    frames, reflections, waterline, cavity,
  })).catch(error => {
    delete textures[layout];
    throw error;
  });
}

function meniscusPosition(level: number, narrow: boolean) {
  const low = narrow ? .737 : .725;
  const high = narrow ? .298 : .345;
  if (level < .24) return 1 + (low - 1) * level / .24;
  if (level <= .82) return low + (high - low) * (level - .24) / .58;
  return high * (1 - (level - .82) / .18);
}

export function drawBakedTwinGlass(
  context: CanvasRenderingContext2D, texture: TwinGlassTextures, layout: Layout, width: number, height: number,
  violet: boolean, percent: number, nodes: Float32Array, time: number, stir: number,
) {
  context.clearRect(0, 0, width, height);
  context.save();
  const stirred = stir > .01 || nodes.some(offset => Math.abs(offset) > .05);
  const strips = stirred ? Math.min(nodes.length, width) : 1;
  const narrow = layout === "narrow";
  const sampleMeniscus = tileHeight * meniscusPosition(violet ? .24 : .82, narrow);
  let left = 0;
  for (let index = 0; index < strips; index++) {
    const right = Math.round((index + 1) * width / strips);
    const fraction = (index + .5) / strips;
    const node = Math.min(nodes.length - 1, Math.floor(fraction * nodes.length));
    const wave = stirred ? nodes[node] + Math.sin(7 * fraction + time / 60) * stir : 0;
    const frame = Math.min(50, Math.max(0, (percent - 2 * wave) / 2));
    const lower = Math.floor(frame);
    const upperAlpha = frame - lower;
    const sourceLeft = left * tileWidth / width;
    const sourceWidth = (right - left) * tileWidth / width;
    const paint = (tile: number, opacity: number) => {
      context.globalAlpha = opacity;
      const x = tile % columns * tileWidth;
      const y = (Math.floor(tile / columns) + (violet ? rowsPerColor : 0)) * tileHeight;
      context.drawImage(texture.frames, x + sourceLeft, y, sourceWidth, tileHeight, left, 0, right - left, height);
    };
    paint(lower, 1);
    if (upperAlpha > 0) paint(lower + 1, upperAlpha);
    const position = meniscusPosition(frame / 50, narrow);
    const meniscus = position * height;
    context.save();
    context.globalAlpha = .82;
    context.globalCompositeOperation = "source-atop";
    const cavityX = Number(violet) * tileWidth + sourceLeft;
    const cavityY = narrow ? tileHeight : 0;
    if (meniscus > 0) {
      context.drawImage(texture.cavity, cavityX, cavityY, sourceWidth, sampleMeniscus,
        left, 0, right - left, meniscus);
    }
    if (meniscus < height) {
      context.drawImage(texture.cavity, cavityX, cavityY + sampleMeniscus, sourceWidth, tileHeight - sampleMeniscus,
        left, meniscus, right - left, height - meniscus);
    }
    context.restore();
    if (frame > 0 && frame < 50) {
      const power = narrow ? 4 : 2;
      const chord = Math.max(0, 1 - Math.abs(2 * position - 1) ** power) ** (1 / power);
      const span = width * chord;
      const depth = height * (narrow ? .115 : .11) * Math.min(1, frame / 5, (50 - frame) / 4);
      context.save();
      context.beginPath();
      context.rect(left, 0, right - left, height);
      context.clip();
      context.globalAlpha = .5;
      context.globalCompositeOperation = "source-atop";
      const row = (narrow ? 2 : 0) + Number(violet);
      context.drawImage(texture.waterline, 0, row * 16, tileWidth, 16,
        (width - span) / 2, position * height - depth / 2, span, depth);
      context.restore();
    }
    left = right;
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-atop";
  const foot = 4 + (narrow ? 2 : 0) + Number(violet);
  const sampleHeight = height * (narrow ? .22 : .28);
  context.globalAlpha = Math.min(1, Math.max(0, percent / 21));
  context.drawImage(texture.waterline, 0, foot * 16, tileWidth, 16,
    width * .07, height * .95 - sampleHeight, width * .86, sampleHeight);
  context.globalAlpha = 1;
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
  violet: boolean, percent: number, nodes: Float32Array, time: number, stir: number,
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
    const tilt = Math.max(-17, Math.min(17, (nodes[nodes.length - 1] - nodes[0]) * 1.35));
    const wobble = Math.sin(time / 44) * stir * 3;
    const depth = Math.min(4.3, level * 19, 1.4 + (1 - level) * 20);
    const back = y - tilt / 2;
    const front = y + tilt / 2;
    const liquid = new Path2D();
    liquid.moveTo(-64, back);
    liquid.bezierCurveTo(-27, back - depth + wobble, 27, front - depth - wobble, 64, front);
    liquid.lineTo(64, 52);
    liquid.lineTo(-64, 52);
    liquid.closePath();
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

    const meniscus = new Path2D();
    meniscus.moveTo(-64, back);
    meniscus.bezierCurveTo(-27, back - depth + wobble, 27, front - depth - wobble, 64, front);
    meniscus.bezierCurveTo(29, front + depth - wobble, -29, back + depth + wobble, -64, back);
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
