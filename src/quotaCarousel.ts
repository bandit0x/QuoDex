import type { DisplayPreferences, SourceSelection } from "./capacityTypes";

export type CarouselSource = Exclude<SourceSelection, "carousel">;
export const carouselLabels = { codex: "Codex", zcode: "ZCode", gemini: "Gemini" } as const;
const sourceOrder = ["codex", "zcode", "gemini"] as const;
export const carouselCandidates = /Mac/.test(navigator.platform)
  ? sourceOrder.slice(0, 2) : sourceOrder;

export function selectedCarouselSources(preferences: Pick<DisplayPreferences, "carouselSources">): CarouselSource[] {
  const selected = carouselCandidates.filter(source => preferences.carouselSources?.includes(source));
  return selected.length >= 2 ? selected : [...carouselCandidates];
}

export function nextCarouselSource(current: CarouselSource, selected: CarouselSource[]): CarouselSource {
  const position = sourceOrder.indexOf(current);
  return selected.find(source => sourceOrder.indexOf(source) > position) ?? selected[0];
}
