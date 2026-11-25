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
