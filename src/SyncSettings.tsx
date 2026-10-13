import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./SyncSettings.css";

type Issue = { code: string; message: string };
type SyncView = {
  state: string; appKey: string; folder: string; userCode: string | null;
  authorizationExpiresAtMs: number | null; lastSuccessAtMs: number | null;
  pending: number; conflicts: number; incomplete: number; unidentified: number;
  devices: { id: string; uploadedAtMs: number }[]; diagnostic: Issue | null;
};
const labels: Record<string, string> = {
  disconnected: "让每台 PC 看见同一份用量", authorizing: "在百度完成一次授权",
  syncing: "正在同步你的个人账本", "catching-up": "正在补齐历史账目",
  ready: "个人账本已连接", failed: "同步需要处理", reauthorize: "请重新授权百度网盘",
};
function issue(error: unknown): Issue {
  if (error && typeof error === "object" && "code" in error && "message" in error) return error as Issue;
  return { code: "QDS-113", message: "无法连接本机同步服务；请重启 QuoDex" };
}
function SyncIcon({ success = false }: { success?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={success ? "m5 12 4 4L19 6" : "M6 18 18 6M7 6h11v11"} /></svg>;
}
export default function SyncSettings() {
  const [view, setView] = useState<SyncView | null>(null);
  const [appKey, setAppKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<Issue | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let stopped = false;
    let first = true;
    const read = async () => {
      try {
        const next = await invoke<SyncView>("sync_read");
        if (stopped) return;
        setView(next);
        if (first) { setAppKey(next.appKey); setFolder(next.folder); first = false; }
      } catch (e) { if (!stopped) setError(issue(e)); }
    };
    void read(); const interval = window.setInterval(read, 1500);
    return () => { stopped = true; window.clearInterval(interval); };
  }, []);
  const action = async (command: string, args?: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      await invoke(command, args);
      if (command === "sync_connect") { setSecretKey(""); setEditing(false); setView(old => old ? { ...old, state: "authorizing", userCode: null, diagnostic: null } : old); }
      if (command === "sync_disconnect") setView(old => old ? { ...old, state: "disconnected", diagnostic: null } : old);
    } catch (e) { setError(issue(e)); }
    finally { setBusy(false); }
  };
  const state = view?.state ?? "disconnected";
  const showForm = editing || ["disconnected", "reauthorize"].includes(state) || (state === "failed" && !view?.lastSuccessAtMs);
  const diagnostic = error ?? view?.diagnostic;
  return <main className="sync-settings-page">
    <header className="sync-settings-brand"><strong>QuoDex</strong><span>个人账本同步</span><span className="sync-settings-provider">百度网盘</span></header>
    <section className="sync-settings-card">
      <div className={`sync-settings-orbit sync-settings-orbit--${state}`} aria-hidden="true"><SyncIcon success={state === "ready"} /></div>
      <h1>{labels[state] ?? labels.disconnected}</h1>
      <p className="sync-settings-lead">Codex + ZCode 的已记录 token 用量，自动汇入同一份个人账本。</p>
      {diagnostic && <div className="sync-settings-error" role="alert"><strong>{diagnostic.message}</strong><small>{diagnostic.code}</small></div>}
      {showForm && <form onSubmit={event => { event.preventDefault(); void action("sync_connect", { appKey, secretKey, folder }); }}>
        <label>AppKey<input value={appKey} onChange={e => setAppKey(e.target.value)} required maxLength={256} autoComplete="off" spellCheck={false} placeholder="百度开发者应用的 AppKey" /></label>
        <label>SecretKey<input type="password" value={secretKey} onChange={e => setSecretKey(e.target.value)} required maxLength={512} autoComplete="off" placeholder="百度开发者应用的 SecretKey" aria-describedby="secret-help" /></label>
        <small id="secret-help" className="sync-secret-help">仅保存在本机系统凭据库，不随账本同步，仅用于百度授权。</small>
        <label>应用文件夹<input value={folder} onChange={e => setFolder(e.target.value)} required maxLength={100} autoComplete="off" placeholder="申请应用时设置的文件夹名称" /><small>其他 PC 使用同一个百度账号、开发者应用与文件夹，并分别授权。</small></label>
        <button className="sync-primary" type="submit" disabled={busy || !view}>{busy ? "正在准备…" : "连接并同步"}<SyncIcon /></button>
      </form>}
      {!showForm && state === "authorizing" && <div className="sync-authorization">
        <p>在百度官方页面确认授权，完成后会自动同步。</p>
        <output className="sync-user-code" aria-label="百度设备授权码">{view?.userCode ?? "正在获取设备码…"}</output>
        {view?.authorizationExpiresAtMs && <p className="sync-settings-muted">有效至 {new Date(view.authorizationExpiresAtMs).toLocaleTimeString("zh-CN", { hour12: false })}</p>}
        <button className="sync-primary" disabled={busy || !view?.userCode} onClick={() => void action("sync_authorize_open")}>打开百度授权页<SyncIcon /></button>
        <button className="sync-secondary" disabled={busy} onClick={() => void action("sync_disconnect")}>取消连接</button>
      </div>}
      {!showForm && state !== "authorizing" && <div className="sync-connected">
        <p className="sync-connected-label">{view?.lastSuccessAtMs ? `最近同步 ${new Date(view.lastSuccessAtMs).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : "首次同步准备中"}</p>
        <dl><div><dt>已发现设备</dt><dd>{view?.devices.length ?? 0}</dd></div><div><dt>待上传记录</dt><dd>{view?.pending ?? 0}</dd></div></dl>
        {!!view?.conflicts && <p className="sync-settings-error">{view.conflicts} 条冲突请求暂不计入全部设备合计。</p>}
        {!!view?.unidentified && <p className="sync-settings-muted">{view.unidentified} 条旧账缺少可靠身份，保留在本机。</p>}
        <button className="sync-primary" disabled={busy || state === "syncing"} onClick={() => void action("sync_now")}>{state === "syncing" ? "正在同步…" : "立即同步"}</button>
        <div className="sync-settings-links"><button onClick={() => setEditing(true)}>重新配置</button><button disabled={busy} onClick={() => void action("sync_disconnect")}>断开连接</button></div>
        <p className="sync-settings-muted">断开后停止同步，已经保存的账目仍会保留。</p>
      </div>}
    </section>
    <footer className="sync-settings-footnote"><span>只同步匿名请求标识、时间与 token 数。</span><span>不上传聊天正文、项目路径或模型 API key。</span>
      <details><summary>首次连接需要准备什么？</summary><p>在百度网盘开放平台完成个人开发者认证，创建应用并开通网盘权限。将 AppKey、SecretKey 和应用文件夹填入上方；然后登录你的百度账号确认授权。</p><p>网盘只负责保存账目。无需维护常驻服务，离线仍会记账；联网后约每分钟同步一次，网络失败时逐步延长重试间隔。</p></details>
    </footer>
  </main>;
}
