import { describe, expect, it } from "vitest";
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
