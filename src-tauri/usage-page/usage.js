/**
 * 用量统计页应用。状态机与文案契约来自 `.scratch/token-usage/page-state-notes.md`。
 *
 * 数据流：本机服务 /api/usage 快照 → 本地按区间聚合渲染。
 * 区间切换是纯本地计算，天然"最后一次选择生效"；
 * 每来源失败互不影响：保留账本数字并标注"上次数据"。
 */

import {
  abbrevTokens,
  addDays,
  calendarGrid,
  eachDay,
  formatDayTitle,
  formatTokens,
  heatScale,
  mergeDayClass,
  minusMonthsClamped,
  monotoneTopPath,
  monthGroupsFor,
  monthTitle,
  niceTicks,
  periodHeatColumns,
  periodRange,
  sourceDayInfo,
  sumRange,
  todayKey,
  weekdayIndex,
} from "./usage-core.js";

const RANGE_OPTIONS = [
  ["7d", "7天"],
  ["30d", "30天"],
  ["3m", "3个月"],
  ["6m", "6个月"],
  ["1y", "1年"],
  ["total", "合计"],
];
const VIEW_OPTIONS = [["merged", "合并"], ["split", "分开"]];
const SOURCES = [
  ["codex", "Codex"],
  ["zcode", "ZCode"],
];
const POLL_INTERVAL_MS = 15000;
const MAX_RANGE_DAYS = 800;

const state = {
  range: "30d",
  view: "merged",
  selectedDay: todayKey(),
  snapshot: null,
  connection: "connecting",
  lastFetchAtMs: null,
  refreshBusy: false,
  retryBusy: {},
};

const els = {};
for (const id of [
  "updated-line", "refresh-btn", "range-group", "view-group", "range-dates",
  "banner", "totals-label", "totals-number", "totals-note", "source-figures",
  "coverage", "calendar-month", "month-total", "month-total-note", "calendar",
  "day-detail", "trend-gap-note", "trend-dates", "trend-charts",
]) {
  els[id] = document.getElementById(id);
}

function timeText(ms, withSeconds = false) {
  if (!ms) return "";
  const options = { hour12: false, hour: "2-digit", minute: "2-digit" };
  if (withSeconds) options.second = "2-digit";
  return new Date(ms).toLocaleTimeString("zh-CN", options);
}

function dateShort(iso) {
  const [, month, day] = iso.split("-").map(Number);
  return `${month}/${day}`;
}

function snapshotSources() {
  const snapshot = state.snapshot;
  return {
    codex: snapshot?.codex ?? null,
    zcode: snapshot?.zcode ?? null,
  };
}

function sourceState(source) {
  return source?.state ?? "unreachable";
}

function sourceHasLedger(source) {
  return Boolean(source && (source.requestCount > 0 || Object.keys(source.daily ?? {}).length > 0));
}

function anyStale() {
  const { codex, zcode } = snapshotSources();
  return [codex, zcode].some(source => sourceState(source) === "failed" || sourceState(source) === "unreachable");
}

function anyBackfill() {
  const { codex, zcode } = snapshotSources();
  return [codex, zcode].some(source => sourceState(source) === "backfill");
}

function earliestRecordDay() {
  const { codex, zcode } = snapshotSources();
  const days = [codex?.earliestDay, zcode?.earliestDay].filter(Boolean);
  return days.length ? days.reduce((a, b) => (a < b ? a : b)) : null;
}

function currentRange() {
  return periodRange(state.range, todayKey(), earliestRecordDay());
}

/* ---------------- 拉取与轮询 ---------------- */

let lastSnapshotKey = null;

async function fetchSnapshot() {
  try {
    const response = await fetch("/api/usage", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    // generatedAtMs 每次轮询都会变；只有来源数据本身变化才替换快照，
    // 避免无新增的刷新触发整页重渲染打断焦点与交互。
    const meaningful = JSON.stringify([next.codex, next.zcode]);
    if (!state.snapshot || meaningful !== lastSnapshotKey) {
      state.snapshot = next;
      lastSnapshotKey = meaningful;
    }
    state.connection = "ok";
    state.lastFetchAtMs = Date.now();
    if (!state.selectedDay) state.selectedDay = todayKey();
  } catch {
    state.connection = "lost";
    // 断连时保留已显示的数字与选择，等待下一次轮询恢复。
  }
  render();
}

function schedulePoll() {
  setInterval(() => {
    if (document.visibilityState === "visible") void fetchSnapshot();
  }, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void fetchSnapshot();
  });
}

async function manualRefresh() {
  if (state.refreshBusy) return;
  state.refreshBusy = true;
  render();
  await fetchSnapshot();
  state.refreshBusy = false;
  render();
}

async function retrySource(sourceKey) {
  if (state.retryBusy[sourceKey]) return;
  state.retryBusy[sourceKey] = true;
  render();
  try {
    await fetch(`/api/refresh?source=${sourceKey}`, { method: "POST", cache: "no-store" });
  } catch {
    /* 断连时重试请求本身失败，等待下一次轮询。 */
  }
  for (const delay of [1000, 2500, 5000]) {
    setTimeout(() => {
      if (document.visibilityState === "visible") void fetchSnapshot();
    }, delay);
  }
  setTimeout(() => {
    state.retryBusy[sourceKey] = false;
    render();
  }, 6000);
}

/* ---------------- 渲染 ---------------- */

let lastRenderKey = null;

function renderStateKey() {
  return [
    JSON.stringify(state.snapshot),
    state.range,
    state.view,
    state.selectedDay,
    state.connection,
    JSON.stringify(state.retryBusy),
    state.refreshBusy,
  ].join("|");
}

function render() {
  // 轮询无新增时跳过重渲染：保留焦点、选中态与滚动位置（刷新成功不丢键盘焦点）。
  const key = renderStateKey();
  if (key === lastRenderKey) return;
  lastRenderKey = key;
  renderControls();
  renderBanner();
  renderTotals();
  renderCoverage();
  renderCalendar();
  renderTrend();
  renderUpdatedLine();
}

function renderUpdatedLine() {
  const { codex, zcode } = snapshotSources();
  if (state.connection === "lost") {
    els["updated-line"].textContent = "连接已断开 · 保留上次数据";
    return;
  }
  const times = [codex?.lastSuccessAtMs, zcode?.lastSuccessAtMs].filter(Boolean);
  if (!times.length) {
    els["updated-line"].textContent = state.snapshot ? "首次读取中…" : "正在连接 QuoDex…";
    return;
  }
  els["updated-line"].textContent = `最近成功读取 ${timeText(Math.max(...times), true)}`;
}

function renderControls() {
  const rangeGroup = els["range-group"];
  rangeGroup.replaceChildren(...RANGE_OPTIONS.map(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill";
    button.dataset.range = key;
    button.dataset.selected = key === state.range;
    button.setAttribute("aria-pressed", key === state.range);
    button.textContent = label;
    button.addEventListener("click", () => {
      state.range = key;
      render();
    });
    return button;
  }));
  const viewGroup = els["view-group"];
  viewGroup.replaceChildren(...VIEW_OPTIONS.map(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill pill--view";
    button.dataset.view = key;
    button.dataset.selected = key === state.view;
    button.setAttribute("aria-pressed", key === state.view);
    button.textContent = label;
    button.addEventListener("click", () => {
      state.view = key;
      render();
    });
    return button;
  }));
  const range = currentRange();
  els["range-dates"].textContent = range.start
    ? `${range.start.replaceAll("-", ".")} — ${range.today.replaceAll("-", ".")}`
    : "暂无已记录起点";
}

