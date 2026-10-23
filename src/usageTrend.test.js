import { describe, expect, it } from "vitest";
import { usageTrend } from "../src-tauri/usage-page/usage-core.js";

describe("平均趋势与原始账目", () => {
  it("平均图的刻度只由平均值决定，不被预热期尖峰和今日累计压扁", () => {
    const source = { collectionStartDay: "2026-10-01", daily: { "2026-10-01": 9000, "2026-10-05": 99999 } };
    const points = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    const result = usageTrend(source, points, "2026-10-05", 3);
    expect(result.max).toBe(3000);
    expect(result.points.at(-1).value).toBe(99999);
  });
  it("预热使用区间前数据，真实零参与，今日只显示累计", () => {
    const source = { collectionStartDay: "2026-10-01", daily: {
      "2026-10-01": 90, "2026-10-02": 0, "2026-10-03": 90, "2026-10-04": 999,
    } };
    const result = usageTrend(source, ["2026-10-03", "2026-10-04"], "2026-10-04", 3);
    expect(result.points.map(p => p.average)).toEqual([60, null]);
    expect(result.points.map(p => p.value)).toEqual([90, 999]);
    expect(source.daily["2026-10-04"]).toBe(999);
  });
  it("缺失与非有限值断开窗口，不把不足样本补零或缩短分母", () => {
    const source = { daily: { "2026-10-01": 90, "2026-10-03": 90, "2026-10-04": 90, "2026-10-05": 90 } };
    const days = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    expect(usageTrend(source, days, "2026-10-06", 3).points.map(p => p.average)).toEqual([null, null, null, 90]);
    expect(usageTrend({ daily: { "2026-10-05": NaN } }, ["2026-10-05"], "2026-10-06", 3).points[0].cls).toBe("unknown");
  });
  it("全零仍有有效平均，孤立尖峰按固定窗口减弱且原值保留", () => {
    const source = { collectionStartDay: "2026-10-01", daily: { "2026-10-04": 900 } };
    const result = usageTrend(source, ["2026-10-03", "2026-10-04"], "2026-10-06", 3);
    expect(result.points.map(p => p.average)).toEqual([0, 300]);
    expect(result.points[1].value).toBe(900);
  });
});
