import type { AmountResult, DebitRecord, UnparseableMessage } from "./types";
import { deduplicateRecords } from "./dedupe";

// ─── 3.1 parseNgnAmount ────────────────────────────────────────────────────

/** Non-NGN currency indicators that make an amount unsupported. */
const NON_NGN_PATTERN = /USD|GBP|EUR|CAD|AUD|JPY|CHF|CNY|INR|\$|€|£|¥/i;

/**
 * Parses a currency string to an integer kobo value.
 * Never uses floating-point arithmetic for the monetary computation.
 * Exported for unit testing.
 */
export function parseNgnAmount(text: string): AmountResult {
  // Check for non-NGN currency before stripping symbols
  if (NON_NGN_PATTERN.test(text)) {
    return { ok: false, reason: "unsupported currency" };
  }

  // Strip NGN, ₦, and commas
  const cleaned = text.replace(/NGN/gi, "").replace(/₦/g, "").replace(/,/g, "").trim();

  // Split on decimal point
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    return { ok: false, reason: "invalid amount" };
  }

  const nairaStr = parts[0].trim();
  const koboStr = parts[1] !== undefined ? parts[1].trim() : undefined;

  // Validate naira part
  if (!/^\d+$/.test(nairaStr)) {
    return { ok: false, reason: "invalid amount" };
  }

  // Validate kobo part if present
  if (koboStr !== undefined && !/^\d{1,2}$/.test(koboStr)) {
    return { ok: false, reason: "invalid amount" };
  }

  // Integer arithmetic only
  const naira = parseInt(nairaStr, 10);
  const koboFraction = parseInt((koboStr ?? "0").padEnd(2, "0").slice(0, 2), 10);
  const kobo = naira * 100 + koboFraction;

  if (kobo > Number.MAX_SAFE_INTEGER) {
    return { ok: false, reason: "invalid amount" };
  }

  return { ok: true, kobo };
}

// ─── 3.2 normaliseMerchant ────────────────────────────────────────────────

/**
 * Normalises a merchant string for grouping/deduplication.
 * Returns an empty string when nothing meaningful remains.
 */
export function normaliseMerchant(raw: string): string {
  // 1. Lowercase
  let result = raw.toLowerCase();

  // 2. Split into tokens, filter out all-digit tokens and ref-style tokens.
  //    A "token" is a contiguous run of non-whitespace characters.
  const tokens = result.split(/\s+/);

  const filtered = tokens.filter((token) => {
    // Remove all-digit tokens (entirely numeric)
    if (/^\d+$/.test(token)) return false;
    // Remove ref-style tokens: contains letters immediately followed by digits.
    // Strip punctuation from token before testing so "ref-00042" is caught too.
    const stripped = token.replace(/[^a-z0-9]/g, "");
    if (/[a-z]\d/.test(stripped)) return false;
    return true;
  });

  result = filtered.join(" ");

  // 3. Strip all punctuation (keep alphanumeric and spaces)
  result = result.replace(/[^a-z0-9 ]/g, "");

  // 4. Collapse multiple spaces, trim
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

// ─── 3.3 deriveDisplayName ───────────────────────────────────────────────

/**
 * Produces a human-readable display name: removes all-digit and ref-style
 * tokens, trims, and truncates to 60 characters.
 */
export function deriveDisplayName(raw: string): string {
  const tokens = raw.trim().split(/\s+/);

  const filtered = tokens.filter((token) => {
    // Remove all-digit tokens
    if (/^\d+$/.test(token)) return false;
    // Remove ref-style tokens (letters immediately followed by digits,
    // after stripping punctuation)
    const stripped = token.replace(/[^a-zA-Z0-9]/g, "");
    if (/[a-zA-Z]\d/.test(stripped)) return false;
    return true;
  });

  const joined = filtered.join(" ").trim();

  // Truncate to 60 characters
  return joined.slice(0, 60);
}

// ─── 3.4 parseAlertDate ──────────────────────────────────────────────────

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Pads a number to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Returns true when the given y/m/d triplet is a real calendar date. */
function isRealDate(y: number, m: number, d: number): boolean {
  const utc = Date.UTC(y, m - 1, d);
  const probe = new Date(utc);
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() + 1 === m &&
    probe.getUTCDate() === d
  );
}

