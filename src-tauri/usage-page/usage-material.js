/**
 * QuoDex 页内光学材质。水流来自 opticalFluidRenderer.ts 的 fbm/curl/焦散；
 * 冠面、柔光箱、Fresnel/GGX、厚度吸收和内壁回光来自 OpticalShell.tsx。
 * 这里只绘制装饰，不读取用量、额度、水位或图表几何。
 *
 * #ocean-canvas: fixed/inset:0/width:100%/height:100%/pointer-events:none.
 * .glass-panel/.pill: position:relative; isolation:isolate.
 * .usage-glass-canvas: absolute/inset:0/100%/pointer-events:none/z-index:0.
 * 容器直接内容保持 z-index:1；热格和 SVG 的原始颜色不由此模块改变。
 */

const INSTANCES = new WeakMap();
const MAX_FPS = 24;
const MAX_WATER_PIXELS = 600_000;
const MAX_GLASS_PIXELS = 450_000;
const MAX_GLASS_SURFACES = 24;
const MAX_DPR = 1.5;
const STATE_CLASSES = ["usage-material-ready", "usage-material-fallback", "usage-material-glass-fallback", "usage-material-static", "usage-material-paused"];

const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const WATER_SHADER = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uTime;
float sat(float x) { return clamp(x, 0.0, 1.0); }
float hash11(float x) { return fract(sin(x * 127.1) * 43758.5453123); }
float valueNoise(vec2 point) {
  vec2 cell = floor(point), local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash11(dot(cell, vec2(1.0, 57.0)));
  float b = hash11(dot(cell + vec2(1.0, 0.0), vec2(1.0, 57.0)));
  float c = hash11(dot(cell + vec2(0.0, 1.0), vec2(1.0, 57.0)));
  float d = hash11(dot(cell + vec2(1.0), vec2(1.0, 57.0)));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}
