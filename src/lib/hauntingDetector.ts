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

// ── 8.1 — sortHauntings ──────────────────────────────────────────────────────

export function sortHauntings(hauntings: Haunting[]): Haunting[] {
  return [...hauntings].sort((a, b) => {
    if (b.estimatedMonthlyCost !== a.estimatedMonthlyCost) {
      return b.estimatedMonthlyCost - a.estimatedMonthlyCost;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ── 8.2 — detectHauntings ────────────────────────────────────────────────────

function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function detectHauntings(
  records: DebitRecord[],
  referenceDate: string
): Haunting[] {
  if (!isValidISODate(referenceDate)) return [];

  const groups = groupByMerchant(records);
  const hauntings: Haunting[] = [];

  for (const [normalisedMerchant, group] of groups) {
    try {
      // Step 1: deduplicate the group
      const deduped = deduplicateRecords(group);

      // Step 2: initial median across all amounts
      const initialMedian = computeMedian(deduped.map((r) => r.amount));

      // Step 3: filter to qualifying charges (within ±10% of initial median)
      const qualifying = filterByTolerance(deduped, initialMedian);

      // Step 4: need at least 3 qualifying charges
      if (qualifying.length < 3) continue;

      // Step 5: recompute typicalAmount as median of qualifying charges only
      const typicalAmount = computeMedian(qualifying.map((r) => r.amount));

      // Step 6: sort qualifying by date, compute gaps, classify interval
      const qualifyingSorted = [...qualifying].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0
      );
      const gaps = computeGaps(qualifyingSorted.map((r) => r.date));
      const interval = classifyInterval(gaps);
      if (interval === null) continue;

      // Step 7: lastChargeDate = most recent date in the whole deduped group
      const lastChargeDate = deduped.reduce((best, r) =>
        r.date > best ? r.date : best, deduped[0].date
      );

      // Step 8: displayName from most recent charge in whole deduped group;
      // tie-break by alphabetically first displayName
      const mostRecent = deduped
        .filter((r) => r.date === lastChargeDate)
        .sort((a, b) => (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0));
      const displayName = mostRecent[0].displayName;

      // Step 9: sourceCharges = all deduped records, sorted by date asc then amount asc
      const sourceCharges = [...deduped].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.amount - b.amount;
      });

      // Step 10: build the Haunting object
      const nextExpectedDate = computeNextDate(lastChargeDate, interval);
      const estimatedMonthlyCost = computeMonthlyCost(typicalAmount, interval);
      const status = assignStatus(nextExpectedDate, interval, referenceDate);
      const id = stableId(normalisedMerchant, interval);
      const chargeCount = sourceCharges.length;

      hauntings.push({
        id,
        normalisedMerchant,
        displayName,
        typicalAmount,
        interval,
        lastChargeDate,
        nextExpectedDate,
        estimatedMonthlyCost,
        chargeCount,
        sourceCharges,
        status,
      });
    } catch {
      // One bad group must not poison others
      continue;
    }
  }

  return sortHauntings(hauntings);
}
