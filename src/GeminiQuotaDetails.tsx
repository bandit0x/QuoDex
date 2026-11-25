import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { readGeminiQuota, type GeminiPool } from "./geminiQuota";
import { geminiPeriods, geminiPoolNotes, getGeminiReading } from "./geminiQuotaReadout";
import "./GeminiQuotaDetails.css";

const sources = [
  { name: "AG Gemini", index: 1 },
  { name: "AG Claude/GPT", index: 2 },
  { name: "Gemini Web", index: 0 },
];

export function GeminiQuotaDetails({ pools, refresh }: { pools: GeminiPool[]; refresh: () => void }) {
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [panel, setPanel] = useState<GeminiPool[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const displayed = panel ?? pools;
  async function connect() {
    setConnecting(true);
    try {
      await invoke("connect_gemini_web");
      setPanel(null);
      setMessage("在独立浏览器窗口登录 Gemini。关闭窗口后将自动读取额度。");
    } catch (error) {
      const diagnostic = error as { message?: string; code?: string } | null;
      setMessage(`${diagnostic?.message ?? "无法启动系统浏览器"} · ${diagnostic?.code ?? "QGM-216"}`);
    } finally {
      setConnecting(false);
    }
  }
  async function comparePanel() {
    setComparing(true);
    setMessage("");
    try {
      const snapshot = await readGeminiQuota("panel");
      setPanel(snapshot.pools.map(pool => ({ ...pool, observedAtMs: pool.observedAtMs ?? null })));
    } catch {
      setMessage("无法读取可见额度面板 · QGM-204");
    } finally {
      setComparing(false);
    }
  }

  return <div className="gemini-quota-details">
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
    {pools[0].state !== "unsupported" && <button type="button" disabled={connecting} onClick={connect}>连接 Gemini 网页账号</button>}
    {pools[0].state !== "unsupported" && <>
      <button type="button" disabled={comparing} onClick={() => { setPanel(null); refresh(); }}>刷新后台额度</button>
      <button type="button" disabled={comparing} onClick={() => void comparePanel()}>对照已打开的面板</button>
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