function renderBanner() {
  const banner = els.banner;
  const { codex, zcode } = snapshotSources();
  const everLoaded = Boolean(state.snapshot);
  if (state.connection === "lost" && everLoaded) {
    banner.hidden = false;
    banner.replaceChildren(...bannerNodes(
      "无法连接 QuoDex；保留上次数据。请启动或重新打开 QuoDex 后重试",
      "QDU-708",
    ));
    return;
  }
  if (everLoaded && !sourceHasLedger(codex) && !sourceHasLedger(zcode)
    && sourceState(codex) === "failed" && sourceState(zcode) === "failed") {
    banner.hidden = false;
    banner.replaceChildren(...bannerNodes("尚未读取到用量；两来源均读取失败", null, true));
    return;
  }
  banner.hidden = true;
  banner.replaceChildren();
}

function bannerNodes(message, code, withRetry = false) {
  const nodes = [];
  const strong = document.createElement("strong");
  strong.textContent = message;
  nodes.push(strong);
  if (code) {
    const codeSpan = document.createElement("span");
    codeSpan.className = "diag-code";
    codeSpan.textContent = code;
    nodes.push(codeSpan);
  }
  if (withRetry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill pill--retry";
    button.textContent = "重试";
    button.addEventListener("click", () => {
      void retrySource("codex");
      void retrySource("zcode");
    });
    nodes.push(button);
  }
  return nodes;
}

function periodSumFor(source, range) {
  if (!source) return { total: 0, hasData: false };
  const total = sumRange(source.daily ?? {}, range.start, range.endExclusive);
  const hasData = sourceHasLedger(source);
  return { total, hasData };
}

function renderTotals() {
  const range = currentRange();
  const { codex, zcode } = snapshotSources();
  const codexSum = periodSumFor(codex, range);
  const zcodeSum = periodSumFor(zcode, range);
  const available = [codexSum, zcodeSum].filter(item => item.hasData);
  const label = els["totals-label"];
  const number = els["totals-number"];
  const note = els["totals-note"];
  if (!state.snapshot) {
    label.textContent = "已记录用量";
    number.textContent = "—";
    note.textContent = "正在连接 QuoDex…";
    note.className = "totals-note totals-note--muted";
  } else if (!available.length) {
    label.textContent = "已记录用量";
    number.textContent = "—";
    note.textContent = state.connection === "lost"
      ? "保留上次数据，等待重新连接"
      : "尚未读取到已记录用量";
    note.className = "totals-note totals-note--muted";
  } else if (available.length === 1) {
    label.textContent = "已记录用量";
    number.textContent = formatTokens(available[0].total);
    note.textContent = "可用来源已记录小计";
    note.className = "totals-note";
  } else {
    label.textContent = state.range === "total" ? "已记录合计" : "已记录用量";
    number.textContent = formatTokens(codexSum.total + zcodeSum.total);
    const notes = [];
    if (anyStale()) notes.push("含未更新数据");
    if (anyBackfill()) notes.push("正在补采");
    note.textContent = notes.join("；");
    note.className = "totals-note";
  }

  els["source-figures"].replaceChildren(...SOURCES.map(([key, name]) => {
    const source = key === "codex" ? codex : zcode;
    const sum = key === "codex" ? codexSum : zcodeSum;
    const figure = document.createElement("div");
    figure.className = "source-figure";
    const head = document.createElement("div");
    head.className = "source-figure-head";
    const dot = document.createElement("span");
    dot.className = `source-dot source-dot--${key}`;
    dot.setAttribute("aria-hidden", "true");
    head.append(dot, document.createTextNode(name));
    const value = document.createElement("div");
    value.className = "source-figure-value";
    value.textContent = sum.hasData ? formatTokens(sum.total) : "—";
    const time = document.createElement("div");
    time.className = "source-figure-time";
    const status = sourceState(source);
    if (status === "ready") time.textContent = `更新于 ${timeText(source.lastSuccessAtMs)}`;
    else if (status === "failed") time.textContent = sum.hasData ? `上次数据 ${timeText(source.lastSuccessAtMs)}` : "读取失败";
    else if (status === "backfill") time.textContent = sum.hasData ? "正在补采；当前显示上次数据" : "正在读取本机历史记录";
    else time.textContent = "尚未读取";
    figure.append(head, value, time);
    return figure;
  }));
}

function renderCoverage() {
  const range = currentRange();
  const { codex, zcode } = snapshotSources();
  const rows = [];
  // 本地留存保证：账本独立于来源应用的历史清理策略。
  const ledgerRow = document.createElement("div");
  ledgerRow.className = "coverage-row coverage-row--ledger";
  const counts = [codex, zcode].map(source => source?.requestCount ?? 0);
  ledgerRow.textContent = `本地账本长期保存 · 已记录 ${formatTokens(counts[0])} + ${formatTokens(counts[1])} 条请求；来源应用只保留近期记录，保持 QuoDex 运行即自动补采`;
  rows.push(ledgerRow);
  for (const [key, name] of SOURCES) {
    const source = key === "codex" ? codex : zcode;
    const row = document.createElement("div");
    row.className = "coverage-row";
    const parts = [];
    if (source?.earliestDay) parts.push(`${name}：最早留存记录 ${source.earliestDay}`);
    if (source?.collectionStartDay) parts.push(`持续采集自 ${source.collectionStartDay}`);
    if (source?.earliestDay && range.start && source.earliestDay > range.start) {
      parts.push(`${dateShort(source.earliestDay)} 前记录不足`);
    }
    if (!parts.length && sourceState(source) !== "backfill") {
      parts.push(`${name}：暂无已记录用量`);
    }
    row.textContent = parts.filter(Boolean).join(" · ");
    const hasError = Boolean(source?.diagnostic);
    if (state.retryBusy[key]) {
      const pending = document.createElement("span");
      pending.textContent = "正在重试…";
      row.append(pending);
    }
    if (hasError) {
      row.classList.add("coverage-row--error");
      const reason = document.createElement("span");
      reason.className = "coverage-reason";
      reason.textContent = source.diagnostic.message;
      const code = document.createElement("span");
      code.className = "diag-code";
      code.textContent = source.diagnostic.code;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "pill pill--retry";
      retry.dataset.retry = key;
      retry.textContent = `重试 ${name}`;
      retry.disabled = Boolean(state.retryBusy[key]);
      retry.addEventListener("click", () => void retrySource(key));
      row.append(reason, code, retry);
    }
    if (row.textContent || row.children.length) rows.push(row);
  }
  els.coverage.replaceChildren(...rows);
}

/* ---------------- 日历 / 期间热力 ---------------- */

const PERIOD_HEAT_RANGES = new Set(["3m", "6m", "1y", "total"]);

function calendarDataset() {
  const today = todayKey();
  const { codex, zcode } = snapshotSources();
  const periodHeat = PERIOD_HEAT_RANGES.has(state.range);
  const range = currentRange();
  let days;
  let columns;
  let monthLabels;
  if (periodHeat) {
    if (!range.start) {
      return { mode: "period", today, days: [], columns: [], monthLabels: [], codexInfo: new Map(), zcodeInfo: new Map(), mergedByDay: new Map(), columnTotals: [], monthGroups: [], scale: heatScale([]) };
    }
    const heat = periodHeatColumns(range.start, range.endExclusive, MAX_RANGE_DAYS / 7 + 2);
    columns = heat.columns;
    monthLabels = heat.monthLabels;
    days = heat.columns.flat().filter(Boolean);
  } else {
    days = calendarGrid(today);
  }
  const codexInfo = new Map();
  const zcodeInfo = new Map();
  const mergedByDay = new Map();
  const values = [];
  for (const day of days) {
    if (!day) continue;
    const infoA = sourceDayInfo(codex ?? { daily: {} }, day, today);
    const infoB = sourceDayInfo(zcode ?? { daily: {} }, day, today);
    codexInfo.set(day, infoA);
    zcodeInfo.set(day, infoB);
    const cls = mergeDayClass([infoA.cls, infoB.cls]);
    const value = (infoA.cls === "value" ? infoA.value : 0) + (infoB.cls === "value" ? infoB.value : 0);
    mergedByDay.set(day, { cls, value });
    if (infoA.cls === "value") values.push(infoA.value);
    if (infoB.cls === "value") values.push(infoB.value);
  }
  const dataset = {
    mode: periodHeat ? "period" : "month",
    today,
    days,
    columns,
    monthLabels,
    codexInfo,
    zcodeInfo,
    mergedByDay,
    scale: heatScale(values),
  };
  if (periodHeat) {
    // 周合计（列）与月合计（柱条）用于右侧预览与月度总览
    dataset.columnTotals = columns.map(column => column.reduce((sum, day) => sum + (day && mergedByDay.get(day)?.cls === "value" ? mergedByDay.get(day).value : 0), 0));
    dataset.monthGroups = monthGroupsFor(columns).map(group => ({
      ...group,
      total: group.days.reduce((sum, day) => sum + (mergedByDay.get(day)?.cls === "value" ? mergedByDay.get(day).value : 0), 0),
    }));
  }
  return dataset;
}

