import { useEffect, useRef, useState } from "react";
import "./TaskStatusStrip.css";
import { readyTaskSources, type ChatTask, type TaskSource, type TaskSourceStatus } from "./taskStatusTypes";
import { isOverlayTaskPointerInside } from "./windowClient";
import { TaskWaterFlow } from "./TaskWaterFlow";
import type { Diagnostic } from "./capacityTypes";

interface TaskStatusStripProps {
  tasks: ChatTask[];
  now: number;
  capacity: number;
  sources?: TaskSourceStatus[];
  diagnostic?: Diagnostic | null;
  reducedMotion?: boolean;
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

function TaskCircle({ task, now, reducedMotion }: { task: ChatTask; now: number; reducedMotion: boolean }) {
  const minutes = task.completedAtMs === null ? null : Math.max(0, Math.floor((now - task.completedAtMs) / 60_000));
  return <span className={`task-circle task-circle--${task.state}`} aria-hidden="true">
    {task.state === "completed" && <svg data-check viewBox="0 0 40.8 40.8"><circle cx="20.4" cy="20.4" r="19.2" /><path d="m5 12 4 4 10-10" transform="translate(10.8 3.5) scale(.8)" /><text x="20.4" y="29.8" textAnchor="middle">{minutes}m</text></svg>}
    {task.state === "running" && <TaskWaterFlow chatId={task.id} reducedMotion={reducedMotion} />}
    {task.state === "waiting" && <svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>}
    {task.state === "failed" && <svg viewBox="0 0 24 24"><path d="M12 4v10m0 4v2" /></svg>}
    {task.state === "unknown" && <svg viewBox="0 0 24 24"><path d="M8 8a4 4 0 1 1 7 3c-2 1-3 2-3 4m0 3v2" /></svg>}
  </span>;
}

function taskTitle(task: ChatTask): string {
  return task.projectName ? `${task.projectName}：${task.title}` : task.title;
}

function taskStateLabel(task: ChatTask, now: number): string {
  return `${stateLabels[task.state]}${task.state === "completed" && task.completedAtMs !== null ? ` · ${Math.max(0, Math.floor((now - task.completedAtMs) / 60_000))} 分钟前` : ""}`;
}

function taskLabel(task: ChatTask, now: number): string {
  return `${taskTitle(task)} · ${taskStateLabel(task, now)}`;
}

const sourceNames: Record<TaskSource, string> = { codex: "Codex", zcode: "ZCode" };
const statePriority = { running: 0, waiting: 1, failed: 2, unknown: 3, completed: 4 };

export function TaskStatusStrip({ tasks, now, sources = readyTaskSources(now), diagnostic = null, capacity, reducedMotion = false, onOpen, onDismiss, onPopoverChange, isPointerInside = isOverlayTaskPointerInside }: TaskStatusStripProps) {
  const [listSource, setListSource] = useState<TaskSource | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [commonDiagnosticOpen, setCommonDiagnosticOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const closeGeneration = useRef(0);
  const key = (task: ChatTask) => `${task.source}:${task.id}`;
  const visible = visibleChatTasks(tasks, now);
  const groups = (["codex", "zcode"] as const).map(source => ({
    source,
    status: sources.find(item => item.source === source),
    tasks: visible.filter(task => task.source === source).sort((a, b) => statePriority[a.state] - statePriority[b.state] || (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0) || a.id.localeCompare(b.id)),
  }));
  const hovered = visible.find(task => key(task) === hoverKey);
  const activeGroup = groups.find(group => group.source === listSource);
  const hasArea = visible.length > 0 || sources.some(source => source.health !== "ready") || diagnostic !== null;
  const commonDiagnostic = commonDiagnosticOpen ? diagnostic : null;
  const isOpen = hasArea && (activeGroup !== undefined || hovered !== undefined || commonDiagnostic !== null);
  const cancelClose = () => { closeGeneration.current += 1; if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); };
  const close = () => { setListSource(null); setHoverKey(null); setCommonDiagnosticOpen(false); };
  const scheduleClose = () => {
    cancelClose();
    const generation = closeGeneration.current;
    closeTimer.current = window.setTimeout(() => {
      void isPointerInside().then(inside => {
        if (generation === closeGeneration.current && !inside) close();
      }).catch(() => { if (generation === closeGeneration.current) close(); });
    }, 160);
  };
  useEffect(() => { onPopoverChange(isOpen); }, [isOpen, onPopoverChange]);
  useEffect(() => () => { closeGeneration.current += 1; if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onOutside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest(".task-strip,.task-popover")) close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onOutside);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onOutside); };
  }, [isOpen]);
  if (!hasArea) return null;
  const openList = (source: TaskSource) => { cancelClose(); setHoverKey(null); setCommonDiagnosticOpen(false); setListSource(previous => previous === source ? null : source); };
  const showTask = (task: ChatTask) => { cancelClose(); setHoverKey(key(task)); setListSource(null); setCommonDiagnosticOpen(false); };
  const slots = Math.min(3, Math.max(2, capacity));
  return <>
    <section className={`task-strip${diagnostic ? " task-strip--diagnostic" : ""}`} aria-label="聊天任务" onMouseLeave={scheduleClose}>
      {groups.map(group => {
        const name = sourceNames[group.source];
        const count = group.tasks.length > slots ? slots - 1 : slots;
        const hidden = group.tasks.slice(count);
        const attention = ["failed", "waiting", "running", "unknown", "completed"].find(state => hidden.some(task => task.state === state));
        const health = group.status?.health ?? "loading";
        return <div key={group.source} className={`task-source-capsule task-source-capsule--${group.source}`} role="group" aria-label={`${name} 任务`}>
          <button type="button" className={`task-source-name task-source-name--${health}`} aria-label={`查看 ${name} 全部 ${group.tasks.length} 个任务${health === "unavailable" ? "，状态不可用" : ""}`} aria-expanded={listSource === group.source}
            onMouseEnter={() => { cancelClose(); setHoverKey(null); }} onClick={() => openList(group.source)}>{name}<i aria-hidden="true" /></button>
          {group.tasks.slice(0, count).map(task => <button key={key(task)} type="button" className="task-button"
            aria-label={taskLabel(task, now)} onMouseEnter={() => showTask(task)}
            onFocus={() => showTask(task)} onBlur={scheduleClose}
            onClick={() => { onOpen(task); close(); }}><TaskCircle task={task} now={now} reducedMotion={reducedMotion} /></button>)}
          {hidden.length > 0 && <button type="button" className={`task-button task-overflow-button task-overflow-button--${attention}`} aria-label={`${name}：其余 ${hidden.length} 个任务`}
            title={hidden.map(task => taskLabel(task, now)).join("\n")} aria-expanded={listSource === group.source}
            onMouseEnter={() => { cancelClose(); setHoverKey(null); }} onClick={() => openList(group.source)}><span className="task-overflow-indicator">{hidden.length > 99 ? "99+" : `+${hidden.length}`}</span></button>}
          {group.tasks.length === 0 && <span className="task-empty" role="status">{health === "loading" ? "读取中" : health === "unavailable" ? "连接异常" : "暂无任务"}</span>}
        </div>;
      })}
      {diagnostic && <button type="button" className="task-common-diagnostic" aria-label="公共任务诊断" title={`${diagnostic.message} · ${diagnostic.code}`} aria-expanded={commonDiagnosticOpen}
        onMouseEnter={cancelClose} onClick={() => { cancelClose(); setHoverKey(null); setListSource(null); setCommonDiagnosticOpen(previous => !previous); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v9m0 4v1" /></svg>
      </button>}
    </section>
    {isOpen && <aside className="task-popover" role="dialog" aria-label={commonDiagnostic ? "公共任务诊断" : activeGroup ? `${sourceNames[activeGroup.source]} 任务列表` : "聊天详情"} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onFocusCapture={cancelClose} onBlurCapture={scheduleClose}>
      {commonDiagnostic && <div className="task-details"><strong>任务提醒记录异常</strong><p className="task-detail-reason" role="status">{commonDiagnostic.message} · {commonDiagnostic.code}</p></div>}
      {hovered && !activeGroup && <div className="task-details"><small>{sourceNames[hovered.source]}</small><strong>{taskTitle(hovered)}</strong><span>{taskStateLabel(hovered, now)}</span>
        {hovered.detail && <span className="task-detail-reason">{hovered.detail}</span>}
        {hovered.state === "failed" && <button type="button" onClick={() => { onDismiss(hovered); close(); }}>移除提醒</button>}
        {hovered.projectPath && <span>{hovered.projectPath}</span>}
        <small>{hovered.source === "zcode" ? "点击圆圈打开 ZCode 项目" : "点击圆圈打开 Codex 聊天"}</small></div>}
      {activeGroup && <div className="task-list"><strong>{sourceNames[activeGroup.source]} · 全部 {activeGroup.tasks.length} 项</strong>
        {activeGroup.status?.diagnostic && <p className="task-detail-reason" role="status">{activeGroup.status.diagnostic.message} · {activeGroup.status.diagnostic.code}</p>}
        {activeGroup.tasks.length === 0 && <span>{activeGroup.status?.health === "ready" ? "暂无任务" : "等待来源恢复后自动同步"}</span>}
        {activeGroup.tasks.map(task => <div className="task-list-row" key={key(task)}><button type="button" className="task-list-entry" aria-label={taskLabel(task, now)}
          onClick={() => { onOpen(task); close(); }}><TaskCircle task={task} now={now} reducedMotion={reducedMotion} /><span>{taskTitle(task)}<small>{taskStateLabel(task, now)}</small></span></button>
          {task.state === "failed" && <button type="button" className="task-list-dismiss" aria-label={`移除 ${taskTitle(task)} 的报错提醒`} onClick={() => onDismiss(task)}>移除提醒</button>}</div>)}
      </div>}
    </aside>}
  </>;
}
