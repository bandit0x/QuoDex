import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abbrevTokens,
  calendarGrid,
  dayClass,
  dayCoverage,
  eachDay,
  formatTokens,
  heatScale,
  mergeDayClass,
  minusMonthsClamped,
  monotoneTopPath,
  monthGroupsFor,
  niceTicks,
  periodHeatColumns,
  periodRange,
  sourceDayInfo,
  sumRange,
  todayKey,
  weekdayShort,
} from "../src-tauri/usage-page/usage-core.js";

// 固定样例来自 .scratch/token-usage/state-review.md 的日期端点复核，
// 截至本机时区的今天 2026-10-06（排他终点 2026-10-07）。
describe("periodRange 与日历月回溯", () => {
  const today = "2026-10-06";

  it("六区间端点与 spec 固定样例一致", () => {
    expect(periodRange("7d", today).start).toBe("2026-09-30");
    expect(periodRange("30d", today).start).toBe("2026-09-07");
    expect(periodRange("3m", today).start).toBe("2026-07-07");
    expect(periodRange("6m", today).start).toBe("2026-04-07");
    expect(periodRange("1y", today).start).toBe("2025-10-07");
    expect(periodRange("total", today, "2026-09-01").start).toBe("2026-09-01");
    expect(periodRange("total", today, null).start).toBeNull();
  });

  it("7/30 天恰好包含今天在内的 N 个日期", () => {
    expect(eachDay("2026-09-30", "2026-10-07")).toHaveLength(7);
    expect(eachDay("2026-09-07", "2026-10-07")).toHaveLength(30);
    expect(eachDay("2026-09-30", "2026-10-07").at(-1)).toBe("2026-10-06");
  });

  it("3/6 个月不是固定 90/180 天", () => {
    expect(eachDay("2026-07-07", "2026-10-07")).toHaveLength(92);
    expect(eachDay("2026-04-07", "2026-10-07")).toHaveLength(183);
    expect(eachDay("2025-10-07", "2026-10-07")).toHaveLength(365);
  });

  it("月末裁剪：05-30 回溯三个月裁到 02-28，05-31 落到 03-01", () => {
    expect(periodRange("3m", "2026-05-30").start).toBe("2026-02-28");
    expect(eachDay("2026-02-28", "2026-05-31")).toHaveLength(92);
    expect(periodRange("3m", "2026-05-31").start).toBe("2026-03-01");
    expect(eachDay("2026-03-01", "2026-06-01")).toHaveLength(92);
  });

  it("闰日：2024-02-29 的一年为 2023-03-01 起 366 个日期", () => {
    expect(periodRange("1y", "2024-02-29").start).toBe("2023-03-01");
    expect(eachDay("2023-03-01", "2024-03-01")).toHaveLength(366);
    expect(periodRange("1y", "2025-02-28").start).toBe("2024-03-01");
    expect(eachDay("2024-03-01", "2025-03-01")).toHaveLength(365);
  });

  it("minusMonthsClamped 不溢出目标月", () => {
    expect(minusMonthsClamped("2026-03-31", 1)).toBe("2026-02-28");
    expect(minusMonthsClamped("2026-01-31", 1)).toBe("2025-12-31");
    // 直接对 02-29 减 12 个月落在 2023-02-28；区间端点经 E=03-01 计算才是 2023-03-01
    expect(minusMonthsClamped("2024-02-29", 12)).toBe("2023-02-28");
  });
});

describe("sumRange 左闭右开聚合", () => {
  const daily = { "2026-10-04": 100, "2026-10-05": 200, "2026-10-06": 300 };

  it("只累计 [start, endExclusive) 内的日期", () => {
    expect(sumRange(daily, "2026-10-05", "2026-10-07")).toBe(500);
    expect(sumRange(daily, "2026-10-04", "2026-10-06")).toBe(300);
    expect(sumRange(daily, "2026-10-07", "2026-10-08")).toBe(0);
    expect(sumRange(daily, null, "2026-10-07")).toBe(0);
  });
});

