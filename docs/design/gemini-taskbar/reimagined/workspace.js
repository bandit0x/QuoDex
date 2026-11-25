const concepts = [
  ["I", "状态琴键", "点「待处理」查看报错和等待。点「运行」或「完成」，可按状态找到聊天。"],
  ["II", "置顶任务笺", "把最需要你处理的聊天推到最前。点标题直达该聊天，点叠页看其余任务。"],
  ["III", "事件时标", "显示最近两次状态变化及时间。点事件看原聊天，点最右端回看完整记录。"],
];
// Anonymous, fixed examples for comparing the same workload across concepts.
const sample = [
  { title: "发布包签名", source: "Codex", state: "failed", time: "14:32", message: "签名命令返回错误，等待检查证书配置。" },
  { title: "确认液面参数", source: "Antigravity", state: "waiting", time: "14:27", message: "请确认这组阻尼参数，再生成下一段预览。" },
  { title: "重绘玻璃边缘", source: "ZCode", state: "running", time: "14:23", message: "正在计算边缘高光。" },
  { title: "导出色卡", source: "Gemini Web", state: "completed", time: "14:18", message: "配色示例已生成。" },
];
const labels = {
  failed: ["报错", "error", "!"], waiting: ["等确认", "warn", "Ⅱ"],
  running: ["运行中", "busy", "›"], completed: ["已完成", "ok", "✓"],
};
const stateText = {working:"运行中",done:"已完成"};
const scene = document.querySelector("#scene");
const dialog = document.querySelector("dialog");
const detail = document.querySelector("#detail");
const board = document.querySelector("#boards");
let tasks;

function setScene() {
  if (scene.value === "empty") tasks = [];
  else if (scene.value === "unknown") tasks = sample.filter(t => t.source !== "Antigravity");
  else tasks = sample.map(t => scene.value in stateText ? {...t,
    state:scene.value === "working" ? "running" : "completed", message:stateText[scene.value]} : t);
  board.replaceChildren();
  concepts.forEach(([number,name,copy], index) => {
    const article = document.createElement("article");
    article.innerHTML = `<div class="title"><i>${number}</i><h2>${name}</h2></div><p class="caption">${copy}</p>`;
    for (const narrow of [false,true]) {
      const size = narrow ? "窄条 · 260 px" : "标准 · 300 px";
      const surface = document.createElement("section");
      const image = narrow ? "narrow" : "standard";
      surface.className = "surface";
      surface.innerHTML = `<span class="size">${size}</span><div class="float ${narrow?"narrow":""}">${toolbar(index)}
        <div class="meter"><img src="../../../verification/gemini-live/${image}.png" alt="Gemini 三仓"></div></div>`;
      article.append(surface);
    }
    board.append(article);
  });
}

function toolbar(index) {
  if (!tasks.length) return "";
  const offline = scene.value === "unknown" ? '<button class="offline" data-filter="unknown">Antigravity 离线</button>' : "";
  if (index === 0) {
    const groups = [["action","warn","待处理"],["running","busy","运行"],["completed","ok","完成"]];
    const keys = groups.map(([group,ink,title]) => `<button class="key ${ink}" data-filter="${group}"><strong>${filterTasks(group).length}</strong><span>${title}</span></button>`).join("");
    return `<div class="toolbar keys">${keys}<button class="key all" aria-label="全部任务" data-filter="all">≡</button></div>${offline}`;
  }
  if (index === 1) {
    const t = tasks[0], [label,ink,symbol] = labels[t.state];
    return `<div class="toolbar deck"><button class="card" data-chat="0"><span class="seal ${ink}"><img src="../../../../src/task-prism.webp" alt=""><i>${symbol}</i></span>
      <span class="paper-text"><strong>${t.title}</strong><small>${t.source} · ${label}</small></span></button>
      <button class="stack" aria-label="查看其余任务" data-filter="others">+${tasks.length-1}</button></div>${offline}`;
  }
  const events = tasks.slice(0,2).map((t,i) => {
    const [label,ink] = labels[t.state];
    return `<button class="event" aria-label="${t.time} ${t.title} ${label}" data-chat="${i}">
      <small class="${ink}">${t.time} · ${label}</small><b>${t.title}</b></button>`;
  }).join("");
  return `<div class="toolbar tape">${events}<button class="history" aria-label="全部事件" data-filter="history">☷</button></div>${offline}`;
}

function filterTasks(group) {
  if (group === "action") return tasks.filter(t => ["failed","waiting"].includes(t.state));
  if (group === "others") return tasks.slice(1);
  if (["all","history"].includes(group)) return tasks;
  return tasks.filter(t => t.state === group);
}

function show(title, html) {
  document.querySelector("#dialog-title").textContent = title;
  detail.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
function showList(group) {
  const titles = { action:"待处理", running:"运行中", completed:"已完成", all:"全部任务", others:"其余任务", history:"状态变化" };
  if (group === "unknown") {show("Antigravity 离线", '<p class="message">当前无法取得该来源的任务状态。</p>'); return;}
  const rows = filterTasks(group).map(t => `<button class="entry" data-chat="${tasks.indexOf(t)}" data-from="${group}"><span><b>${t.title}</b>
    <small>${t.source} · ${t.time}</small></span><span class="${labels[t.state][1]}">${labels[t.state][0]} ›</span></button>`);
  show(titles[group], rows.join("") || '<p class="message">当前没有这类任务。</p>');
}
document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "close") dialog.close();
  else if (button.hasAttribute("data-filter")) showList(button.dataset.filter);
  else if (button.hasAttribute("data-chat")) {
    const t = tasks[Number(button.dataset.chat)];
    show(t.title, `<p class="message">${t.source} · ${t.time} · ${labels[t.state][0]}</p><p class="message">${t.message}</p>
      <p class="message"><small>原聊天预览 · 演示数据</small></p>${button.dataset.from ? `<button class="back" data-filter="${button.dataset.from}">返回列表</button>`:""}`);
  }
});
scene.addEventListener("change",setScene);
setScene();