float fluidFbm(vec2 point) {
  float value = 0.0, weight = 0.52;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  for (int octave = 0; octave < 5; octave++) {
    value += valueNoise(point) * weight;
    point = turn * point * 2.03 + vec2(7.1, 3.7);
    weight *= 0.49;
  }
  return value;
}
vec2 curlField(vec2 point) {
  const float stepSize = 0.075;
  float left = fluidFbm(point - vec2(stepSize, 0.0));
  float right = fluidFbm(point + vec2(stepSize, 0.0));
  float top = fluidFbm(point - vec2(0.0, stepSize));
  float bottom = fluidFbm(point + vec2(0.0, stepSize));
  return vec2(top - bottom, left - right) / (2.0 * stepSize);
}
void main() {
  vec2 uv = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uResolution;
  float aspect = uResolution.x / uResolution.y;
  vec2 domain = vec2(uv.x * aspect, uv.y) * 7.2;
  float flowTime = uTime * 0.16;
  vec2 curl = clamp(curlField(domain * 0.74 + vec2(flowTime * 0.13, -flowTime * 0.07)), vec2(-1.5), vec2(1.5));
  vec2 transported = domain - curl * 0.34 + vec2(-flowTime * 0.10, flowTime * 0.03);
  float density = fluidFbm(transported);
  float stepSize = 0.055;
  vec2 gradient = vec2(fluidFbm(transported + vec2(stepSize, 0.0)), fluidFbm(transported + vec2(0.0, stepSize))) - density;
  vec3 normal = normalize(vec3(-gradient / stepSize * 0.72, 0.34));
  float volumeLight = sat(dot(normal, normalize(vec3(-0.58, -0.70, 0.62))) * 0.5 + 0.72);
  float causticDensity = fluidFbm(transported * 1.42 + curl * 0.38 + vec2(flowTime * 0.09, -flowTime * 0.06));
  float softCaustic = smoothstep(0.56, 0.80, causticDensity);
  // Curved narrow light paths; no blurred decorative bands or data-driven liquid level.
  float thread = pow(sat(1.0 - abs(causticDensity - 0.52) * 12.0), 3.0);
  float secondThread = pow(sat(1.0 - abs(density - 0.48) * 16.0), 4.0);
  float overhead = exp(-uv.y * 2.1);
  vec3 deep = vec3(0.010, 0.072, 0.102);
  vec3 water = vec3(0.042, 0.255, 0.320);
  vec3 color = mix(deep, water, 0.55 + overhead * 0.45);
  color *= 0.86 + volumeLight * 0.19;
  color += vec3(0.065, 0.29, 0.34) * (thread * 0.55 + secondThread * 0.17) * (0.45 + overhead * 0.70);
  color += vec3(0.021, 0.10, 0.12) * softCaustic * (0.30 + overhead * 0.40);
  float shafts = pow(sat(0.5 + 0.5 * cos(uv.x * 27.0 + curl.x * 0.30 + flowTime * 0.035)), 10.0);
  color += vec3(0.05, 0.13, 0.15) * shafts * overhead * 0.25;
  color *= 1.0 - smoothstep(0.4, 1.0, abs(uv.x - 0.5) * 2.0) * 0.16;
  outColor = vec4(color, 1.0);
}
`;

const GLASS_SHADER = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uRadius;
uniform float uPanel;
const float PI = 3.141592653589793;
float sat(float x) { return clamp(x, 0.0, 1.0); }
float pow5(float x) { float square = x * x; return square * square * x; }
float roundedRectSdf(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}
float fresnelSchlick(float cosine, float f0) { return f0 + (1.0 - f0) * pow5(1.0 - sat(cosine)); }
float ggx(float roughness, float nDotL, float nDotV, float nDotH) {
  float alpha2 = roughness * roughness;
  float denominator = PI * pow(nDotH * nDotH * (alpha2 - 1.0) + 1.0, 2.0);
  float distribution = alpha2 / max(denominator, 0.0001);
  float k = roughness * 0.5;
  float visibility = 1.0 / max((nDotL * (1.0 - k) + k) * (nDotV * (1.0 - k) + k), 0.0001);
  return max(nDotL, 0.0) * distribution * visibility;
}
float wallWidth() { return min(mix(9.0, 12.0, uPanel), uResolution.y / uPixelRatio * 0.34); }
float controlElevation(vec2 point, vec2 halfSize, float radius) {
  float depth = max(-roundedRectSdf(point - uResolution * 0.5, halfSize, radius) / uPixelRatio, 0.0);
  float roll = sin(PI * sat(depth / wallWidth()));
  vec2 plane = point / uResolution * 2.0 - 1.0;
  float crown = max(1.0 - plane.x * plane.x, 0.0) * max(1.0 - plane.y * plane.y, 0.0);
  return 5.2 * roll * roll + mix(5.5, 12.0, uPanel) * crown * smoothstep(3.0, wallWidth(), depth);
}
vec3 controlEnvironment(vec3 ray, vec2 point) {
  vec2 size = uResolution / uPixelRatio;
  vec2 hit = point / uPixelRatio + ray.xy * (64.0 / max(ray.z, 0.16));
  float softbox = exp(-pow((hit.x - size.x * 0.22) / max(size.x * 0.24, 1.0), 4.0) - pow((hit.y + 36.0) / 78.0, 4.0)) * smoothstep(0.08, 0.25, ray.z);
  float wallSoftbox = exp(-pow((ray.x + 0.34) / 0.48, 4.0) - pow((ray.y + 0.62) / 0.26, 4.0)) * exp(-pow((point.x / uResolution.x - 0.17) / 0.30, 2.0));
  float left = exp(-pow((ray.x + 0.8) / 0.42, 2.0) - pow((ray.y + 0.05) / 0.8, 2.0));
  float right = exp(-pow((ray.x - 0.76) / 0.38, 2.0) - pow((ray.y - 0.22) / 0.7, 2.0));
  return vec3(0.11, 0.12, 0.13) + vec3(0.98, 0.995, 1.0) * (softbox * 13.5 + wallSoftbox * 7.0) + vec3(0.55, 0.58, 0.61) * (left + right) * 0.9;
}
void main() {
  float ratio = uPixelRatio;
  vec2 fragment = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 halfSize = uResolution * 0.5 - vec2(0.75 * ratio);
  float radius = min(uRadius * ratio, min(halfSize.x, halfSize.y));
  float sd = roundedRectSdf(fragment - uResolution * 0.5, halfSize, radius);
  float mask = 1.0 - smoothstep(-max(1.0, ratio), 0.0, sd);
  if (mask <= 0.0) { outColor = vec4(0.0); return; }
  float depth = max(-sd / ratio, 0.0);
  float roll = max(sin(PI * sat(depth / wallWidth())), 0.0);
  vec2 slope = vec2(controlElevation(fragment + vec2(ratio, 0.0), halfSize, radius) - controlElevation(fragment - vec2(ratio, 0.0), halfSize, radius), controlElevation(fragment + vec2(0.0, ratio), halfSize, radius) - controlElevation(fragment - vec2(0.0, ratio), halfSize, radius)) * 0.5;
  vec3 normal = normalize(vec3(-slope, 1.0));
  vec3 view = vec3(0.0, 0.0, 1.0);
  vec3 light = normalize(vec3(-0.58, -0.72, 0.5));
  float nDotV = sat(dot(normal, view));
  float f0 = pow((1.52 - 1.0003) / (1.52 + 1.0003), 2.0);
  float fresnel = fresnelSchlick(nDotV, f0);
  float path = (3.4 + 11.0 * roll) / max(nDotV, 0.2);
  vec3 transmission = exp(-vec3(0.028, 0.027, 0.025) * path);
  vec3 transmittedRay = refract(-view, normal, 1.0003 / 1.52);
  vec2 refractedUv = fragment / uResolution + transmittedRay.xy * path * ratio / uResolution;
  float dome = max(1.0 - length((refractedUv - vec2(0.36, -0.15)) * vec2(0.9, 1.25)), 0.0);
  vec3 body = (vec3(0.025, 0.059, 0.071) + vec3(0.08, 0.12, 0.13) * dome * 0.4) * transmission;
  body *= 1.0 - smoothstep(0.4, 1.0, refractedUv.y) * 0.32;
  vec3 glass = body * (1.0 - fresnel) + controlEnvironment(reflect(-view, normal), fragment) * fresnel;
  glass += vec3(0.98, 0.995, 1.0) * ggx(0.19, sat(dot(normal, light)), nDotV, sat(dot(normal, normalize(light + view)))) * 0.28;
  float innerBounce = exp(-pow((depth - wallWidth() * 0.79) / max(wallWidth() * 0.26, 1.0), 2.0));
  float outerGlint = exp(-pow((depth - 1.1) / 0.7, 2.0));
  float facingLight = sat(dot(normal, light) * 0.65 + 0.35);
  glass += vec3(0.54, 0.58, 0.60) * innerBounce * 0.22;
  glass += vec3(0.86, 0.89, 0.90) * outerGlint * (0.14 + facingLight * 0.41);
  glass += vec3(0.54, 0.58, 0.60) * roll * 0.06;
  // A clear front sheet: DOM backgrounds remain visible; thick walls absorb more.
  float alpha = mask * clamp(mix(0.16, 0.10, uPanel) + fresnel * 0.58 + roll * 0.12 + innerBounce * 0.07, 0.0, 0.88);
  vec3 rgb = pow(max(glass, vec3(0.0)), vec3(0.92));
  outColor = vec4(min(rgb, vec3(1.0)) * alpha, alpha);
}
`;

