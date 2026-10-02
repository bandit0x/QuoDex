import { useEffect, useRef, useState } from "react";
import "./TaskStatusStrip.css";
import type { ChatTask } from "./taskStatusTypes";
import { isOverlayTaskPointerInside } from "./windowClient";

interface TaskStatusStripProps {
  tasks: ChatTask[];
  now: number;
  capacity: number;
  onOpen: (task: ChatTask) => void;
  onDismiss: (task: ChatTask) => void;
  onPopoverChange: (open: boolean) => void;
  isPointerInside?: () => Promise<boolean>;
}

const stateLabels = { running: "运行中", waiting: "等待你操作", completed: "已完成", failed: "执行报错", unknown: "状态未知" };

export function visibleChatTasks(tasks: ChatTask[], now: number): ChatTask[] {
  return tasks.flatMap(task => {
    if (task.expiresAtMs != null && task.expiresAtMs <= now) return [];
    if (task.state !== "completed") return [task];
    if (task.completedAtMs === null || !Number.isFinite(task.completedAtMs) || task.completedAtMs > now) {
      return [{ ...task, state: "unknown" as const, completedAtMs: null, detail: "结束时间暂不可用；等待同步后自动恢复 · QDT-608" }];
    }
    return now - task.completedAtMs < 1_800_000 ? [task] : [];
  });
}

function TaskCircle({ task, now }: { task: ChatTask; now: number }) {
  const minutes = task.completedAtMs === null ? null : Math.max(0, Math.floor((now - task.completedAtMs) / 60_000));
  return <span className={`task-circle task-circle--${task.state}`} aria-hidden="true">
    {task.state === "completed" && <><svg data-check viewBox="0 0 24 24"><path d="m5 12 4 4 10-10" /></svg><small>{minutes}m</small></>}
    {task.state === "running" && <svg className="task-running-arc" viewBox="0 0 48 48"><path d="M24 3a21 21 0 0 1 21 21" /></svg>}
    {task.state === "waiting" && <svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>}
    {task.state === "failed" && <svg viewBox="0 0 24 24"><path d="M12 4v10m0 4v2" /></svg>}
    {task.state === "unknown" && <svg viewBox="0 0 24 24"><path d="M8 8a4 4 0 1 1 7 3c-2 1-3 2-3 4m0 3v2" /></svg>}
  </span>;
}

function taskLabel(task: ChatTask, now: number): string {
  return `${task.title} · ${stateLabels[task.state]}${task.state === "completed" && task.completedAtMs !== null ? ` · ${Math.max(0, Math.floor((now - task.completedAtMs) / 60_000))} 分钟前` : ""}`;
}

export function TaskStatusStrip({ tasks, now, capacity, onOpen, onDismiss, onPopoverChange, isPointerInside = isOverlayTaskPointerInside }: TaskStatusStripProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const closeGeneration = useRef(0);
  const visible = visibleChatTasks(tasks, now);
  const count = visible.length > capacity ? capacity - 1 : capacity;
  const shown = visible.slice(0, count);
  const hidden = visible.slice(count);
  const hovered = visible.find(task => task.id === hoverId);
  const isOpen = (overflowOpen && hidden.length > 0) || hovered !== undefined;
  const cancelClose = () => { closeGeneration.current += 1; if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); };
  const close = () => { setOverflowOpen(false); setHoverId(null); };
  const scheduleClose = () => {
    cancelClose();
    const generation = closeGeneration.current;
    closeTimer.current = window.setTimeout(() => {
      // Native resize can emit a leave even though the circle returns beneath the pointer.
      void isPointerInside().then(inside => {
        if (generation === closeGeneration.current && !inside) close();
      }).catch(() => { if (generation === closeGeneration.current) close(); });
    }, 160);
  };
  useEffect(() => { onPopoverChange(isOpen); }, [isOpen, onPopoverChange]);
  useEffect(() => () => { closeGeneration.current += 1; if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOverflowOpen(false); setHoverId(null); } };
    const onOutside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest(".task-strip,.task-popover")) { setOverflowOpen(false); setHoverId(null); } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onOutside);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onOutside); };
  }, [isOpen]);
  if (visible.length === 0) return null;
  return <>
    <section className="task-strip" aria-label="Codex 聊天任务" onMouseLeave={scheduleClose}>
      {shown.map(task => <button key={task.id} type="button" className="task-button"
        aria-label={taskLabel(task, now)} onMouseEnter={() => { cancelClose(); setHoverId(task.id); setOverflowOpen(false); }}
        onFocus={() => { cancelClose(); setHoverId(task.id); setOverflowOpen(false); }} onBlur={scheduleClose}
        onClick={() => { onOpen(task); close(); }}><TaskCircle task={task} now={now} /></button>)}
      {hidden.length > 0 && <button type="button" className={`task-button task-overflow-button${hidden.some(task => task.state === "running") ? " task-overflow-button--active" : ""}`} aria-label={`其余 ${hidden.length} 个聊天`}
        aria-expanded={overflowOpen} onMouseEnter={() => { cancelClose(); setHoverId(null); }} onClick={() => { cancelClose(); setHoverId(null); setOverflowOpen(!overflowOpen); }}>...</button>}
    </section>
    {isOpen && <aside className="task-popover" role="dialog" aria-label={overflowOpen ? "其余聊天" : "聊天详情"} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onFocusCapture={cancelClose} onBlurCapture={scheduleClose}>
      {hovered && !overflowOpen && <div className="task-details"><strong>{hovered.title}</strong><span>{taskLabel(hovered, now).slice(hovered.title.length + 3)}</span>
        {hovered.detail && <span className="task-detail-reason">{hovered.detail}</span>}
        {hovered.state === "failed" && <button type="button" onClick={() => { onDismiss(hovered); close(); }}>移除提醒</button>}
        <small>点击圆圈打开聊天</small></div>}
      {overflowOpen && <div className="task-list">
      {hidden.map(task => <button type="button" className="task-list-entry" key={task.id} aria-label={taskLabel(task, now)}
        onClick={() => { onOpen(task); close(); }}><TaskCircle task={task} now={now} /><span>{task.title}<small>{stateLabels[task.state]}</small></span></button>)}
      </div>}
    </aside>}
  </>;
}
