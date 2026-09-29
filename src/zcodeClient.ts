import { invoke } from "@tauri-apps/api/core";
import type { ZCodePlanPreference, ZCodeQuotaSnapshot } from "./capacityTypes";

export function readZcodeQuotaSnapshot(
  preferredPlan: ZCodePlanPreference = "start",
): Promise<ZCodeQuotaSnapshot> {
  return invoke<ZCodeQuotaSnapshot>("read_zcode_quota_snapshot", { preferredPlan });
}
