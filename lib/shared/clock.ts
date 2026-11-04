/** Seconds as m:ss ("0:53", "14:32"), rounded up so a countdown never shows 0:00 while time remains. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
