/**
 * 用量页核心逻辑：日期端点、区间聚合、日历分级、数字格式。
 *
 * 规则来自 `.scratch/token-usage/spec.md` 的日期端点契约：
 * - 统一右开边界 [S, E)，E 为本机今天次日 00:00；
 * - 7/30 天从 E 减对应日历日；3/6/12 个日历月按日号回溯、目标月缺日号裁到月末；
 * - 先做日历运算再谈时区：所有日期用 "YYYY-MM-DD" 字符串表达，
 *   运算锚定 UTC 正午，永不使用固定秒数模拟日历日。
 */

const DAY_MS = 86400000;

function pad(value) {
  return value < 10 ? `0${value}` : String(value);
}

export function parseDay(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function dayKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(iso, count) {
  const moment = parseDay(iso);
  moment.setUTCDate(moment.getUTCDate() + count);
  return dayKey(moment);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** E 减 count 个日历月；目标月缺少同日号时裁到月末。 */
export function minusMonthsClamped(iso, count) {
  const moment = parseDay(iso);
  const total = moment.getUTCFullYear() * 12 + moment.getUTCMonth() - count;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  const day = Math.min(moment.getUTCDate(), daysInMonth(year, monthIndex + 1));
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

/** 本机今天（YYYY-MM-DD）。页面在本机运行，直接用本地时钟。 */
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 六区间端点。返回 { start, endExclusive, today }；合计的 start 由账本最早记录决定，
 * 没有任何记录时为 null。
 */
export function periodRange(rangeKey, todayIso, earliestIso = null) {
  const endExclusive = addDays(todayIso, 1);
  switch (rangeKey) {
    case "7d":
      return { start: addDays(endExclusive, -7), endExclusive, today: todayIso };
    case "30d":
      return { start: addDays(endExclusive, -30), endExclusive, today: todayIso };
    case "3m":
      return { start: minusMonthsClamped(endExclusive, 3), endExclusive, today: todayIso };
    case "6m":
      return { start: minusMonthsClamped(endExclusive, 6), endExclusive, today: todayIso };
    case "1y":
      return { start: minusMonthsClamped(endExclusive, 12), endExclusive, today: todayIso };
    case "total":
      return { start: earliestIso, endExclusive, today: todayIso };
    default:
      throw new Error(`unknown range: ${rangeKey}`);
  }
}

export function eachDay(startIso, endExclusiveIso, limit = 800) {
  const days = [];
  if (!startIso) return days;
  let cursor = startIso;
  while (cursor < endExclusiveIso) {
    days.push(cursor);
    if (days.length > limit) throw new Error("period too long");
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** [start, endExclusive) 内的已记录总量。 */
export function sumRange(daily, startIso, endExclusiveIso) {
  if (!daily || !startIso) return 0;
  let total = 0;
  for (const [day, value] of Object.entries(daily)) {
    if (day >= startIso && day < endExclusiveIso) total += value;
  }
  return total;
}

/**
 * 单日分类（互斥）：
 * - future：今天之后，尚未到来；
 * - value：有已记录用量；
 * - zero：处于持续采集起点之后、今天之前的无记录日——只有这时才允许视为已确认零；
 * - unknown：采集起点之前的无记录日，历史不完整，不能当 0。
 */
export function dayClass(dayIso, todayIso, collectionStartIso, hasRecord) {
  if (dayIso > todayIso) return "future";
  if (hasRecord) return "value";
  if (collectionStartIso && dayIso >= collectionStartIso) return "zero";
  return "unknown";
}

/** 覆盖标记：持续采集起点之后的记录视为完整覆盖，此前为部分记录。 */
export function dayCoverage(dayIso, collectionStartIso) {
  return collectionStartIso && dayIso >= collectionStartIso ? "full" : "partial";
}

export function mergeDayClass(classes) {
  if (classes.includes("value")) return "value";
  if (classes.every(item => item === "future")) return "future";
  if (classes.includes("zero") && classes.every(item => item === "zero" || item === "future")) return "zero";
  return "unknown";
}

/**
 * 五级亮度阈值。peak M 为本月有效日值峰值（合并与分开共用同一 M）：
 * v > 0 时 level = min(5, ceil(5v / M))，v = 0 为独立 0 级；M = 0 时全月零/缺失，跳过除法。
 * thresholds 为图例可见的各级上界（向上取整）。
 */
export function heatScale(values) {
  const peak = values.reduce((max, value) => (value > max ? value : max), 0);
  if (peak <= 0) {
    return { peak: 0, thresholds: [], level: () => 0 };
  }
  const thresholds = [1, 2, 3, 4, 5].map(step => Math.ceil((peak * step) / 5));
  return {
    peak,
    thresholds,
    level: value => {
      if (value <= 0) return 0;
      return Math.min(5, Math.ceil((5 * value) / peak));
    },
  };
}

/** 千位分隔精确数。 */
export function formatTokens(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 图表刻度缩写：840 / 0.84M / 1.51B。 */
export function abbrevTokens(value) {
  const format = mantissa => {
    const text = mantissa >= 100 ? Math.round(mantissa).toString() : mantissa >= 10 ? mantissa.toFixed(1) : mantissa.toFixed(2);
    return text.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  };
  if (value >= 1e9) return `${format(value / 1e9)}B`;
  if (value >= 1e6) return `${format(value / 1e6)}M`;
  if (value >= 1e3) return `${format(value / 1e3)}k`;
  return String(Math.round(value));
}

const WEEKDAY_MONDAY_FIRST = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAY_LONG = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

export function weekdayIndex(iso) {
  return (parseDay(iso).getUTCDay() + 6) % 7;
}

export function weekdayShort(iso) {
  return WEEKDAY_MONDAY_FIRST[weekdayIndex(iso)];
}

export function weekdayLong(iso) {
  return WEEKDAY_LONG[weekdayIndex(iso)];
}

/** "10月5日 · 星期一" 样式的选中日标题。 */
export function formatDayTitle(iso) {
  const moment = parseDay(iso);
  return `${moment.getUTCMonth() + 1}月${moment.getUTCDate()}日 · ${weekdayLong(iso)}`;
}

export function monthTitle(iso) {
  const moment = parseDay(iso);
  return `${moment.getUTCFullYear()}年${moment.getUTCMonth() + 1}月`;
}

/** 本月日历网格（周一起始）：前导与月末补 null。 */
export function calendarGrid(iso) {
  const moment = parseDay(iso);
  const year = moment.getUTCFullYear();
  const month = moment.getUTCMonth() + 1;
  const firstWeekday = weekdayIndex(`${year}-${pad(month)}-01`);
  const total = daysInMonth(year, month);
  const cells = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= total; day += 1) {
    cells.push(`${year}-${pad(month)}-${pad(day)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** 快照里单来源某日的记录与覆盖。 */
export function sourceDayInfo(sourceSnapshot, dayIso, todayIso) {
  const hasRecord = Object.prototype.hasOwnProperty.call(sourceSnapshot.daily || {}, dayIso);
  const value = hasRecord ? sourceSnapshot.daily[dayIso] : null;
  return {
    hasRecord,
    value,
    cls: dayClass(dayIso, todayIso, sourceSnapshot.collectionStartDay, hasRecord),
    coverage: dayCoverage(dayIso, sourceSnapshot.collectionStartDay),
  };
}

/** 数值安全的 y 轴 nice 上界：0/中/峰值三档刻度。 */
export function niceTicks(maxValue) {
  if (maxValue <= 0) return [0, 0, 0];
  const exponent = Math.floor(Math.log10(maxValue));
  const base = 10 ** exponent;
  const scaled = maxValue / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 4 ? 4 : scaled <= 5 ? 5 : scaled <= 8 ? 8 : 10;
  const top = nice * base;
  return [0, top / 2, top];
}
