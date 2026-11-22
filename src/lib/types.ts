export type Interval = "weekly" | "monthly" | "yearly";
export type HauntingStatus = "active" | "lapsed";

/** Discriminated union returned by parseNgnAmount. */
export type AmountResult =
  | { ok: true; kobo: number }
  | { ok: false; reason: string };

/** Structured output from the Alert Parser for one successfully parsed debit. */
export interface DebitRecord {
  /** Integer kobo. Never a float. */
  amount: number;
  /** ISO-8601 date string, e.g. "2024-03-15". */
  date: string;
  /** Lowercase, whitespace-collapsed, punctuation-stripped, digit-run-removed merchant string. */
  normalisedMerchant: string;
  /** Original merchant text with all-digit tokens and ref-style tokens removed, truncated to 60 chars. */
  displayName: string;
}

/** An Alert_Message the parser could not fully convert to a DebitRecord. */
export interface UnparseableMessage {
  /** 1-based line number where this Alert_Message starts in the original rawText. */
  lineNumber: number;
  /** Human-readable explanation, e.g. "missing date", "unsupported currency", "invalid date". */
  reason: string;
  /** The raw text of the Alert_Message, for display purposes. */
  rawText: string;
}

/** A recurring charge pattern identified by the Haunting Detector. */
export interface Haunting {
  /** Deterministic slug: normalisedMerchant + "-" + interval. */
  id: string;
  normalisedMerchant: string;
  displayName: string;
  /** Median kobo amount of qualifying charges (within ±10% tolerance). */
  typicalAmount: number;
  interval: Interval;
  /** ISO-8601 date of the most recent charge in this merchant group. */
  lastChargeDate: string;
  /** ISO-8601 date the next charge is expected. */
  nextExpectedDate: string;
  /** Estimated cost per month in kobo, computed with round-half-up arithmetic. */
  estimatedMonthlyCost: number;
  /** Total number of Debit_Records in the merchant group, including out-of-tolerance records. */
  chargeCount: number;
  /** All Debit_Records in the merchant group, including out-of-tolerance records. */
  sourceCharges: DebitRecord[];
  status: HauntingStatus;
}

/** Return type of parseAlerts. */
export interface ParseResult {
  records: DebitRecord[];
  unparseable: UnparseableMessage[];
}
