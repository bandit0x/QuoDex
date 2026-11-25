const agents = {
  codex: {name:"Codex", stops:[[113,127,139],[225,235,241],[255,255,255]]},
  zcode: {name:"ZCode", stops:[[4,7,10],[19,25,31],[133,148,157]]},
  gemini: {name:"Gemini", stops:[[16,51,112],[36,113,231],[184,229,255]]},
};
const labels = {running:"运行", idle:"静置", waiting:"等待", completed:"3 分钟前完成", failed:"报错", unknown:"未知", mixed:"运行与报错"};
const paths = {
  waiting:"M8 5v14M16 5v14",
  failed:"M12 4v10m0 4v2",
  unknown:"M8 8a4 4 0 1 1 7 3c-2 1-3 2-3 4m0 3v2",
};
const diameter = 20.4;
const tau = Math.PI*2;
const clamp = v => Math.max(0,Math.min(1,v));
const streams = [];
// Cross sections in the 20.4-unit source coordinate system.
// Static material varies across its width only, never around the circumference.
const stillProfiles = {
  idle:      {width:1.45, edge:.27, face:.50},
  waiting:   {width:1.90, edge:.21, face:.56},
  completed: {width:1.32, edge:.24, face:.53},
  failed:    {width:2.38, edge:.11, face:.63},
  unknown:   {width:1.55, edge:.29, face:.48},
};
function stillRim(radius,profile) {
  const outer=diameter/2-.15;
  const depth=clamp((outer-radius)/profile.width);
  const roundedFace=Math.sin(Math.PI*depth);
  return {
    outer,inner:outer-profile.width,
    energy:profile.edge+(profile.face-profile.edge)*roundedFace,
  };
}

