import { useEffect, useRef } from "react";

interface OpticalShellProps {
  dragging: boolean;
  reducedMotion: boolean;
  opacity: number;
  controlSurface?: boolean;
}

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
uniform float uTime;
uniform float uMotion;
uniform float uOpacity;
uniform float uControlSurface;

const float AIR_IOR = 1.0003;
const float GLASS_IOR = 1.52;
const float PI = 3.141592653589793;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float linearStep(float edge0, float edge1, float value) {
  return clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
}

float pow5(float value) {
  float squared = value * value;
  return squared * squared * value;
}

float roundedRectSdf(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

float fresnelSchlick(float cosine, float f0) {
  return f0 + (1.0 - f0) * pow5(1.0 - saturate(cosine));
}

float ggx(float roughness, float nDotL, float nDotV, float nDotH) {
  if (nDotL <= 0.0) return 0.0;
  float alpha2 = roughness * roughness;
  float denominator = PI * pow(nDotH * nDotH * (alpha2 - 1.0) + 1.0, 2.0);
  float distribution = alpha2 / max(denominator, 0.0001);
  float k = roughness * 0.5;
  float visibility = 1.0 / max(
    (nDotL * (1.0 - k) + k) * (nDotV * (1.0 - k) + k),
    0.0001
  );
  return nDotL * distribution * visibility;
}

vec3 spectralRim(float angle, float rim, float phase) {
  float red = pow(saturate(angle + 0.16 + phase), 4.0);
  float green = pow(saturate(angle + 0.02), 4.0);
  float blue = pow(saturate(angle - 0.13 - phase), 4.0);
  return vec3(red, green, blue) * rim;
}

// The crown and the rolled wall form one height field. Both the front sheet
// and the wall therefore reflect the same studio lights through their normals.
float controlElevation(vec2 point, vec2 halfSize, float radius) {
  float depth = max(-roundedRectSdf(point - uResolution * 0.5, halfSize, radius) / uPixelRatio, 0.0);
  float roll = sin(PI * saturate(depth / 20.0));
  vec2 plane = point / uResolution * 2.0 - 1.0;
  float crown = max(1.0 - plane.x * plane.x, 0.0)
    * max(1.0 - plane.y * plane.y, 0.0);
  return 7.8 * roll * roll
    + 12.0 * crown * smoothstep(4.0, 20.0, depth);
}

vec3 controlEnvironment(vec3 ray, vec2 point) {
  vec2 size = uResolution / uPixelRatio;
  // A finite overhead softbox: intersect the reflected ray with its light plane.
  // Its footprint bends across the crown and wall instead of lighting a full rim.
  vec2 hit = point / uPixelRatio + ray.xy * (64.0 / max(ray.z, 0.16));
  float softbox = exp(-pow((hit.x - size.x * 0.22) / (size.x * 0.24), 4.0)
    - pow((hit.y + 36.0) / 78.0, 4.0)) * smoothstep(0.08, 0.25, ray.z);
  float wallSoftbox = exp(-pow((ray.x + 0.34) / 0.48, 4.0)
    - pow((ray.y + 0.62) / 0.26, 4.0))
    * exp(-pow((point.x / uResolution.x - 0.17) / 0.30, 2.0));
  float cyanWall = exp(-pow((ray.x + 0.8) / 0.42, 2.0)
    - pow((ray.y + 0.05) / 0.8, 2.0));
  float greenWall = exp(-pow((ray.x - 0.76) / 0.38, 2.0)
    - pow((ray.y - 0.22) / 0.7, 2.0));
  return vec3(0.045, 0.12, 0.18)
    + vec3(0.86, 0.97, 1.0) * (softbox * 13.5 + wallSoftbox * 7.0)
    + vec3(0.06, 0.64, 0.87) * cyanWall * 1.7
    + vec3(0.035, 0.68, 0.47) * greenWall * 2.0;
}

vec4 controlGlass(vec2 fragment) {
  float ratio = uPixelRatio;
  vec2 halfSize = uResolution * 0.5 - vec2(0.75 * ratio);
  float radius = 34.0 * ratio;
  float sd = roundedRectSdf(fragment - uResolution * 0.5, halfSize, radius);
  float mask = 1.0 - smoothstep(-max(1.0, ratio), 0.0, sd);
  if (mask <= 0.0) return vec4(0.0);

  float depth = max(-sd / ratio, 0.0);
  float roll = max(sin(PI * saturate(depth / 20.0)), 0.0);
  vec2 slope = vec2(
    controlElevation(fragment + vec2(ratio, 0.0), halfSize, radius)
      - controlElevation(fragment - vec2(ratio, 0.0), halfSize, radius),
    controlElevation(fragment + vec2(0.0, ratio), halfSize, radius)
      - controlElevation(fragment - vec2(0.0, ratio), halfSize, radius)
  ) * 0.5;
  vec3 normal = normalize(vec3(-slope, 1.0));
  vec3 view = vec3(0.0, 0.0, 1.0);
  float drift = sin(uTime * 0.24) * 0.035 + uMotion * 0.08;
  vec3 light = normalize(vec3(-0.58 + drift, -0.72, 0.5));
  vec3 halfway = normalize(light + view);
  float nDotV = saturate(dot(normal, view));
  float f0 = pow((GLASS_IOR - AIR_IOR) / (GLASS_IOR + AIR_IOR), 2.0);
  float fresnel = fresnelSchlick(nDotV, f0);

  // Beer-Lambert attenuation depends on wall thickness and the viewing angle.
  float path = (3.4 + 11.0 * roll) / max(nDotV, 0.2);
  vec3 transmission = exp(-vec3(0.052, 0.019, 0.008) * path);
  vec3 transmittedRay = refract(-view, normal, AIR_IOR / GLASS_IOR);
  vec2 refractedUv = fragment / uResolution
    + transmittedRay.xy * path * ratio / uResolution;
  float dome = max(1.0 - length((refractedUv - vec2(0.36, -0.15)) * vec2(0.9, 1.25)), 0.0);
  float lowerDepth = smoothstep(0.4, 1.0, refractedUv.y);
  vec3 body = vec3(0.014, 0.052, 0.082)
    + vec3(0.055, 0.13, 0.18) * dome * 0.5;
  body *= transmission * (1.0 - lowerDepth * 0.32);

  vec3 reflectedRay = reflect(-view, normal);
  vec3 reflection = controlEnvironment(reflectedRay, fragment);
  float specular = ggx(0.19, saturate(dot(normal, light)), nDotV,
    saturate(dot(normal, halfway)));
  vec3 glass = body * (1.0 - fresnel) + reflection * fresnel;
  glass += vec3(0.9, 0.985, 1.0) * specular * 0.28;

  float innerBounce = exp(-pow((depth - 15.8) / 5.2, 2.0));
  float outerGlint = exp(-pow((depth - 1.1) / 0.7, 2.0));
  float side = smoothstep(0.36, 0.88, fragment.x / uResolution.x);
  vec3 wallTint = mix(vec3(0.055, 0.56, 0.78), vec3(0.025, 0.68, 0.43), side);
  glass += wallTint * innerBounce * 0.60;
  glass += vec3(0.65, 0.9, 0.99) * outerGlint * 0.55;
  glass += wallTint * roll * 0.10;

  float alpha = mask * clamp(0.84 + fresnel * 0.14 + roll * 0.06, 0.0, 0.98)
    * mix(0.9, 1.0, uOpacity);
  vec3 rgb = pow(max(glass, vec3(0.0)), vec3(0.92));
  // This WebGL context uses premultiplied alpha.
  return vec4(min(rgb, vec3(1.0)) * alpha, alpha);
}

void main() {
  vec2 fragment = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  if (uControlSurface > 0.5) {
    outColor = controlGlass(fragment);
    return;
  }
  vec2 center = uResolution * 0.5;
  vec2 local = fragment - center;
  float ratio = uPixelRatio;
  float logicalHeight = uResolution.y / ratio;
  float radius = (logicalHeight < 100.0 ? 28.0 : 34.0) * ratio;
  vec2 halfSize = uResolution * 0.5 - vec2(0.75 * ratio);
  float sd = roundedRectSdf(local, halfSize, radius);
  float antialias = max(1.0, ratio);
  float mask = 1.0 - smoothstep(-antialias, 0.0, sd);
  if (mask <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  vec2 uv = fragment / uResolution;
  float edgeWidth = (logicalHeight < 100.0 ? 13.0 : 18.0) * ratio;
  float rim = pow(linearStep(-edgeWidth, 0.0, sd), 3.4);
  float wall = linearStep(-edgeWidth, -1.0 * ratio, sd);
  float wallCore = pow(wall, 1.45);

  float gradientStep = max(0.8 * ratio, 1.0);
  vec2 gradient = vec2(
    roundedRectSdf(local + vec2(gradientStep, 0.0), halfSize, radius)
      - roundedRectSdf(local - vec2(gradientStep, 0.0), halfSize, radius),
    roundedRectSdf(local + vec2(0.0, gradientStep), halfSize, radius)
      - roundedRectSdf(local - vec2(0.0, gradientStep), halfSize, radius)
  );
  vec2 edgeNormal = normalize(gradient + vec2(0.0001));
  vec3 normal = normalize(vec3(edgeNormal * mix(0.05, 1.42, rim), -1.0 + rim * 0.86));

  float topDome = exp(-pow((uv.x - 0.5) * 1.5, 2.0))
    * exp(-pow((uv.y + 0.02) * 3.1, 2.0));
  float sideDepth = pow(abs(uv.x - 0.5) * 2.0, 1.7);
  float bottomDepth = smoothstep(0.6, 1.0, uv.y);
  vec3 base = vec3(0.006, 0.026, 0.043);
  base += vec3(0.055, 0.13, 0.18) * topDome;
  base *= 1.0 - sideDepth * 0.18;
  base *= 1.0 - bottomDepth * 0.22;

  float opticalDepth = wallCore * (1.0 - rim * 0.34);
  vec3 absorption = exp(-vec3(0.52, 0.19, 0.08) * opticalDepth);
  vec3 glass = base * absorption;
  glass += vec3(0.025, 0.085, 0.12) * wallCore;

  vec3 view = vec3(0.0, 0.0, -1.0);
  float lightDrift = sin(uTime * 0.24) * 0.09 + uMotion * 0.16;
  vec3 light = normalize(vec3(-0.58 + lightDrift, -0.72, -0.5));
  vec3 halfVector = normalize(light + view);
  float nDotV = saturate(dot(normal, view));
  float nDotL = saturate(dot(normal, light));
  float nDotH = saturate(dot(normal, halfVector));
  float f0 = pow((GLASS_IOR - AIR_IOR) / (GLASS_IOR + AIR_IOR), 2.0);
  float fresnel = fresnelSchlick(nDotV, f0);
  float specular = ggx(0.22, nDotL, nDotV, nDotH);

  float lightAngle = dot(edgeNormal, normalize(vec2(-0.62 + lightDrift, -0.78)));
  float spectralPhase = sin(uTime * 0.19) * 0.025 + uMotion * 0.035;
  vec3 dispersion = spectralRim(abs(lightAngle), pow(rim, 1.55), spectralPhase);
  dispersion += spectralRim(abs(-lightAngle), pow(rim, 2.2), -spectralPhase).bgr * 0.38;

  glass = mix(glass, vec3(0.44, 0.75, 0.91), fresnel * rim * 0.7);
  glass += vec3(0.92, 0.985, 1.0) * specular * rim * 0.9;
  glass += dispersion * vec3(0.22, 0.35, 0.46);

  float outerLine = exp(-pow((sd + 0.9 * ratio) / (0.72 * ratio), 2.0));
  float innerLine = exp(-pow((sd + edgeWidth * 0.84) / (0.92 * ratio), 2.0));
  float internalBounce = exp(-pow((sd + edgeWidth * 0.48) / (2.8 * ratio), 2.0));
  glass += vec3(0.7, 0.92, 1.0) * outerLine * 0.54;
  glass += vec3(0.54, 0.88, 1.0) * innerLine * 0.42;
  glass += vec3(0.05, 0.26, 0.38) * internalBounce * 0.38;

  float topReflection = exp(-pow((uv.y - 0.022) / 0.018, 2.0))
    * smoothstep(0.03, 0.18, uv.x)
    * (1.0 - smoothstep(0.46, 0.78, uv.x));
  float lowerReflection = exp(-pow((uv.y - 0.965) / 0.028, 2.0))
    * smoothstep(0.12, 0.4, uv.x)
    * (1.0 - smoothstep(0.63, 0.92, uv.x));
  glass += vec3(0.78, 0.95, 1.0) * topReflection * 0.42;
  glass += vec3(0.1, 0.53, 0.68) * lowerReflection * 0.22;

  float alpha = mask * mix(0.72, 0.98, uOpacity) * (0.84 + rim * 0.16);
  outColor = vec4(pow(max(glass, vec3(0.0)), vec3(0.92)), alpha);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create shell shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) ?? "Unknown shell shader error";
    gl.deleteShader(shader);
    throw new Error(detail);
  }
  return shader;
}

function requireUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string) {
  const location = gl.getUniformLocation(program, name);
  if (location === null) throw new Error(`Shell uniform not found: ${name}`);
  return location;
}

class OpticalShellRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly shaders: WebGLShader[];
  private readonly quad: WebGLBuffer;
  private readonly uniforms: Record<string, WebGLUniformLocation>;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: false,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    this.shaders = [
      compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER),
      compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER),
    ];
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to create shell program");
    this.program = program;
    for (const shader of this.shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Unable to link shell program");
    }

    const quad = gl.createBuffer();
    if (!quad) throw new Error("Unable to create shell quad");
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      resolution: requireUniform(gl, program, "uResolution"),
      pixelRatio: requireUniform(gl, program, "uPixelRatio"),
      time: requireUniform(gl, program, "uTime"),
      motion: requireUniform(gl, program, "uMotion"),
      opacity: requireUniform(gl, program, "uOpacity"),
      controlSurface: requireUniform(gl, program, "uControlSurface"),
    };
  }

  render(timeMs: number, dragging: boolean, opacity: number, controlSurface: boolean) {
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
    const { gl, program, uniforms } = this;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, width, height);
    gl.uniform1f(uniforms.pixelRatio, ratio);
    gl.uniform1f(uniforms.time, timeMs / 1_000);
    gl.uniform1f(uniforms.motion, dragging ? 1 : 0);
    gl.uniform1f(uniforms.opacity, opacity);
    gl.uniform1f(uniforms.controlSurface, controlSurface ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    const { gl } = this;
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.program);
    for (const shader of this.shaders) gl.deleteShader(shader);
  }
}

