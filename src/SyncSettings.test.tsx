import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SyncSettings from "./SyncSettings";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const disconnected = { state: "disconnected", appKey: "", folder: "", userCode: null, diagnostic: null,
  devices: [], pending: 0, conflicts: 0, unidentified: 0, incomplete: 0, lastSuccessAtMs: null, authorizationExpiresAtMs: null };
beforeEach(() => invoke.mockReset());
describe("personal ledger connection", () => {
  it("does not authorize on mount and keeps SecretKey masked", async () => {
    invoke.mockResolvedValue(disconnected);render(<SyncSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: /连接并同步/ })).toBeEnabled());
    expect(invoke.mock.calls.every(([command]) => command === "sync_read")).toBe(true);
    expect(screen.getByLabelText("SecretKey")).toHaveAttribute("type", "password");
  });
  it("sends credentials only through native connect, then clears the form and waits for authorization", async () => {
    invoke.mockImplementation(async command => command === "sync_read" ? disconnected : undefined);
    render(<SyncSettings />); const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("button", { name: /连接并同步/ })).toBeEnabled());
    await user.type(screen.getByLabelText("AppKey"), "fixture-key");
    await user.type(screen.getByLabelText("SecretKey"), "fixture-secret");
    await user.type(screen.getByLabelText(/应用文件夹/), "Fixture");
    await user.click(screen.getByRole("button", { name: /连接并同步/ }));
    expect(invoke).toHaveBeenCalledWith("sync_connect", { appKey: "fixture-key", secretKey: "fixture-secret", folder: "Fixture" });
    expect(await screen.findByRole("heading", { name: "在百度完成一次授权" })).toBeVisible();
    expect(screen.queryByLabelText("SecretKey")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开百度授权页/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "取消连接" }));
    expect(screen.getByLabelText("SecretKey")).toHaveValue("");
  });
  it("shows the stable diagnostic and conflict exclusion while retaining last synchronization time", async () => {
    invoke.mockResolvedValue({ ...disconnected, state: "failed", lastSuccessAtMs: 1791307800000, conflicts: 2,
      diagnostic: { code: "QDS-103", message: "无法连接百度网盘；请检查网络" } });
    render(<SyncSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("QDS-103");
    expect(screen.getByText("2 条冲突请求暂不计入全部设备合计。")).toBeVisible();
    expect(screen.getByText(/最近同步/)).toBeVisible();
  });
});
