"use strict";

const concepts = [
  ["A", "三组并排", "每个来源都有固定位置。点状态灯看单个聊天，点来源名看整组。"],
  ["B", "来源切换", "上排保留三个来源和提醒灯，下排展开所选来源的任务名称。"],
  ["C", "待处理优先", "把跨来源最需处理的一项放大。点「全部」查看每个来源的任务。"],
];
const sources = { codex: "Codex", zcode: "ZCode", gemini: "Gemini" };
const labels = { failed: "执行报错", waiting: "等待操作", running: "运行中", unknown: "状态未知", completed: "已完成" };
const priority = ["failed", "waiting", "running", "unknown", "completed"];
const baseTasks = [
  ["codex", "running", "构建桌面版"], ["codex", "completed", "整理变更记录"],
  ["zcode", "waiting", "确认依赖更新"], ["zcode", "running", "运行回归检查"],
  ["gemini", "failed", "校对接口文档", "Antigravity"], ["gemini", "running", "整理设计稿", "Antigravity"],
  ["gemini", "completed", "比对参考资料", "Web"],
];
const extraTasks = [
  ["codex","waiting","确认文件改名"], ["codex","running","检查布局"], ["codex","completed","整理测试数据"],
  ["zcode","failed","导出报告"], ["zcode","running","读取日志"],
  ["gemini","waiting","确认构建参数","Antigravity"], ["gemini","running","审阅样稿","Web"], ["gemini","completed","整理引用","Web"],
];
const paths = { waiting:"M4 2.5v7M8 2.5v7", failed:"M6 2v5m0 2v.5", completed:"m2 6 2.5 2.5L10 3", unknown:"M3.6 4.5a2.5 2.5 0 1 1 5 0c0 1.5-2.6 1.7-2.6 3m0 1.6v.3" };
let scene = "normal";
let width = "standard";
let selected = "gemini";
let opener = null;

