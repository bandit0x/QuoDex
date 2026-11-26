import { useState } from "react";
import { readGeminiQuota, type GeminiPool } from "./geminiQuota";
import { geminiPeriods, geminiPoolNotes, getGeminiReading } from "./geminiQuotaReadout";
import "./GeminiQuotaDetails.css";

const sources = [
  { name: "Gemini", index: 1 },
  { name: "Claude/GPT", index: 2 },
  { name: "Gemini Web", index: 0 },
];

export function GeminiQuotaDetails({ pools }: { pools: GeminiPool[] }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<GeminiPool[] | null>(null);
  const displayed = panel ?? pools;
  const supported = pools[0].state !== "unsupported";

  async function comparePanel() {
    setBusy(true);
    setMessage("");
    try {
      const snapshot = await readGeminiQuota("panel");
      setPanel(snapshot.pools.map(pool => ({ ...pool, observedAtMs: pool.observedAtMs ?? null })));
    } catch {
      setMessage("无法读取可见额度面板 · QGM-204");
    } finally {
      setBusy(false);
    }
  }

  return <div className="gemini-quota-details">
    {supported && <div className="gemini-details-head">
      <span>额度与重置明细</span>
      <button type="button" className="gemini-compare-link" disabled={busy} onClick={() => void comparePanel()}>对照已打开的面板</button>
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
