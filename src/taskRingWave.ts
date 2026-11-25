export const DIAMETER = 20.4;
export const EDGE_WIDTH_MULTIPLIER = 2;
export const TAU = Math.PI * 2;
export const FRAME_INTERVAL = 1000 / 30;

export const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function phaseSeed(chatId: string): number {
  let hash = 2166136261;
  for (const character of chatId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296 * TAU;
}

function packet(angle: number, phase: number, front: number, tail: number): number {
  const delta = Math.atan2(Math.sin(angle - phase), Math.cos(angle - phase));
  return Math.exp(-0.5 * (delta / (delta > 0 ? front : tail)) ** 2);
}

export function waveAt(angle: number, time: number, seed: number) {
  const t = time + seed;
  const phaseA = TAU * t / 2.6 + 0.32 * Math.sin(t * 1.7);
  const phaseB = TAU * t / 3.9 + 2.3 + 0.4 * Math.sin(t * 1.13 + seed);
  const a = packet(angle, phaseA, 0.38 + 0.12 * Math.sin(t * 1.9), 1.13 + 0.32 * Math.sin(t * 1.07));
  const b = packet(angle, phaseB, 0.32 + 0.13 * Math.cos(t * 1.37), 0.88 + 0.26 * Math.sin(t * 1.61)) * (0.7 + 0.2 * Math.sin(t * 0.91));
  const energy = 1 - (1 - a) * (1 - b);
  const ripple = 0.5 * Math.sin(angle * 3 - t * 2.1 + Math.sin(angle + t * 0.83)) + 0.5 * Math.sin(angle * 5 + t * 1.7);
  const outer = DIAMETER / 2 - 0.17 * (1 + ripple);
  return { outer, inner: outer - EDGE_WIDTH_MULTIPLIER * (0.72 + 0.48 * energy), energy };
}