// The two packets, their ripple and their width are the v0.4.10 TaskWaterFlow model.
function phaseSeed(id) {
  let hash=2166136261;
  for(const c of id) hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return (hash>>>0)/4294967296*tau;
}
function packet(angle,phase,front,tail) {
  const delta=Math.atan2(Math.sin(angle-phase),Math.cos(angle-phase));
  return Math.exp(-.5*(delta/(delta>0?front:tail))**2);
}
function waveAt(angle,time,seed) {
  const t=time+seed;
  const phaseA=tau*t/2.6+.32*Math.sin(t*1.7);
  const phaseB=tau*t/3.9+2.3+.4*Math.sin(t*1.13+seed);
  const a=packet(angle,phaseA,.38+.12*Math.sin(t*1.9),1.13+.32*Math.sin(t*1.07));
  const b=packet(angle,phaseB,.32+.13*Math.cos(t*1.37),.88+.26*Math.sin(t*1.61))*(.7+.2*Math.sin(t*.91));
  const energy=1-(1-a)*(1-b);
  const ripple=.5*Math.sin(angle*3-t*2.1+Math.sin(angle+t*.83))+.5*Math.sin(angle*5+t*1.7);
  const outer=diameter/2-.17*(1+ripple);
  return {outer,inner:outer-2*(.72+.48*energy),energy};
}
function measure(stream) {
  const n=Math.ceil(stream.canvas.getBoundingClientRect().width*Math.min(devicePixelRatio||1,2));
  if(!n || n===stream.canvas.width && stream.image) return;
  stream.canvas.width=stream.canvas.height=n;
  stream.image=stream.ctx.createImageData(n,n);
  stream.scale=n/diameter;
  stream.band=[];
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const dx=(x+.5)/stream.scale-diameter/2;
    const dy=(y+.5)/stream.scale-diameter/2;
    const radius=Math.hypot(dx,dy);
    if(radius>=diameter/2-.34-2.4-.5/stream.scale && radius<=diameter/2+.5/stream.scale) {
      const angle=Math.atan2(dy,dx);
      let coverage=1;
      if(stream.dashed) {
        // Twelve breaks in the water rim. Soften each cut by one device pixel.
        const phase=(angle/tau+1.25)*12;
        const gapDistance=Math.abs(phase-Math.round(phase))-.15;
        coverage=clamp(gapDistance*tau*radius/12*stream.scale+.5);
      }
      stream.band.push({offset:4*(y*n+x),radius,angle,coverage});
    }
  }
}
function paint(stream,time) {
  measure(stream);
  if(!stream.image) return;
  const rgba=stream.image.data;
  const scale=stream.scale;
  for(const {offset,radius,angle,coverage} of stream.band) {
    const {outer,inner,energy}=stream.moving
      ? waveAt(angle,time,stream.seed)
      : stillRim(radius,stream.profile);
    // Same two pigment intervals and crest exponent as 0.4.10. The centre stays transparent.
    const step=energy<.45?0:1;
    const mix=step===0 ? energy/.45 : ((energy-.45)/.55)**.65;
    for(let c=0;c<3;c++) {
      const a=stream.stops[step][c],b=stream.stops[step+1][c];
      rgba[offset+c]=Math.round(a+(b-a)*mix);
    }
    rgba[offset+3]=Math.round(255*coverage*clamp((outer-radius)*scale+.5)*clamp((radius-inner)*scale+.5));
  }
  stream.ctx.putImageData(stream.image,0,0);
}
function ring(agent,state) {
  const result=document.createElement("span");
  result.className="ring "+agent;
  result.dataset.state=state;
  result.setAttribute("role","img");
  result.setAttribute("aria-label",agents[agent].name+" · "+labels[state]);
  const canvas=document.createElement("canvas");
  result.append(canvas);
  streams.push({
    canvas,ctx:canvas.getContext("2d"),stops:agents[agent].stops,seed:phaseSeed(agent),
    moving:state==="running" || state==="mixed",dashed:state==="unknown",profile:stillProfiles[state]
  });
  if(state==="completed") {
    result.insertAdjacentHTML("beforeend",'<svg class="completion" viewBox="0 0 40.8 40.8"><path d="m5 12 4 4 10-10" transform="translate(10.8 3.5) scale(.8)" stroke-width="2.8"/><text x="20.4" y="29.8" text-anchor="middle">3m</text></svg>');
  }
  const path=paths[state==="mixed"?"failed":state];
  if(path) result.insertAdjacentHTML("beforeend",'<svg class="glyph" viewBox="0 0 24 24"><path d="'+path+'"/></svg>');
  return result;
}
const rows=document.getElementById("examples");
for(const [agent,details] of Object.entries(agents)) {
  const row=rows.insertRow();
  const title=document.createElement("th");
  title.scope="row";
  title.textContent=details.name;
  row.append(title);
  for(const state of Object.keys(labels)) row.insertCell().append(ring(agent,state));
}
const strip=document.getElementById("strip");
strip.append(ring("codex","running"),ring("zcode","completed"),ring("gemini","mixed"));
const movingStreams=streams.filter(stream=>stream.moving);
const pref=matchMedia("(prefers-reduced-motion: reduce)");
const reduce=document.getElementById("reduce");
let manualReduce=false;
let time=0;
let previous=null;
let request=0;
function frame(now) {
  if(previous===null) previous=now-34;
  if(now-previous>=1000/30) {
    time+=(now-previous)/1000;
    previous=now;
    movingStreams.forEach(stream=>paint(stream,time));
  }
  request=requestAnimationFrame(frame);
}
function refresh() {
  if(request) cancelAnimationFrame(request);
  request=0;
  previous=null;
  streams.forEach(stream=>paint(stream,stream.moving?time:0));
  reduce.setAttribute("aria-pressed",String(manualReduce||pref.matches));
  reduce.disabled=pref.matches;
  if(!manualReduce && !pref.matches && !document.hidden) request=requestAnimationFrame(frame);
}
const sheet=document.getElementById("sheet");
document.getElementById("core").onclick=event=>{
  event.currentTarget.setAttribute("aria-pressed",String(sheet.classList.toggle("core")));
};
document.getElementById("zoom").onclick=event=>{
  const zoom=sheet.classList.toggle("zoom");
  event.currentTarget.setAttribute("aria-pressed",String(zoom));
  document.getElementById("scale").textContent=zoom?"放大 · 50 px":"标准 · 29 px";
  refresh();
};
document.getElementById("contrast").onclick=event=>{
  event.currentTarget.setAttribute("aria-pressed",String(sheet.classList.toggle("dark")));
};
reduce.onclick=()=>{manualReduce=!manualReduce; refresh()};
document.addEventListener("visibilitychange",refresh);
pref.addEventListener("change",refresh);
refresh();
