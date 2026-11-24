"use strict";
const sources = ["Codex", "ZCode", "Gemini"];
const colors = ["#62d8fc", "#75e5b1", "#d2a0fa"];
const states = {run:["运行中","›"], wait:["等待操作","Ⅱ"], fail:["执行报错","!"], done:["已完成","✓"]};
const base = [
  ["Codex","run","构建桌面版"], ["Codex","done","整理变更记录"],
  ["ZCode","wait","确认依赖更新"], ["ZCode","run","运行回归检查"],
  ["Gemini","fail","校对接口文档","Antigravity"], ["Gemini","run","整理设计稿","Antigravity"],
  ["Gemini","done","比对参考资料","Web"]
];
const extra = [
  ["Codex","run","检查布局"], ["Codex","wait","确认文件改名"], ["Codex","done","整理测试数据"],
  ["ZCode","fail","导出报告"], ["ZCode","run","读取日志"], ["Gemini","wait","确认构建参数","Antigravity"],
  ["Gemini","run","审阅样稿","Web"], ["Gemini","done","整理引用","Web"]
];
let scene = "normal";
let width = 300;
let selected = "Gemini";
const dialog = document.querySelector("#detail");
const taskRows = () => (scene === "empty" ? [] : scene === "busy" ? [...base,...extra] : base)
  .map(([source,state,title,origin=source],id)=>({source,state,title,origin,id}))
  .filter(t=>!(t.source==="Gemini" && (scene==="offline" || (scene==="partial" && t.origin==="Web"))));
