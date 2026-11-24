import { AMBIENT_BREEZE, FLUID_TAIL_EXTENSION } from "./fluidPhysics";

export const OPTICAL_SURFACE_NODE_COUNT = 56;

export interface OpticalFluidFrame {
  remainingPercent: number;
  surface: Float32Array;
  flowOffset: readonly [number, number];
  agitation: number;
  timeMs: number;
  active: boolean;
  ambientMotion: boolean;
  phaseOffset: number;
  flowScale: number;
}

export type FluidAccent = "cyan" | "mint" | "moonlight" | "emerald";

interface OpticalPalette {
  top: [number, number, number];
  middle: [number, number, number];
  deep: [number, number, number];
  absorption: [number, number, number];
  accent: [number, number, number];
}

const PALETTES: Record<FluidAccent, OpticalPalette> = {
  cyan: {
    top: [0.48, 0.94, 1.0],
    middle: [0.018, 0.52, 0.76],
    deep: [0.0, 0.23, 0.39],
    absorption: [1.7, 0.62, 0.25],
    accent: [0.38, 0.9, 1.0],
  },
  mint: {
    top: [0.54, 0.96, 0.85],
    middle: [0.016, 0.49, 0.41],
    deep: [0.0, 0.2, 0.18],
    absorption: [1.78, 0.54, 0.39],
    accent: [0.5, 0.98, 0.86],
  },
  moonlight: {
    top: [0.91, 0.98, 1.0],
    middle: [0.38, 0.58, 0.66],
    deep: [0.035, 0.17, 0.22],
    absorption: [0.48, 0.26, 0.18],
    accent: [0.78, 0.91, 0.95],
  },
  emerald: {
    top: [0.64, 1.0, 0.84],
    middle: [0.016, 0.56, 0.36],
    deep: [0.0, 0.19, 0.14],
    absorption: [1.82, 0.48, 0.86],
    accent: [0.4, 0.96, 0.69],
  },
};

const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

out vec4 outColor;

uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uRemaining;
uniform float uTime;
uniform float uActive;
uniform float uAmbientMotion;
uniform float uPhaseOffset;
uniform float uFlowScale;
uniform vec2 uFlowOffset;
uniform float uAgitation;
uniform float uSurface[${OPTICAL_SURFACE_NODE_COUNT}];
uniform vec3 uTop;
uniform vec3 uMiddle;
uniform vec3 uDeep;
uniform vec3 uAbsorption;
uniform vec3 uAccent;

