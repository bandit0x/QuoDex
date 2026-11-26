import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { GeminiPool } from "./geminiQuota";

export interface AgyCliStatus {
  cliInstalled: boolean;
  cliPath: string | null;
  statuslineConfigured: boolean;
  statuslineFresh: boolean;
  desktopInstalled: boolean;
}

export function GeminiDockSection({
  pools,
  reading = false,
  onRefresh,
}: {
  pools?: GeminiPool[];
  reading?: boolean;
  onRefresh?: () => void;
}) {
  const [cliStatus, setCliStatus] = useState<AgyCliStatus | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const supported = pools ? pools[0]?.state !== "unsupported" : true;

  const reloadCliStatus = useCallback(async () => {
    if (!supported || !isTauri()) return;
    try {
      const next = await invoke<AgyCliStatus>("read_agy_cli_status");
      setCliStatus(next);
    } catch {
      // Keep status null in test/mock environments without native command.
    }
  }, [supported]);

  useEffect(() => {
    void reloadCliStatus();
  }, [reloadCliStatus, pools]);

  async function loginAgy() {
    setBusyAction("login");
    setMessage("");
    try {
      const tip = await invoke<string>("login_agy_cli");
      setMessage(tip || "已启动官方 agy 登录流程。");
      void reloadCliStatus();
    } catch (error) {
      const diagnostic = error as { message?: string; code?: string } | null;
      setMessage(`${diagnostic?.message ?? "无法启动 agy 登录"} · ${diagnostic?.code ?? "QGM-262"}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function setupStatusline() {
    setBusyAction("statusline");
    setMessage("");
    try {
      const tip = await invoke<string>("setup_agy_statusline");
      setMessage(tip || "已配置 agy 零请求状态栏钩子。");
      void reloadCliStatus();
    } catch (error) {
      const diagnostic = error as { message?: string; code?: string } | null;
      setMessage(`${diagnostic?.message ?? "无法配置状态栏钩子"} · ${diagnostic?.code ?? "QGM-263"}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function connectWeb() {
    setBusyAction("web");
    setMessage("");
    try {
      await invoke("connect_gemini_web");
      setMessage("已在正常浏览器打开 Gemini 用量页；保持页面可见时 QuoDex 将纯本地同步，不运行后台无头抓取。");
    } catch (error) {
      const diagnostic = error as { message?: string; code?: string } | null;
      setMessage(`${diagnostic?.message ?? "无法启动系统浏览器"} · ${diagnostic?.code ?? "QGM-216"}`);
    } finally {
      setBusyAction(null);
    }
  }

  const modeTone = cliStatus?.statuslineFresh
    ? "ready"
    : cliStatus?.cliInstalled
      ? "ready"
      : cliStatus?.desktopInstalled
        ? "fallback"
        : "unauth";
  const modeLabel = cliStatus?.statuslineFresh
    ? "agy 状态栏（零请求）"
    : cliStatus?.cliInstalled
      ? (cliStatus.statuslineConfigured ? "agy CLI + 零请求钩子" : "agy CLI 已就绪")
      : cliStatus?.desktopInstalled
        ? "AG 本地低频回退"
        : "未登录 agy CLI";

  const hookActive = Boolean(cliStatus?.statuslineConfigured);

  return (
    <div className="dock-gemini" role="group" aria-label="Gemini 连接与操作">
      <div className="dock-gemini-head">
        <span className="dock-gemini-status">
          <span className={`dock-gemini-dot dock-gemini-dot--${modeTone}`} aria-hidden="true" />
          <span>{modeLabel}</span>
        </span>
        {onRefresh && (
          <button
            type="button"
            className="dock-gemini-refresh"
            aria-label="刷新 Gemini 额度"
            disabled={reading}
            onClick={() => { setMessage(""); onRefresh(); void reloadCliStatus(); }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
            <span>{reading ? "刷新中…" : "刷新"}</span>
          </button>
        )}
      </div>
      {supported && (
        <div className="dock-gemini-actions">
          <button
            type="button"
            className="dock-gemini-btn"
            disabled={busyAction !== null}
            onClick={() => void loginAgy()}
          >
            <svg className="ico-login" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
            <span>{cliStatus && !cliStatus.cliInstalled ? "安装/登录" : "登录 agy"}</span>
          </button>
          <button
            type="button"
            className="dock-gemini-btn"
            disabled={busyAction !== null}
            onClick={() => void setupStatusline()}
          >
            {hookActive
              ? <svg className="ico-hook-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
              : <svg className="ico-hook-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l6-6-6-6M12 19h8" /></svg>}
            <span>{hookActive ? "钩子已启" : "零请求钩子"}</span>
          </button>
          <button
            type="button"
            className="dock-gemini-btn"
            disabled={busyAction !== null}
            onClick={() => void connectWeb()}
          >
            <svg className="ico-web" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
            <span>连接网页</span>
          </button>
        </div>
      )}
      {message && <p className="dock-gemini-feedback" role="status">{message}</p>}
    </div>
  );
}