function renderCalendar() {
  const dataset = calendarDataset();
  // 去重计数：两来源都有记录的同一天只算一天
  const recordedDays = dataset.days.filter(day => day && mergeDayClass([
    dataset.codexInfo.get(day).cls,
    dataset.zcodeInfo.get(day).cls,
  ]) === "value").length;
  const monthTotal = [...dataset.codexInfo.values()].reduce((sum, info) => sum + (info.cls === "value" ? info.value : 0), 0)
    + [...dataset.zcodeInfo.values()].reduce((sum, info) => sum + (info.cls === "value" ? info.value : 0), 0);

  const head = document.querySelector(".calendar-section .section-head");
  const monthLabel = document.getElementById("calendar-month");
  const note = head?.querySelector(".section-note");
  const totalWrap = document.querySelector(".month-total");
  if (dataset.mode === "period") {
    const range = currentRange();
    if (monthLabel) monthLabel.textContent = range.start
      ? `期间热力 · ${range.start.replaceAll("-", ".")} — ${range.today.replaceAll("-", ".")}`
      : "期间热力 · 暂无起点";
    if (note) note.textContent = "同一日期的用量随区间范围积累展示";
    if (totalWrap) {
      totalWrap.replaceChildren(
        document.createTextNode(`本期已记录 ${formatTokens(recordedDays)} 天 · 合计 `),
      );
      const strong = document.createElement("strong");
      strong.id = "month-total";
      strong.textContent = formatTokens(monthTotal);
      totalWrap.append(strong, document.createTextNode(" tokens"));
      const staleNote = document.createElement("span");
      staleNote.id = "month-total-note";
      staleNote.className = "section-note";
      staleNote.textContent = anyStale() ? "（含未更新数据）" : "";
      totalWrap.append(staleNote);
    }
  } else {
    if (monthLabel) monthLabel.textContent = monthTitle(dataset.today);
    if (note) note.textContent = "本月已记录用量，与上方区间独立";
    if (totalWrap) {
      totalWrap.replaceChildren(document.createTextNode("本月合计 "));
      const strong = document.createElement("strong");
      strong.id = "month-total";
      strong.textContent = formatTokens(monthTotal);
      totalWrap.append(strong, document.createTextNode(" tokens"));
      const staleNote = document.createElement("span");
      staleNote.id = "month-total-note";
      staleNote.className = "section-note";
      staleNote.textContent = anyStale() ? "（含未更新数据）" : "";
      totalWrap.append(staleNote);
    }
  }

  const grid = els.calendar;
  calendarView = dataset;
  const structureKey = JSON.stringify([state.range, state.view, dataset.mode, dataset.days]);
  if (dataset.mode === "period" && heatLayout && calendarStructureKey === structureKey) {
    updatePeriodHeat(dataset);
  } else if (dataset.mode === "period") {
    grid.replaceChildren();
    renderPeriodHeat(grid, dataset);
  } else {
    heatLayout = null;
    grid.replaceChildren();
    grid.removeAttribute("data-mode");
    for (const label of ["一", "二", "三", "四", "五", "六", "日"]) {
      const head = document.createElement("span");
      head.className = "calendar-weekday";
      head.setAttribute("role", "columnheader");
      head.textContent = label;
      grid.append(head);
    }
    for (const day of dataset.days) {
      if (!day) {
        const pad = document.createElement("span");
        pad.className = "calendar-cell calendar-cell--pad";
        pad.setAttribute("aria-hidden", "true");
        grid.append(pad);
        continue;
      }
      grid.append(calendarCell(day, dataset));
    }
  }
  calendarStructureKey = structureKey;
  renderCalendarDetail();
}

function renderPeriodHeat(grid, dataset) {
  grid.setAttribute("data-mode", "period");
  const wrap = document.createElement("div");
  wrap.className = "heat-wrap";
  const body = document.createElement("div");
  body.className = "heat-body";
  const weekdays = document.createElement("div");
  weekdays.className = "heat-weekdays";
  for (const label of ["一", "二", "三", "四", "五", "六", "日"]) {
    const item = document.createElement("span");
    item.textContent = label;
    weekdays.append(item);
  }
  // 热力墙月份标签与日格共用周坐标；月度统计使用独立的月份坐标。
  const scroll = document.createElement("div");
  scroll.className = "heat-scroll";
  const columns = document.createElement("div");
  columns.className = "heat-columns";
  const count = Math.max(dataset.columns.length, 1);
  columns.style.gridTemplateColumns = `repeat(${count}, var(--heat-cell))`;

  // 背景层只标记周列，不改变零值、未知和用量格的原始色级。
  const highlight = document.createElement("div");
  highlight.className = "heat-week-highlight";
  highlight.hidden = true;
  highlight.setAttribute("aria-hidden", "true");
  columns.append(highlight);
  dataset.columns.forEach((column, columnIndex) => {
    for (const day of column) {
      if (!day) {
        const pad = document.createElement("span");
        pad.className = "heat-cell heat-cell--pad";
        pad.setAttribute("aria-hidden", "true");
        columns.append(pad);
        continue;
      }
      columns.append(heatCell(day, dataset, columnIndex));
    }
  });

  const monthSection = document.createElement("section");
  monthSection.className = "heat-month-chart";
  monthSection.setAttribute("aria-label", "所选期间内月度已记录用量");
  const monthHead = document.createElement("div");
  monthHead.className = "heat-month-head";
  const monthTitle = document.createElement("h3");
  monthTitle.textContent = "月度已记录用量";
  const monthNote = document.createElement("span");
  monthNote.textContent = "所选期间内 · tokens";
  monthHead.append(monthTitle, monthNote);
  const monthScroll = document.createElement("div");
  monthScroll.className = "heat-month-scroll";
  const bars = document.createElement("div");
  bars.className = "heat-bars";
  bars.style.gridTemplateColumns = `repeat(${dataset.monthGroups.length}, minmax(84px, 1fr))`;
  const maxMonthTotal = Math.max(...dataset.monthGroups.map(group => group.total), 1);
  dataset.monthGroups.forEach(group => {
    const bar = document.createElement("div");
    bar.className = "heat-bar";
    bar.dataset.month = group.key;
    bar.tabIndex = 0;
    bar.setAttribute("role", "img");
    const plot = document.createElement("div");
    plot.className = "heat-bar-plot";
    const value = document.createElement("span");
    value.className = "heat-bar-value";
    const fill = document.createElement("div");
    fill.className = "heat-bar-fill";
    plot.append(value, fill);
    const month = document.createElement("span");
    month.className = "heat-bar-month";
    month.textContent = group.key.replace("-", ".");
    bar.append(plot, month);
    updateHeatBar(bar, group, dataset, maxMonthTotal);
    bars.append(bar);
  });
  monthScroll.append(bars);
  monthSection.append(monthHead, monthScroll);

  const months = document.createElement("div");
  months.className = "heat-months";
  months.style.width = `calc(${count} * var(--heat-cell) + ${(count - 1) * 3}px)`;
  for (const { column, label } of dataset.monthLabels) {
    const span = document.createElement("span");
    span.style.left = `calc(${column} * (var(--heat-cell) + 3px))`;
    // 月初可能与上一月共用周列，用该标签列的实际日期匹配月份。
    const month = dataset.columns[column].find(Boolean)?.slice(0, 7);
    const group = dataset.monthGroups.find(item => item.key === month);
    if (group) span.dataset.month = group.key;
    span.textContent = label;
    months.append(span);
  }

  scroll.append(months, columns);
  body.append(weekdays, scroll);
  wrap.append(body, monthSection);
  grid.append(wrap);

  // 格子尺寸随容器宽度自适应：短区间放大铺满，长区间保底并横向滚动。
  heatLayout = { wrap, scroll, monthScroll, bars, columns, weekdays, count, highlight, pointerPreview: null, focusPreview: null };
  wrap.addEventListener("pointerover", event => setHeatPreview("pointerPreview", heatPreviewFor(event.target)));
  wrap.addEventListener("pointerout", event => setHeatPreview("pointerPreview", heatPreviewFor(event.relatedTarget)));
  wrap.addEventListener("focusin", event => {
    const bar = event.target.closest?.(".heat-bar");
    bar?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    setHeatPreview("focusPreview", heatPreviewFor(event.target));
  });
  wrap.addEventListener("focusout", event => setHeatPreview("focusPreview", heatPreviewFor(event.relatedTarget)));
  scroll.addEventListener("scroll", () => setHeatPreview("pointerPreview", null), { passive: true });
  monthScroll.addEventListener("scroll", () => setHeatPreview("pointerPreview", null), { passive: true });
  requestAnimationFrame(() => applyHeatCellSize());
  // 切换区间后停在最新一端（右侧）：空白的更早历史不必是第一眼。
  const heatKey = `${state.range}|${state.view}`;
  if (lastHeatScrollKey !== heatKey) {
    lastHeatScrollKey = heatKey;
    requestAnimationFrame(() => {
      scroll.scrollLeft = scroll.scrollWidth;
      monthScroll.scrollLeft = monthScroll.scrollWidth;
      applyHeatCellSize();
    });
  }
}

