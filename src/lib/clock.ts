import { getSetting, setSetting } from "./db";

const DAY = 24 * 60 * 60 * 1000;

export function offsetDays(): number {
  return Number(getSetting("clock_offset_days") ?? "0");
}

export function now(): Date {
  return new Date(Date.now() + offsetDays() * DAY);
}

export function nowIso(): string {
  return now().toISOString();
}

export function advanceDays(days: number) {
  setSetting("clock_offset_days", String(offsetDays() + days));
}

export function resetClock() {
  setSetting("clock_offset_days", "0");
}

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return (now().getTime() - new Date(iso).getTime()) / DAY;
}
