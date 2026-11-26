import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { readGeminiQuota, type GeminiPool } from "./geminiQuota";
import { geminiPeriods, geminiPoolNotes, getGeminiReading } from "./geminiQuotaReadout";
import "./GeminiQuotaDetails.css";

interface AgyCliStatus {
  cliInstalled: boolean;
  cliPath: string | null;
  statuslineConfigured: boolean;
  statuslineFresh: boolean;
  desktopInstalled: boolean;
}

const sources = [
  { name: "AG Gemini", index: 1 },
  { name: "AG Claude/GPT", index: 2 },
  { name: "Gemini Web", index: 0 },
];

export function GeminiQuotaDetails({ pools, refresh }: { pools: GeminiPool[]; refresh: () => void }) {
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [panel, setPanel] = useState<GeminiPool[] | null>(null);
  const [cliStatus, setCliStatus] = useState<AgyCliStatus | null>(null);
  const displayed = panel ?? pools;
  const supported = pools[0].state !== "unsupported";

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
      setPanel(null);
      setMessage("已在正常浏览器打开 Gemini 用量页；保持页面可见时 QuoDex 将纯本地同步，不运行后台无头抓取。");
    } catch (error) {
      const diagnostic = error as { message?: string; code?: string } | null;
      setMessage(`${diagnostic?.message ?? "无法启动系统浏览器"} · ${diagnostic?.code ?? "QGM-216"}`);
    } finally {
      setBusyAction(null);
    }
  }

  async function comparePanel() {
    setBusyAction("panel");
    setMessage("");
    try {
      const snapshot = await readGeminiQuota("panel");
      setPanel(snapshot.pools.map(pool => ({ ...pool, observedAtMs: pool.observedAtMs ?? null })));
    } catch {
      setMessage("无法读取可见额度面板 · QGM-204");
    } finally {
      setBusyAction(null);
    }
  }

  const modeBadge = cliStatus?.statuslineFresh
    ? { label: "agy 状态栏（零请求）", tone: "ready" }
    : cliStatus?.cliInstalled
      ? { label: cliStatus.statuslineConfigured ? "agy CLI + 零请求钩子" : "agy CLI 已就绪", tone: "ready" }
      : cliStatus?.desktopInstalled
        ? { label: "AG 本地低频回退", tone: "fallback" }
        : null;

  return <div className="gemini-quota-details">
    {supported && <div className="gemini-actions-bar" role="group" aria-label="Gemini 与 AG 快捷操作">
      <div className="gemini-actions-row">
        {modeBadge && <span className={`gemini-mode-badge gemini-mode-badge--${modeBadge.tone}`}>
          <span className="gemini-mode-dot" aria-hidden="true" />
          {modeBadge.label}
        </span>}
        <button type="button" className="gemini-btn gemini-btn--primary" disabled={busyAction !== null} onClick={() => void loginAgy()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
          {cliStatus && !cliStatus.cliInstalled ? "安装/登录 agy CLI" : "登录 agy CLI"}
        </button>
        <button type="button" className={`gemini-btn${cliStatus?.statuslineConfigured ? " gemini-btn--active" : ""}`} disabled={busyAction !== null} onClick={() => void setupStatusline()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17l6-6-6-6M12 19h8" /></svg>
          {cliStatus?.statuslineConfigured ? "零请求钩子已启用" : "配置零请求钩子"}
        </button>
      </div>
      <div className="gemini-actions-row">
        <button type="button" className="gemini-btn" disabled={busyAction !== null} onClick={() => void connectWeb()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
          连接 Gemini 网页账号
        </button>
        <button type="button" className="gemini-btn" disabled={busyAction !== null} onClick={() => { setPanel(null); refresh(); void reloadCliStatus(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
          刷新后台额度
        </button>
        <button type="button" className="gemini-btn" disabled={busyAction !== null} onClick={() => void comparePanel()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
          对照已打开的面板
        </button>
      </div>
    </div>}
    {message && <p className="gemini-action-status" role="status">{message}</p>}
    <table aria-label="Gemini 额度窗口">
      <thead><tr><th scope="col">来源</th><th scope="col">周期</th><th scope="col">剩余</th><th scope="col">重置提示</th></tr></thead>
      <tbody>{sources.flatMap(({ name, index }) => geminiPeriods.map(period => {
        const pool = displayed[index];
        const reading = getGeminiReading(pool, period);
        const current = reading.value !== null && !reading.stale;
        const reset = current ? pool.windows.find(window => window.period === period)?.reset : null;
        return <tr key={`${name}-${period}`}>
          <th scope="row">{name}</th>
          <td>{period === "weekly" ? "一周" : "5 小时"}</td>
          <td>{reading.value === null ? <span aria-label="未读">—</span> : `${Number(reading.value.toFixed(1))}%`}
            {reading.stale && <small>上次</small>}</td>
          <td>{current ? reset || (pool.source === "panel" ? "面板未披露" : "未披露") : "—"}</td>
        </tr>;
      }))}</tbody>
    </table>
    <dl>{sources.map(({ name, index }) => {
      const notes = geminiPoolNotes(displayed[index], index);
      return notes.length > 0 && <div key={name}><dt>{name}</dt><dd>{notes.join(" · ")}</dd></div>;
    })}</dl>
  </div>;
}