let heatLayout = null;
let lastHeatScrollKey = null;
let calendarView = null;
let calendarStructureKey = null;

function heatPreviewFor(target) {
  const cell = target?.closest?.(".heat-cell[data-day]");
  if (cell && heatLayout?.scroll.contains(cell)) {
    return { kind: "day", day: cell.dataset.day, column: Number(cell.dataset.column) };
  }
  const month = target?.closest?.("[data-month]");
  return month && heatLayout?.wrap.contains(month) ? { kind: "month", key: month.dataset.month } : null;
}

function setHeatPreview(channel, preview) {
  if (!heatLayout) return;
  const previous = heatLayout[channel];
  const other = channel === "pointerPreview" ? "focusPreview" : "pointerPreview";
  if (JSON.stringify(previous) === JSON.stringify(preview) && (!preview || !heatLayout[other])) return;
  if (preview) heatLayout[other] = null;
  heatLayout[channel] = preview;
  renderCalendarDetail();
}

function updatePeriodHeat(dataset) {
  for (const cell of heatLayout.columns.querySelectorAll(".heat-cell[data-day]")) {
    const day = cell.dataset.day;
    const column = Number(cell.dataset.column);
    const merged = dataset.mergedByDay.get(day);
    const tag = merged.cls === "unknown" || merged.cls === "future" ? "SPAN" : "BUTTON";
    if (cell.tagName === tag) updateHeatCell(cell, day, dataset, column);
    else {
      const focused = document.activeElement === cell;
      const replacement = heatCell(day, dataset, column);
      cell.replaceWith(replacement);
      if (focused && merged.cls !== "future") replacement.focus({ preventScroll: true });
    }
  }
  const maxMonthTotal = Math.max(...dataset.monthGroups.map(group => group.total), 1);
  for (const bar of heatLayout.bars.querySelectorAll(".heat-bar")) {
    const group = dataset.monthGroups.find(item => item.key === bar.dataset.month);
    updateHeatBar(bar, group, dataset, maxMonthTotal);
  }
}

function updateHeatBar(bar, group, dataset, maxMonthTotal) {
  const recorded = recordedHeatTotal(dataset, group.days);
  bar.classList.toggle("is-unknown", recorded === null);
  bar.classList.toggle("is-zero", recorded === 0);
  bar.setAttribute("aria-label", `${monthTitle(`${group.key}-01`)}，${recorded === null ? "无可核对记录" : `已记录合计 ${formatTokens(recorded)} tokens`}`);
  bar.querySelector(".heat-bar-value").textContent = recorded === null ? "—" : abbrevTokens(recorded);
  bar.style.setProperty("--bar-h", recorded === null ? "4px" : recorded === 0 ? "2px" : `${(recorded / maxMonthTotal) * 100}%`);
}

function selectCalendarDay(day) {
  state.selectedDay = day;
  for (const cell of els.calendar.querySelectorAll("button[data-day]")) {
    const selected = cell.dataset.day === day;
    cell.dataset.selected = selected;
    cell.setAttribute("aria-pressed", selected);
  }
  renderCalendarDetail();
  // 已局部同步选中态；同快照轮询无需重新渲染月历或趋势。
  lastRenderKey = renderStateKey();
}

function renderCalendarDetail() {
  if (!calendarView) return;
  const preview = heatLayout?.pointerPreview ?? heatLayout?.focusPreview;
  const detail = els["day-detail"];
  detail.classList.toggle("day-detail-preview", Boolean(preview));
  if (preview) detail.dataset.previewKind = preview.kind;
  else delete detail.dataset.previewKind;
  if (heatLayout) {
    const previousCell = heatLayout.columns.querySelector('[data-preview="true"]');
    if (previousCell) delete previousCell.dataset.preview;
    const highlight = heatLayout.highlight;
    highlight.hidden = preview?.kind !== "day";
    if (preview?.kind === "day") {
      highlight.dataset.column = String(preview.column);
      highlight.style.transform = `translateX(calc(${preview.column} * (var(--heat-cell) + 3px)))`;
      const cell = heatLayout.columns.querySelector(`[data-day="${preview.day}"]`);
      if (cell) cell.dataset.preview = "true";
    }
  }
  if (preview?.kind === "month") renderMonthPreview(calendarView, preview.key);
  else {
    renderDayDetail(calendarView, preview?.day);
    if (preview?.kind === "day") {
      const rows = document.createElement("div");
      rows.className = "day-detail-sources day-detail-period-totals";
      const month = calendarView.monthGroups.find(group => group.key === preview.day.slice(0, 7));
      for (const [kind, label, days] of [["week", "本周范围", calendarView.columns[preview.column]], ["month", "本月范围", month?.days ?? []]]) {
        const group = document.createElement("div");
        group.className = "day-detail-period-total";
        const row = document.createElement("div");
        row.className = "day-detail-source";
        const bounds = heatPeriodBounds(preview.day, kind);
        const rangeLabel = document.createElement("span");
        rangeLabel.className = "day-detail-period-label";
        rangeLabel.textContent = `${label} · ${dateSpanText(bounds.start, bounds.end)}`;
        const amount = document.createElement("span");
        amount.className = "value";
        const value = recordedHeatTotal(calendarView, days);
        amount.textContent = value === null ? "—" : formatTokens(value);
        row.append(rangeLabel, amount);
        const note = document.createElement("span");
        note.className = "day-detail-period-note";
        note.textContent = periodSubtotalText(days);
        group.append(row, note);
        rows.append(group);
      }
      detail.append(rows);
    }
  }
  renderLegend(calendarView);
}

