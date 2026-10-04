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
    let previous = "";
    const region = (element: HTMLElement): MaterialRegion => {
      const bounds = element.getBoundingClientRect();
      const scale = element.offsetWidth > 0 ? bounds.width / element.offsetWidth : .5;
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) * scale || 0;
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, radius: Math.min(radius, bounds.width / 2, bounds.height / 2) };
    };
    const update = () => {
      if (stopped) return;
      const regions = Array.from(document.querySelectorAll<HTMLElement>(".task-source-capsule,.task-popover")).map(region);
      const visibleRegions = Array.from(document.querySelectorAll<HTMLElement>(".task-source-capsule,.task-popover,.task-common-diagnostic,.glass-shell,.settings-popover,.control-message")).map(region);
      // Native resize is asynchronous. Wait for the window viewport to catch up with the
      // approved popover layout; ResizeObserver delivers the final geometry afterwards.
      if ([...regions, ...visibleRegions].some(r => r.x < 0 || r.y < 0 || r.x + r.width > window.innerWidth + .1 || r.y + r.height > window.innerHeight + .1)) return;
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
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    const root = document.querySelector(".app-frame");
    const observed = new Set<Element>();
    const observeRegions = () => {
      const current = new Set<Element>(document.querySelectorAll(".app-frame,.task-source-capsule,.task-popover,.task-common-diagnostic,.glass-shell,.settings-popover,.control-message"));
      observed.forEach(element => { if (!current.has(element)) { observer.unobserve(element); observed.delete(element); } });
      current.forEach(element => { if (!observed.has(element)) { observer.observe(element); observed.add(element); } });
      schedule();
    };
    const mutations = new MutationObserver(observeRegions);
    if (root) mutations.observe(root, { childList: true, subtree: true });
    observeRegions();
    window.addEventListener("resize", schedule);
    schedule();
    return () => { stopped = true; observer.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); };
  }, [layoutKey]);
}
