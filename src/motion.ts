/** Motion timings tuned for 120Hz displays (multiples of ~8.33ms frame time). */
export const MOTION_MS = {
  instant: 80,
  fast: 120,
  standard: 160,
  panel: 200,
  screen: 200,
  expand: 200,
  stagger: 32,
  spin: 640,
} as const;

export const MOTION_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

export function readMotionMs(token: keyof typeof MOTION_MS, fallback = MOTION_MS[token]): number {
  if (typeof window === 'undefined' || !document.documentElement) return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--motion-${token}`).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
