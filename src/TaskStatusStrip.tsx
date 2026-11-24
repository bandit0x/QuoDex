import { useEffect, useId, useRef, useState } from "react";
import "./TaskStatusStrip.css";
import { readyTaskSources, taskSourceNames, type ChatTask, type TaskSourceStatus } from "./taskStatusTypes";
import { isOverlayTaskPointerInside } from "./windowClient";
import { TaskWaterFlow } from "./TaskWaterFlow";
import prismTexture from "./task-prism.webp";
import type { Diagnostic } from "./capacityTypes";

interface TaskStatusStripProps {
  tasks: ChatTask[];
  now: number;
  sources?: TaskSourceStatus[];
  diagnostic?: Diagnostic | null;
  reducedMotion?: boolean;
  compact?: boolean;
  onOpen: (task: ChatTask) => void;
  onDismiss: (task: ChatTask) => void;
  onPopoverChange?: (open: boolean) => void;
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
  const origin = task.source === "geminiWeb" || task.source === "antigravity" ? ` · ${taskSourceNames[task.source]}` : "";
  return `${taskTitle(task)} · ${taskStateLabel(task, now)}${origin}`;
}

const dismissible = (state: ChatTask["state"]) => state === "failed" || state === "completed";

function dismissAriaLabel(task: ChatTask): string {
  return `移除 ${taskTitle(task)} 的${task.state === "failed" ? "报错" : "完成"}提醒`;
}

const taskGroups = [
  { name: "Codex", entries: ["codex"], color: "#62d8fc" },
  { name: "ZCode", entries: ["zcode"], color: "#75e5b1" },
  { name: "Gemini", entries: ["geminiWeb", "antigravity"], color: "#d2a0fa" },
];
const statePriority = { failed: 0, waiting: 1, running: 2, unknown: 3, completed: 4 };
const glyphs = { running: "›", waiting: "Ⅱ", failed: "!", unknown: "?", completed: "✓" };
const fibers = [
  ["M21 16 C40 16 43 1 65 1 H185 L181 11 H65 C48 11 42 17 21 18 Z", "M21 16 C41 16 43 2 65 2 H183"],
  ["M21 17 C39 17 45 13 65 13 H185 L181 23 H65 C46 23 39 19 21 19 Z", "M21 17 C43 17 46 14 65 14 H183"],
  ["M21 18 C40 18 47 25 65 25 H185 L181 35 H65 C44 35 41 21 21 20 Z", "M21 19 C41 19 49 26 65 26 H183"],
];

