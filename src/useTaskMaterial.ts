import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Diagnostic } from "./capacityTypes";

interface MaterialRegion { x: number; y: number; width: number; height: number; radius: number }
let materialQueue: Promise<unknown> = Promise.resolve();

export function useTaskMaterial(layoutKey: string, onError: (message: string) => void) {
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let frame = 0;
    const transitions = new Map<Element, Set<string>>();
    let previous = "";
    const region = (element: HTMLElement): MaterialRegion => {
      const bounds = element.getBoundingClientRect();
      const scale = element.offsetWidth > 0 ? bounds.width / element.offsetWidth : .5;
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) * scale || 0;
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, radius: Math.min(radius, bounds.width / 2, bounds.height / 2) };
    };
    const update = () => {
      if (stopped) return;
      const regions = Array.from(document.querySelectorAll<HTMLElement>(".task-strip,.task-popover,[data-glass-lens],.dock-controls,.dock-error")).map(region);
      const visibleRegions = Array.from(document.querySelectorAll<HTMLElement>(".task-strip,.task-popover,.task-common-diagnostic,.glass-shell,[data-glass-lens],.dock-controls,.dock-error,.control-message")).map(region);
      // Native resize is asynchronous. Wait for the window viewport to catch up with the
      // approved popover layout; ResizeObserver delivers the final geometry afterwards.
      if ([...regions, ...visibleRegions].some(r => r.width <= 0 || r.height <= 0 || r.x < 0 || r.y < 0 || r.x + r.width > window.innerWidth + .1 || r.y + r.height > window.innerHeight + .1)) return;
      const payload = { regions, visibleRegions };
      const serialized = JSON.stringify(payload);
      if (serialized === previous) return;
      previous = serialized;
      materialQueue = materialQueue.catch(() => undefined).then(async () => {
        if (stopped) return;
        await invoke("set_task_material_regions", payload);
        if (!stopped) document.documentElement.dataset.taskMaterial = "native";
      }).catch((error: Partial<Diagnostic> | null) => {
        if (!stopped) {
          document.documentElement.dataset.taskMaterial = "unavailable";
          errorHandler.current(`${error?.message ?? "系统毛玻璃未能更新；请重新打开 QuoDex"} · ${error?.code ?? "QDT-631"}`);
        }
      });
    };
    const tick = () => {
      update();
      for (const target of transitions.keys()) if (!target.isConnected) transitions.delete(target);
      if (transitions.size > 0) frame = requestAnimationFrame(tick);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick); };
    const startTransition = (event: TransitionEvent) => {
      const target = event.target as Element;
      const properties = transitions.get(target) ?? new Set<string>();
      properties.add(event.propertyName); transitions.set(target, properties); schedule();
    };
    const endTransition = (event: TransitionEvent) => {
      const target = event.target as Element;
      const properties = transitions.get(target);
      properties?.delete(event.propertyName);
      if (!properties?.size) transitions.delete(target);
      schedule();
    };
    const observer = new ResizeObserver(schedule);
    const root = document.querySelector<HTMLElement>(".app-frame");
    const observed = new Set<Element>();
    const observeRegions = () => {
      const current = new Set<Element>(document.querySelectorAll(".app-frame,.task-strip,.task-popover,.task-common-diagnostic,.glass-shell,[data-glass-lens],.dock-controls,.dock-error,.control-message"));
      observed.forEach(element => { if (!current.has(element)) { observer.unobserve(element); observed.delete(element); } });
      current.forEach(element => { if (!observed.has(element)) { observer.observe(element); observed.add(element); } });
      schedule();
    };
    const mutations = new MutationObserver(observeRegions);
    if (root) mutations.observe(root, { childList: true, subtree: true });
    root?.addEventListener("animationend", schedule);
    root?.addEventListener("transitionrun", startTransition);
    root?.addEventListener("transitionend", endTransition);
    root?.addEventListener("transitioncancel", endTransition);
    observeRegions();
    window.addEventListener("resize", schedule);
    schedule();
    return () => { stopped = true; observer.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); root?.removeEventListener("animationend", schedule); root?.removeEventListener("transitionrun", startTransition); root?.removeEventListener("transitionend", endTransition); root?.removeEventListener("transitioncancel", endTransition); };
  }, [layoutKey]);
}
