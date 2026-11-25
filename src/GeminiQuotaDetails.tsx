import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { GeminiPool } from "./geminiQuota";
import { geminiPeriods, geminiPoolNotes, getGeminiReading } from "./geminiQuotaReadout";
import "./GeminiQuotaDetails.css";

const sources = [
  { name: "AG Gemini", index: 1 },
  { name: "AG Claude/GPT", index: 2 },
  { name: "Gemini Web", index: 0 },
];

export function GeminiQuotaDetails({ pools }: { pools: GeminiPool[] }) {
  const [message, setMessage] = useState("");
  const [connecting, setConnecting] = useState(false);
  async function connect() {
    setConnecting(true);
    try {
      await invoke("connect_gemini_web");
      setMessage("在独立浏览器窗口登录 Gemini，完成后关闭该窗口并点击刷新。");
    } catch (error) {
      const diagnostic = error as { message?: string; code?: string } | null;
      setMessage(`${diagnostic?.message ?? "无法启动系统浏览器"} · ${diagnostic?.code ?? "QGM-216"}`);
    } finally {
      setConnecting(false);
    }
  }

  return <div className="gemini-quota-details">
    <table aria-label="Gemini 额度窗口">
      <thead><tr><th scope="col">来源</th><th scope="col">周期</th><th scope="col">剩余</th><th scope="col">重置提示</th></tr></thead>
      <tbody>{sources.flatMap(({ name, index }) => geminiPeriods.map(period => {
        const pool = pools[index];
        const reading = getGeminiReading(pool, period);
        const current = reading.value !== null && !reading.stale;
        const reset = current ? pool.windows.find(window => window.period === period)?.reset : null;
        return <tr key={`${name}-${period}`}>
          <th scope="row">{name}</th>
          <td>{period === "weekly" ? "一周" : "5 小时"}</td>
          <td>{reading.value === null ? <span aria-label="未读">—</span> : `${Number(reading.value.toFixed(1))}%`}
            {reading.stale && <small>上次</small>}</td>
          <td>{current ? reset || "面板未披露" : "—"}</td>
        </tr>;
      }))}</tbody>
    </table>
    <dl>{sources.map(({ name, index }) => {
      const notes = geminiPoolNotes(pools[index], index);
      return notes.length > 0 && <div key={name}><dt>{name}</dt><dd>{notes.join(" · ")}</dd></div>;
    })}</dl>
    {pools[0].state !== "unsupported" && <button type="button" disabled={connecting} onClick={connect}>连接 Gemini 网页账号</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
