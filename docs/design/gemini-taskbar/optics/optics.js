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
function glassLines(rows){
  const bands = [
    ["M3 4 H99 C148 4 167 10 196 17 S232 23 255 23 L255 26 C223 27 206 24 183 20 S136 17 101 17 H10 Z","M5 5 H99 C162 5 188 24 248 24"],
    ["M3 21 H120 C174 21 193 25 255 26 L255 30 C193 31 163 34 121 34 H10 Z","M5 22 H120 C177 22 203 27 249 27"],
    ["M3 38 H99 C148 38 163 36 190 32 S230 29 255 30 L255 32 C227 34 204 39 183 43 S138 51 102 51 H10 Z","M5 39 H99 C156 39 211 31 249 31"]
  ];
  return `<svg class="fibers" viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true"><defs>${colors.map((c,i)=>`<linearGradient id="fiber${i}" x2=".91" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#0a1c29"/><stop offset=".28" stop-color="#183843"/><stop offset=".57" stop-color="${c}"/><stop offset=".68" stop-color="#223048"/><stop offset=".94" stop-color="${c}"/></linearGradient>`).join("")}</defs>${bands.map(([band,shine],i)=>`<path d="${band}" fill="url(#fiber${i})" stroke="#465967" stroke-width=".5"/><path d="${shine}" fill="none" stroke="${colors[i]}" stroke-width="1.4"/><path class="${rows.some(t=>t.source===sources[i]&&t.state==='run')?`pulse p${i}`:'dormant'}" d="${shine}" fill="none" stroke="#f6ffff" stroke-width="1" />`).join("")}</svg>`;
}
function prism(rows){
  return `${glassLines(rows)}${sources.map((s,i)=>{
    const group=rows.filter(t=>t.source===s), cap=width===260?3:4;
    return `<button class="strand s${i}" data-list="${s}" title="查看 ${s} 的聊天"><span class="engraved">${s}</span><span class="points">${group.slice(0,cap).map(t=>mark(t.state)).join("")}${group.length>cap?`<small>+${group.length-cap}</small>`:""}${unknown(s)?"<small>?</small>":""}</span></button>`;
  }).join("")}<button class="prism-tip" data-list="attention" aria-label="查看全部报错和等待" title="报错和等待"><img src="assets/prism.webp" alt=""><span class="prism-lens">${rows.filter(issue).length}</span></button>`;
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
function render(){
  const rows=taskRows();
  for(const [id,paint] of Object.entries(designs)){
    const stage=document.querySelector(`#${id} .stage`);
    stage.style.width=`${width}px`;
    stage.classList.toggle("compact",width===260);
    stage.innerHTML=`${rows.length||unknown("Gemini")?`<div class="instrument ${id}">${paint(rows)}</div>`:""}<div class="quota"><img src="../../../verification/gemini-live/${width===260?"narrow":"standard"}.png" alt="已通过的 Gemini 三仓浮窗，示例额度"></div>`;
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
document.querySelector("#large").addEventListener("change",e=>document.body.classList.toggle("actual",!e.target.checked));
document.querySelector("#close").addEventListener("click",()=>dialog.close());
dialog.addEventListener("click",e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
render();
