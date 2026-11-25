const groups = [
  { name: "AG Gemini", short: "Gemini", tile: 2, tint: "#4e69ac", values: [82, 16] },
  { name: "AG Claude/GPT", short: "Claude/GPT", tile: 3, tint: "#9360a1", values: [24, 90] },
  { name: "Gemini Web", short: "Web", tile: 1, tint: "#64799c", values: [68, 55] }
];
const periods = ["5 小时", "一周"];
const concepts = [
  { id: "a", title: "双周期总览", purpose: "按行找模型组，同时读出两个周期。", trade: "标准浮窗可直接比较六项。窄条优先显示两组 AG，点击恢复后可见 Web。" },
  { id: "b", title: "按来源查看", purpose: "选择当前使用的来源，查看它的两个周期。", trade: "每个周期各占一个大液仓。比较不同来源时需要切换一次。" },
  { id: "c", title: "按周期对比", purpose: "选择 5 小时或一周，横向比较三个来源。", trade: "同一周期的三组读数可以直接比较。查另一周期时需要切换一次。" }
];
const state = { group: 0, period: 0, scenario: "normal" };
const board = document.querySelector("#board");
const viewer = document.querySelector("#viewer");
const content = document.querySelector("#dialog-content");
const atlas = new Image();
atlas.src = "../../../src/gemini-glass.webp";
const refreshing = new Set();

function sample(group, period) {
  const affected = group === 0 && period === 1;
  const value = affected && state.scenario === "missing" ? null :
    affected && state.scenario === "zero" ? 0 : groups[group].values[period];
  return { value, old: affected && state.scenario === "old" };
}

function reading(group, period) {
  const { value, old } = sample(group, period);
  const spoken = value === null ? "未读取" : (old ? "上次剩余 " : "剩余 ") + value + "%";
  const body = value === null ? "—" : value + "<small>%</small>";
  return `<span class="reading${old ? " old" : ""}" aria-label="${spoken}" title="${spoken}">${body}${old ? '<span class="old-label">上次</span>' : ""}</span>`;
}

function meter(group, period) {
  const { value } = sample(group, period);
  const fill = value > 0 ? `<i class="fill" aria-hidden="true"></i>` : "";
  return `<div class="meter" style="--level:${value ?? 0}%;--tint:${groups[group].tint}">${fill}${reading(group, period)}</div>`;
}

function matrix() {
  const rows = groups.map((group, i) =>
    `<div class="row-label">${group.name}</div>${meter(i, 0)}${meter(i, 1)}`).join("");
  return `<div class="matrix"><span class="col-label">剩余额度</span><span class="col-label">5 小时</span><span class="col-label">一周</span>${rows}</div>`;
}

function switches(labels, kind) {
  const active = state[kind];
  return '<div class="switches" role="group" aria-label="' + (kind === "group" ? "选择来源" : "选择周期") + '">' +
    labels.map((label, i) => `<button data-kind="${kind}" data-index="${i}" aria-pressed="${active === i}">${label}</button>`).join("") + "</div>";
}

function gauge(label, group, period) {
  return `<div class="gauge"><canvas aria-hidden="true" data-group="${group}" data-period="${period}"></canvas><span class="name">${label}</span>${reading(group, period)}</div>`;
}

function standard(id) {
  let body;
  if (id === "a") body = matrix();
  if (id === "b") body = switches(groups.map(group => group.name), "group") +
    '<div class="gauges">' + periods.map((label, i) => gauge(label, state.group, i)).join("") + "</div>";
  if (id === "c") body = `<div class="switches period-switch"><span class="switch-caption">剩余额度</span>${switches(periods, "period")}</div>` +
    '<div class="gauges trio">' + groups.map((group, i) => gauge(group.name, i, state.period)).join("") + "</div>";
  const refresh = refreshing.has(id) ? '<button class="detail" disabled>正在读取…</button>' :
    `<button class="detail" data-refresh="${id}">刷新</button>`;
  return `<div class="surface glass surface-${id}">${body}<div class="brand-row"><button class="detail" data-details><span class="brand">GEMINI</span> · 详情 ›</button>${refresh}</div></div>`;
}

function narrowDescription(id) {
  const cells = id === "a" ? [[0, 0], [0, 1], [1, 0], [1, 1]] :
    id === "b" ? [[state.group, 0], [state.group, 1]] : groups.map((_, i) => [i, state.period]);
  return cells.map(([group, period]) => {
    const { value, old } = sample(group, period);
    const amount = value === null ? "未读取" : (old ? "上次剩余 " : "剩余 ") + value + "%";
    return [groups[group].name, periods[period], amount].join(" ");
  }).join("，");
}