function badge(state, showAge = false) {
  const glyph = paths[state] ? '<svg viewBox="0 0 12 12"><path d="' + paths[state] + '"/></svg>' : "";
  const timed = showAge && state === "completed";
  return '<span aria-hidden="true" class="badge ' + state + (timed ? ' timed' : '') + '">' + glyph
    + (timed ? '<small>3m</small>' : '') + '</span>';
}
function offline(source) { return scene === "offline" && source === "gemini"; }
function partial(source) { return scene === "partial" && source === "gemini"; }
function tasks() {
  if (scene === "empty") return [];
  const rows = scene === "busy" ? baseTasks.concat(extraTasks) : baseTasks;
  return rows.filter(([source,,,origin]) => !offline(source) && !(partial(source) && origin === "Web")).map(([source,state,title,origin],id) =>
    ({source,state,title,origin,id})).sort((a,b) => priority.indexOf(a.state) - priority.indexOf(b.state));
}
function status(task) { return labels[task.state] + (task.state === "completed" ? " · 3 分钟前" : ""); }
function label(task) { return sources[task.source] + (task.origin ? " / " + task.origin : "") + " · " + task.title + " · " + status(task); }
function indicator(task, named) {
  return '<button class="' + (named ? "chip" : "task-hit") + '" data-task="' + task.id + '" title="' + label(task) + '" aria-label="' + label(task) + '">'
    + badge(task.state,true) + (named ? '<span class="caption">' + task.title + '</span>' : '') + '</button>';
}
function listButton(source, more) {
  return '<button class="more" data-list="' + source + '" aria-label="查看 ' + sources[source] + ' 其余 ' + more + ' 个任务">+' + more + '</button>';
}
function emptyLabel(source) {
  return offline(source) ? '<span class="off">状态未知</span>' : '<span class="empty">空闲</span>';
}
function columns(rows) {
  return Object.keys(sources).map(source => {
    const group = rows.filter(t => t.source === source);
    const limit = group.length > 3 ? 2 : 3;
    return '<div class="cell glass" data-source="' + source + '"><button class="source-title" data-list="' + source + '">' + sources[source]
      + '</button><div class="lamps">' + (group.length ? group.slice(0,limit).map(t=>indicator(t,false)).join("") : emptyLabel(source))
      + (group.length > limit ? listButton(source, group.length-limit) : "")
      + (partial(source) ? '<button class="task-hit" data-list="gemini" title="Gemini 网页状态未知" aria-label="Gemini 网页状态未知">' + badge("unknown") + '</button>' : "") + '</div></div>';
  }).join("");
}
function tabs(rows) {
  const buttons = Object.keys(sources).map(source => {
    const group = rows.filter(t=>t.source === source);
    const attention = group.find(t => t.state === "waiting" || t.state === "failed");
    return '<button class="tab" data-tab="' + source + '" data-source="' + source + '" aria-pressed="' + (source === selected)
      + '" aria-label="' + sources[source] + '，' + (offline(source) ? '状态未知' : group.length + ' 个任务' + (attention ? '，' + status(attention) : '')) + '">' + sources[source]
      + '<span class="tab-count">' + (offline(source) ? '—' : group.length + (partial(source) ? '+?' : '')) + '</span>'
      + (attention ? '<i class="sig ' + attention.state + '"></i>' : '') + '</button>';
  }).join("");
  const group = rows.filter(t=>t.source === selected);
  return '<div class="switchboard glass"><div class="tabs">' + buttons + '</div><div class="chips">'
    + (group.length ? group.slice(0,2).map(t=>indicator(t,true)).join("") : emptyLabel(selected))
    + (group.length>2 ? listButton(selected, group.length-2) : '') + (partial(selected) ? '<button class="more" data-list="gemini">网页 ?</button>' : '') + '</div></div>';
}
function attention(rows) {
  const first = rows[0];
  const focus = first ? '<button class="lead" data-task="' + first.id + '" data-source="' + first.source + '" aria-label="' + label(first) + '">'
    + badge(first.state) + '<span class="lead-text"><small>' + sources[first.source] + ' · ' + status(first) + '</small><b>'
    + first.title + '</b></span></button>' : '';
  return '<div class="priority glass">' + focus + '<button class="all" data-list="all">'
    + (scene === 'offline' || scene === 'partial' ? '已知' : '全部') + ' <b>' + rows.length + '</b> ›</button></div>';
}
function build() {
  document.getElementById("concepts").innerHTML = concepts.map(([letter,name,description]) =>
    '<section class="concept"><div><h2><i class="letter">' + letter + '</i>' + name + '</h2><p class="description">'
    + description + '</p></div><div class="stage" data-design="' + letter + '"><div class="dock dock-' + letter.toLowerCase()
    + '"></div><div class="base"><img alt="Gemini 三仓主浮窗，示例液位"></div><aside class="popup" role="dialog" aria-label="示例任务详情" hidden></aside></div></section>'
  ).join("");
  document.querySelector(".key").innerHTML = ["running","waiting","failed","completed","unknown"].map(s=>'<span>' + badge(s) + labels[s] + '</span>').join("");
}
function paint() {
  const rows = tasks();
  document.querySelectorAll(".stage").forEach(stage => {
    const letter = stage.dataset.design;
    stage.classList.toggle("narrow",width === "narrow");
    const dock = stage.querySelector(".dock");
    dock.hidden = scene === "empty";
    dock.innerHTML = letter === "A" ? columns(rows) : letter === "B" ? tabs(rows) : attention(rows);
    stage.querySelector("img").src = "../../verification/gemini-live/" + (width === "narrow" ? "narrow" : "standard") + ".png";
    stage.querySelector(".popup").hidden = true;
  });
  document.querySelectorAll("[data-setting] button").forEach(b=>{
    b.setAttribute("aria-pressed", String(b.value === (b.parentElement.dataset.setting === "width" ? width : scene)));
  });
}
function closePopup(restore = true) {
  document.querySelectorAll(".popup").forEach(p=>p.hidden=true);
  if (restore && opener?.isConnected) opener.focus();
  opener=null;
}
function openDetail(button) {
  const stage = button.closest(".stage");
  const pop = stage.querySelector(".popup");
  closePopup(false);
  const source = button.dataset.list;
  const rows = tasks();
  const task = rows.find(t=>String(t.id) === button.dataset.task);
  const subset = task ? [task] : rows.filter(t => source === "all" || t.source === source);
  const title = task ? sources[task.source] + (task.origin ? " / " + task.origin : "") : (sources[source] || "全部") + "任务";
  const entries = subset.map(t=>'<div class="entry">' + badge(t.state) + '<span>' + t.title + '</span><small>' +
    (task ? status(t) : (t.origin || sources[t.source]) + ' · ' + status(t)) + '</small></div>').join("");
  const showHealth = source === "all" || source === "gemini";
  const unknown = showHealth && offline("gemini") ? '<p>Gemini 网页、Antigravity · 暂时无法读取任务状态</p>'
    : showHealth && partial("gemini") ? '<p>Gemini 网页 · 暂时无法读取任务状态</p>' : '';
  pop.innerHTML = '<div class="popup-head"><strong>' + title + '</strong><button data-close>关闭</button></div>'
    + entries + unknown + (!entries && !unknown ? '<p>暂无任务</p>' : '');
  opener=button; pop.hidden=false; pop.querySelector("button").focus({preventScroll:true});
}
document.addEventListener("click",e=>{
  const button=e.target.closest("button");
  if(!button){if(!e.target.closest(".popup"))closePopup(false);return;}
  if(button.parentElement.dataset.setting){
    if(button.parentElement.dataset.setting === "width")width=button.value;else scene=button.value;
    closePopup(false);paint();return;
  }
  if(button.dataset.tab){
    selected=button.dataset.tab;closePopup(false);paint();
    document.querySelector('[data-tab="'+selected+'"]').focus({preventScroll:true});return;
  }
  if(button.hasAttribute("data-close")){closePopup();return;}
  if(button.hasAttribute("data-task")||button.dataset.list)openDetail(button);
});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closePopup();});
build();
paint();
