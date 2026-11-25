const svgNamespace = "http://www.w3.org/2000/svg";
const agents = ["Codex", "ZCode", "Gemini"];
const materials = [
  { key:"titanium", letter:"A", name:"折钛", finish:"金属带折出硬边，反光横掠折面。" },
  { key:"waveguide", letter:"B", name:"光导管", finish:"弯管保留通透的空隙，光点沿管壁行走。" },
  { key:"enamel", letter:"C", name:"烧制珐琅", finish:"深色釉面嵌在金属包边里，受光处渐亮。" },
];
const labels = {idle:"静置",running:"运行",waiting:"等待",done:"完成",error:"报错",mixed:"混合状态"};
const notices = {
  waiting:{path:"M12.7 8.9v14.2m6.6-14.2v14.2", color:"#ffdfa1"},
  done:{path:"m7.5 16.5 5.7 5.4 11-12.25", color:"#ccffd8"},
  error:{path:"M16 7.8v11m0 5.35v.1", color:"#ffccb4"},
};
let instance = 0;
function mark(agent, family) {
  const svg = document.createElementNS(svgNamespace, "svg");
  const prefix = "mark-" + ++instance;
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("role", "img");
  svg.setAttribute("class", "mark");
  svg.dataset.family = family;
  svg.dataset.agent = agent;
  const art = window.markFamilies[family][agent.toLowerCase()].replaceAll("__ID__", prefix);
  svg.innerHTML = '<defs><mask id="' + prefix + '-notice"><rect width="32" height="32" fill="white"/><path class="knockout" fill="none" stroke="black" stroke-width="6.8" stroke-linecap="round" stroke-linejoin="round"/></mask></defs>' +
    '<g mask="url(#' + prefix + '-notice)">' + art + '</g>' +
    '<g class="noticeInk"><path stroke="#172729" stroke-width="5.2"/><path stroke-width="3.25"/></g>';
  for (const glint of svg.querySelectorAll(".glint")) {
    const reflection = document.createElementNS(svgNamespace, "g");
    reflection.setAttribute("class", "reflection");
    glint.replaceWith(reflection);
    reflection.append(glint);
  }
  setState(svg, "idle", false);
  return svg;
}
function setState(svg,state,running) {
  svg.dataset.state = state;
  svg.dataset.running = String(running);
  svg.setAttribute("aria-label", svg.dataset.agent + " · " + labels[state] + (running && state !== "running" ? "，另有任务运行" : ""));
  svg.toggleAttribute("data-notice", Boolean(notices[state]));
  const d = notices[state]?.path || "";
  for(const p of svg.querySelectorAll(".knockout, .noticeInk path")) p.setAttribute("d",d);
  if(notices[state]) svg.querySelector(".noticeInk path:last-child").setAttribute("stroke",notices[state].color);
}
const scenes = document.getElementById("specimens");
for(const family of materials) {
  const row = document.createElement("article");
  row.className = "layout sample";
  row.innerHTML = '<div class="material"><h2><i>' + family.letter + '</i>' + family.name + '</h2><p>' + family.finish + '</p></div>';
  for(const agent of agents) {
    const figure = document.createElement("figure");
    figure.className = "specimen";
    const label = document.createElement("figcaption");
    label.textContent = agent;
    figure.append(mark(agent,family.key),label);
    row.append(figure);
  }
  const bench = document.createElement("div");
  bench.className = "bench";
  bench.innerHTML = '<div class="rail"></div><img class="chambers" src="../../gemini-quota-windows/liquid/twin/narrow.png" alt="Gemini 双舷窗窄条参考">';
  for(const agent of agents) bench.firstElementChild.append(mark(agent,family.key));
  row.append(bench);
  scenes.append(row);
}
const controls = document.querySelector(".states");
function preview(mode) {
  for(const svg of scenes.querySelectorAll(".mark")) {
    const agent = agents.indexOf(svg.dataset.agent);
    const state = mode === "mixed" ? (svg.closest(".bench") ? ["running","done","error"][agent] : "idle") : mode;
    setState(svg,state,state === "running" || (mode === "mixed" && state === "error"));
  }
  for(const button of controls.children) button.setAttribute("aria-pressed",String(mode === button.value));
}
for(const state of ["mixed","idle","running","waiting","done","error"]) {
  const button = document.createElement("button");
  button.type = "button";
  button.value = state;
  button.textContent = labels[state];
  button.addEventListener("click",() => preview(state));
  controls.append(button);
}
document.getElementById("lighting").addEventListener("click",event => {
  const light = document.getElementById("gallery").classList.toggle("light");
  event.currentTarget.setAttribute("aria-pressed",String(light));
  event.currentTarget.textContent = light ? "切换深色桌面" : "切换浅色桌面";
});
document.getElementById("sizing").addEventListener("click",event => {
  const actual = document.getElementById("gallery").classList.toggle("actual");
  event.currentTarget.setAttribute("aria-pressed",String(actual));
  event.currentTarget.textContent = actual ? "放大看材质" : "查看 29 px 实寸";
});
preview("mixed");
