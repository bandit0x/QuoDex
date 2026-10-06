import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsDock } from "./SettingsDock";
import type { DisplayPreferences } from "./capacityTypes";

const basePreferences: DisplayPreferences = { opacity: 0.92, reducedMotion: false, alwaysOnTop: true, x: null, y: null };

function renderDock(props: Partial<Parameters<typeof SettingsDock>[0]> = {}) {
  return render(<SettingsDock
    preferences={basePreferences}
    source="codex"
    dragging={false}
    saveState="idle"
    saveError={null}
    onChange={() => {}}
    onPreviewOpacity={() => {}}
    onCommitOpacity={() => {}}
    onRetry={() => {}}
    onClose={() => {}}
    onQuit={() => {}}
    {...props}
  />);
}

describe("SettingsDock 用量统计入口", () => {
  it("默认态展示完整入口行：用量统计 / 默认浏览器 + 外开图标", () => {
    renderDock({ onOpenUsage: () => {} });
    const entry = screen.getByRole("button", { name: /用量统计/ });
    expect(entry).toHaveTextContent("用量统计");
    expect(entry).toHaveTextContent("默认浏览器");
    expect(entry.querySelector("svg")).not.toBeNull();
    expect(entry).toHaveAttribute("aria-busy", "false");
  });

  it("打开中仅禁用入口并显示正在打开，不影响其他控件", () => {
    renderDock({ onOpenUsage: () => {}, usageEntryState: "opening" });
    const entry = screen.getByRole("button", { name: /用量统计/ });
    expect(entry).toBeDisabled();
    expect(entry).toHaveAttribute("aria-busy", "true");
    expect(entry).toHaveTextContent("正在打开…");
    expect(entry.querySelector(".dock-usage-spinner")).not.toBeNull();
    expect(screen.getByRole("button", { name: "退出应用" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "透明度" })).toBeEnabled();
  });

  it("系统接受派发后显示已请求浏览器打开，不声称页面已加载", () => {
    renderDock({ onOpenUsage: () => {}, usageEntryState: "requested" });
    const entry = screen.getByRole("button", { name: /用量统计/ });
    expect(entry).toBeEnabled();
    expect(entry).toHaveTextContent("已请求浏览器打开");
    expect(entry).not.toHaveTextContent("默认浏览器");
  });

  it("打开失败走独立错误轨：编号与重试完整可见，入口文案不变", async () => {
    const onOpenUsage = vi.fn();
    renderDock({
      onOpenUsage,
      usageError: { code: "QUT-702", message: "无法打开默认浏览器", detail: "请检查系统默认浏览器后重试" },
    });
    const entry = screen.getByRole("button", { name: /^用量统计/ });
    expect(entry).toHaveTextContent("用量统计");
    expect(entry).toHaveTextContent("默认浏览器");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("QUT-702");
    expect(alert).toHaveTextContent("无法打开默认浏览器");
    await userEvent.click(screen.getByRole("button", { name: "重试打开用量统计" }));
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
  });

  it("偏好保存失败与打开失败并存时保留两条独立错误轨", () => {
    renderDock({
      onOpenUsage: () => {},
      usageError: { code: "QUT-701", message: "无法准备本机用量页，请重试", detail: null },
      saveError: { code: "CRV-301", message: "偏好保存失败", detail: null },
      saveState: "failed",
    });
    expect(screen.getByText(/QUT-701/)).toBeInTheDocument();
    expect(screen.getByText(/CRV-301/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试打开用量统计" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试保存" })).toBeInTheDocument();
    expect(document.querySelector(".dock-controls--two-errors")).not.toBeNull();
  });

  it("点击入口触发打开回调", async () => {
    const onOpenUsage = vi.fn();
    renderDock({ onOpenUsage });
    await userEvent.click(screen.getByRole("button", { name: /用量统计/ }));
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
  });
});

describe("planSettingsExtraHeight 配套断言", () => {
  it("两条错误轨各自增加 24px 预算", async () => {
    const { planSettingsExtraHeight, SETTINGS_WINDOW_EXTRA_HEIGHT, SETTINGS_ERROR_EXTRA_HEIGHT } = await import("./windowClient");
    expect(planSettingsExtraHeight(false, false)).toBe(SETTINGS_WINDOW_EXTRA_HEIGHT);
    expect(planSettingsExtraHeight(true, false)).toBe(SETTINGS_WINDOW_EXTRA_HEIGHT + SETTINGS_ERROR_EXTRA_HEIGHT);
    expect(planSettingsExtraHeight(false, true)).toBe(SETTINGS_WINDOW_EXTRA_HEIGHT + SETTINGS_ERROR_EXTRA_HEIGHT);
    expect(planSettingsExtraHeight(true, true)).toBe(SETTINGS_WINDOW_EXTRA_HEIGHT + 2 * SETTINGS_ERROR_EXTRA_HEIGHT);
  });
});