function narrow(id) {
  let body;
  if (id === "a") body = groups.slice(0, 2).map((group, i) =>
    `<span class="mini-row"><span class="mini-name">${group.name}</span>${periods.map((p, j) => `<span class="mini-cell"><span class="period-label">${p}</span>${reading(i, j)}</span>`).join("")}</span>`).join("");
  if (id === "b") body = `<span class="mini-name">${groups[state.group].name}</span>` +
    periods.map((period, i) => `<span class="mini-well"><span class="period-label">${period}</span>${reading(state.group, i)}</span>`).join("");
  if (id === "c") body = `<span class="period-label">${periods[state.period]}</span>` +
    groups.map((group, i) => `<span class="mini-well"><span class="mini-name">${group.name}</span>${reading(i, state.period)}</span>`).join("");
  return `<button type="button" class="glass narrow narrow-${id}" data-restore="${id}" title="恢复标准视图" aria-label="${narrowDescription(id)}。点击恢复标准视图">${body}</button>`;
}

function panel({ id, title, purpose, trade }) {
  return `<article class="concept" id="concept-${id}"><h2><span class="letter">${id.toUpperCase()}</span>${title}</h2><p class="purpose">${purpose}</p>
    <div class="stage">
      <section><h3 class="size">标准浮窗<span>300 × 130</span></h3>${standard(id)}</section>
      <section><h3 class="size">窄条<span>260 × 48</span></h3>${narrow(id)}</section>
    </div><p class="trade">${trade}</p></article>`;
}

function paintGlass() {
  if (!atlas.complete || !atlas.naturalWidth) return;
  const edge = atlas.naturalHeight;
  document.querySelectorAll("canvas").forEach(canvas => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const scale = devicePixelRatio || 1;
    const width = canvas.width = Math.round(bounds.width * scale);
    const height = canvas.height = Math.round(bounds.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(atlas, 0, 0, edge, edge, 0, 0, width, height);
    const group = Number(canvas.dataset.group);
    const value = sample(group, Number(canvas.dataset.period)).value;
    if (!value) return;
    const level = value / 100;
    const y = height * (.94 - .8 * level);
    const depth = height * Math.min(.087, .39 * level, .035 + .4 * (1 - level));
    const foot = Math.max(height * .79, y + depth + .20 * (height - y - depth));
    const x = edge * groups[group].tile;
    function band(from, to, top, bottom) {
      ctx.drawImage(atlas, x, edge * from, edge, edge * (to - from), 0, top, width, bottom - top);
    }
    band(.35, .54, y - depth, y + depth);
    band(.54, .79, y + depth, foot);
    band(.79, 1, foot, height);
  });
}

function draw() {
  board.innerHTML = concepts.map(panel).join("");
  if (viewer.open && viewer.dataset.concept) content.innerHTML = standard(viewer.dataset.concept);
  paintGlass();
}

function openViewer(title, markup, concept = "") {
  document.querySelector("#dialog-heading").textContent = title;
  viewer.dataset.concept = concept;
  content.innerHTML = markup;
  if (!viewer.open) viewer.showModal();
  paintGlass();
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "close") return viewer.close();
  if (button.dataset.kind) {
    const { kind, index } = button.dataset;
    const scope = button.closest("dialog, article");
    state[kind] = Number(index);
    draw();
    const restored = scope.id === "viewer" ? viewer : document.getElementById(scope.id);
    restored.querySelector(`[data-kind="${kind}"][data-index="${index}"]`).focus();
  } else if (button.dataset.restore) {
    const concept = concepts.find(option => option.id === button.dataset.restore);
    openViewer(concept.title + " · 标准浮窗", standard(concept.id), concept.id);
  } else if (button.dataset.refresh) {
    const id = button.dataset.refresh;
    refreshing.add(id);
    draw();
    window.setTimeout(() => {
      refreshing.delete(id);
      draw();
    }, 650);
  } else if (button.hasAttribute("data-details")) {
    const rows = groups.flatMap((group, i) => periods.map((period, j) => {
      const { value, old } = sample(i, j);
      return `<tr><td>${group.name}</td><td>${period}</td><td>${value === null ? "未读取" : (old ? "上次 " : "") + value + "%"}</td></tr>`;
    })).join("");
    openViewer("剩余额度 · 示例数据", `<table class="details-table"><thead><tr><th>来源</th><th>周期</th><th>剩余</th></tr></thead><tbody>${rows}</tbody></table>`);
  }
});
document.querySelector("#scenario").addEventListener("change", event => {
  state.scenario = event.target.value;
  draw();
});
atlas.addEventListener("load", paintGlass);
window.addEventListener("resize", paintGlass);
draw();
