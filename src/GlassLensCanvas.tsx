import { useEffect, useRef } from "react";

// A single optical pass for the dock's separate lenses, sharing the shell's
// glass IOR, Fresnel response and microfacet lighting. HTML owns all input.
const vertex = `#version 300 es
layout(location=0) in vec2 position;
void main(){gl_Position=vec4(position,0.,1.);}`;
const fragment = `#version 300 es
precision highp float;
out vec4 color;
uniform vec2 size;
uniform vec2 origin;
uniform float ratio;
uniform float selected;
uniform float pressed;
uniform vec3 tint;
float sdf(vec2 p, vec2 b, float r) {
  vec2 q=abs(p)-b+r;
  return min(max(q.x,q.y),0.)+length(max(q,0.))-r;
}
void main(){
  vec2 p=vec2(gl_FragCoord.x-origin.x,size.y-(gl_FragCoord.y-origin.y));
  vec2 halfSize=size*.5-vec2(ratio);
  float radius=min(halfSize.y,halfSize.x);
  vec2 local=p-size*.5;
  float d=sdf(local,halfSize,radius);
  float mask=1.-smoothstep(-ratio,0.,d);
  if(mask<=0.){color=vec4(0.);return;}
  vec2 uv=p/size;
  vec2 edge=normalize(vec2(
    sdf(local+vec2(ratio,0.),halfSize,radius)-sdf(local-vec2(ratio,0.),halfSize,radius),
    sdf(local+vec2(0.,ratio),halfSize,radius)-sdf(local-vec2(0.,ratio),halfSize,radius))+.0001);
  float wall=1.-smoothstep(-radius*.85,0.,d);
  float slope=pow(1.-wall,1.6);
  vec3 n=normalize(vec3(edge*(slope*1.8+.06),1.));
  vec3 light=normalize(vec3(-.5,-.65,.65));
  vec3 h=normalize(light+vec3(0.,0.,1.));
  float nv=max(n.z,0.);
  float nl=max(dot(n,light),0.);
  float nh=max(dot(n,h),0.);
  float f0=pow((1.52-1.0003)/(1.52+1.0003),2.);
  float fresnel=f0+(1.-f0)*pow(1.-nv,5.);
  float a2=.22*.22;
  float distribution=a2/(3.14159265*pow(nh*nh*(a2-1.)+1.,2.));
  float spec=nl*distribution*.09;
  float outer=exp(-pow((d+ratio*1.8)/(ratio*.85),2.));
  float inner=exp(-pow((d+ratio*5.5)/(ratio*1.1),2.));
  float glint=exp(-pow((uv.x-.25)/.19,2.)-pow((uv.y-.13)/.055,2.));
  float lower=exp(-pow((uv.y-.91)/.11,2.));
  float volume=exp(-pow((uv.x-.5)/.58,2.)-pow((uv.y-.7)/.42,2.));
  vec3 blue=vec3(.008,.05,.10);
  vec3 glass=blue+vec3(.035,.105,.19)*exp(-pow((uv.y-.20)/.25,2.));
  glass+=tint*(selected*volume*.56+lower*.14);
  glass+=vec3(.78,.94,1.)*(outer*.74+inner*.30+glint*.38+spec*(1.-pressed*.5));
  glass+=tint*fresnel*.6;
  glass*=1.-pressed*.23;
  float alpha=.62+selected*.09+outer*.24+inner*.12+glint*.12+fresnel*.12;
  color=vec4(clamp(glass,0.,1.),mask*clamp(alpha,0.,.94));
}`;