class MaterialError extends Error {
  constructor(reason, detail) { super(detail); this.reason = reason; }
}

function makeProgram(gl, fragmentSource, label, names) {
  const shaders = [];
  let program = null;
  let quad = null;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      if (!shader) throw new MaterialError(`${label}-shader-allocation`, "Unable to allocate optical shader");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new MaterialError(`${label}-shader-compile`, gl.getShaderInfoLog(shader) || "Optical shader compilation failed");
    }
    program = gl.createProgram();
    if (!program) throw new MaterialError(`${label}-program-allocation`, "Unable to allocate optical program");
    shaders.forEach(shader => gl.attachShader(program, shader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new MaterialError(`${label}-program-link`, gl.getProgramInfoLog(program) || "Optical program linking failed");
    quad = gl.createBuffer();
    if (!quad) throw new MaterialError(`${label}-buffer-allocation`, "Unable to allocate optical quad");
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(names.map(name => {
      const location = gl.getUniformLocation(program, name);
      if (location === null) throw new MaterialError(`${label}-uniform-missing`, `Missing optical uniform ${name}`);
      return [name, location];
    }));
    return { program, quad, uniforms };
  } catch (error) {
    if (quad) gl.deleteBuffer(quad);
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    shaders.forEach(shader => gl.deleteShader(shader));
  }
}

function releaseProgram(gl, resources) {
  if (!resources) return;
  gl.deleteBuffer(resources.quad);
  gl.deleteProgram(resources.program);
}

function opticalContext(canvas) {
  return canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "low-power" });
}