export function OpticalShell({ dragging, reducedMotion, opacity, controlSurface = false }: OpticalShellProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OpticalShellRenderer | null>(null);
  const frameStateRef = useRef({ dragging, opacity, controlSurface });
  frameStateRef.current = { dragging, opacity, controlSurface };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: OpticalShellRenderer;
    try {
      renderer = new OpticalShellRenderer(canvas);
      rendererRef.current = renderer;
      canvas.dataset.renderer = "webgl-shell";
    } catch {
      canvas.dataset.renderer = "css-shell";
      return;
    }

    let frame: number | null = null;
    let lastDraw = 0;
    const draw = (time: number) => {
      if (time - lastDraw >= 32 || reducedMotion) {
        lastDraw = time;
        const state = frameStateRef.current;
        renderer.render(time, state.dragging, state.opacity, state.controlSurface);
      }
      if (!reducedMotion) frame = requestAnimationFrame(draw);
    };
    draw(performance.now());

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const state = frameStateRef.current;
          renderer.render(performance.now(), state.dragging, state.opacity, state.controlSurface);
        });
    resizeObserver?.observe(canvas);
    return () => {
      resizeObserver?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [reducedMotion]);

  // Reduced motion pauses the loop, but direct opacity changes still need a frame.
  useEffect(() => {
    if (reducedMotion) rendererRef.current?.render(performance.now(), dragging, opacity, controlSurface);
  }, [dragging, opacity, reducedMotion, controlSurface]);

  return <canvas ref={canvasRef} className="optical-shell-canvas" aria-hidden="true" />;
}
