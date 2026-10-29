/** Visual-only marker, never used to authorize a session. Set only after Auth confirms success. */
export const LOGIN_MOTION_COOKIE = "tf-login-motion";
export const LOGIN_MOTION_DURATION_MS = 1600;
export const LOGIN_MOTION_MAX_AGE_SECONDS = 30;

export function vortexBoundary(radius: number, outerRadius: number, progress: number, half: 0 | 1): number {
  const p = Math.max(0, Math.min(1, progress / 0.84));
  const eased = p * p * (3 - 2 * p);
  return Math.PI / 2 + half * Math.PI + 8.7 * eased * Math.pow(Math.max(0, 1 - radius / outerRadius), 2.05);
}