function renderMonthPreview(dataset, key) {
  const group = dataset.monthGroups.find(item => item.key === key);
  const detail = els["day-detail"];
  detail.replaceChildren();
  if (!group) return;
  const title = document.createElement("h3");
  title.className = "day-detail-title";
  title.textContent = monthTitle(`${key}-01`);
  const sub = document.createElement("span");
  sub.className = "day-detail-sub";
  const bounds = heatPeriodBounds(`${key}-01`, "month");
  sub.textContent = `本月范围 · ${dateSpanText(bounds.start, bounds.end)}`;
  const total = document.createElement("div");
  total.className = "day-detail-total";
  const amount = document.createElement("strong");
  const recorded = recordedHeatTotal(dataset, group.days);
  amount.textContent = recorded === null ? "—" : formatTokens(recorded);
  const unit = document.createElement("span");
  unit.textContent = "tokens";
  total.append(amount, unit);
  const subtotalNote = document.createElement("span");
  subtotalNote.className = "day-detail-period-note";
  subtotalNote.textContent = periodSubtotalText(group.days);
  const note = document.createElement("span");
  note.className = "day-detail-note";
  note.textContent = recorded === null
    ? "无可核对记录；移开恢复所选日"
    : anyStale() ? "含未更新数据；移开恢复所选日" : "仅汇总已记录用量；缺失历史不等于零";
  detail.append(title, sub, total, subtotalNote, note);
}

function heatPeriodBounds(day, kind) {
  const start = kind === "week" ? addDays(day, -weekdayIndex(day)) : `${day.slice(0, 7)}-01`;
  return { start, end: kind === "week" ? addDays(start, 6) : addDays(minusMonthsClamped(start, -1), -1) };
}

function dateSpanText(start, end) {
  return `${start.replaceAll("-", ".")} — ${end.replaceAll("-", ".")}`;
}

function periodSubtotalText(days) {
  const included = days.filter(Boolean);
  return included.length
    ? `所选期间内已记录小计 · ${dateSpanText(included[0], included.at(-1))}`
    : "所选期间内无可核对日期";
}

/** 无已知日期时不能把求和初值 0 当作已确认零。 */
function recordedHeatTotal(dataset, days = []) {
  const known = days.map(day => dataset.mergedByDay.get(day)).filter(info => info?.cls === "value" || info?.cls === "zero");
  return known.length ? known.reduce((total, info) => total + (info.cls === "value" ? info.value : 0), 0) : null;
}

function applyHeatCellSize() {
  if (!heatLayout) return;
  const { wrap, scroll, count } = heatLayout;
  const minCell = window.innerWidth <= 760 || window.matchMedia?.("(pointer: coarse)")?.matches ? 22 : 16;
  // scroll 的宽度已扣除星期栏，直接按它铺满，避免二次扣减。
  const available = Math.max(scroll.clientWidth, count * minCell);
  const cell = Math.max(minCell, Math.min(40, Math.floor((available - (count - 1) * 3) / count)));
  wrap.style.setProperty("--heat-cell", `${cell}px`);
}

window.addEventListener("resize", () => applyHeatCellSize());

function heatCell(day, dataset, columnIndex) {
  const merged = dataset.mergedByDay.get(day);
  const readonly = merged.cls === "unknown" || merged.cls === "future";
  const cell = document.createElement(readonly ? "span" : "button");
  if (readonly) {
    cell.tabIndex = -1;
    cell.setAttribute("role", "img");
  }
  else {
    cell.type = "button";
    cell.addEventListener("click", () => selectCalendarDay(day));
  }
  updateHeatCell(cell, day, dataset, columnIndex);
  return cell;
}

function updateHeatCell(cell, day, dataset, columnIndex) {
  const merged = dataset.mergedByDay.get(day);
  const columnTotal = dataset.columnTotals[columnIndex] ?? 0;
  const monthTotal = dataset.monthGroups.find(group => group.key === day.slice(0, 7))?.total ?? 0;
  cell.className = `heat-cell${merged.cls === "unknown" || merged.cls === "future" ? ` heat-cell--${merged.cls}` : ""}`;
  cell.dataset.day = day;
  cell.dataset.column = String(columnIndex);
  cell.dataset.state = merged.cls;
  if (merged.cls === "value") {
    cell.dataset.level = dataset.scale.level(merged.value);
  } else {
    if (merged.cls === "zero") cell.dataset.level = "0";
    else delete cell.dataset.level;
  }
  const dayText = merged.cls === "value" ? `已记录 ${formatTokens(merged.value)} tokens` : merged.cls === "zero" ? "已确认零" : merged.cls === "future" ? "尚未到来" : "无可核对记录";
  const weekRecorded = recordedHeatTotal(dataset, dataset.columns[columnIndex]);
  const monthRecorded = recordedHeatTotal(dataset, dataset.monthGroups.find(group => group.key === day.slice(0, 7))?.days);
  cell.setAttribute("aria-label", `${formatDayTitle(day)}，${dayText}；本周已记录合计 ${weekRecorded === null ? "无可核对记录" : formatTokens(columnTotal)}，本月已记录合计 ${monthRecorded === null ? "无可核对记录" : formatTokens(monthTotal)}`);
  if (cell.tagName !== "BUTTON") return;
  cell.dataset.weekTotal = String(columnTotal);
  const selected = state.selectedDay === day;
  cell.dataset.selected = selected;
  cell.setAttribute("aria-pressed", selected);
}