/** Formats a validated y/m/d triplet as an ISO-8601 string. */
function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Parses a date string found inside an alert message.
 *
 * Supported formats: DD/MM/YYYY | DD-Mon-YYYY | YYYY-MM-DD | DD/MM
 *
 * Returns:
 *   - ISO-8601 string on success
 *   - "invalid" for impossible dates
 *   - "missing" when no date pattern is found
 */
export function parseAlertDate(text: string, refDate: string): string | "invalid" | "missing" {
  // DD/MM/YYYY
  const dmySlash = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  if (dmySlash) {
    const d = parseInt(dmySlash[1], 10);
    const m = parseInt(dmySlash[2], 10);
    const y = parseInt(dmySlash[3], 10);
    if (!isRealDate(y, m, d)) return "invalid";
    return toISO(y, m, d);
  }

  // DD-Mon-YYYY  (e.g. 15-Mar-2024)
  const dmyMon = /\b(\d{1,2})-([A-Za-z]{3})-(\d{4})\b/.exec(text);
  if (dmyMon) {
    const d = parseInt(dmyMon[1], 10);
    const monthNum = MONTH_ABBR[dmyMon[2].toLowerCase()];
    const y = parseInt(dmyMon[3], 10);
    if (monthNum === undefined) return "invalid";
    if (!isRealDate(y, monthNum, d)) return "invalid";
    return toISO(y, monthNum, d);
  }

  // YYYY-MM-DD
  const isoFull = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (isoFull) {
    const y = parseInt(isoFull[1], 10);
    const m = parseInt(isoFull[2], 10);
    const d = parseInt(isoFull[3], 10);
    if (!isRealDate(y, m, d)) return "invalid";
    return toISO(y, m, d);
  }

  // DD/MM  (no year — resolve using refDate)
  const dmOnly = /\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
  if (dmOnly) {
    const d = parseInt(dmOnly[1], 10);
    const m = parseInt(dmOnly[2], 10);
    const refYear = parseInt(refDate.slice(0, 4), 10);

    if (!isRealDate(refYear, m, d)) return "invalid";

    const candidate = toISO(refYear, m, d);
    // If candidate is in the future relative to refDate, subtract one year
    if (candidate > refDate) {
      const prevYear = refYear - 1;
      if (!isRealDate(prevYear, m, d)) return "invalid";
      return toISO(prevYear, m, d);
    }
    return candidate;
  }

  return "missing";
}

// ─── 3.5 splitMessages ───────────────────────────────────────────────────

/** Alert-header patterns that start a new message segment. */
const ALERT_HEADER_RE = /^(debit alert|account debit|transaction alert)/i;

/**
 * Pattern that identifies a Format B one-line debit narrative within a line.
 * Matches "debited" followed by an NGN/₦ amount. Linear-time.
 */
const FORMAT_B_INLINE_RE = /debited\s+(?:NGN|₦)\s?[\d,]+(?:\.\d{1,2})?/i;

/**
 * Splits raw pasted alert text into individual message segments.
 * Returns trimmed, non-empty segment strings.
 */
export function splitMessages(raw: string): string[] {
  const lines = raw.split("\n");
  const segments: string[] = [];
  let current: string[] = [];

  const flushCurrent = () => {
    const seg = current.join("\n").trim();
    if (seg.length > 0) segments.push(seg);
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0) {
      flushCurrent();
      continue;
    }

    if (ALERT_HEADER_RE.test(trimmedLine)) {
      flushCurrent();
      current.push(line);
      continue;
    }

    if (FORMAT_B_INLINE_RE.test(trimmedLine)) {
      flushCurrent();
      current.push(line);
      continue;
    }

    current.push(line);
  }

  flushCurrent();
  return segments;
}

// ─── 4.1 parseMessage ────────────────────────────────────────────────────────

/**
 * Debit detection: matches the phrases "debited", "Debit Alert", "Account Debit"
 * as whole phrases (not bare "debit" alone).
 */
const DEBIT_RE = /\bdebited\b|debit alert|account debit/i;

/**
 * Credit detection: matches the phrases "credited", "Credit Alert"
 * as whole phrases (not bare "credit" alone).
 */
const CREDIT_RE = /\bcredited\b|credit alert/i;

// Format A regexes (applied per-line after trimming). Empty values are allowed
// so that a missing field gives a specific reason instead of "unrecognised format".
const FORMAT_A_AMT_RE = /^Amt:\s*(.*)$/i;
const FORMAT_A_DESC_RE = /^Desc:\s*(.*)$/i;
const FORMAT_A_DATE_RE = /^Date:\s*(.*)$/i;

