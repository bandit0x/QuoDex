import { useEffect, useRef, useState } from "react";
import "./TaskStatusStrip.css";
import { readyTaskSources, taskSourceNames, type ChatTask, type TaskSource, type TaskSourceStatus } from "./taskStatusTypes";
import { AgentTaskRing, type AgentRingAgent } from "./AgentTaskRing";
import { isOverlayTaskPointerInside } from "./windowClient";
import { TaskWaterFlow } from "./TaskWaterFlow";
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

const taskGroups: { name: AgentRingAgent; entries: TaskSource[] }[] = [
  { name: "Codex", entries: ["codex"] },
  { name: "ZCode", entries: ["zcode"] },
  { name: "Gemini", entries: ["geminiWeb", "antigravity"] },
];
const statePriority = { failed: 0, waiting: 1, running: 2, unknown: 3, completed: 4 };
export function TaskStatusStrip({ tasks, now, sources = readyTaskSources(now), diagnostic = null, reducedMotion = false, compact = false, onOpen, onDismiss, onPopoverChange, isPointerInside = isOverlayTaskPointerInside }: TaskStatusStripProps) {
  const [selection, setSelection] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const closeGeneration = useRef(0);
  const key = (task: ChatTask) => `${task.source}:${task.id}`;
  const visible = visibleChatTasks(tasks, now);
  const groups = taskGroups.map(group => ({
    ...group,
    statuses: sources.filter(source => group.entries.includes(source.source)),
    tasks: visible.filter(task => group.entries.includes(task.source)).sort((a, b) => statePriority[a.state] - statePriority[b.state] || (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0) || a.id.localeCompare(b.id)),
  }));
  const shown = groups.filter(group => group.tasks.length || group.statuses.some(s => s.health !== "ready"));
  if (!shown.length && diagnostic) shown.push(groups[0]);
  const activeGroup = shown.find(group => group.name === selection);
  const isOpen = Boolean(activeGroup);
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
  if (!shown.length) return null;
  const reveal = (name: string) => {
    cancelClose();
    setSelection(name);
  };
  return <>
    <section className={`task-strip${compact ? " task-strip--compact" : ""}`} data-reduced-motion={reducedMotion || undefined} aria-label="聊天任务" onMouseLeave={scheduleClose}>
      {shown.map(group => {
        const states = group.tasks.map(task => task.state);
        const unavailable = group.statuses.some(status => status.health !== "ready");
        const running = states.includes("running");
        // Completed chats are already sorted newest first within this group.
        const completedAt = group.tasks.find(task => task.state === "completed")?.completedAtMs;
        const minutes = completedAt == null ? null : Math.floor((now - completedAt) / 60_000);
        const state = states.includes("failed") ? "failed" : states.includes("waiting") ? "waiting"
          : minutes !== null ? "completed" : states.includes("unknown") || unavailable || diagnostic ? "unknown" : "idle";
        const description = state === "completed" ? `最近完成于 ${minutes} 分钟前`
          : state === "idle" ? "" : stateLabels[state];
        return <button type="button" key={group.name} className="task-agent-orb"
          data-agent={group.name}
          data-running={running || undefined} data-spinning={(running && !reducedMotion) || undefined} aria-expanded={selection === group.name}
          aria-label={`查看 ${group.name} 全部 ${group.tasks.length} 个任务${unavailable ? "，部分或全部来源状态未知" : ""}`}
          aria-description={[running && stateLabels.running, description].filter(Boolean).join("，") || undefined}
          onMouseEnter={() => reveal(group.name)} onFocus={() => reveal(group.name)} onClick={() => reveal(group.name)}>
          <AgentTaskRing agent={group.name} state={state} running={running} minutes={minutes} reducedMotion={reducedMotion} />
        </button>;
      })}
    </section>
    {activeGroup && <aside className="task-popover" role="dialog" aria-label={`${activeGroup.name} 任务列表`} onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onFocusCapture={cancelClose} onBlurCapture={scheduleClose}>
      <div className="task-list">
        <strong>{activeGroup.name} · 全部 {activeGroup.tasks.length} 项</strong>
        {diagnostic && <p className="task-detail-reason" role="status">{diagnostic.message} · {diagnostic.code}</p>}
        {activeGroup.statuses.map(status => status.diagnostic && <p className="task-detail-reason" key={status.source} role="status">{taskSourceNames[status.source]} · {status.diagnostic.message} · {status.diagnostic.code}</p>)}
        {activeGroup.tasks.length === 0 && !diagnostic && activeGroup.statuses.every(status => status.health === "ready") && <span>暂无任务</span>}
        {activeGroup.tasks.map(task => <div className="task-list-row" key={key(task)}>
          <button type="button" className="task-list-entry" aria-label={taskLabel(task, now)} onClick={() => { onOpen(task); close(); }}>
            <TaskCircle task={task} now={now} reducedMotion={reducedMotion} />
            <span>{taskTitle(task)}<small>{taskSourceNames[task.source]} · {taskStateLabel(task, now)}</small>
              {task.detail && <small>{task.detail}</small>}
              {task.projectPath && <small>{task.projectPath}</small>}
            </span>
          </button>
          {dismissible(task.state) && <button type="button" className="task-list-dismiss" aria-label={dismissAriaLabel(task)} onClick={() => onDismiss(task)}>移除提醒</button>}
        </div>)}
      </div>
    </aside>}
  </>;
}