function calendarCell(day, dataset) {
  const codexInfo = dataset.codexInfo.get(day);
  const zcodeInfo = dataset.zcodeInfo.get(day);
  const classes = state.view === "split"
    ? [codexInfo.cls, zcodeInfo.cls]
    : [mergeDayClass([codexInfo.cls, zcodeInfo.cls])];
  const knownClasses = classes.filter(item => item !== "future");
  const effective = knownClasses.length ? mergeDayClass(knownClasses) : "future";
  // 未知日不可点击：与期间热力墙一致，避免跳到"无可核对记录"空态。
  if (effective === "unknown") {
    const span = document.createElement("span");
    span.className = "calendar-cell calendar-cell--unknown";
    span.dataset.day = day;
    const dayNumber = document.createElement("span");
    dayNumber.className = "calendar-day";
    dayNumber.textContent = String(Number(day.slice(8)));
    span.append(dayNumber);
    span.title = `${formatDayTitle(day)}：无可核对记录`;
    return span;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "calendar-cell";
  button.dataset.day = day;
  const dayNumber = document.createElement("span");
  dayNumber.className = "calendar-day";
  dayNumber.textContent = String(Number(day.slice(8)));
  button.append(dayNumber);

  const mergedClass = classes[0];
  const isFuture = mergedClass === "future" || (state.view === "split" && codexInfo.cls === "future" && zcodeInfo.cls === "future");
  button.dataset.state = effective;

  if (effective === "value") {
    if (state.view === "merged") {
      const total = (codexInfo.cls === "value" ? codexInfo.value : 0) + (zcodeInfo.cls === "value" ? zcodeInfo.value : 0);
      const amount = document.createElement("span");
      amount.className = "calendar-amount";
      // 大数值用缩写保住格内可读性；精确数在 title、aria 与选中日详情里。
      amount.textContent = cellAmount(total);
      button.title = `${formatTokens(total)} tokens`;
      button.dataset.level = dataset.scale.level(total);
      button.append(amount);
    } else {
      const bands = document.createElement("span");
      bands.className = "cell-bands";
      bands.append(bandRow("codex", codexInfo, dataset.scale), bandRow("zcode", zcodeInfo, dataset.scale));
      button.append(bands);
      const ownMax = Math.max(
        codexInfo.cls === "value" ? codexInfo.value : 0,
        zcodeInfo.cls === "value" ? zcodeInfo.value : 0,
      );
      button.dataset.level = dataset.scale.level(ownMax);
    }
  } else if (effective === "zero") {
    const amount = document.createElement("span");
    amount.className = "calendar-amount";
    amount.textContent = "0";
    button.dataset.level = "0";
    button.append(amount);
  }

  if (day === dataset.today) {
    const dot = document.createElement("span");
    dot.className = "calendar-today-dot";
    dot.title = "今天";
    button.append(dot);
  }
  if (isFuture) {
    button.disabled = true;
  }
  const selected = state.selectedDay === day;
  button.dataset.selected = selected;
  button.setAttribute("aria-pressed", selected);
  button.setAttribute("aria-label", cellAriaLabel(day, effective, codexInfo, zcodeInfo, dataset));
  if (!isFuture) {
    button.addEventListener("click", () => {
      selectCalendarDay(day);
    });
  }
  return button;
}

/** 日历格内金额：六位以内用千位分隔精确数，更大缩写；悬停 title 与详情提供精确值。 */
function cellAmount(value) {
  return value < 1_000_000 ? formatTokens(value) : abbrevTokens(value);
}

function bandRow(sourceKey, info, scale) {
  const band = document.createElement("span");
  band.className = `cell-band cell-band--${sourceKey}${info.cls !== "value" ? " cell-band--none" : ""}`;
  const dot = document.createElement("span");
  dot.className = "cell-band-dot";
  dot.setAttribute("aria-hidden", "true");
  const value = document.createElement("span");
  value.className = "cell-band-value";
  if (info.cls === "value") {
    value.textContent = cellAmount(info.value);
    band.dataset.level = scale.level(info.value);
  } else if (info.cls === "zero") {
    value.textContent = "0";
  } else if (info.cls === "future") {
    value.textContent = "";
  } else {
    value.textContent = "—";
  }
  band.append(dot, value);
  return band;
}

function cellAriaLabel(day, effective, codexInfo, zcodeInfo) {
  const base = `${formatDayTitle(day).replace(" · ", "，")}，${monthTitle(day)}`;
  if (effective === "future") return `${base}，尚未到来`;
  if (effective === "unknown") return `${base}，无可核对记录`;
  if (effective === "zero") return `${base}，已记录用量 0`;
  const parts = [];
  if (codexInfo.cls === "value") parts.push(`Codex ${formatTokens(codexInfo.value)}`);
  if (zcodeInfo.cls === "value") parts.push(`ZCode ${formatTokens(zcodeInfo.value)}`);
  const total = (codexInfo.cls === "value" ? codexInfo.value : 0) + (zcodeInfo.cls === "value" ? zcodeInfo.value : 0);
  return `${base}，已记录 ${formatTokens(total)} tokens${parts.length ? `（${parts.join("，")}）` : ""}`;
}

function renderDayDetail(dataset, previewDay) {
  const day = previewDay ?? (state.selectedDay && dataset.days.includes(state.selectedDay)
    ? state.selectedDay
    : dataset.today);
  if (!previewDay) state.selectedDay = day;
  const codexInfo = dataset.codexInfo.get(day) ?? { cls: "unknown" };
  const zcodeInfo = dataset.zcodeInfo.get(day) ?? { cls: "unknown" };
  const detail = els["day-detail"];
  detail.replaceChildren();

  const title = document.createElement("h3");
  title.className = "day-detail-title";
  title.textContent = formatDayTitle(day);
  const sub = document.createElement("span");
  sub.className = "day-detail-sub";
  sub.textContent = previewDay ? "日期预览；点击热力格保留该日"
    : dataset.mode === "period"
    ? "期间日期详情，点击热力格切换日期"
    : "本月日期详情，不随上方区间筛选";
  detail.append(title, sub);

  const merged = mergeDayClass([codexInfo.cls, zcodeInfo.cls]);
  const stale = { codex: sourceState(snapshotSources().codex) === "failed", zcode: sourceState(snapshotSources().zcode) === "failed" };
  if (merged === "future") {
    const empty = document.createElement("p");
    empty.className = "day-detail-unknown";
    empty.textContent = "尚未到来";
    detail.append(empty);
  } else if (merged === "unknown") {
    const empty = document.createElement("p");
    empty.className = "day-detail-unknown";
    empty.textContent = "无可核对记录";
    detail.append(empty);
  } else {
    const total = (codexInfo.cls === "value" ? codexInfo.value : 0) + (zcodeInfo.cls === "value" ? zcodeInfo.value : 0);
    const totalRow = document.createElement("div");
    totalRow.className = "day-detail-total";
    const strong = document.createElement("strong");
    strong.textContent = formatTokens(total);
    const unit = document.createElement("span");
    unit.textContent = "tokens";
    totalRow.append(strong, unit);
    const sources = document.createElement("div");
    sources.className = "day-detail-sources";
    sources.append(...SOURCES.map(([key, name]) => {
      const info = key === "codex" ? codexInfo : zcodeInfo;
      const row = document.createElement("div");
      row.className = "day-detail-source";
      const dot = document.createElement("span");
      dot.className = `source-dot source-dot--${key}`;
      dot.setAttribute("aria-hidden", "true");
      row.append(dot, document.createTextNode(name));
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = info.cls === "value" ? formatTokens(info.value) : info.cls === "zero" ? "0" : "—";
      row.append(value);
      if (stale[key]) {
        const tag = document.createElement("span");
        tag.className = "stale-tag";
        tag.textContent = "上次数据";
        row.append(tag);
      }
      return row;
    }));
    const note = document.createElement("span");
    note.className = "day-detail-note";
    const partial = [codexInfo, zcodeInfo].some(info => info.cls === "value" && info.coverage === "partial");
    note.textContent = merged === "zero"
      ? "已确认当日无已记录请求"
      : partial
        ? "部分记录：该日处于持续采集起点之前"
        : anyStale()
          ? "含未更新数据"
          : "该日已记录用量";
    detail.append(totalRow, sources, note);
  }
}

function renderLegend(dataset) {
  const legend = document.createElement("div");
  legend.className = "legend";
  const caption = document.createElement("span");
  caption.className = "legend-caption";
  if (dataset.scale.peak > 0) {
    caption.textContent = dataset.mode === "period"
      ? (state.view === "split" ? "两来源共用五档阈值 · 按所选期间已记录日峰值" : "按所选期间已记录日峰值")
      : (state.view === "split" ? "两来源共用五档阈值 · 按本月已记录日峰值" : "按本月已记录日峰值");
  } else {
    caption.textContent = dataset.mode === "period" ? "所选期间已记录用量均为 0 或缺失" : "本月已记录用量均为 0 或缺失";
  }
  const scale = document.createElement("div");
  scale.className = "legend-scale";
  const low = document.createElement("span");
  low.className = "legend-low";
  low.textContent = "低";
  scale.append(low);
  for (let level = 1; level <= 5; level += 1) {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = `var(--lv${level})`;
    const upper = dataset.scale.thresholds[level - 1];
    const lower = level > 1 ? dataset.scale.thresholds[level - 2] : 0;
    swatch.title = upper
      ? `第 ${level} 级：${formatTokens(lower + 1)} – ${formatTokens(upper)} tokens`
      : `第 ${level} 级`;
    scale.append(swatch);
  }
  const high = document.createElement("span");
  high.className = "legend-high";
  high.textContent = "高";
  scale.append(high);
  const thresholds = document.createElement("div");
  thresholds.className = "legend-thresholds";
  thresholds.setAttribute("aria-hidden", "true");
  for (const threshold of dataset.scale.thresholds) {
    const item = document.createElement("span");
    item.textContent = threshold >= 10000 ? abbrevTokens(threshold) : formatTokens(threshold);
    thresholds.append(item);
  }
  const extra = document.createElement("div");
  extra.className = "legend-extra";
  extra.append(
    legendItem("swatch--future", "未来日期"),
    legendItem("swatch--unknown", "记录不足"),
    legendItem("swatch--zero", "已确认零"),
  );
  legend.append(caption, scale, thresholds, extra);
  els["day-detail"].append(legend);
}

function legendItem(swatchClass, label) {
  const item = document.createElement("span");
  item.className = "item";
  const swatch = document.createElement("span");
  swatch.className = `swatch ${swatchClass}`;
  item.append(swatch, document.createTextNode(label));
  return item;
}

/* ---------------- 趋势 ---------------- */

function renderTrend() {
  const range = currentRange();
  const { codex, zcode } = snapshotSources();
  const charts = els["trend-charts"];
  charts.className = state.view === "split" ? "trend-charts trend-charts--split" : "trend-charts";
  let days = [];
  try {
    days = range.start ? eachDay(range.start, range.endExclusive, MAX_RANGE_DAYS) : [];
  } catch {
    days = [];
    els["trend-gap-note"].textContent = "区间过长，仅显示合计";
  }
  els["trend-dates"].textContent = range.start
    ? `${range.start.replaceAll("-", ".")} — ${range.today.replaceAll("-", ".")}`
    : "";
  if (!state.snapshot) {
    els["trend-gap-note"].textContent = "";
    charts.replaceChildren(emptyTrend("正在连接 QuoDex…"));
    return;
  }
  if (!days.length || (!sourceHasLedger(codex) && !sourceHasLedger(zcode))) {
    els["trend-gap-note"].textContent = "";
    charts.replaceChildren(emptyTrend("尚未读取到已记录用量"));
    return;
  }
  const codexSeries = seriesOf(codex, days);
  const zcodeSeries = seriesOf(zcode, days);
  els["trend-gap-note"].textContent = [codexSeries, zcodeSeries].some(series => series.hasGap)
    ? "斜纹区为记录不足或缺失，不按零计算"
    : "";
  if (state.view === "split") {
    charts.replaceChildren(
      trendChart("codex", "Codex", codexSeries, Math.max(codexSeries.max, zcodeSeries.max), days),
      trendChart("zcode", "ZCode", zcodeSeries, Math.max(codexSeries.max, zcodeSeries.max), days),
    );
  } else {
    charts.replaceChildren(mergedTrendChart(codexSeries, zcodeSeries, days));
  }
}

function seriesOf(source, days) {
  const points = days.map(day => {
    const info = sourceDayInfo(source ?? { daily: {} }, day, todayKey());
    return { day, cls: info.cls, value: info.cls === "value" ? info.value : 0 };
  });
  const max = points.reduce((peak, point) => Math.max(peak, point.value), 0);
  const hasGap = points.some(point => point.cls === "unknown");
  const knownCount = points.filter(point => point.cls === "value").length;
  return { points, max, hasGap, knownCount };
}

function emptyTrend(message) {
  const empty = document.createElement("div");
  empty.className = "trend-empty";
  empty.textContent = message;
  return empty;
}

function mergedTrendChart(codexSeries, zcodeSeries, days) {
  const card = document.createElement("div");
  const head = document.createElement("div");
  head.className = "trend-head";
  const title = document.createElement("span");
  title.className = "trend-title";
  const codexDot = document.createElement("span");
  codexDot.className = "source-dot source-dot--codex";
  codexDot.setAttribute("aria-hidden", "true");
  const zcodeDot = document.createElement("span");
  zcodeDot.className = "source-dot source-dot--zcode";
  zcodeDot.setAttribute("aria-hidden", "true");
  zcodeDot.style.marginLeft = "8px";
  title.append(codexDot, document.createTextNode("Codex"), zcodeDot, document.createTextNode("ZCode · 合并"));
  head.append(title);
  card.append(head);
  const codexBaseline = new Map(codexSeries.points.map(point => [point.day, point.cls === "value" ? point.value : 0]));
  card.append(buildChartSvg(
    days,
    [
      { name: "Codex", series: codexSeries, color: "rgba(94, 211, 255, 0.55)", edge: "rgba(94, 211, 255, 0.9)", baselineOf: point => 0 },
      {
        name: "ZCode",
        series: zcodeSeries,
        color: "rgba(88, 242, 171, 0.5)",
        edge: "rgba(88, 242, 171, 0.9)",
        baselineOf: point => codexBaseline.get(point.day) ?? 0,
      },
    ],
    Math.max(codexSeries.max + zcodeSeries.max, 1),
    "merged",
  ));
  return card;
}

function trendChart(sourceKey, name, series, sharedMax, days) {
  const card = document.createElement("div");
  const head = document.createElement("div");
  head.className = "trend-head";
  const title = document.createElement("span");
  title.className = "trend-title";
  const dot = document.createElement("span");
  dot.className = `source-dot source-dot--${sourceKey}`;
  dot.setAttribute("aria-hidden", "true");
  title.append(dot, document.createTextNode(`${name} · 每日已记录用量`));
  const time = document.createElement("span");
  time.className = "trend-time";
  const source = sourceKey === "codex" ? snapshotSources().codex : snapshotSources().zcode;
  time.textContent = sourceState(source) === "ready"
    ? `更新于 ${timeText(source?.lastSuccessAtMs)}`
    : sourceState(source) === "failed"
      ? `上次数据 ${timeText(source?.lastSuccessAtMs)} · 本次读取失败`
      : "读取中";
  const recent = document.createElement("span");
  recent.className = "trend-recent";
  const known = series.points.filter(point => point.cls === "value").slice(-6);
  for (const point of known) {
    const item = document.createElement("span");
    item.textContent = `${dateShort(point.day)} ${abbrevTokens(point.value)}`;
    recent.append(item);
  }
  head.append(title, time, recent);
  card.append(head);
  card.append(buildChartSvg(days, [{ name, series, color: sourceKey === "codex" ? "rgba(94, 211, 255, 0.5)" : "rgba(88, 242, 171, 0.5)", edge: sourceKey === "codex" ? "rgba(94, 211, 255, 0.9)" : "rgba(88, 242, 171, 0.9)", baselineOf: () => 0 }], Math.max(sharedMax, 1), sourceKey));
  return card;
}

/**
 * 面积图：已知点连续成段，缺口不断线也不补零，只铺斜纹；
 * y 轴用 nice 刻度，x 轴约五档日期标签。几何走 viewBox 拉伸，
 * 文本标签用 HTML 定位在与 svg 完全相同的区域内，避免文字变形。
 */
function buildChartSvg(days, layers, maxValue, chartId) {
  const width = 600;
  const height = 210;
  const axisLeft = 40;
  const axisBottom = 22;
  const plotTop = 8;
  const wrapper = document.createElement("div");
  wrapper.className = "trend-chart";
  wrapper.style.position = "relative";
  const body = document.createElement("div");
  body.style.position = "relative";
  body.style.height = `${height}px`;
  body.style.marginLeft = `${axisLeft}px`;
  body.style.marginBottom = `${axisBottom}px`;
  // 精确读数在绘图区外预留一行，不覆盖峰值、斜纹缺口或十字线。
  const tooltipSlot = document.createElement("div");
  tooltipSlot.className = "trend-tooltip-slot";
  wrapper.append(tooltipSlot, body);

  const top = niceTicks(maxValue)[2] || maxValue || 1;
  const xAt = index => (days.length <= 1 ? width / 2 : (index / (days.length - 1)) * width);
  const yAt = value => height - (value / top) * (height - plotTop);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");

  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = `
    <pattern id="hatch-${chartId}" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(190,226,240,0.35)" stroke-width="1.4"/>
    </pattern>`;
  svg.append(defs);

  for (const tick of niceTicks(maxValue)) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", 0);
    line.setAttribute("x2", width);
    line.setAttribute("y1", yAt(tick));
    line.setAttribute("y2", yAt(tick));
    line.setAttribute("stroke", "rgba(190, 226, 240, 0.12)");
    line.setAttribute("stroke-width", 1);
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(line);
    const label = document.createElement("span");
    label.style.position = "absolute";
    label.style.left = `-${axisLeft}px`;
    label.style.width = `${axisLeft - 8}px`;
    label.style.top = `${(yAt(tick) / height) * 100}%`;
    label.style.transform = "translateY(-50%)";
    label.style.textAlign = "right";
    label.textContent = tick === 0 ? "0" : abbrevTokens(tick);
    label.style.fontSize = "11px";
    label.style.color = "var(--text-faint)";
    label.style.fontVariantNumeric = "tabular-nums";
    body.append(label);
  }

  // 斜纹缺口：unknown 连续段铺满绘图高度
  let gapStart = -1;
  for (let index = 0; index <= days.length; index += 1) {
    const allUnknown = index < days.length && layers.every(layer => layer.series.points[index].cls === "unknown");
    if (allUnknown && gapStart < 0) gapStart = index;
    if (!allUnknown && gapStart >= 0) {
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", xAt(gapStart));
      rect.setAttribute("y", plotTop);
      rect.setAttribute("width", Math.max(xAt(index) - xAt(gapStart), 2));
      rect.setAttribute("height", height - plotTop);
      rect.setAttribute("fill", `url(#hatch-${chartId})`);
      rect.setAttribute("opacity", 0.5);
      svg.append(rect);
      gapStart = -1;
    }
  }

  for (const layer of layers) {
    // 连续已知段分别成面，段间断开，不跨缺口连线
    let run = [];
    const flushRun = () => {
      if (run.length >= 2) {
        const path = document.createElementNS(ns, "path");
        // 顶边走单调三次插值让折线圆润；底边保持直线，段端垂直起落不变。
        const tops = run.map(point => [xAt(point.index), yAt(layer.baselineOf(point) + point.value)]);
        let d = `M ${tops[0][0]} ${yAt(layer.baselineOf(run[0]))} L ${tops[0][0]} ${tops[0][1]}`;
        d += monotoneTopPath(tops);
        for (let position = run.length - 1; position >= 0; position -= 1) {
          const point = run[position];
          d += ` L ${xAt(point.index)} ${yAt(layer.baselineOf(point))}`;
        }
        d += " Z";
        path.setAttribute("d", d);
        path.setAttribute("fill", layer.color);
        svg.append(path);
      } else if (run.length === 1 && run[0].cls === "value") {
        // 孤立单点：画一根窄柱，避免面积不可见
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", xAt(run[0].index) - 2);
        rect.setAttribute("y", yAt(run[0].value));
        rect.setAttribute("width", 4);
        rect.setAttribute("height", Math.max(height - yAt(run[0].value), 2));
        rect.setAttribute("fill", layer.color);
        svg.append(rect);
      }
      run = [];
    };
    layer.series.points.forEach((point, index) => {
      if (point.cls === "value" || point.cls === "zero") {
        run.push({ ...point, index });
      } else {
        flushRun();
      }
    });
    flushRun();
  }

  body.append(svg);
  // x 轴标签（挂在 wrapper 上，位置与 body 绘图区对齐）
  const tickCount = Math.min(5, days.length);
  for (let tick = 0; tick < tickCount; tick += 1) {
    const index = Math.round((tick / Math.max(tickCount - 1, 1)) * (days.length - 1));
    const label = document.createElement("span");
    label.style.position = "absolute";
    if (tick === tickCount - 1) {
      label.style.right = "0";
    } else {
      label.style.left = `calc(${axisLeft}px + (100% - ${axisLeft}px) * ${index / Math.max(days.length - 1, 1)})`;
    }
    label.style.bottom = "0";
    label.style.transform = tick === 0 ? "none" : tick === tickCount - 1 ? "none" : "translateX(-50%)";
    label.textContent = dateShort(days[index]);
    label.style.fontSize = "11px";
    label.style.color = "var(--text-faint)";
    label.style.fontVariantNumeric = "tabular-nums";
    wrapper.append(label);
  }

  /* ---- 悬停/触摸/键盘交互：十字线 + 来源标记点 + 精确数浮层 ---- */
  wrapper.tabIndex = 0;
  wrapper.setAttribute("aria-label", "每日用量趋势；聚焦后用左右方向键逐日查看精确数值");
  const crosshair = document.createElement("div");
  crosshair.className = "trend-crosshair";
  crosshair.hidden = true;
  body.append(crosshair);
  const markers = layers.map(() => {
    const dot = document.createElement("div");
    dot.className = "trend-dot";
    dot.hidden = true;
    body.append(dot);
    return dot;
  });
  const tooltip = document.createElement("div");
  tooltip.className = "trend-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  tooltipSlot.append(tooltip);
  let activeIndex = null;

  const setActive = index => {
    if (index === null || !days.length) {
      activeIndex = null;
      crosshair.hidden = true;
      markers.forEach(dot => { dot.hidden = true; });
      tooltip.hidden = true;
      return;
    }
    activeIndex = Math.max(0, Math.min(days.length - 1, index));
    const fraction = days.length > 1 ? activeIndex / (days.length - 1) : 0.5;
    crosshair.hidden = false;
    crosshair.style.left = `${fraction * 100}%`;
    const rows = [];
    let total = 0;
    let totalKnown = false;
    layers.forEach((layer, position) => {
      const point = layer.series.points[activeIndex];
      const dot = markers[position];
      if (point.cls === "value") {
        dot.hidden = false;
        dot.style.left = `${fraction * 100}%`;
        dot.style.top = `${(yAt(layer.baselineOf(point) + point.value) / height) * 100}%`;
        rows.push(`${layer.name} ${formatTokens(point.value)}`);
        total += point.value;
        totalKnown = true;
      } else if (point.cls === "zero") {
        dot.hidden = true;
        rows.push(`${layer.name} 0（已确认）`);
      } else {
        dot.hidden = true;
        rows.push(`${layer.name} 无可核对记录`);
      }
    });
    const day = days[activeIndex];
    const lines = [`${day.replaceAll("-", ".")} ${formatDayTitle(day).split(" · ")[1] ?? ""}`, ...rows];
    if (layers.length > 1 && totalKnown) lines.push(`合计 ${formatTokens(total)}`);
    tooltip.textContent = lines.join(" · ");
    tooltip.hidden = false;
  };

  body.addEventListener("pointermove", event => {
    if (!days.length) return;
    const rect = body.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    setActive(Math.round(fraction * (days.length - 1)));
  });
  body.addEventListener("pointerleave", () => {
    if (document.activeElement !== wrapper) setActive(null);
  });
  wrapper.addEventListener("keydown", event => {
    if (!days.length) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((activeIndex ?? days.length - 1) - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setActive((activeIndex ?? days.length - 2) + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(days.length - 1);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  });
  wrapper.addEventListener("focus", () => {
    if (activeIndex === null) setActive(days.length - 1);
  });
  wrapper.addEventListener("blur", () => setActive(null));
  return wrapper;
}

/* ---------------- 启动 ---------------- */

// 月历横向为逐日、纵向为逐周；热墙按列优先布局，方向对应交换。
els.calendar.addEventListener("keydown", event => {
  const deltas = els.calendar.dataset.mode === "period"
    ? { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
    : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (!(event.key in deltas)) return;
  const current = event.target.closest("[data-day]");
  if (!current) return;
  const next = addDays(current.dataset.day, deltas[event.key]);
  const target = els.calendar.querySelector(`[data-day="${next}"]`);
  if (target && !target.disabled && target.dataset.state !== "future") {
    event.preventDefault();
    target.focus();
  }
});

els["refresh-btn"].addEventListener("click", () => void manualRefresh());
els["refresh-btn"].dataset.busy = "false";
render();
void fetchSnapshot().then(schedulePoll);
