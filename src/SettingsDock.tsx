import type { CSSProperties } from "react";
import type { Diagnostic, DisplayPreferences, SourceSelection, ZCodePlanPreference } from "./capacityTypes";
import { OpticalShell } from "./OpticalShell";
import { GlassLensCanvas } from "./GlassLensCanvas";
import "./SettingsDock.css";

export type PreferenceSaveState = "idle" | "saving" | "saved" | "failed";
interface SettingsDockProps {
  preferences: DisplayPreferences;
  source: SourceSelection;
  dragging: boolean;
  saveState: PreferenceSaveState;
  saveError: Diagnostic | null;
  onChange: (next: DisplayPreferences) => void;
  onPreviewOpacity: (opacity: number) => void;
  onCommitOpacity: () => void;
  onRetry: () => void;
  onClose: () => void;
  onQuit: () => void;
}

export function SettingsDock({ preferences, source, dragging, saveState, saveError, onChange, onPreviewOpacity, onCommitOpacity, onRetry, onClose, onQuit }: SettingsDockProps) {
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
    <div className={`glass-shell dock-controls${source !== "zcode" ? " dock-controls--simple" : ""}${saveError ? " dock-controls--error" : ""}`} data-save-state={saveState}>
      <OpticalShell dragging={dragging} reducedMotion={preferences.reducedMotion} opacity={preferences.opacity} controlSurface />
      <div className={`dock-preferences${source !== "zcode" ? " dock-preferences--simple" : ""}`}>
        {source === "zcode" && <span className="dock-plan">
          <span className="dock-control-label">套餐</span>
          <select aria-label="ZCode 套餐" value={preferences.zcodePlan ?? "start"} onChange={event => onChange({ ...preferences, zcodePlan: event.target.value as ZCodePlanPreference })}>
            <option value="start">体验套餐</option><option value="coding">个人套餐</option>
          </select>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
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
        <label className="dock-motion">
          <span>减少动效</span><input type="checkbox" checked={preferences.reducedMotion} onChange={event => onChange({ ...preferences, reducedMotion: event.target.checked })} />
          <span className="dock-switch" aria-hidden="true" />
        </label>
        <span className="dock-save-state" role="status">{saveState === "saved" ? <><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg><span>已保存</span></> : <span className="dock-sr-only">{saveState === "saving" ? "正在保存" : ""}</span>}</span>
        <button className="dock-quiet" type="button" aria-label="退出应用" onClick={onQuit}>退出</button>
        <button className="dock-collapse" type="button" aria-label="关闭设置" title="收起设置 · Esc" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg></button>
      </div>
      {saveError && <div className="dock-error" role="alert"><span title={[saveError.detail, "检查本地存储空间和配置目录写入权限后重试"].filter(Boolean).join("；")}>{saveError.message} · {saveError.code}</span><button type="button" aria-label="重试保存" disabled={saveState === "saving"} onClick={onRetry}>{saveState === "saving" ? "保存中" : "重试"}</button></div>}
    </div>
  </aside>;
}