function renderSize(width, height, density, maxPixels) {
  const ratio = Math.min(density, Math.sqrt(maxPixels / Math.max(1, width * height)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)), ratio };
}

/** 初始化不接收业务数据。update 重扫材质目标；destroy 恢复原 DOM 状态。 */
export function initUsageMaterial({ backgroundCanvas, queryScope, reducedMotion = false, glassSelector = ".glass-panel, .pill" } = {}) {
  if (!backgroundCanvas || typeof backgroundCanvas.getContext !== "function") throw new TypeError("Usage material requires a background canvas");
  const existing = INSTANCES.get(backgroundCanvas);
  if (existing) { existing.update({ reducedMotion }); return existing; }
  const doc = backgroundCanvas.ownerDocument;
  const win = doc.defaultView;
  const scope = queryScope || doc;
  const stateRoot = doc.documentElement;
  const motionQuery = win.matchMedia("(prefers-reduced-motion: reduce)");
  const sharedCanvas = doc.createElement("canvas");
  const surfaces = new Map();
  const previousClasses = new Map(STATE_CLASSES.map(name => [name, stateRoot.classList.contains(name)]));
  const previousReason = stateRoot.getAttribute("data-usage-material-reason");
  const previousPointerEvents = backgroundCanvas.style.pointerEvents;
  const previousAriaHidden = backgroundCanvas.getAttribute("aria-hidden");
  let waterGl = null, glassGl = null, waterProgram = null, glassProgram = null;
  let waterReason = "", glassReason = "";
  let waterLost = false, glassLost = false, disposed = false, pagePaused = false;
  let localReduced = Boolean(reducedMotion), dirty = true, frame = null, lastDraw = null, elapsed = 0;

  backgroundCanvas.style.pointerEvents = "none";
  backgroundCanvas.setAttribute("aria-hidden", "true");

  const isReduced = () => localReduced || motionQuery.matches;
  const isPaused = () => doc.hidden || pagePaused;
  const status = () => ({ mode: disposed ? "destroyed" : waterProgram && !waterLost ? "webgl" : "css", glass: glassProgram && !glassLost ? "webgl" : "css", reducedMotion: isReduced(), paused: isPaused(), reason: waterReason || glassReason });
  function publishState() {
    const current = status();
    stateRoot.classList.toggle("usage-material-ready", current.mode === "webgl");
    stateRoot.classList.toggle("usage-material-fallback", current.mode !== "webgl");
    stateRoot.classList.toggle("usage-material-glass-fallback", current.glass !== "webgl");
    stateRoot.classList.toggle("usage-material-static", current.reducedMotion);
    stateRoot.classList.toggle("usage-material-paused", current.paused);
    if (current.reason) stateRoot.setAttribute("data-usage-material-reason", current.reason);
    else stateRoot.removeAttribute("data-usage-material-reason");
  }
  function reportFailure(error, layer) {
    const reason = error instanceof MaterialError ? error.reason : `${layer}-context-create`;
    if (layer === "water") waterReason = reason;
    else glassReason = reason;
    console.warn(`[QuoDex usage material: ${reason}]`, error);
  }
  function buildWater() {
    try {
      waterGl = opticalContext(backgroundCanvas);
      if (!waterGl) throw new MaterialError("water-webgl2-unavailable", "WebGL2 unavailable; CSS water remains active");
      waterProgram = makeProgram(waterGl, WATER_SHADER, "water", ["uResolution", "uTime"]);
      waterReason = "";
    } catch (error) { waterProgram = null; reportFailure(error, "water"); }
  }
  function buildGlass() {
    try {
      glassGl = opticalContext(sharedCanvas);
      if (!glassGl) throw new MaterialError("glass-webgl2-unavailable", "WebGL2 unavailable; CSS glass remains active");
      glassProgram = makeProgram(glassGl, GLASS_SHADER, "glass", ["uResolution", "uPixelRatio", "uRadius", "uPanel"]);
      glassReason = "";
    } catch (error) { glassProgram = null; reportFailure(error, "glass"); }
  }
  function removeSurface(element, record) {
    resizeObserver?.unobserve(element);
    record.canvas?.remove();
    if (record.previousAttribute === null) element.removeAttribute("data-usage-glass");
    else element.setAttribute("data-usage-glass", record.previousAttribute);
    surfaces.delete(element);
  }
  function scanSurfaces() {
    const elements = [...scope.querySelectorAll(glassSelector)];
    const current = new Set(elements);
    for (const [element, record] of surfaces) if (!current.has(element)) removeSurface(element, record);
    elements.forEach((element, index) => {
      let record = surfaces.get(element);
      if (!record) {
        record = { canvas: null, context: null, key: "", previousAttribute: element.getAttribute("data-usage-glass") };
        surfaces.set(element, record);
        resizeObserver?.observe(element);
      }
      const supported = index < MAX_GLASS_SURFACES && glassProgram && !glassLost;
      if (!supported) {
        record.canvas?.remove();
        record.canvas = null;
        record.context = null;
        record.key = "";
        element.setAttribute("data-usage-glass", "css");
        return;
      }
      if (!record.canvas || record.canvas.parentNode !== element) {
        const canvas = doc.createElement("canvas");
        canvas.className = "usage-glass-canvas";
        canvas.setAttribute("aria-hidden", "true");
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "none";
        const context = canvas.getContext("2d", { alpha: true });
        if (!context) { element.setAttribute("data-usage-glass", "css"); return; }
        record.canvas = canvas;
        record.context = context;
        record.key = "";
        element.prepend(canvas);
      }
      element.setAttribute("data-usage-glass", "webgl");
    });
  }
  function drawGlassSurfaces() {
    if (!glassProgram || glassLost) return;
    const gl = glassGl, { program, uniforms } = glassProgram;
    for (const [element, record] of surfaces) {
      if (!record.canvas) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const style = win.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const size = renderSize(rect.width, rect.height, Math.min(win.devicePixelRatio || 1, MAX_DPR), MAX_GLASS_PIXELS);
      const isPanel = element.classList.contains("glass-panel");
      const radius = Math.min(parseFloat(style.borderTopLeftRadius) || (isPanel ? 28 : rect.height / 2), rect.width / 2, rect.height / 2);
      const key = `${size.width}:${size.height}:${radius}:${isPanel}`;
      if (record.key === key) continue;
      sharedCanvas.width = size.width;
      sharedCanvas.height = size.height;
      gl.viewport(0, 0, size.width, size.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uniforms.uResolution, size.width, size.height);
      gl.uniform1f(uniforms.uPixelRatio, size.ratio);
      gl.uniform1f(uniforms.uRadius, radius);
      gl.uniform1f(uniforms.uPanel, isPanel ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      record.canvas.width = size.width;
      record.canvas.height = size.height;
      record.context.clearRect(0, 0, size.width, size.height);
      record.context.drawImage(sharedCanvas, 0, 0);
      record.key = key;
    }
  }
  function drawWater() {
    if (!waterProgram || waterLost) return;
    const rect = backgroundCanvas.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;
    const size = renderSize(rect.width, rect.height, Math.min(win.devicePixelRatio || 1, MAX_DPR) * 0.58, MAX_WATER_PIXELS);
    if (backgroundCanvas.width !== size.width || backgroundCanvas.height !== size.height) {
      backgroundCanvas.width = size.width;
      backgroundCanvas.height = size.height;
    }
    const gl = waterGl, { program, uniforms } = waterProgram;
    gl.viewport(0, 0, size.width, size.height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uResolution, size.width, size.height);
    gl.uniform1f(uniforms.uTime, isReduced() ? 0 : elapsed / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function cancelFrame() {
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    lastDraw = null;
  }
  function draw(time) {
    frame = null;
    if (disposed || isPaused()) return;
    const due = lastDraw === null || time - lastDraw >= 1000 / MAX_FPS;
    if (due) {
      if (!isReduced() && lastDraw !== null) elapsed += Math.min(time - lastDraw, 100);
      lastDraw = time;
      if (dirty) { scanSurfaces(); drawGlassSurfaces(); dirty = false; }
      drawWater();
    }
    if (waterProgram && !waterLost && !isReduced()) frame = win.requestAnimationFrame(draw);
  }
  function schedule() {
    if (!disposed && !isPaused() && frame === null) frame = win.requestAnimationFrame(draw);
  }
  function invalidate() { dirty = true; schedule(); }
  function pauseChanged() {
    cancelFrame();
    publishState();
    if (!isPaused()) invalidate();
  }
  function motionChanged() { cancelFrame(); publishState(); invalidate(); }
  function lost(event, layer) {
    event.preventDefault();
    if (layer === "water") { waterLost = true; waterReason = "water-context-lost"; }
    else { glassLost = true; glassReason = "glass-context-lost"; }
    cancelFrame();
    invalidate();
    publishState();
  }
  function restored(layer) {
    if (disposed) return;
    if (layer === "water") {
      waterLost = false;
      buildWater();
      if (waterProgram && !glassProgram && !glassLost) buildGlass();
    }
    else { glassLost = false; buildGlass(); for (const record of surfaces.values()) record.key = ""; }
    publishState();
    invalidate();
  }
  const onWaterLost = event => lost(event, "water");
  const onGlassLost = event => lost(event, "glass");
  const onWaterRestored = () => restored("water");
  const onGlassRestored = () => restored("glass");
  const onPageHide = event => { if (!event.persisted) controller.destroy(); else { pagePaused = true; pauseChanged(); } };
  const onPageShow = () => { pagePaused = false; pauseChanged(); };
  const resizeObserver = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(invalidate) : null;
  const mutationObserver = typeof win.MutationObserver === "function" ? new win.MutationObserver(records => {
    const external = records.some(record => {
      if (record.target === backgroundCanvas || record.target.classList?.contains("usage-glass-canvas")) return false;
      if (record.type === "attributes") return true;
      return [...record.addedNodes, ...record.removedNodes].some(node => !node.classList?.contains("usage-glass-canvas"));
    });
    if (external) invalidate();
  }) : null;
  const controller = {
    update(options = {}) {
      if (disposed) return;
      if (Object.prototype.hasOwnProperty.call(options, "reducedMotion")) localReduced = Boolean(options.reducedMotion);
      motionChanged();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelFrame();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      doc.removeEventListener("visibilitychange", pauseChanged);
      win.removeEventListener("resize", invalidate);
      win.removeEventListener("pagehide", onPageHide);
      win.removeEventListener("pageshow", onPageShow);
      motionQuery.removeEventListener("change", motionChanged);
      backgroundCanvas.removeEventListener("webglcontextlost", onWaterLost);
      backgroundCanvas.removeEventListener("webglcontextrestored", onWaterRestored);
      sharedCanvas.removeEventListener("webglcontextlost", onGlassLost);
      sharedCanvas.removeEventListener("webglcontextrestored", onGlassRestored);
      for (const [element, record] of [...surfaces]) removeSurface(element, record);
      if (waterGl && !waterLost) { releaseProgram(waterGl, waterProgram); waterGl.clearColor(0, 0, 0, 0); waterGl.clear(waterGl.COLOR_BUFFER_BIT); }
      if (glassGl && !glassLost) { releaseProgram(glassGl, glassProgram); glassGl.getExtension("WEBGL_lose_context")?.loseContext(); }
      backgroundCanvas.style.pointerEvents = previousPointerEvents;
      if (previousAriaHidden === null) backgroundCanvas.removeAttribute("aria-hidden");
      else backgroundCanvas.setAttribute("aria-hidden", previousAriaHidden);
      previousClasses.forEach((present, name) => stateRoot.classList.toggle(name, present));
      if (previousReason === null) stateRoot.removeAttribute("data-usage-material-reason");
      else stateRoot.setAttribute("data-usage-material-reason", previousReason);
      INSTANCES.delete(backgroundCanvas);
    },
    get status() { return status(); },
  };

  backgroundCanvas.addEventListener("webglcontextlost", onWaterLost);
  backgroundCanvas.addEventListener("webglcontextrestored", onWaterRestored);
  sharedCanvas.addEventListener("webglcontextlost", onGlassLost);
  sharedCanvas.addEventListener("webglcontextrestored", onGlassRestored);
  buildWater();
  if (waterProgram) buildGlass();
  else glassReason = "glass-css-after-water-fallback";
  resizeObserver?.observe(backgroundCanvas);
  mutationObserver?.observe(scope === doc ? doc.body : scope, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "disabled", "data-selected"] });
  doc.addEventListener("visibilitychange", pauseChanged);
  win.addEventListener("resize", invalidate);
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);
  motionQuery.addEventListener("change", motionChanged);
  INSTANCES.set(backgroundCanvas, controller);
  publishState();
  schedule();
  return controller;
}

// 独立同源 module 脚本可直接接入，不需要改动统计交互模块。
if (typeof document !== "undefined") {
  const start = () => {
    const canvas = document.getElementById("ocean-canvas");
    if (canvas) initUsageMaterial({ backgroundCanvas: canvas });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
