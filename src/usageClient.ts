import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Diagnostic } from "./capacityTypes";

/** 打开用量统计本机网页：确保本机只读服务已启动并交给系统默认浏览器。 */
export function openUsagePage(): Promise<string> {
  if (!isTauri()) {
    return Promise.reject({
      code: "QUT-701",
      message: "无法准备本机用量页，请重试",
      detail: "用量统计需要 QuoDex 桌面应用提供本机服务",
    } satisfies Diagnostic);
  }
  return invoke<string>("usage_page_open");
}