export function TaskStatusStrip({ tasks, now, sources = readyTaskSources(now), diagnostic = null, reducedMotion = false, compact = false, onOpen, onDismiss, onPopoverChange, isPointerInside = isOverlayTaskPointerInside }: TaskStatusStripProps) {
  const [selection, setSelection] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const closeGeneration = useRef(0);
  const fiberId = useId();
  const key = (task: ChatTask) => `${task.source}:${task.id}`;
  const visible = visibleChatTasks(tasks, now);
  const groups = taskGroups.map(group => ({
    ...group,
    statuses: sources.filter(source => group.entries.includes(source.source)),
    tasks: visible.filter(task => group.entries.includes(task.source)).sort((a, b) => statePriority[a.state] - statePriority[b.state] || (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0) || a.id.localeCompare(b.id)),
  }));
  const issues = visible.filter(task => task.state === "failed" || task.state === "waiting");
  const activeGroup = groups.find(group => group.name === selection);
  const hasArea = visible.length > 0 || sources.some(source => source.health !== "ready") || diagnostic !== null;
  const showAttention = selection === "attention";
  const showDiagnostic = selection === "diagnostic" && diagnostic !== null;
  const isOpen = hasArea && Boolean(activeGroup || showAttention || showDiagnostic);
  const cancelClose = () => { closeGeneration.current += 1; if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); };
  const close = () => setSelection(null);
  const scheduleClose = () => {
    cancelClose();
    const generation = closeGeneration.current;
    // 窗口为 popover 扩展/回落的间隙里，原生光标读数与 DOM 布局短暂失配，
    // 单次判定会误关并触发 hover 振荡；两段都判定离开才真正关闭。
    const confirmClose = () => {
      void isPointerInside().then(inside => {
        if (generation !== closeGeneration.current || inside) return;
        closeTimer.current = window.setTimeout(() => {
          void isPointerInside().then(again => {
            if (generation === closeGeneration.current && !again) close();
          }).catch(() => { if (generation === closeGeneration.current) close(); });
        }, 120);
      }).catch(() => { if (generation === closeGeneration.current) close(); });
    };
    closeTimer.current = window.setTimeout(confirmClose, 160);
  };
    useEffect(() => { onPopoverChange?.(isOpen); }, [isOpen, onPopoverChange]);
  // 非激活窗口收不到 mouseleave（光标离开后事件投给前台 app），打开期间
  // 由原生光标查询主动仲裁；补偿轮询会把标志/坐标维护为最新值。
  const scheduleCloseRef = useRef(scheduleClose);
  scheduleCloseRef.current = scheduleClose;
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setInterval(() => {
      void isPointerInside().then(inside => { if (!inside) scheduleCloseRef.current(); }).catch(() => undefined);
    }, 400);
    return () => window.clearInterval(timer);
  }, [isOpen, isPointerInside]);
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
  const toggle = (name: string) => {
    cancelClose();
    setSelection(previous => previous === name ? null : name);
  };
  const limit = compact ? 3 : 4;
  const listed = activeGroup?.tasks ?? (showAttention ? issues : []);
  const listedStatuses = activeGroup?.statuses ?? (showAttention ? sources.filter(source => source.health !== "ready") : []);
  const listTitle = activeGroup ? `${activeGroup.name} 任务列表` : showAttention ? "报错和等待" : "公共任务诊断";
  return <>
    <section className={`task-strip${compact ? " task-strip--compact" : ""}`} aria-label="聊天任务" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      <svg className="task-fibers" viewBox="0 0 186 36" preserveAspectRatio="none" aria-hidden="true">
        <defs>{groups.map(({ name, color }, index) => <linearGradient key={name} id={`${fiberId}-${index}`} x2=".12" y2="1">
          <stop stopColor={color} /><stop offset=".18" stopColor="#405563" /><stop offset=".45" stopColor="#182c39" />
          <stop offset=".76" stopColor="#172d38" /><stop offset="1" stopColor={color} />
        </linearGradient>)}</defs>
        {fibers.map(([body, edge], index) => <g key={body}>
          <path d={body} fill={`url(#${fiberId}-${index})`} stroke="#43525b" strokeWidth=".45" />
          <path d={edge} fill="none" stroke={groups[index].color} strokeWidth=".75" />
          {!reducedMotion && groups[index].tasks.some(task => task.state === "running") &&
            <path className={`task-fiber-pulse task-fiber-pulse--${index}`} d={edge} pathLength="100" fill="none" stroke="#fff" strokeWidth=".95" />}
        </g>)}
      </svg>
      <button type="button" className="task-prism" aria-label={`查看 ${issues.length} 项已知报错和等待`} aria-expanded={showAttention} onClick={() => toggle("attention")}>
        <img src={prismTexture} alt="" /><span aria-hidden="true">{issues.length > 99 ? "99+" : issues.length}</span>
      </button>
      <div className="task-fiber-rows">
        {groups.map(group => {
          const extra = group.tasks.length - limit;
          const unknown = group.statuses.some(status => status.health !== "ready");
          return <button key={group.name} type="button" className="task-strand" aria-expanded={selection === group.name}
            aria-label={`查看 ${group.name} 全部 ${group.tasks.length} 个任务${unknown ? "，部分或全部来源状态未知" : ""}`}
            onClick={() => toggle(group.name)}>
            <span className="task-strand-name">{group.name}</span>
            <span className="task-strand-marks" aria-hidden="true">
              {group.tasks.slice(0, limit).map(task => <i key={key(task)} className={`task-mark task-mark--${task.state}`}>{glyphs[task.state]}</i>)}
              {extra > 0 && <small>{extra > 99 ? "99+" : `+${extra}`}</small>}
              {unknown && <small>?</small>}
            </span>
          </button>;
        })}
      </div>
      {diagnostic && <button type="button" className="task-common-diagnostic" aria-label="公共任务诊断" title={`${diagnostic.message} · ${diagnostic.code}`} aria-expanded={showDiagnostic} onClick={() => toggle("diagnostic")}>!</button>}
    </section>
    {isOpen && <aside className="task-popover" role="dialog" aria-label={listTitle} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onFocusCapture={cancelClose} onBlurCapture={scheduleClose}>
      {showDiagnostic && diagnostic && <div className="task-details"><strong>任务提醒记录异常</strong><p className="task-detail-reason" role="status">{diagnostic.message} · {diagnostic.code}</p></div>}
      {!showDiagnostic && <div className="task-list">
        <strong>{activeGroup ? `${activeGroup.name} · 全部 ${listed.length} 项` : listTitle}</strong>
        {listedStatuses.map(status => status.diagnostic && <p className="task-detail-reason" key={status.source} role="status">{taskSourceNames[status.source]} · {status.diagnostic.message} · {status.diagnostic.code}</p>)}
        {listed.length === 0 && !listedStatuses.some(status => status.health !== "ready") && <span>{showAttention ? "暂无报错或等待" : "暂无任务"}</span>}
        {listed.map(task => <div className="task-list-row" key={key(task)}>
          <button type="button" className="task-list-entry" aria-label={taskLabel(task, now)} onClick={() => { onOpen(task); close(); }}>
            <TaskCircle task={task} now={now} reducedMotion={reducedMotion} />
            <span>{taskTitle(task)}<small>{taskSourceNames[task.source]} · {taskStateLabel(task, now)}</small>
              {task.detail && <small>{task.detail}</small>}
              {task.projectPath && <small>{task.projectPath}</small>}
            </span>
          </button>
          {dismissible(task.state) && <button type="button" className="task-list-dismiss" aria-label={dismissAriaLabel(task)} onClick={() => onDismiss(task)}>移除提醒</button>}
        </div>)}
      </div>}
    </aside>}
  </>;
}
