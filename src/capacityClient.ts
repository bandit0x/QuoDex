import { invoke } from "@tauri-apps/api/core";
import type { CapacitySnapshot, DisplayPreferences } from "./capacityTypes";

export function readCapacitySnapshot(): Promise<CapacitySnapshot> {
  return invoke<CapacitySnapshot>("read_capacity_snapshot");
}

export function loadDisplayPreferences(): Promise<DisplayPreferences> {
  return invoke<DisplayPreferences>("load_display_preferences");
}

export function saveDisplayPreferences(preferences: DisplayPreferences): Promise<void> {
  return invoke("save_display_preferences", { preferences });
}

export function enableTemporaryClickThrough(durationMs = 10_000): Promise<void> {
  return invoke("enable_temporary_click_through", { durationMs });
}

export function quitApplication(): Promise<void> {
  return invoke("quit_app");
}