// Format B regex (applied to full message text).
// The date must start with a digit so a merchant containing " on " still works.
const FORMAT_B_RE =
  /debited\s+((?:NGN|₦)\s?[\d,]+(?:\.\d{1,2})?)\s+for\s+(.+?)\s+on\s+(\d[\d/\-A-Za-z]*)/i;

// Format C regexes (applied per-line after trimming)
const FORMAT_C_AMT_RE = /^Amount:\s*(.*)$/i;
const FORMAT_C_DESC_RE = /^Description:\s*(.*)$/i;
const FORMAT_C_DATE_RE = /^Value Date:\s*(.*)$/i;

/**
 * Attempts to parse a single Alert_Message string into a DebitRecord.
 * Returns:
 *   - `DebitRecord` on success
 *   - `UnparseableMessage` when the message is a debit alert but cannot be fully parsed
 *   - `null` when the message is a credit alert (caller silently excludes it)
 *
 * Exported for direct unit testing.
 */
export function parseMessage(
  msg: string,
  lineOffset: number,
  refDate: string
): DebitRecord | UnparseableMessage | null {
  const makeUnparseable = (reason: string): UnparseableMessage => ({
    lineNumber: lineOffset,
    reason,
    rawText: msg,
  });

  const isDebit = DEBIT_RE.test(msg);
  const isCredit = CREDIT_RE.test(msg);

  if (isDebit && isCredit) {
    return makeUnparseable("ambiguous alert type");
  }

  if (!isDebit && !isCredit) {
    return makeUnparseable("unrecognised format");
  }

  if (isCredit) {
    // Credit alert — silently exclude
    return null;
  }

  // ── Debit alert: attempt Format A, then B, then C ───────────────────────

  const lines = msg.split("\n").map((l) => l.trim());

  // ── Format A ─────────────────────────────────────────────────────────────
  {
    let amtRaw: string | null = null;
    let descRaw: string | null = null;
    let dateRaw: string | null = null;

    for (const line of lines) {
      const amtMatch = FORMAT_A_AMT_RE.exec(line);
      if (amtMatch) { amtRaw = amtMatch[1].trim(); continue; }
      const descMatch = FORMAT_A_DESC_RE.exec(line);
      if (descMatch) { descRaw = descMatch[1].trim(); continue; }
      const dateMatch = FORMAT_A_DATE_RE.exec(line);
      if (dateMatch) { dateRaw = dateMatch[1].trim(); continue; }
    }

    if (amtRaw !== null && (descRaw !== null || dateRaw !== null)) {
      return buildRecord(amtRaw, descRaw ?? "", dateRaw ?? "", lineOffset, refDate, msg);
    }
  }

  // ── Format B ─────────────────────────────────────────────────────────────
  {
    const match = FORMAT_B_RE.exec(msg);
    if (match) {
      const amtRaw = match[1].trim();
      const descRaw = match[2].trim();
      const dateRaw = match[3].trim();
      return buildRecord(amtRaw, descRaw, dateRaw, lineOffset, refDate, msg);
    }
  }

  // ── Format C ─────────────────────────────────────────────────────────────
  {
    let amtRaw: string | null = null;
    let descRaw: string | null = null;
    let dateRaw: string | null = null;

    for (const line of lines) {
      const amtMatch = FORMAT_C_AMT_RE.exec(line);
      if (amtMatch) { amtRaw = amtMatch[1].trim(); continue; }
      const descMatch = FORMAT_C_DESC_RE.exec(line);
      if (descMatch) { descRaw = descMatch[1].trim(); continue; }
      const dateMatch = FORMAT_C_DATE_RE.exec(line);
      if (dateMatch) { dateRaw = dateMatch[1].trim(); continue; }
    }

    if (amtRaw !== null && (descRaw !== null || dateRaw !== null)) {
      return buildRecord(amtRaw, descRaw ?? "", dateRaw ?? "", lineOffset, refDate, msg);
    }
  }

  // No format matched
  return {
    lineNumber: lineOffset,
    reason: "unrecognised format",
    rawText: msg,
  };
}

/**
 * Shared field-validation and record-construction helper used by all three
 * format branches.  Returns a DebitRecord or an UnparseableMessage.
 */
