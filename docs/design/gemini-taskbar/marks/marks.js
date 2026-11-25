const agents = [
  { id: "codex", name: "Codex" },
  { id: "zcode", name: "ZCode" },
  { id: "gemini", name: "Gemini" },
];
const variants = [
  ["engraved", "A", "独立刻印", "开口终端、折带 Z、双生星。"],
  ["silhouette", "B", "单色品牌章", "终端云、三段 Z、四芒星，同色系深墨印。"],
  ["original", "C", "原色圆章", "保留原图配色，嵌入瓷粉圆面。"],
];
const shapes = {
  engraved: {
    codex: '<path d="M19.6 5.8 16.3 8a6.45 6.45 0 1 0-1.6 10.5l3.25 2.35A10.25 10.25 0 1 1 19.6 5.8Z"/><path d="m11.7 8.2 4.5 3.9-4.5 3.9-1.55-1.85 2.45-2.05-2.45-2.05zM16.5 14.1h5.2v2.45h-5.2z"/>',
    zcode: '<path d="M2 4.2h17.2l-4 4H6zM21.9 4.65v5.6L8.7 20H2.25zM13.8 16.15h5.25L22 20H9.95z"/>',
    gemini: '<path fill-rule="evenodd" d="M10.3 1.1C11.5 6.9 14 10 20 12.1c-6 1.6-8.5 5-9.7 11C8.5 17.2 6.2 14.2.5 12.1c5.8-2 8.2-5.4 9.8-11Zm-.1 6.65c-.65 1.8-2.1 3.4-3.9 4.35 1.65.95 3.3 2.55 3.9 4.4.65-1.85 2.1-3.55 3.8-4.4-1.6-.95-3.2-2.45-3.8-4.35Z"/><path d="M19.85.8c.5 2.4 1.6 3.65 3.8 4.45-2.2.7-3.3 2.05-3.8 4.3-.55-2.25-1.65-3.55-3.85-4.3 2.2-.8 3.3-2.05 3.85-4.45Z"/>',
  },
  silhouette: {
    codex: '<path fill-rule="evenodd" d="M5.1 6.2c.9-3.7 5-5 8.25-2.85 3.75-.45 6.65 2.4 6.95 5.75 2.8 2.85 2.75 6.45 1.2 8.45.25 2.7-2.1 4.75-5.05 4.35-1.4 1.15-4.15 1.2-5.95-.35-3.55 1.1-7.15-.65-7.05-4.15C.3 14.35.7 9.3 5.1 6.2Zm2.2 2.25a.92.92 0 0 0-.32 1.24l1.6 2.75-1.6 2.75a.9.9 0 0 0 1.56.92l2.03-3.23a.86.86 0 0 0 0-.88l-2.03-3.23a.9.9 0 0 0-1.24-.32Zm5.65 6.2a.93.93 0 0 0 0 1.86h4.4a.93.93 0 0 0 0-1.86Z"/>',
    zcode: '<path d="M2.2 3.4h9.9l-1.4 1.91c-.37.5-.76.66-1.37.66H2.2zM13.55 3.4h8L10 20.6H1.8zM13.52 18.03h7.74v2.57H11.1l1.34-1.9c.28-.4.55-.67 1.08-.67Z"/>',
    gemini: '<path d="M11.25 1.55c.22-.9 1.28-.9 1.5 0 1.06 4.98 4.7 8.64 9.74 9.7.95.2.95 1.29 0 1.5-5.04 1.06-8.68 4.73-9.74 9.7-.22.91-1.28.91-1.5 0-1.06-4.97-4.7-8.64-9.74-9.7-.95-.21-.95-1.3 0-1.5 5.04-1.06 8.68-4.72 9.74-9.7Z"/>',
  },
};
const stateLabels = { idle: "静置", running: "运行", waiting: "等待", done: "完成", error: "报错" };
const notices = { waiting: "Ⅱ", done: "✔", error: "!" };

function circle(agent, variant) {
  const icon = variant === "original"
    ? '<img alt="" src="assets/' + agent.id + '.png">'
    : '<svg viewBox="0 0 24 24" aria-hidden="true">' + shapes[variant][agent.id] + '</svg>';
  return '<span class="orb ' + agent.id + '" role="img" data-agent="' + agent.name + '"><span class="glyph">' + icon + '</span><span class="status" aria-hidden="true"></span></span>';
}

function nativePanel(variant, compact) {
  const size = compact ? "260 px" : "300 px";
  const caption = compact ? "窄条 · 混合状态" : "标准浮窗";
  return '<div class="cap">' + caption + '<small>' + size + '</small></div><div class="panel ' + (compact ? 'compact' : 'standard') + '"><div class="window"><div class="strip">' +
    agents.map(a => circle(a, variant)).join('') + '</div></div></div>';
}

function setState(orb, state, alsoRunning = false) {
  orb.dataset.state = state;
  orb.dataset.running = String(state === "running" || alsoRunning);
  orb.dataset.notice = String(Boolean(notices[state]));
  orb.querySelector(".status").textContent = notices[state] || "";
  orb.setAttribute("aria-label", orb.dataset.agent + " · " + stateLabels[state] + (alsoRunning ? "，另有任务运行" : ""));
}

for (const [variant, letter, name, description] of variants) {
  const article = document.createElement("article");
  article.className = variant;
  const enlarged = agents.map(agent => '<figure>' + circle(agent, variant) + '<figcaption>' + agent.name + '</figcaption></figure>').join('');
  article.innerHTML = '<h2><i>' + letter + '</i>' + name + '</h2><p class="desc">' + description + '</p><div class="plate">' + enlarged + '</div>' +
    nativePanel(variant, false) + nativePanel(variant, true);
  document.querySelector(".directions").append(article);
  article.querySelectorAll(".compact .orb").forEach((orb, i) => setState(orb, ["running", "done", "error"][i], i === 2));
}
const buttons = document.querySelector(".states");
function preview(state) {
  document.querySelectorAll(".plate .orb, .standard .orb").forEach(orb => setState(orb, state));
  buttons.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(button.value === state)));
}
for (const [state, label] of Object.entries(stateLabels)) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.value = state;
  button.addEventListener("click", () => preview(state));
  buttons.append(button);
}
preview("idle");
