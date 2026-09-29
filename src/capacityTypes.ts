export interface QuotaWindow {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number;
  // ZCode 的 0 用量窗口没有重置时间，Codex 恒有
  resetsAt: number | null;
}

export interface FullResetCredits {
  availableCount: number;
  nearestExpiryAt: number | null;
}

export interface CapacitySnapshot {
  sourceState: "healthy" | "stale";
  /** app-server `account/rateLimits/read` 披露的套餐类型；null 表示协议未披露。 */
  planType: string | null;
  /** 读取时 auth.json 的账户标识；null 表示未登录或身份不可读。与额度数据同批产生。 */
  accountId: string | null;
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  fullResetCredits: FullResetCredits | null;
  observedAtMs: number;
}

export interface ZCodeQuotaWindow {
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number;
  resetsAt: number | null;
  quotaTotal: number;
  quotaUsed: number;
  quotaRemaining: number;
}

export interface ZCodeQuotaSnapshot {
  sourceState: "healthy";
  fiveHour: ZCodeQuotaWindow | null;
  weekly: ZCodeQuotaWindow | null;
  planLevel: string | null;
  /** 套餐形态：start_plan = 体验套餐（单池），coding_plan = 个人套餐（5h+周窗口）。 */
  planKind: "start_plan" | "coding_plan" | null;
  observedAtMs: number;
}

export type MeterSource = "codex" | "zcode";
export type SourceSelection = MeterSource | "carousel";
/** ZCode 来源下展示哪个套餐：start = 体验套餐优先（不可用回落个人），coding = 仅个人套餐。 */
export type ZCodePlanPreference = "start" | "coding";

export interface DisplayPreferences {
  opacity: number;
  reducedMotion: boolean;
  x: number | null;
  y: number | null;
  source?: SourceSelection;
  zcodePlan?: ZCodePlanPreference;
}

export interface Diagnostic {
  code: string;
  message: string;
  detail: string | null;
  /** 失败发生时已登录的账户标识（仅 Codex 来源携带），用于判定缓存数据归属。 */
  accountId?: string | null;
}

export interface TomatoConnectionSnapshot {
  state: "healthy" | "blocked";
  countryCode: string | null;
  latencyMs: number | null;
  observedAtMs: number;
  diagnostic: Diagnostic | null;
}