function buildRecord(
  amtRaw: string,
  descRaw: string,
  dateRaw: string,
  lineOffset: number,
  refDate: string,
  rawMsg: string
): DebitRecord | UnparseableMessage {
  const makeUnparseable = (reason: string): UnparseableMessage => ({
    lineNumber: lineOffset,
    reason,
    rawText: rawMsg,
  });

  // Merchant first — gives the most specific error when it fails
  const normMerchant = normaliseMerchant(descRaw);
  if (normMerchant === "") {
    return makeUnparseable("missing merchant");
  }

  const displayName = deriveDisplayName(descRaw);

  // Amount
  const amtResult = parseNgnAmount(amtRaw);
  if (!amtResult.ok) {
    return makeUnparseable(amtResult.reason);
  }

  // Date
  if (dateRaw.trim() === "") {
    return makeUnparseable("missing date");
  }
  const dateResult = parseAlertDate(dateRaw, refDate);
  if (dateResult === "invalid") {
    return makeUnparseable("invalid date");
  }
  if (dateResult === "missing") {
    return makeUnparseable("missing date");
  }

  return {
    amount: amtResult.kobo,
    date: dateResult,
    normalisedMerchant: normMerchant,
    displayName,
  };
}

// ─── parseAlerts (public entry point) ───────────────────────────────────────

/** ISO-8601 date pattern validator */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Splits raw text into segments paired with their 1-based starting line number.
 * Mirrors splitMessages but also returns the line offset of each segment.
 */
function splitMessagesWithOffsets(raw: string): Array<{ text: string; lineOffset: number }> {
  const lines = raw.split("\n");
  const results: Array<{ text: string; lineOffset: number }> = [];

  let currentLines: string[] = [];
  let currentStart = 1; // 1-based line number of the first line in currentLines

  const flushCurrent = () => {
    const seg = currentLines.join("\n").trim();
    if (seg.length > 0) {
      results.push({ text: seg, lineOffset: currentStart });
    }
    currentLines = [];
  };

  const addLine = (line: string, index: number) => {
    if (currentLines.length === 0) currentStart = index + 1;
    currentLines.push(line);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0) {
      flushCurrent();
      continue;
    }

    if (ALERT_HEADER_RE.test(trimmedLine) || FORMAT_B_INLINE_RE.test(trimmedLine)) {
      flushCurrent();
    }

    addLine(line, i);
  }

  flushCurrent();
  return results;
}

/**
 * Top-level entry point.  Accepts raw pasted alert text and a Reference_Date,
 * and returns structured DebitRecords plus any unparseable messages.
 */
export function parseAlerts(
  rawText: string,
  referenceDate: string
): import("./types").ParseResult {
  // Guard: validate referenceDate format and calendar reality
  if (!ISO_DATE_RE.test(referenceDate)) {
    return {
      records: [],
      unparseable: [{ lineNumber: 1, reason: "invalid reference date", rawText: "" }],
    };
  }
  {
    const [y, m, d] = referenceDate.split("-").map(Number);
    if (!isRealDate(y, m, d)) {
      return {
        records: [],
        unparseable: [{ lineNumber: 1, reason: "invalid reference date", rawText: "" }],
      };
    }
  }

  // Guard: input size limit
  if (rawText.length > 200_000) {
    return {
      records: [],
      unparseable: [{ lineNumber: 1, reason: "input too large", rawText: "" }],
    };
  }

  const records: import("./types").DebitRecord[] = [];
  const unparseable: import("./types").UnparseableMessage[] = [];

  try {
    // Short-circuit on empty / whitespace-only input
    if (rawText.trim().length === 0) {
      return { records: [], unparseable: [] };
    }

    const segments = splitMessagesWithOffsets(rawText);

    for (const { text, lineOffset } of segments) {
      let result: import("./types").DebitRecord | import("./types").UnparseableMessage | null;
      try {
        result = parseMessage(text, lineOffset, referenceDate);
      } catch {
        unparseable.push({ lineNumber: lineOffset, reason: "internal error", rawText: text });
        continue;
      }

      if (result === null) {
        // Credit alert — silently excluded
        continue;
      }

      if ("amount" in result) {
        records.push(result as import("./types").DebitRecord);
      } else {
        unparseable.push(result as import("./types").UnparseableMessage);
      }
    }

    return {
      records: deduplicateRecords(records),
      unparseable,
    };
  } catch {
    return {
      records: deduplicateRecords(records),
      unparseable: [
        ...unparseable,
        { lineNumber: 1, reason: "internal error", rawText: "" },
      ],
    };
  }
}