describe("dayClass 与覆盖", () => {
  it("未来/有值/确认零/未知互斥", () => {
    expect(dayClass("2026-10-07", "2026-10-06", "2026-10-01", false)).toBe("future");
    expect(dayClass("2026-10-05", "2026-10-06", "2026-10-01", true)).toBe("value");
    expect(dayClass("2026-10-05", "2026-10-06", "2026-10-01", false)).toBe("zero");
    expect(dayClass("2026-09-20", "2026-10-06", "2026-10-01", false)).toBe("unknown");
    // 没有持续采集起点时，任何无记录日都不能当成零
    expect(dayClass("2026-10-05", "2026-10-06", null, false)).toBe("unknown");
  });

  it("持续采集起点之后的记录为完整覆盖，此前为部分记录", () => {
    expect(dayCoverage("2026-10-05", "2026-10-01")).toBe("full");
    expect(dayCoverage("2026-09-30", "2026-10-01")).toBe("partial");
    expect(dayCoverage("2026-09-30", null)).toBe("partial");
  });

  it("合并分类：值优先，未知压过零，全部确认零才是零", () => {
    expect(mergeDayClass(["value", "zero"])).toBe("value");
    expect(mergeDayClass(["zero", "zero"])).toBe("zero");
    expect(mergeDayClass(["zero", "unknown"])).toBe("unknown");
    expect(mergeDayClass(["unknown", "unknown"])).toBe("unknown");
  });
});

