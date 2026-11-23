import type { DebitRecord, Interval, HauntingStatus, Haunting } from "./types";
import { deduplicateRecords } from "./dedupe";

// ── Private helpers ──────────────────────────────────────────────────────────

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function toISO(y: number, m: number, d: number): string {
  return (
    String(y).padStart(4, "0") +
    "-" +
    String(m).padStart(2, "0") +
    "-" +
    String(d).padStart(2, "0")
  );
}

// ── 7.1 — roundHalfUp / computeMedian ───────────────────────────────────────

export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

export function computeMedian(amounts: number[]): number {
  if (amounts.length === 0) return 0;
  const sorted = [...amounts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return roundHalfUp((sorted[mid - 1] + sorted[mid]) / 2);
}

// ── 7.2 — filterByTolerance ──────────────────────────────────────────────────

export function filterByTolerance(
  records: DebitRecord[],
  median: number
): DebitRecord[] {
  return records.filter(
    (r) => r.amount * 10 >= median * 9 && r.amount * 10 <= median * 11
  );
}

// ── 7.3 — computeGaps / classifyInterval ────────────────────────────────────

export function computeGaps(sortedDates: string[]): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < sortedDates.length - 1; i++) {
    gaps.push(utcDay(sortedDates[i + 1]) - utcDay(sortedDates[i]));
  }
  return gaps;
}

export function classifyInterval(gaps: number[]): Interval | null {
  if (gaps.length === 0) return null;
  if (gaps.every((g) => g >= 5 && g <= 9)) return "weekly";
  if (gaps.every((g) => g >= 25 && g <= 35)) return "monthly";
  if (gaps.every((g) => g >= 355 && g <= 375)) return "yearly";
  return null;
}

// ── 7.4 — computeNextDate ────────────────────────────────────────────────────

export function computeNextDate(lastDate: string, interval: Interval): string {
  const [y, m, d] = lastDate.split("-").map(Number);

  if (interval === "weekly") {
    const ms = Date.UTC(y, m - 1, d) + 7 * 86_400_000;
    const next = new Date(ms);
    return toISO(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }

  if (interval === "monthly") {
    let newYear: number;
    let newMonth: number;
    if (m + 1 > 12) {
      newYear = y + 1;
      newMonth = 1;
    } else {
      newYear = y;
      newMonth = m + 1;
    }
    // Last day of newMonth in newYear: day 0 of the following month
    const lastDayMs = Date.UTC(newYear, newMonth, 0);
    const lastDay = new Date(lastDayMs).getUTCDate();
    const clampedDay = d > lastDay ? lastDay : d;
    return toISO(newYear, newMonth, clampedDay);
  }

  // yearly
  const newYear = y + 1;
  let clampedDay = d;
  if (m === 2 && d === 29) {
    const isLeap =
      (newYear % 4 === 0 && newYear % 100 !== 0) || newYear % 400 === 0;
    if (!isLeap) clampedDay = 28;
  }
  return toISO(newYear, m, clampedDay);
}

// ── 7.5 — computeMonthlyCost ─────────────────────────────────────────────────

export function computeMonthlyCost(
  typicalAmount: number,
  interval: Interval
): number {
  if (interval === "weekly") return roundHalfUp((typicalAmount * 52) / 12);
  if (interval === "monthly") return typicalAmount;
  return roundHalfUp(typicalAmount / 12);
}

// ── 7.6 — assignStatus ───────────────────────────────────────────────────────

export function assignStatus(
  nextDate: string,
  interval: Interval,
  refDate: string
): HauntingStatus {
  const lapseDate = computeNextDate(nextDate, interval);
  return utcDay(refDate) > utcDay(lapseDate) ? "lapsed" : "active";
}

// ── 7.7 — stableId ───────────────────────────────────────────────────────────

export function stableId(
  normalisedMerchant: string,
  interval: Interval
): string {
  return normalisedMerchant.replace(/ /g, "-") + "-" + interval;
}

// ── groupByMerchant (needed by task 8.2) ─────────────────────────────────────

export function groupByMerchant(
  records: DebitRecord[]
): Map<string, DebitRecord[]> {
  const map = new Map<string, DebitRecord[]>();
  for (const r of records) {
    const bucket = map.get(r.normalisedMerchant) ?? [];
    bucket.push(r);
    map.set(r.normalisedMerchant, bucket);
  }
  return map;
}
