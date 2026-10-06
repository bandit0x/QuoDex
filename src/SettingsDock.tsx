import type { CSSProperties } from "react";
import type { Diagnostic, DisplayPreferences, SourceSelection } from "./capacityTypes";
import { OpticalShell } from "./OpticalShell";
import { GlassLensCanvas } from "./GlassLensCanvas";
import { PlanSegmented } from "./PlanSegmented";
import "./SettingsDock.css";

export type PreferenceSaveState = "idle" | "saving" | "saved" | "failed";
export type UsageEntryState = "idle" | "opening" | "requested";
interface SettingsDockProps {
  preferences: DisplayPreferences;
  source: SourceSelection;
  dragging: boolean;
  saveState: PreferenceSaveState;
  saveError: Diagnostic | null;
  usageEntryState?: UsageEntryState;
  usageError?: Diagnostic | null;
  appliedAlwaysOnTop?: boolean;
  pinStateUnconfirmed?: boolean;
  onChange: (next: DisplayPreferences) => void;
  onPreviewOpacity: (opacity: number) => void;
  onCommitOpacity: () => void;
  onRetry: () => void;
  onClose: () => void;
  onQuit: () => void;
  onOpenUsage?: () => void;
}

export function SettingsDock({ preferences, source, dragging, saveState, saveError, usageEntryState = "idle", usageError = null, appliedAlwaysOnTop, pinStateUnconfirmed = false, onChange, onPreviewOpacity, onCommitOpacity, onRetry, onClose, onQuit, onOpenUsage }: SettingsDockProps) {
  const shownAlwaysOnTop = saveState === "saving" ? (preferences.alwaysOnTop ?? true) : (appliedAlwaysOnTop ?? preferences.alwaysOnTop ?? true);
  const twoErrors = Boolean(saveError && usageError);
  return <aside className="settings-dock" role="dialog" aria-label="显示设置">
    <GlassLensCanvas reducedMotion={preferences.reducedMotion} />
    <div className="dock-sources" role="group" aria-label="额度来源">
      {([['codex', 'Codex'], ['zcode', 'ZCode'], ['carousel', '轮播']] as const).map(([value, label]) => <button
        key={value} type="button" className={`glass-lens glass-lens--${value}`} data-glass-lens data-lens-tone={value} data-selected={source === value}
        aria-pressed={source === value} onClick={() => onChange({ ...preferences, source: value })}>
        {value === "carousel" ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5m10-4a8 8 0 0 0-13-2m-1 10a8 8 0 0 0 13 2" /></svg> : <span className="lens-state-dot" aria-hidden="true" />}
        <span>{label}</span>
      </button>)}
    </div>
    <div className={`glass-shell dock-controls${source !== "zcode" ? " dock-controls--simple" : ""}${saveError ? " dock-controls--error" : ""}${twoErrors ? " dock-controls--two-errors" : ""}`} data-save-state={saveState}>
      <OpticalShell dragging={dragging} reducedMotion={preferences.reducedMotion} opacity={preferences.opacity} controlSurface />
      <div className={`dock-preferences${source !== "zcode" ? " dock-preferences--simple" : ""}`}>
        {source === "zcode" && <span className="dock-plan">
          <span className="dock-control-label">套餐</span>
          <PlanSegmented value={preferences.zcodePlan ?? "start"} onChange={zcodePlan => onChange({ ...preferences, zcodePlan })} />
        </span>}
        <label className="dock-opacity" htmlFor="dock-opacity">
          <span>透明度</span><output htmlFor="dock-opacity">{Math.round(preferences.opacity * 100)}%</output>
          <input id="dock-opacity" aria-label="透明度" type="range" min="0.86" max="1" step="0.02" value={preferences.opacity}
            style={{ "--range-fill": `${(preferences.opacity - .86) / .14 * 100}%` } as CSSProperties}
            onChange={event => onPreviewOpacity(Number(event.target.value))}
            onPointerUp={onCommitOpacity} onPointerCancel={onCommitOpacity} onKeyUp={onCommitOpacity} onBlur={onCommitOpacity} />
        </label>
      </div>
      <div className="dock-actions">
        <label className={`dock-motion dock-pin${saveState === "saving" || pinStateUnconfirmed ? " dock-pin--saving" : ""}`} title={pinStateUnconfirmed ? "窗口置顶状态未确认；请重试或重新打开 QuoDex" : "开启后保持窗口置顶"}>
          <span>置于顶层</span><input type="checkbox" checked={shownAlwaysOnTop} disabled={saveState === "saving" || pinStateUnconfirmed} onChange={event => onChange({ ...preferences, alwaysOnTop: event.target.checked })} />
          <span className="dock-switch" aria-hidden="true" />
        </label>
        <label className="dock-motion">
          <span>减少动效</span><input type="checkbox" checked={preferences.reducedMotion} onChange={event => onChange({ ...preferences, reducedMotion: event.target.checked })} />
          <span className="dock-switch" aria-hidden="true" />
        </label>
        <span className="dock-save-state" role="status">{saveState === "saved" ? <><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg><span>已保存</span></> : saveState === "saving" ? <span>正在保存</span> : null}</span>
        <button className="dock-quiet" type="button" aria-label="退出应用" onClick={onQuit}>退出</button>
        <button className="dock-collapse" type="button" aria-label="关闭设置" title="收起设置 · Esc" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg></button>
      </div>
      <button className="dock-usage" type="button" data-entry-state={usageEntryState} aria-busy={usageEntryState === "opening"}
        disabled={usageEntryState === "opening" || !onOpenUsage} onClick={onOpenUsage}>
        <span className="dock-usage-label">用量统计</span>
        <span className="dock-usage-hint" role="status">
          {usageEntryState === "opening" ? <><span className="dock-usage-spinner" aria-hidden="true" />正在打开…</>
            : usageEntryState === "requested" ? "已请求浏览器打开"
              : <>默认浏览器<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6-9 9m7 0v7H4V6h7" /></svg></>}
        </span>
      </button>
      {usageError && <div className="dock-error dock-error--usage" role="alert"><span className="dock-error-message" title={[usageError.message, usageError.detail].filter(Boolean).join("；")}>{usageError.message}</span><span className="dock-error-code"> · {usageError.code}</span><button type="button" aria-label="重试打开用量统计" disabled={usageEntryState === "opening"} onClick={onOpenUsage}>{usageEntryState === "opening" ? "打开中" : "重试"}</button></div>}
      {saveError && <div className="dock-error" role="alert"><span className="dock-error-message" title={[saveError.message, saveError.detail].filter(Boolean).join("；")}>{saveError.message}</span><span className="dock-error-code"> · {saveError.code}</span><button type="button" aria-label="重试保存" disabled={saveState === "saving"} onClick={onRetry}>{saveState === "saving" ? "保存中" : "重试"}</button></div>}
    </div>
  </aside>;
}