describe("五级亮度阈值", () => {
  it("峰值映射：840k→3 级、1.32M→4 级、峰值→5 级、0→0 级", () => {
    const scale = heatScale([840000, 1320000, 1690000, 210000, 970000]);
    expect(scale.peak).toBe(1690000);
    expect(scale.level(0)).toBe(0);
    expect(scale.level(840000)).toBe(3);
    expect(scale.level(1320000)).toBe(4);
    expect(scale.level(1690000)).toBe(5);
    expect(scale.level(210000)).toBe(1);
  });

  it("等级对任意正值单调不降，且 0 级低于正值第一级", () => {
    const scale = heatScale([100, 500, 999, 2500, 10000]);
    let previous = 0;
    for (const value of [1, 99, 100, 499, 500, 999, 2500, 9999, 10000]) {
      const level = scale.level(value);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
    expect(scale.level(0)).toBe(0);
    expect(scale.level(1)).toBeGreaterThanOrEqual(1);
  });

  it("阈值为峰值的五等分上界，可读出各级边界", () => {
    const scale = heatScale([1000]);
    expect(scale.thresholds).toEqual([200, 400, 600, 800, 1000]);
    expect(scale.level(200)).toBe(1);
    expect(scale.level(201)).toBe(2);
  });

  it("峰值为零时跳过除法，全月零级", () => {
    const scale = heatScale([0, 0]);
    expect(scale.peak).toBe(0);
    expect(scale.thresholds).toEqual([]);
    expect(scale.level(0)).toBe(0);
  });
});

describe("格式化", () => {
  it("千位分隔与缩写刻度", () => {
    expect(formatTokens(18742906)).toBe("18,742,906");
    expect(formatTokens(0)).toBe("0");
    expect(abbrevTokens(840)).toBe("840");
    expect(abbrevTokens(840000)).toBe("840k");
    expect(abbrevTokens(1320000)).toBe("1.32M");
    expect(abbrevTokens(1516123893)).toBe("1.52B");
  });

  it("niceTicks 给出可读三档刻度", () => {
    expect(niceTicks(2000000)).toEqual([0, 1000000, 2000000]);
    expect(niceTicks(0)).toEqual([0, 0, 0]);
  });
});

describe("月历网格与星期", () => {
  it("2026 年 10 月周一起始：10-01 是周四，首行三个空位", () => {
    const cells = calendarGrid("2026-10-06");
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBeNull();
    expect(cells[2]).toBeNull();
    expect(cells[3]).toBe("2026-10-01");
    expect(cells).toHaveLength(35);
    expect(cells[33]).toBe("2026-10-31");
    expect(cells[34]).toBeNull();
  });

  it("星期标注：10-05 周一、10-06 周二", () => {
    expect(weekdayShort("2026-10-05")).toBe("一");
    expect(weekdayShort("2026-10-06")).toBe("二");
    expect(weekdayShort("2026-10-04")).toBe("日");
  });

  it("todayKey 取本机日期而非 UTC", () => {
    const now = new Date(2026, 9, 6, 23, 30);
    expect(todayKey(now)).toBe("2026-10-06");
  });
});

describe("periodHeatColumns 多周热力墙", () => {
  it("从起始周的周一开始分列，区间外补 null，月份标签落在新月首列", () => {
    // 2026-10-05 是周一；从 10-05 起两周：第一列 10-05..10-11，第二列 10-12..10-15（区间止于 10-16）
    const heat = periodHeatColumns("2026-10-05", "2026-10-16");
    expect(heat.columns).toHaveLength(2);
    expect(heat.columns[0][0]).toBe("2026-10-05");
    expect(heat.columns[0][6]).toBe("2026-10-11");
    expect(heat.columns[1][0]).toBe("2026-10-12");
    expect(heat.columns[1][3]).toBe("2026-10-15");
    expect(heat.columns[1][4]).toBeNull();
    expect(heat.monthLabels).toEqual([{ column: 0, label: "10月" }]);
  });

  it("起始日非周一：前导 null 对齐周一，跨越月份时补月份标签", () => {
    // 2026-10-01 是周四：首列前三个格位为 null
    const heat = periodHeatColumns("2026-10-01", "2026-11-04");
    expect(heat.columns[0][0]).toBeNull();
    expect(heat.columns[0][1]).toBeNull();
    expect(heat.columns[0][2]).toBeNull();
    expect(heat.columns[0][3]).toBe("2026-10-01");
    expect(heat.columns[4][6]).toBe("2026-11-01");
    const labels = heat.monthLabels.map(item => item.label);
    expect(labels).toContain("10月");
    expect(labels).toContain("11月");
  });

  it("空起点返回空结构", () => {
    expect(periodHeatColumns(null, "2026-10-07")).toEqual({ columns: [], monthLabels: [] });
  });

  it("monthGroupsFor 按月分组并给出精确列范围", () => {
    const heat = periodHeatColumns("2026-09-28", "2026-11-02");
    const groups = monthGroupsFor(heat.columns);
    // 09-28 是周一：9 月只有 09-28..09-30 三天，位于第 0 列；10 月跨多列；
    // 排他终点 11-02 使 11-01 归入 11 月
    expect(groups.map(group => group.label)).toEqual(["9月", "10月", "11月"]);
    expect(groups[0].days).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(groups[0].startColumn).toBe(0);
    expect(groups[0].endColumn).toBe(1);
    const october = groups[1];
    expect(october.days[0]).toBe("2026-10-01");
    expect(october.days.at(-1)).toBe("2026-10-31");
    expect(october.startColumn).toBe(0);
    expect(october.endColumn).toBe(5);
    expect(groups[2].days).toEqual(["2026-11-01"]);
  });

  it("monthGroupsFor 空列返回空数组", () => {
    expect(monthGroupsFor([])).toEqual([]);
  });
});

describe("sourceDayInfo", () => {
  it("按快照字段给出记录值、分类与覆盖", () => {
    const source = {
      daily: { "2026-10-05": 1234 },
      collectionStartDay: "2026-10-03",
    };
    const info = sourceDayInfo(source, "2026-10-05", "2026-10-06");
    expect(info).toMatchObject({ hasRecord: true, value: 1234, cls: "value", coverage: "full" });
    expect(sourceDayInfo(source, "2026-10-04", "2026-10-06").cls).toBe("zero");
    expect(sourceDayInfo(source, "2026-10-02", "2026-10-06").cls).toBe("unknown");
    expect(sourceDayInfo(source, "2026-10-02", "2026-10-06").coverage).toBe("partial");
    expect(sourceDayInfo(source, "2026-10-07", "2026-10-06").cls).toBe("future");
  });
});

describe("monotoneTopPath 单调平滑路径", () => {
  const parsePath = d => [...d.matchAll(/([CL])\s((?:-?[\d.eE+-]+\s?)+)/g)].map(([, command, coords]) => ({
    command,
    coords: coords.trim().split(/\s+/).map(Number),
  }));

  // 画笔起点是 points[0]（与 usage.js 的 M 底边 + L 顶边衔接一致）；
  // 逐段按贝塞尔参数采样，供越界与过点断言使用。
  function sampleCurve(points, d, perSegment = 32) {
    const commands = parsePath(d);
    expect(commands.length).toBeGreaterThan(0);
    let [cx, cy] = points[0];
    const samples = [[cx, cy]];
    for (const { command, coords } of commands) {
      if (command === "L") {
        [cx, cy] = [coords[0], coords[1]];
        samples.push([cx, cy]);
        continue;
      }
      const [x1, y1, x2, y2, x, y] = coords;
      for (let step = 1; step <= perSegment; step += 1) {
        const t = step / perSegment;
        const u = 1 - t;
        samples.push([
          u ** 3 * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x,
          u ** 3 * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y,
        ]);
      }
      [cx, cy] = [x, y];
    }
    return samples;
  }

  it("少于两个点没有路径命令", () => {
    expect(monotoneTopPath([])).toBe("");
    expect(monotoneTopPath([[10, 5]])).toBe("");
  });

  it("曲线精确穿过每个数据点，段数等于点数减一", () => {
    const points = [[0, 100], [30, 40], [60, 55], [90, 20], [120, 60]];
    const samples = sampleCurve(points, monotoneTopPath(points));
    expect(samples.length).toBe(1 + 4 * 32);
    for (const [x, y] of points) {
      const nearest = samples.reduce((best, sample) => Math.abs(sample[0] - x) < Math.abs(best[0] - x) ? sample : best, samples[0]);
      expect(nearest[0]).toBeCloseTo(x, 6);
      expect(nearest[1]).toBeCloseTo(y, 6);
    }
  });

  it("限幅生效：均值切线会把急转弯后的曲线顶出值域，平滑后不得越界", () => {
    // 若去掉 Fritsch–Carlson 限幅，末段的均值切线（t₂=0.505）会把曲线顶过 330.3。
    const points = [[0, 0], [30, 300], [60, 330], [90, 330.3]];
    for (const [, y] of sampleCurve(points, monotoneTopPath(points))) {
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(330.3 + 1e-6);
    }
  });

  it("零值平台走直线，极值符号翻转处不越界", () => {
    const points = [[0, 80], [40, 80], [80, 0], [120, 60]];
    const d = monotoneTopPath(points);
    expect(d).toContain(" L 40 80");
    for (const [, y] of sampleCurve(points, d)) {
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(80 + 1e-6);
    }
  });
});

describe("用量页真实 DOM 交互", () => {
  let snapshot;
  let listeners;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 6, 12));
    vi.resetModules();
    listeners = [];
    for (const surface of [window, document]) {
      const add = surface.addEventListener.bind(surface);
      vi.spyOn(surface, "addEventListener").mockImplementation((type, listener, options) => {
        listeners.push([surface, type, listener, options]);
        add(type, listener, options);
      });
    }
    const source = daily => ({
      state: "ready", daily, requestCount: 3,
      earliestDay: "2026-09-28", collectionStartDay: "2026-09-28",
      lastSuccessAtMs: Date.now(),
    });
    snapshot = {
      codex: source({ "2026-09-28": 100, "2026-10-05": 1200, "2026-10-06": 2300 }),
      zcode: source({ "2026-09-28": 50, "2026-10-05": 300, "2026-10-06": 700 }),
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    vi.stubGlobal("requestAnimationFrame", callback => { callback(0); return 1; });
    const html = readFileSync("src-tauri/usage-page/index.html", "utf8");
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
    await import("../src-tauri/usage-page/usage.js");
    await vi.dynamicImportSettled();
  });

  afterEach(() => {
    for (const [surface, type, listener, options] of listeners) surface.removeEventListener(type, listener, options);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("热墙悬停整周背景并在侧栏预览，移出恢复所选日且不改色级", () => {
    document.querySelector('[data-range="1y"]').click();
    const cell = document.querySelector('.heat-cell[data-day="2026-10-05"]');
    const detail = document.getElementById("day-detail");
    const level = cell.dataset.level;
    cell.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(detail).toHaveClass("day-detail-preview");
    expect(detail.textContent).toContain("1,500");
    expect(detail.textContent).toContain("本周范围");
    expect(detail.textContent).toContain("4,500");
    expect(detail.textContent).toContain("本月范围");
    const highlight = document.querySelector(".heat-week-highlight");
    expect(highlight.hidden).toBe(false);
    expect(highlight.dataset.column).toBe(cell.dataset.column);
    expect(cell.dataset.level).toBe(level);
    expect(document.querySelector(".heat-tip")).toBeNull();
    cell.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    expect(detail).not.toHaveClass("day-detail-preview");
    expect(detail.textContent).toContain("10月6日");
    expect(detail.textContent).toContain("3,000");
    expect(highlight.hidden).toBe(true);
  });

  it("热墙上下逐日、左右逐周；未知可读但不能选择，月历保留原方向", () => {
    document.querySelector('[data-range="1y"]').click();
    const monday = document.querySelector('.heat-cell[data-day="2026-10-05"]');
    monday.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    monday.focus();
    monday.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement.dataset.day).toBe("2026-10-06");
    expect(document.getElementById("day-detail").textContent).toContain("3,000");
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement.dataset.day).toBe("2026-09-29");
    expect(document.activeElement.dataset.level).toBe("0");
    const unknown = document.querySelector('.heat-cell[data-day="2026-09-27"]');
    unknown.focus();
    expect(unknown.tagName).toBe("SPAN");
    expect(document.getElementById("day-detail").textContent).toContain("无可核对记录");
    expect(unknown.dataset.level).toBeUndefined();
    unknown.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    unknown.blur();
    monday.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    expect(document.querySelector('[data-day="2026-10-06"]')).toHaveAttribute("aria-pressed", "true");
    document.querySelector('[data-range="7d"]').click();
    const day = document.querySelector('.calendar-cell[data-day="2026-10-05"]');
    day.focus();
    day.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement.dataset.day).toBe("2026-10-06");
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement.dataset.day).toBe("2026-10-06"); // 未来禁用日不可进入
  });

  it("日期点击和新快照刷新保留热墙节点、滚动与焦点；月柱只预览", async () => {
    document.querySelector('[data-range="3m"]').click();
    const wall = document.querySelector(".heat-columns");
    const scroll = document.querySelector(".heat-scroll");
    const cell = document.querySelector('.heat-cell[data-day="2026-10-05"]');
    scroll.scrollLeft = 117;
    cell.focus();
    cell.click();
    expect(document.querySelector(".heat-columns")).toBe(wall);
    expect(document.querySelector(".heat-scroll")).toBe(scroll);
    expect(scroll.scrollLeft).toBe(117);
    expect(document.activeElement).toBe(cell);
    expect(cell).toHaveAttribute("aria-pressed", "true");
    expect(document.getElementById("day-detail")).toHaveClass("day-detail-preview");
    snapshot = { ...snapshot, codex: { ...snapshot.codex, daily: { ...snapshot.codex.daily, "2026-10-05": 1800 } } };
    document.getElementById("refresh-btn").click();
    await vi.dynamicImportSettled();
    expect(document.querySelector(".heat-columns")).toBe(wall);
    expect(document.querySelector('.heat-cell[data-day="2026-10-05"]')).toBe(cell);
    expect(scroll.scrollLeft).toBe(117);
    expect(document.activeElement).toBe(cell);
    expect(document.getElementById("day-detail").textContent).toContain("2,100");
    const bar = document.querySelector('.heat-bar[data-month="2026-10"]');
    const requests = fetch.mock.calls.length;
    bar.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(document.getElementById("day-detail").dataset.previewKind).toBe("month");
    expect(document.getElementById("day-detail").textContent).toContain("5,100");
    bar.click();
    expect(fetch.mock.calls).toHaveLength(requests);
    expect(cell).toHaveAttribute("aria-pressed", "true");
    bar.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    expect(document.getElementById("day-detail").textContent).toContain("10月5日");
  });

  it("趋势精确读数在绘图区外，保留键盘十字线与 Escape 收起", () => {
    const chart = document.querySelector(".trend-chart");
    chart.focus();
    const tip = chart.querySelector(".trend-tooltip");
    expect(tip.hidden).toBe(false);
    expect(tip.parentElement).toHaveClass("trend-tooltip-slot");
    expect(tip.textContent).toContain("2026.10.06");
    expect(tip.textContent).toContain("Codex 2,300");
    expect(tip.textContent).toContain("ZCode 700");
    expect(chart.querySelector(".trend-crosshair").hidden).toBe(false);
    chart.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(tip.textContent).toContain("2026.10.05");
    expect(tip.textContent).toContain("合计 1,500");
    chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tip.hidden).toBe(true);
    expect(chart.querySelector(".trend-crosshair").hidden).toBe(true);
  });

  it("未知周月预览不补零，已核对覆盖的零与未来保持不同状态", async () => {
    document.querySelector('[data-range="1y"]').click();
    const unknown = document.querySelector('.heat-cell[data-day="2026-09-20"]');
    unknown.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(document.querySelector(".day-detail-period-totals .value").textContent).toBe("—");
    const missingMonth = document.querySelector('.heat-bar[data-month="2026-08"]');
    missingMonth.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(document.querySelector(".day-detail-total strong").textContent).toBe("—");
    expect(document.getElementById("day-detail").textContent).toContain("无可核对记录");
    expect(missingMonth.getAttribute("aria-label")).toContain("无可核对记录");
    const october = [...document.querySelectorAll(".heat-months span")].filter(label => label.textContent === "10月").at(-1);
    october.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(document.getElementById("day-detail").dataset.previewKind).toBe("month");
    expect(document.querySelector(".day-detail-total strong").textContent).toBe("4,500");
    snapshot = { ...snapshot, codex: { ...snapshot.codex, daily: {} }, zcode: { ...snapshot.zcode, daily: {} } };
    document.getElementById("refresh-btn").click();
    await vi.dynamicImportSettled();
    const zero = document.querySelector('.heat-cell[data-day="2026-10-05"]');
    zero.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(zero.dataset.level).toBe("0");
    expect(document.querySelector(".day-detail-total strong").textContent).toBe("0");
    expect(document.querySelector(".day-detail-period-totals .value").textContent).toBe("0");
    document.querySelector('[data-range="7d"]').click();
    const future = document.querySelector('.calendar-cell[data-day="2026-10-07"]');
    expect(future.disabled).toBe(true);
    expect(future.dataset.state).toBe("future");
    expect(future.dataset.level).toBeUndefined();
  });

  it("年份热墙保留可操作格宽，窄屏通过现有横向滚动承载", () => {
    document.querySelector('[data-range="1y"]').click();
    const wrap = document.querySelector(".heat-wrap");
    expect(Number.parseInt(wrap.style.getPropertyValue("--heat-cell"))).toBeGreaterThanOrEqual(16);
    vi.stubGlobal("innerWidth", 390);
    window.dispatchEvent(new Event("resize"));
    expect(Number.parseInt(wrap.style.getPropertyValue("--heat-cell"))).toBeGreaterThanOrEqual(22);
    expect(document.querySelector(".heat-scroll .heat-columns")).not.toBeNull();
  });

  it("周/月预览区分完整日历范围与所选期间内小计，月份预览显示截断范围", () => {
    document.querySelector('[data-range="1y"]').click();
    const cell = document.querySelector('.heat-cell[data-day="2026-10-05"]');
    cell.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    const groups = document.querySelectorAll(".day-detail-period-total");
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector(".day-detail-period-label").textContent).toContain("2026.10.05 — 2026.10.11");
    expect(groups[0].querySelector(".day-detail-period-note").textContent).toContain("所选期间内已记录小计 · 2026.10.05 — 2026.10.06");
    expect(groups[0].querySelector(".value").textContent).toBe("4,500");
    expect(groups[1].querySelector(".day-detail-period-label").textContent).toContain("2026.10.01 — 2026.10.31");
    expect(groups[1].querySelector(".day-detail-period-note").textContent).toContain("所选期间内已记录小计 · 2026.10.01 — 2026.10.06");
    expect(groups[1].querySelector(".value").textContent).toBe("4,500");
    const bar = document.querySelector('.heat-bar[data-month="2026-10"]');
    bar.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    const detail = document.getElementById("day-detail");
    expect(detail.querySelector(".day-detail-sub").textContent).toContain("2026.10.01 — 2026.10.31");
    expect(detail.querySelector(".day-detail-period-note").textContent).toContain("所选期间内已记录小计 · 2026.10.01 — 2026.10.06");
    expect(detail.querySelector(".day-detail-total strong").textContent).toBe("4,500");
  });

  it("月历点击后同快照的15秒轮询保留日期节点、焦点与趋势节点", async () => {
    const cell = document.querySelector('.calendar-cell[data-day="2026-10-05"]');
    const chart = document.querySelector(".trend-chart");
    cell.focus();
    cell.click();
    const requests = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetch.mock.calls).toHaveLength(requests + 1);
    expect(document.querySelector('.calendar-cell[data-day="2026-10-05"]')).toBe(cell);
    expect(document.activeElement).toBe(cell);
    expect(cell).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".trend-chart")).toBe(chart);
  });

  it("点击热格保留鼠标和焦点的整周高亮，离开后恢复新选择日", () => {
    document.querySelector('[data-range="1y"]').click();
    const cell = document.querySelector('.heat-cell[data-day="2026-10-05"]');
    const detail = document.getElementById("day-detail");
    const highlight = document.querySelector(".heat-week-highlight");
    cell.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    cell.click();
    expect(highlight.hidden).toBe(false);
    expect(highlight.dataset.column).toBe(cell.dataset.column);
    expect(cell).toHaveAttribute("aria-pressed", "true");
    cell.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    expect(highlight.hidden).toBe(true);
    expect(detail).not.toHaveClass("day-detail-preview");
    expect(detail.querySelector(".day-detail-title").textContent).toContain("10月5日");
    cell.focus();
    cell.click();
    expect(highlight.hidden).toBe(false);
    cell.blur();
    expect(highlight.hidden).toBe(true);
    expect(detail).not.toHaveClass("day-detail-preview");
    expect(detail.querySelector(".day-detail-title").textContent).toContain("10月5日");
  });

  it("月柱可见数区分已确认零和完全未知，刷新时也保持同样口径", async () => {
    document.querySelector('[data-range="1y"]').click();
    const month = document.querySelector('.heat-bar[data-month="2026-10"]');
    const unknown = document.querySelector('.heat-bar[data-month="2026-08"]');
    expect(month).not.toHaveClass("is-unknown");
    expect(month).not.toHaveClass("is-zero");
    expect(unknown).toHaveClass("is-unknown");
    expect(unknown).not.toHaveClass("is-zero");
    expect(unknown.querySelector(".heat-bar-value").textContent).toBe("—");
    snapshot = { ...snapshot, codex: { ...snapshot.codex, daily: {} }, zcode: { ...snapshot.zcode, daily: {} } };
    document.getElementById("refresh-btn").click();
    await vi.dynamicImportSettled();
    expect(document.querySelector('.heat-bar[data-month="2026-10"]')).toBe(month);
    expect(month).toHaveClass("is-zero");
    expect(month).not.toHaveClass("is-unknown");
    expect(month.querySelector(".heat-bar-value").textContent).toBe("0");
    expect(unknown).toHaveClass("is-unknown");
    expect(unknown).not.toHaveClass("is-zero");
    expect(unknown.querySelector(".heat-bar-value").textContent).toBe("—");
    month.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(document.querySelector(".day-detail-total strong").textContent).toBe("0");
  });

  it("独立月图直接标注13个跨年月份，不再依赖热墙周列定位", () => {
    document.querySelector('[data-range="1y"]').click();
    const heatScroll = document.querySelector(".heat-scroll");
    const monthScroll = document.querySelector(".heat-month-scroll");
    expect(monthScroll).not.toBeNull();
    expect(heatScroll.contains(monthScroll)).toBe(false);
    const bars = [...monthScroll.querySelectorAll(".heat-bars .heat-bar")];
    expect(bars.map(bar => bar.dataset.month)).toEqual([
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(bars[0].querySelector(".heat-bar-month")).toHaveTextContent(/2025.*10/);
    expect(bars[3].querySelector(".heat-bar-month")).toHaveTextContent(/2026.*0?1/);
    expect(bars.at(-1).querySelector(".heat-bar-month")).toHaveTextContent(/2026.*10/);
    expect(bars.every(bar => bar.querySelector(".heat-bar-month")?.textContent)).toBe(true);
  });

  it("月柱按真实月小计保持精确比例，微小用量不设5%下限", async () => {
    document.querySelector('[data-range="3m"]').click();
    snapshot = {
      codex: { ...snapshot.codex, daily: { "2026-09-28": 8_000_000, "2026-10-05": 4_455_000 } },
      zcode: { ...snapshot.zcode, daily: { "2026-09-28": 4_009_000, "2026-10-05": 2_367_000 } },
    };
    document.getElementById("refresh-btn").click();
    await vi.dynamicImportSettled();
    const september = document.querySelector('.heat-bar[data-month="2026-09"]');
    const october = document.querySelector('.heat-bar[data-month="2026-10"]');
    // .scratch/usage-web-refinement/month-bars-v2-review.md 的固定数据与独立比值。
    expect(september).toHaveAttribute("aria-label", expect.stringContaining("12,009,000"));
    expect(october).toHaveAttribute("aria-label", expect.stringContaining("6,822,000"));
    expect(september.style.getPropertyValue("--bar-h")).toBe("100%");
    expect(october.style.getPropertyValue("--bar-h")).toMatch(/%$/);
    expect(Number.parseFloat(october.style.getPropertyValue("--bar-h"))).toBeCloseTo(56.80739445415938, 8);

    snapshot = {
      codex: { ...snapshot.codex, daily: { "2026-09-28": 20_000_000, "2026-10-05": 10_000 } },
      zcode: { ...snapshot.zcode, daily: {} },
    };
    document.getElementById("refresh-btn").click();
    await vi.dynamicImportSettled();
    expect(document.querySelector('.heat-bar[data-month="2026-10"]')).toBe(october);
    expect(october).not.toHaveClass("is-zero");
    expect(october).not.toHaveClass("is-unknown");
    expect(october.style.getPropertyValue("--bar-h")).toMatch(/%$/);
    expect(Number.parseFloat(october.style.getPropertyValue("--bar-h"))).toBeCloseTo(0.05, 8);
  });

  it("独立月图的鼠标和键盘预览精确月小计，离开恢复所选日且不新增请求", () => {
    document.querySelector('[data-range="3m"]').click();
    const selected = document.querySelector('.heat-cell[data-day="2026-10-05"]');
    selected.click();
    const detail = document.getElementById("day-detail");
    const month = document.querySelector('.heat-month-scroll .heat-bar[data-month="2026-09"]');
    const requests = fetch.mock.calls.length;
    month.querySelector(".heat-bar-month").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    expect(detail.dataset.previewKind).toBe("month");
    expect(detail.querySelector(".day-detail-total strong").textContent).toBe("150");
    expect(detail.querySelector(".day-detail-sub")).toHaveTextContent("2026.09.01 — 2026.09.30");
    month.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    expect(detail).not.toHaveClass("day-detail-preview");
    expect(detail.querySelector(".day-detail-title")).toHaveTextContent("10月5日");
    expect(detail.querySelector(".day-detail-total strong").textContent).toBe("1,500");

    month.focus();
    expect(document.activeElement).toBe(month);
    expect(detail.dataset.previewKind).toBe("month");
    expect(detail.querySelector(".day-detail-total strong").textContent).toBe("150");
    month.blur();
    expect(detail).not.toHaveClass("day-detail-preview");
    expect(detail.querySelector(".day-detail-title")).toHaveTextContent("10月5日");
    expect(detail.querySelector(".day-detail-total strong").textContent).toBe("1,500");
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(fetch.mock.calls).toHaveLength(requests);
  });
});