export function GlassLensCanvas({ reducedMotion }: { reducedMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const dock = canvas?.parentElement;
    if (!canvas || !dock) return;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false, depth: false });
    if (!gl) { canvas.dataset.renderer = "css-lens"; return; }
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const quad = gl.createBuffer();
    if (!program || !quad) {
      if (program) gl.deleteProgram(program);
      if (quad) gl.deleteBuffer(quad);
      console.warn("Glass lenses use CSS fallback · QDG-101: resource allocation failed");
      canvas.dataset.renderer = "css-lens";
      return;
    }
    try {
      for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(kind);
        if (!shader) throw new Error("Lens shader allocation failed");
        shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Lens compilation failed");
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Lens linking failed");
    } catch (error) {
      console.warn("Glass lenses use CSS fallback · QDG-101", error);
      shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program); gl.deleteBuffer(quad);
      canvas.dataset.renderer = "css-lens";
      return;
    }
    canvas.dataset.renderer = "webgl-lens";
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(["size", "origin", "ratio", "selected", "pressed", "tint"].map(name => [name, gl.getUniformLocation(program, name)]));
    let frame = 0;
    const transitions = new Map<Element, Set<string>>();
    let pressing: Element | null = null;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const scale = canvas.clientWidth / bounds.width;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * pixelRatio);
      const height = Math.round(canvas.clientHeight * pixelRatio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program);
      for (const lens of dock.querySelectorAll<HTMLElement>("[data-glass-lens]")) {
        const r = lens.getBoundingClientRect();
        const x = Math.round((r.left - bounds.left) * scale * pixelRatio);
        const y = Math.round((bounds.bottom - r.bottom) * scale * pixelRatio);
        const w = Math.round(r.width * scale * pixelRatio);
        const h = Math.round(r.height * scale * pixelRatio);
        gl.viewport(x,y,w,h);
        gl.uniform2f(uniforms.size,w,h); gl.uniform2f(uniforms.origin,x,y);
        gl.uniform1f(uniforms.ratio,pixelRatio);
        gl.uniform1f(uniforms.selected,lens.dataset.selected === "true" ? 1 : 0);
        gl.uniform1f(uniforms.pressed,pressing === lens ? 1 : 0);
        gl.uniform3f(uniforms.tint,...(lens.dataset.lensTone === "zcode" ? [.16,.95,.62] : [.22,.79,1.]) as [number,number,number]);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
    };
    const tick = () => {
      draw();
      for (const target of transitions.keys()) if (!dock.contains(target)) transitions.delete(target);
      if (transitions.size > 0 && !reducedMotion) frame = requestAnimationFrame(tick);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick); };
    const resize = new ResizeObserver(schedule);
    resize.observe(dock);
    const mutations = new MutationObserver(schedule);
    mutations.observe(dock, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-selected", "class"] });
    const down = (event: PointerEvent) => { pressing = (event.target as Element).closest("[data-glass-lens]"); schedule(); };
    const up = () => { pressing = null; schedule(); };
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { pressing = (event.target as Element).closest("[data-glass-lens]"); schedule(); } };
    const startTransition = (event: TransitionEvent) => {
      const target = event.target as Element;
      const properties = transitions.get(target) ?? new Set<string>();
      properties.add(event.propertyName); transitions.set(target, properties); schedule();
    };
    const endTransition = (event: TransitionEvent) => {
      const target = event.target as Element;
      const properties = transitions.get(target);
      properties?.delete(event.propertyName);
      if (!properties?.size) transitions.delete(target);
      schedule();
    };
    dock.addEventListener("pointerdown", down); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    dock.addEventListener("keydown", keyDown); window.addEventListener("keyup", up);
    dock.addEventListener("transitionrun", startTransition); dock.addEventListener("transitionend", endTransition); dock.addEventListener("transitioncancel", endTransition);
    schedule();
    return () => {
      resize.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame);
      dock.removeEventListener("pointerdown", down); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      dock.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", up);
      dock.removeEventListener("transitionrun", startTransition); dock.removeEventListener("transitionend", endTransition); dock.removeEventListener("transitioncancel", endTransition);
      shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program); gl.deleteBuffer(quad);
    };
  }, [reducedMotion]);
  return <canvas className="glass-lens-canvas" ref={canvasRef} aria-hidden="true" />;
}