const unknown = source => source === "Gemini" && (scene === "partial" || scene === "offline");
const issue = t => t.state === "fail" || t.state === "wait";
const mark = state => `<span class="sign ${state}" aria-hidden="true">${states[state][1]}</span>`;
const label = t => `${t.source} · ${t.origin===t.source?"":t.origin+" · "}${t.title} · ${states[t.state][0]}`;
function glassLines(rows, key) {
  const bands = [
    ["M21 16 C40 16 43 1 65 1 H185 L181 11 H65 C48 11 42 17 21 18 Z","M21 16 C41 16 43 2 65 2 H183"],
    ["M21 17 C39 17 45 13 65 13 H185 L181 23 H65 C46 23 39 19 21 19 Z","M21 17 C43 17 46 14 65 14 H183"],
    ["M21 18 C40 18 47 25 65 25 H185 L181 35 H65 C44 35 41 21 21 20 Z","M21 19 C41 19 49 26 65 26 H183"]
  ];
  const gradients = colors.map((color, i) => `
    <linearGradient id="${key}-fiber-${i}" x1="0" y1="0" x2=".12" y2="1">
      <stop stop-color="${color}"/><stop offset=".18" stop-color="#405563"/>
      <stop offset=".45" stop-color="#182c39"/><stop offset=".76" stop-color="#172d38"/>
      <stop offset="1" stop-color="${color}"/>
    </linearGradient>`).join("");
  const paths = bands.map(([body, edge], i) => {
    const active = rows.some(task => task.source === sources[i] && task.state === "run");
    return `<path d="${body}" fill="url(#${key}-fiber-${i})" stroke="#43525b" stroke-width=".45"/>
      <path d="${edge}" fill="none" stroke="${colors[i]}" stroke-width=".75"/>
      ${active ? `<path class="pulse p${i}" d="${edge}" pathLength="100" fill="none" stroke="#fff" stroke-width=".95"/>` : ""}`;
  }).join("");
  return `<svg class="fibers" viewBox="0 0 186 36" preserveAspectRatio="none" aria-hidden="true"><defs>${gradients}</defs>${paths}</svg>`;
}
function prism(rows, previewWidth, key) {
  const issues = rows.filter(issue).length;
  const tip = `<button class="prism-tip" data-list="attention" aria-label="查看 ${issues} 项已知报错和等待" title="报错和等待"><img src="assets/prism.webp" alt=""><span class="prism-lens">${issues}</span></button>`;
  const cap = previewWidth === 260 ? 3 : 4;
  const strands = sources.map((source, index) => {
    const group = rows.filter(task => task.source === source);
    const excess = group.length - cap;
    const unavailable = unknown(source);
    const title = `${source} · ${group.length} 项已知聊天${unavailable ? "，部分或全部来源未连接" : ""}`;
    return `<button class="strand s${index}" data-list="${source}" title="${title}" aria-label="${title}">
      <span class="engraved">${source}</span><span class="points">${group.slice(0, cap).map(task => mark(task.state)).join("")}
      ${excess > 0 ? `<small>+${excess}</small>` : ""}${unavailable ? "<small>?</small>" : ""}</span></button>`;
  }).join("");
  return glassLines(rows, key) + tip + strands;
}
function polar(radius,angle){
  const a=(angle-90)*Math.PI/180;
  return [50+radius*Math.cos(a),50+radius*Math.sin(a)];
}
function arc(radius,start,end){
  return `M${polar(radius,start)} A${radius},${radius} 0 0 1 ${polar(radius,end)}`;
}
function dial(rows){
  const group=rows.filter(t=>t.source===selected);
  const first=group.find(t=>t.state==="fail") ?? group.find(t=>t.state==="wait") ?? group[0];
  const marks=sources.map((s,i)=>{
    const start=120*i-59, tasks=rows.filter(t=>t.source===s);
    return `<path d="${arc(44,start,start+115)}" fill="none" stroke="${colors[i]}" stroke-opacity="${s===selected?".95":".45"}" stroke-width="${s===selected?4:2}"/>${tasks.map((t,j)=>{
      const [x,y]=polar(38,start+14+j*88/Math.max(2,tasks.length-1));
      return `<circle class="jewel ${t.state}" cx="${x}" cy="${y}" r="3.7" stroke="#2b2d33" stroke-width="1"/>`;
    }).join("")}${unknown(s)?`<text x="${polar(36,start+101)[0]}" y="${polar(36,start+101)[1]}" fill="white" font-size="11">?</text>`:""}`;
  }).join("");
  return `<div class="wing"><div class="wing-face"></div></div><button class="rotor" data-list="all" aria-label="查看全部聊天" title="全部聊天"><img src="assets/dial.webp" alt=""><svg aria-hidden="true" viewBox="0 0 100 100">${marks}</svg></button><div class="dial-info"><div class="legend">${sources.map((s,i)=>`<button data-select="${s}" aria-pressed="${s===selected}" style="--color:${colors[i]}" title="切换至 ${s}">${s}${unknown(s)?" ?":""}</button>`).join("")}</div><div class="inscription">${first?`<button class="featured" data-task="${first.id}" title="${label(first)}"><strong>${first.title}</strong><small>${first.origin} · ${states[first.state][0]}</small></button>`:`<span class="no-read">${unknown(selected)?"状态未知":"空闲"}</span>`}<button class="other" data-list="${selected}" aria-label="查看 ${selected} 全组" title="查看整组聊天"><span>${group.length}${unknown(selected)?"?":""}</span><b aria-hidden="true">›</b></button></div></div>`;
}
function pendants(rows){
  return `<div class="rail"></div><div class="banks">${sources.map((s,i)=>{
    const group=rows.filter(t=>t.source===s);
    const cap=width===260?2:3;
    const overflow=group.length>cap;
    const visible=overflow?group.slice(0,cap-1):group;
    return `<div class="bank" style="--color:${colors[i]}"><button data-list="${s}" class="hallmark" title="查看 ${s} 的聊天">${s}${unknown(s)?" ?":""}</button><div class="drops">${visible.map((t,j)=>`<button class="pendant ${t.state} level${(i+j)%3}" data-task="${t.id}" title="${label(t)}" aria-label="${label(t)}"><i></i><span class="crystal"><img src="assets/drop.webp" alt="">${mark(t.state)}</span></button>`).join("")}${overflow?`<button class="pendant more level1" data-list="${s}" aria-label="查看 ${s} 其余 ${group.length-visible.length} 项"><i></i><span class="crystal"><img src="assets/drop.webp" alt=""><b>+${group.length-visible.length}</b></span></button>`:""}${!group.length?`<button data-list="${s}" class="no-drops">${unknown(s)?"状态未知":"空闲"}</button>`:""}</div></div>`;
  }).join("")}</div>`;
}
const designs={prism,dial,drop:pendants};
function render() {
  const rows = taskRows();
  for (const stage of document.querySelectorAll(".stage")) {
    const id = stage.dataset.design || stage.closest("article").id;
    const size = Number(stage.dataset.previewWidth) || width;
    const hasTasks = rows.length > 0 || unknown("Gemini");
    stage.style.width = `${size}px`;
    stage.classList.toggle("compact", size === 260);
    stage.innerHTML = `${hasTasks ? `<div class="instrument ${id}">${designs[id](rows, size, stage.id || id)}</div>` : ""}
      <div class="quota"><img src="../../../verification/gemini-live/${size === 260 ? "narrow" : "standard"}.png" alt="已通过的 Gemini 三仓浮窗，示例额度"></div>`;
  }
}
function openDetails(button){
  const rows=taskRows();
  const group=button.dataset.list;
  const task=button.hasAttribute("data-task")?rows.find(t=>t.id===Number(button.dataset.task)):null;
  const matches=task?[task]:group==="all"?rows:group==="attention"?rows.filter(issue):rows.filter(t=>t.source===group);
  const entries=dialog.querySelector(".entries");
  dialog.querySelector("h2").textContent=task?task.title:group==="attention"?"报错和等待":group==="all"?"全部聊天":`${group} 聊天`;
  entries.innerHTML=matches.map(t=>`<div class="entry">${mark(t.state)}<div><b>${t.title}</b><small>${t.source}${t.origin===t.source?"":` / ${t.origin}`} · ${states[t.state][0]}</small></div></div>`).join("");
  if(!task && unknown("Gemini") && ["all","attention","Gemini"].includes(group)){
    entries.insertAdjacentHTML("beforeend",`<p class="notice">${scene==="partial"?"Gemini 网页未连接":"Gemini 网页、Antigravity 均未连接"}，任务状态未知。</p>`);
  }
  if(!entries.children.length) entries.textContent=group==="attention"?"当前没有报错或等待。":"当前没有聊天。";
  dialog.showModal();
}
document.querySelector(".gallery").addEventListener("click",e=>{
  const button=e.target.closest("button");
  if(!button)return;
  if(button.dataset.select){
    selected=button.dataset.select;
    document.querySelector(".instrument.dial").innerHTML=dial(taskRows());
    document.querySelector(`[data-select="${selected}"]`).focus({preventScroll:true});
  }else openDetails(button);
});
document.querySelector("nav").addEventListener("click",e=>{
  const option=e.target.closest("[data-width]");
  if(!option)return;
  width=Number(option.dataset.width);
  document.querySelectorAll("[data-width]").forEach(b=>b.setAttribute("aria-pressed",String(b===option)));
  render();
});
document.querySelector("#scene").addEventListener("change",e=>{scene=e.target.value;render();});
document.querySelector("#large")?.addEventListener("change",e=>document.body.classList.toggle("actual",!e.target.checked));
document.querySelector("#close").addEventListener("click",()=>dialog.close());
dialog.addEventListener("click",e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
render();
