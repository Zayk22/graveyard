import type { DebitRecord } from "./types";

/**
 * Removes duplicate DebitRecords that share the same
 * (normalisedMerchant, date, amount) triple. When duplicates differ in
 * displayName, keeps the alphabetically smallest so the result does not
 * depend on input order.
 */
export function deduplicateRecords(records: DebitRecord[]): DebitRecord[] {
  const byKey = new Map<string, DebitRecord>();

  for (const record of records) {
    const key = `${record.normalisedMerchant}\0${record.date}\0${record.amount}`;
    const existing = byKey.get(key);
    if (!existing || record.displayName < existing.displayName) {
      byKey.set(key, record);
    }
  }

  return [...byKey.values()];
}