const float NODE_LAST = ${OPTICAL_SURFACE_NODE_COUNT - 1}.0;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float hash11(float value) {
  return fract(sin(value * 127.1) * 43758.5453123);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash11(dot(cell, vec2(1.0, 57.0)));
  float b = hash11(dot(cell + vec2(1.0, 0.0), vec2(1.0, 57.0)));
  float c = hash11(dot(cell + vec2(0.0, 1.0), vec2(1.0, 57.0)));
  float d = hash11(dot(cell + vec2(1.0, 1.0), vec2(1.0, 57.0)));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fluidFbm(vec2 point) {
  float value = 0.0;
  float weight = 0.52;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  for (int octave = 0; octave < 5; octave += 1) {
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
  float top = fluidFbm(point + vec2(0.0, stepSize));
  float bottom = fluidFbm(point - vec2(0.0, stepSize));
  return vec2(top - bottom, left - right) / (2.0 * stepSize);
}

float roundedRectSdf(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

float sampleSurface(float normalizedX) {
  float scaled = saturate(normalizedX) * NODE_LAST;
  int lower = int(floor(scaled));
  int upper = min(lower + 1, ${OPTICAL_SURFACE_NODE_COUNT - 1});
  return mix(uSurface[lower], uSurface[upper], fract(scaled));
}

float freeSurfaceOffset(float normalizedX) {
  float x = saturate(normalizedX);
  float wallRise = -5.2 * (
    exp(-x * 18.0) + exp(-(1.0 - x) * 18.0)
  ) + 0.58;
  float ambientRipple = (
    sin(x * ${AMBIENT_BREEZE.primarySpatialFrequency.toFixed(1)}
      + uTime * uFlowScale * ${AMBIENT_BREEZE.primaryTemporalFrequency.toFixed(2)}
      + uPhaseOffset)
      * ${AMBIENT_BREEZE.primaryWeight.toFixed(2)}
    + sin(x * ${AMBIENT_BREEZE.secondarySpatialFrequency.toFixed(1)}
      - uTime * uFlowScale * ${AMBIENT_BREEZE.secondaryTemporalFrequency.toFixed(2)}
      - uPhaseOffset * 0.73)
      * ${AMBIENT_BREEZE.secondaryWeight.toFixed(2)}
  ) * mix(
    ${AMBIENT_BREEZE.idleStrength.toFixed(2)},
    ${AMBIENT_BREEZE.activeStrength.toFixed(2)},
    uActive
  ) * uAmbientMotion;
  return sampleSurface(x) + wallRise + ambientRipple;
}

vec3 chamberColor(vec2 uv) {
  float dome = saturate(1.0 - length((uv - vec2(0.5, -0.04)) * vec2(0.92, 1.35)));
  float sideFalloff = pow(abs(uv.x - 0.5) * 2.0, 1.8);
  float lowerShade = smoothstep(0.48, 1.0, uv.y);
  vec3 color = vec3(0.014, 0.052, 0.082);
  color += vec3(0.07, 0.14, 0.19) * dome * 0.7;
  color *= 1.0 - sideFalloff * 0.32;
  color *= 1.0 - lowerShade * 0.34;
  return color;
}

float fresnelSchlick(float cosine, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - saturate(cosine), 5.0);
}

void main() {
  vec2 fragment = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 uv = fragment / uResolution;
  float ratio = uPixelRatio;
  float extension = ${FLUID_TAIL_EXTENSION.toFixed(1)} * ratio;
  // Match the CSS chamber edge; a second inset would read as an unwanted inner frame.
  float inset = 0.0;
  float frameInset = -18.0 * ratio;
  float radius = 22.0 * ratio;
  vec2 center = uResolution * 0.5;
  vec2 halfSize = uResolution * 0.5 - vec2(frameInset);
  vec2 local = fragment - center;
  float sd = roundedRectSdf(local, halfSize, radius);

  if (sd > 0.0) {
    outColor = vec4(0.0);
    return;
  }

  float edgeDistance = -sd;
  float wallWidth = 16.0 * ratio;
  float rim = 1.0 - smoothstep(0.0, wallWidth, edgeDistance);
  float rimCore = pow(rim, 1.8);

  float gradientStep = max(0.75 * ratio, 1.0);
  vec2 gradient = vec2(
    roundedRectSdf(local + vec2(gradientStep, 0.0), halfSize, radius)
      - roundedRectSdf(local - vec2(gradientStep, 0.0), halfSize, radius),
    roundedRectSdf(local + vec2(0.0, gradientStep), halfSize, radius)
      - roundedRectSdf(local - vec2(0.0, gradientStep), halfSize, radius)
  );
  gradient = normalize(gradient + vec2(0.0001));

  float opticalDisplacement = rimCore * (9.0 + 5.0 * rim) * ratio;
  vec2 refractedUv = uv - gradient * opticalDisplacement / uResolution;
  vec2 dispersion = gradient * 1.35 * ratio / uResolution;
  vec3 refracted = vec3(
    chamberColor(refractedUv + dispersion).r,
    chamberColor(refractedUv).g,
    chamberColor(refractedUv - dispersion).b
  );

  float normalizedX = saturate((fragment.x - inset) / max(uResolution.x - inset * 2.0, 1.0));
  float chamberHeight = max(uResolution.y - extension - inset * 2.0, 1.0);
  float baseSurface = inset + chamberHeight * (1.0 - saturate(uRemaining / 100.0));
  float surfaceY = baseSurface + freeSurfaceOffset(normalizedX) * ratio;
  float surfaceStep = 0.009;
  float surfaceBefore = freeSurfaceOffset(normalizedX - surfaceStep);
  float surfaceAfter = freeSurfaceOffset(normalizedX + surfaceStep);
  float surfaceSlope = (surfaceAfter - surfaceBefore)
    / max(surfaceStep * 2.0 * (uResolution.x / ratio), 1.0);
  vec2 surfaceNormal = normalize(vec2(-surfaceSlope * 2.6, -1.0));
  float surfaceRefraction = surfaceNormal.x * mix(3.0, 7.5, uActive) * ratio;
  float liquidMask = smoothstep(surfaceY - 0.9 * ratio, surfaceY + 0.9 * ratio, fragment.y);
  float liquidDepthPx = max(uResolution.y - inset - surfaceY, 1.0);
  float depth = saturate((fragment.y - surfaceY) / liquidDepthPx);

  vec3 color = refracted;
  if (liquidMask > 0.001) {
    float horizontalVolume = sqrt(max(0.0, 1.0 - pow((normalizedX - 0.5) * 2.0, 2.0)));
    float opticalDepth = depth * mix(1.08, 0.58, horizontalVolume);
    vec3 transmission = exp(-uAbsorption * opticalDepth);
    vec2 liquidUv = vec2(
      saturate((fragment.x + surfaceRefraction - inset) / max(uResolution.x - inset * 2.0, 1.0)),
      uv.y
    );
    vec3 refractedBackdrop = chamberColor(liquidUv);
    vec3 waterTint = mix(uTop, uMiddle, smoothstep(0.02, 0.3, depth));
    waterTint = mix(waterTint, uDeep, smoothstep(0.48, 1.0, depth));
    vec3 transmittedLight = refractedBackdrop * transmission * (0.74 + horizontalVolume * 0.3);
    vec3 scatteredLight = waterTint * (0.44 + (vec3(1.0) - transmission) * 0.72);
    vec3 body = transmittedLight + scatteredLight;
    body *= mix(vec3(0.58), vec3(1.08), horizontalVolume);

    float flowTime = uTime * mix(0.16, 0.42, uActive) * uFlowScale
      + uPhaseOffset * 0.24;
    vec2 chamberDomainOffset = vec2(cos(uPhaseOffset), sin(uPhaseOffset)) * 1.7;
    vec2 flowDomain = vec2(normalizedX * 4.8, depth * 4.1) + chamberDomainOffset;
    vec2 transportedFlow = uFlowOffset * vec2(1.2, -0.9);
    vec2 velocityDomain = flowDomain * 0.74
      + vec2(flowTime * 0.13, -flowTime * 0.07)
      - transportedFlow * 0.42;
    vec2 curlVelocity = clamp(curlField(velocityDomain), vec2(-1.5), vec2(1.5));
    float vorticity = saturate(length(curlVelocity) / 1.45);
    vec2 advectedDomain = flowDomain
      - curlVelocity * mix(0.38, 0.68, max(uActive, uAgitation))
      - transportedFlow
      + vec2(-flowTime * 0.1, flowTime * 0.03);

    float density = fluidFbm(advectedDomain);
    float densityStep = 0.055;
    float densityX = fluidFbm(advectedDomain + vec2(densityStep, 0.0));
    float densityY = fluidFbm(advectedDomain + vec2(0.0, densityStep));
    vec2 densityGradient = vec2(densityX - density, densityY - density) / densityStep;
    vec3 densityNormal = normalize(vec3(-densityGradient * 0.72, 0.34));
    vec3 volumeLight = normalize(vec3(-0.58, -0.7, 0.62));
    float volumeShading = saturate(dot(densityNormal, volumeLight) * 0.5 + 0.72);
    float textureWeight = mix(0.18, 0.72, smoothstep(0.08, 0.94, depth));
    body *= mix(0.94, 1.065, volumeShading) * (1.0 + (density - 0.5) * 0.11 * textureWeight);
    body += uAccent * (density - 0.48) * 0.055 * textureWeight;
    body += uAccent * vorticity * 0.018 * textureWeight;

    float bottomFocus = pow(smoothstep(0.62, 1.0, depth), 2.2);
    float causticDensity = fluidFbm(
      advectedDomain * 1.42 + curlVelocity * 0.38 + vec2(flowTime * 0.09, -flowTime * 0.06)
    );
    float softCaustic = smoothstep(0.59, 0.82, causticDensity);
    float shallowBoost = mix(1.7, 1.0, smoothstep(18.0, 62.0, uRemaining));
    body += uAccent * softCaustic * bottomFocus * 0.12 * shallowBoost;

    float surfaceHaze = exp(-depth / 0.2) * mix(0.72, 1.0, density);
    body += mix(uAccent, vec3(0.92, 1.0, 1.0), 0.5) * surfaceHaze * 0.055;
    float volumeGlow = exp(-pow((normalizedX - 0.52) * 2.1, 2.0))
      * exp(-pow((depth - 0.3) * 2.0, 2.0));
    body += uAccent * volumeGlow * 0.08;
    body += uAccent * mix(0.11, 0.035, depth) * horizontalVolume;

    float lowLevelBoost = 1.0 + (1.0 - smoothstep(8.0, 55.0, uRemaining)) * 0.22;
    body *= lowLevelBoost;
    float bottomLens = exp(-pow((1.0 - depth) / 0.085, 2.0));
    body += uAccent * bottomLens * (0.16 + 0.14 * horizontalVolume);

    float aspect = uResolution.x / uResolution.y;
    for (int bubbleIndex = 0; bubbleIndex < 10; bubbleIndex += 1) {
      float seed = float(bubbleIndex) + uPhaseOffset * 2.37;
      float bubbleX = 0.09 + hash11(seed * 2.13) * 0.82;
      float bubbleSpeed = 0.014 + hash11(seed * 4.7) * 0.018;
      float bubbleY = fract(
        hash11(seed * 8.31)
          + uTime * bubbleSpeed * mix(0.62, 1.0, uActive) * uFlowScale
          + uPhaseOffset * 0.07
      );
      float bubbleRadius = mix(0.0035, 0.0075, hash11(seed * 5.91));
      vec2 delta = vec2((normalizedX - bubbleX) * aspect, depth - bubbleY);
      float bubbleDistance = length(delta);
      float ring = smoothstep(bubbleRadius, bubbleRadius * 0.66, bubbleDistance)
        * smoothstep(bubbleRadius * 0.32, bubbleRadius * 0.7, bubbleDistance);
      body += vec3(0.74, 0.98, 1.0) * ring * 0.42;
    }

    color = mix(color, body, liquidMask);

    float surfaceDistance = abs(fragment.y - surfaceY) / ratio;
    float meniscus = exp(-surfaceDistance * 0.82);
    float surfaceLens = exp(-pow((fragment.y - surfaceY - 2.7 * ratio) / (3.8 * ratio), 2.0));
    float underside = exp(-pow((fragment.y - surfaceY - 6.0 * ratio) / (4.6 * ratio), 2.0));
    float surfaceFresnel = fresnelSchlick(abs(surfaceNormal.y), 0.021);
    color += mix(uAccent, vec3(0.94, 1.0, 1.0), 0.72) * meniscus * 0.92;
    color += uAccent * surfaceLens * (0.16 + surfaceFresnel * 1.4);
    color -= vec3(0.0, 0.055, 0.075) * underside * 0.58;
    float travelingGlint = pow(
      0.5 + 0.5 * sin(normalizedX * 32.0 - uTime * 1.8 * uFlowScale + uPhaseOffset),
      9.0
    );
    float glintBand = exp(-pow((fragment.y - surfaceY - 6.0 * ratio) / (7.0 * ratio), 2.0));
    color += vec3(0.72, 1.0, 0.96) * travelingGlint * glintBand * 0.13;
  }

  vec3 normal = normalize(vec3(-gradient * mix(0.2, 1.3, rim), 1.0 - rim * 0.92));
  vec3 viewDirection = vec3(0.0, 0.0, 1.0);
  vec3 lightDirection = normalize(vec3(-0.62, -0.72, 0.62));
  float f0 = 0.043;
  float fresnel = fresnelSchlick(dot(normal, viewDirection), f0);
  float specular = pow(max(dot(normal, lightDirection), 0.0), 22.0);
  float reflectedArc = pow(abs(dot(gradient, normalize(vec2(-0.62, -0.78)))), 5.0);

  color = mix(color, vec3(0.58, 0.86, 0.98), fresnel * rimCore * 0.7);
  color += vec3(0.92, 0.99, 1.0) * specular * rimCore * 1.4;
  color += uAccent * reflectedArc * rimCore * 0.26;

  float innerBand = smoothstep(wallWidth * 0.68, wallWidth * 0.82, edgeDistance)
    * (1.0 - smoothstep(wallWidth * 0.82, wallWidth, edgeDistance));
  color += vec3(0.72, 0.94, 1.0) * innerBand * 0.24;

  float frontLens = smoothstep(0.72, 1.0, uv.y)
    * (1.0 - smoothstep(0.0, 0.12, abs(uv.x - 0.5)) * 0.08);
  color += uAccent * frontLens * 0.045;

  float edgeAlpha = 1.0 - smoothstep(-1.4 * ratio, 0.0, sd);
  outColor = vec4(pow(max(color, vec3(0.0)), vec3(0.92)), edgeAlpha);
}`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create optical shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) ?? "Unknown shader compilation error";
    gl.deleteShader(shader);
    throw new Error(detail);
  }
  return shader;
}

function requireUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) throw new Error(`Optical uniform not found: ${name}`);
  return location;
}

export class OpticalFluidRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexShader: WebGLShader;
  private readonly fragmentShader: WebGLShader;
  private readonly quad: WebGLBuffer;
  private readonly uniforms: Record<string, WebGLUniformLocation>;
  private readonly palette: OpticalPalette;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    accent: FluidAccent,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    this.palette = PALETTES[accent];

    this.vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    this.fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to create optical program");
    this.program = program;
    gl.attachShader(program, this.vertexShader);
    gl.attachShader(program, this.fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Unable to link optical program");
    }

    const quad = gl.createBuffer();
    if (!quad) throw new Error("Unable to create optical quad");
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      resolution: requireUniform(gl, program, "uResolution"),
      pixelRatio: requireUniform(gl, program, "uPixelRatio"),
      remaining: requireUniform(gl, program, "uRemaining"),
      time: requireUniform(gl, program, "uTime"),
      active: requireUniform(gl, program, "uActive"),
      ambientMotion: requireUniform(gl, program, "uAmbientMotion"),
      phaseOffset: requireUniform(gl, program, "uPhaseOffset"),
      flowScale: requireUniform(gl, program, "uFlowScale"),
      flowOffset: requireUniform(gl, program, "uFlowOffset"),
      agitation: requireUniform(gl, program, "uAgitation"),
      surface: requireUniform(gl, program, "uSurface[0]"),
      top: requireUniform(gl, program, "uTop"),
      middle: requireUniform(gl, program, "uMiddle"),
      deep: requireUniform(gl, program, "uDeep"),
      absorption: requireUniform(gl, program, "uAbsorption"),
      accent: requireUniform(gl, program, "uAccent"),
    };
  }

  render(frame: OpticalFluidFrame): void {
    const logicalWidth = this.canvas.clientWidth;
    const logicalHeight = this.canvas.clientHeight;
    if (logicalWidth <= 0 || logicalHeight <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(logicalWidth * ratio));
    const height = Math.max(1, Math.round(logicalHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const { gl, program, uniforms, palette } = this;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, width, height);
    gl.uniform1f(uniforms.pixelRatio, ratio);
    gl.uniform1f(uniforms.remaining, frame.remainingPercent);
    gl.uniform1f(uniforms.time, frame.timeMs / 1_000);
    gl.uniform1f(uniforms.active, frame.active ? 1 : 0);
    gl.uniform1f(uniforms.ambientMotion, frame.ambientMotion ? 1 : 0);
    gl.uniform1f(uniforms.phaseOffset, frame.phaseOffset);
    gl.uniform1f(uniforms.flowScale, frame.flowScale);
    gl.uniform2f(uniforms.flowOffset, frame.flowOffset[0], frame.flowOffset[1]);
    gl.uniform1f(uniforms.agitation, frame.agitation);
    gl.uniform1fv(uniforms.surface, frame.surface);
    gl.uniform3fv(uniforms.top, palette.top);
    gl.uniform3fv(uniforms.middle, palette.middle);
    gl.uniform3fv(uniforms.deep, palette.deep);
    gl.uniform3fv(uniforms.absorption, palette.absorption);
    gl.uniform3fv(uniforms.accent, palette.accent);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy(): void {
    const { gl } = this;
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.program);
    gl.deleteShader(this.vertexShader);
    gl.deleteShader(this.fragmentShader);
  }
}
