import { describe, it, expect } from "vitest";
import {
  parseNgnAmount,
  normaliseMerchant,
  deriveDisplayName,
  parseAlertDate,
  splitMessages,
} from "./alertParser";
import { deduplicateRecords } from "./dedupe";
import type { DebitRecord } from "./types";

// ─── parseNgnAmount ──────────────────────────────────────────────────────────

describe("parseNgnAmount", () => {
  describe("valid NGN amounts", () => {
    it("parses NGN with naira and kobo parts", () => {
      const result = parseNgnAmount("NGN 1,234.56");
      expect(result).toEqual({ ok: true, kobo: 123456 });
    });

    it("parses NGN with whole naira and .00 kobo", () => {
      const result = parseNgnAmount("NGN 1,500.00");
      expect(result).toEqual({ ok: true, kobo: 150000 });
    });

    it("parses NGN without decimal part", () => {
      const result = parseNgnAmount("NGN 100");
      expect(result).toEqual({ ok: true, kobo: 10000 });
    });

    it("parses NGN with commas in large amount", () => {
      const result = parseNgnAmount("NGN 1,000,000.00");
      expect(result).toEqual({ ok: true, kobo: 100000000 });
    });

    it("parses ₦ symbol instead of NGN", () => {
      const result = parseNgnAmount("₦750.50");
      expect(result).toEqual({ ok: true, kobo: 75050 });
    });

    it("parses ₦ symbol with no space before digits", () => {
      const result = parseNgnAmount("₦750");
      expect(result).toEqual({ ok: true, kobo: 75000 });
    });

    it("parses NGN with no space before digits", () => {
      const result = parseNgnAmount("NGN1200.5");
      expect(result).toEqual({ ok: true, kobo: 120050 });
    });

    it("parses zero kobo correctly", () => {
      const result = parseNgnAmount("NGN 0.00");
      expect(result).toEqual({ ok: true, kobo: 0 });
    });

    it("uses integer arithmetic — no floating-point rounding error", () => {
      // 4,500.99 naira = 450099 kobo exactly
      const result = parseNgnAmount("NGN 4,500.99");
      expect(result).toEqual({ ok: true, kobo: 450099 });
    });

    it("pads single-digit kobo to two places", () => {
      // "NGN 1.5" should be treated as 1 naira and 50 kobo = 150 kobo
      const result = parseNgnAmount("NGN 1.5");
      expect(result).toEqual({ ok: true, kobo: 150 });
    });
  });

  describe("non-NGN currencies", () => {
    it("rejects USD amount", () => {
      const result = parseNgnAmount("USD 100.00");
      expect(result).toEqual({ ok: false, reason: "unsupported currency" });
    });

    it("rejects GBP amount", () => {
      const result = parseNgnAmount("GBP 50.00");
      expect(result).toEqual({ ok: false, reason: "unsupported currency" });
    });

    it("rejects EUR amount", () => {
      const result = parseNgnAmount("EUR 200.00");
      expect(result).toEqual({ ok: false, reason: "unsupported currency" });
    });

    it("rejects $ symbol", () => {
      const result = parseNgnAmount("$99.99");
      expect(result).toEqual({ ok: false, reason: "unsupported currency" });
    });

    it("rejects £ symbol", () => {
      const result = parseNgnAmount("£30.00");
      expect(result).toEqual({ ok: false, reason: "unsupported currency" });
    });
  });

  describe("invalid amounts", () => {
    it("rejects non-numeric naira string", () => {
      const result = parseNgnAmount("NGN abc.00");
      expect(result).toEqual({ ok: false, reason: "invalid amount" });
    });

    it("rejects amount with more than two decimal places", () => {
      const result = parseNgnAmount("NGN 1.234");
      expect(result).toEqual({ ok: false, reason: "invalid amount" });
    });

    it("rejects amount with multiple decimal points", () => {
      const result = parseNgnAmount("NGN 1.2.3");
      expect(result).toEqual({ ok: false, reason: "invalid amount" });
    });

    it("rejects empty string", () => {
      const result = parseNgnAmount("");
      expect(result).toEqual({ ok: false, reason: "invalid amount" });
    });
  });
});

// ─── normaliseMerchant ───────────────────────────────────────────────────────

describe("normaliseMerchant", () => {
  it("lowercases the input", () => {
    expect(normaliseMerchant("ZapTunes")).toBe("zaptunes");
  });

  it("removes all-digit tokens", () => {
    expect(normaliseMerchant("ZapTunes 12345")).toBe("zaptunes");
  });

  it("removes ref-style tokens (letters immediately followed by digits)", () => {
    expect(normaliseMerchant("GhostRide REF20240315")).toBe("ghostride");
  });

  it("removes ref-style tokens with hyphens in the token", () => {
    // "ref-00042" → stripped of punctuation becomes "ref00042" which matches [a-z]\d
    expect(normaliseMerchant("NeonBites ref-00042")).toBe("neonbites");
  });

  it("strips punctuation after token filtering", () => {
    expect(normaliseMerchant("ZapTunes, Ltd.")).toBe("zaptunes ltd");
  });

  it("collapses multiple spaces", () => {
    expect(normaliseMerchant("NeonBites   Delivery")).toBe("neonbites delivery");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normaliseMerchant("  ZapTunes  ")).toBe("zaptunes");
  });

  it("returns empty string when only digit tokens remain", () => {
    expect(normaliseMerchant("12345 67890")).toBe("");
  });

  it("returns empty string when only ref-style tokens remain", () => {
    expect(normaliseMerchant("REF99 TRF20240315")).toBe("");
  });

  it("handles merchant with no changes needed", () => {
    expect(normaliseMerchant("ghostride ltd")).toBe("ghostride ltd");
  });

  it("removes mixed digit and ref tokens, keeps plain words", () => {
    // "FableBank 00001 TRF-99 PLC" → keep "fablebank" and "plc"
    expect(normaliseMerchant("FableBank 00001 TRF-99 PLC")).toBe("fablebank plc");
  });
});

// ─── deriveDisplayName ───────────────────────────────────────────────────────

describe("deriveDisplayName", () => {
  it("removes all-digit tokens", () => {
    expect(deriveDisplayName("NeonBites 123456789")).toBe("NeonBites");
  });

  it("removes ref-style tokens", () => {
    expect(deriveDisplayName("GhostRide REF20240315")).toBe("GhostRide");
  });

  it("truncates to 60 characters", () => {
    const long = "ZapTunes " + "A".repeat(60);
    const result = deriveDisplayName(long);
    expect(result.length).toBe(60);
    expect(result).toBe(("ZapTunes " + "A".repeat(60)).slice(0, 60));
  });

  it("preserves mixed-case original text", () => {
    expect(deriveDisplayName("NeonBites Delivery")).toBe("NeonBites Delivery");
  });

  it("removes a 6-digit run token", () => {
    // 6 consecutive digits in a standalone token
    expect(deriveDisplayName("ZapTunes 123456 Monthly")).toBe("ZapTunes Monthly");
  });

  it("keeps tokens with fewer than 6 digits", () => {
    // "123" is all-digit but fewer than 6 chars; normaliseMerchant removes all-digit tokens,
    // but deriveDisplayName also removes all-digit tokens regardless of length
    expect(deriveDisplayName("GhostRide 123 Ltd")).toBe("GhostRide Ltd");
  });

  it("returns empty string when all tokens are digits or ref-style", () => {
    expect(deriveDisplayName("12345 REF99")).toBe("");
  });

  it("trims result", () => {
    expect(deriveDisplayName("  ZapTunes  ")).toBe("ZapTunes");
  });
});

// ─── parseAlertDate ──────────────────────────────────────────────────────────

describe("parseAlertDate", () => {
  const REF = "2024-03-15";

  describe("DD/MM/YYYY format", () => {
    it("parses a valid date", () => {
      expect(parseAlertDate("15/03/2024", REF)).toBe("2024-03-15");
    });

    it("pads single-digit day and month", () => {
      expect(parseAlertDate("7/4/2024", REF)).toBe("2024-04-07");
    });

    it("returns 'invalid' for impossible date (month 13)", () => {
      expect(parseAlertDate("01/13/2024", REF)).toBe("invalid");
    });

    it("returns 'invalid' for February 30", () => {
      expect(parseAlertDate("30/02/2024", REF)).toBe("invalid");
    });
  });

  describe("DD-Mon-YYYY format", () => {
    it("parses 15-Mar-2024", () => {
      expect(parseAlertDate("15-Mar-2024", REF)).toBe("2024-03-15");
    });

    it("parses 1-Jan-2024", () => {
      expect(parseAlertDate("1-Jan-2024", REF)).toBe("2024-01-01");
    });

    it("is case-insensitive for month abbreviation", () => {
      expect(parseAlertDate("15-mar-2024", REF)).toBe("2024-03-15");
      expect(parseAlertDate("15-MAR-2024", REF)).toBe("2024-03-15");
    });

    it("returns 'invalid' for unknown month abbreviation", () => {
      expect(parseAlertDate("15-Xyz-2024", REF)).toBe("invalid");
    });

    it("returns 'invalid' for impossible day in month", () => {
      expect(parseAlertDate("30-Feb-2024", REF)).toBe("invalid");
    });
  });

  describe("YYYY-MM-DD format", () => {
    it("parses a valid ISO date", () => {
      expect(parseAlertDate("2024-03-15", REF)).toBe("2024-03-15");
    });

    it("returns 'invalid' for 2024-02-30", () => {
      expect(parseAlertDate("2024-02-30", REF)).toBe("invalid");
    });
  });

  describe("DD/MM format (year resolution from refDate)", () => {
    it("uses ref year when date is not in the future", () => {
      // 15/03 in ref year 2024 = 2024-03-15, which equals refDate (not future)
      expect(parseAlertDate("15/03", "2024-03-15")).toBe("2024-03-15");
    });

    it("uses ref year when date is earlier in same year", () => {
      expect(parseAlertDate("01/01", "2024-03-15")).toBe("2024-01-01");
    });

    it("uses previous year when date would be in the future", () => {
      // 20/12 in year 2024 = 2024-12-20 which is after refDate 2024-03-15 → use 2023
      expect(parseAlertDate("20/12", "2024-03-15")).toBe("2023-12-20");
    });

    it("returns 'invalid' for impossible DD/MM date", () => {
      expect(parseAlertDate("30/02", REF)).toBe("invalid");
    });
  });

  describe("missing and unrecognised input", () => {
    it("returns 'missing' when no date pattern is present", () => {
      expect(parseAlertDate("No date here at all", REF)).toBe("missing");
    });

    it("returns 'missing' for empty string", () => {
      expect(parseAlertDate("", REF)).toBe("missing");
    });
  });
});

// ─── splitMessages ───────────────────────────────────────────────────────────

describe("splitMessages", () => {
  it("returns a single segment when input has no boundaries", () => {
    const raw = "Debit Alert\nAmt: NGN 1,000.00\nDesc: ZapTunes\nDate: 15/03/2024";
    const result = splitMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("ZapTunes");
  });

  it("splits two alerts separated by a blank line", () => {
    const raw = [
      "Debit Alert",
      "Amt: NGN 1,000.00",
      "Desc: ZapTunes",
      "Date: 15/03/2024",
      "",
      "Debit Alert",
      "Amt: NGN 500.00",
      "Desc: NeonBites",
      "Date: 16/03/2024",
    ].join("\n");

    const result = splitMessages(raw);
    expect(result).toHaveLength(2);
  });

  it("splits on 'Debit Alert' header pattern", () => {
    const raw = [
      "Debit Alert",
      "Amt: NGN 1,000.00",
      "Desc: ZapTunes",
      "Date: 15/03/2024",
      "Debit Alert",
      "Amt: NGN 500.00",
      "Desc: NeonBites",
      "Date: 16/03/2024",
    ].join("\n");

    const result = splitMessages(raw);
    expect(result).toHaveLength(2);
  });

  it("splits on 'Account Debit' header pattern", () => {
    const raw = [
      "Account Debit",
      "Amount: ₦750.00",
      "Description: GhostRide Ltd",
      "Value Date: 15-Mar-2024",
      "Account Debit",
      "Amount: ₦200.00",
      "Description: ZapTunes",
      "Value Date: 16-Mar-2024",
    ].join("\n");

    const result = splitMessages(raw);
    expect(result).toHaveLength(2);
  });

  it("splits on 'Transaction Alert' header pattern", () => {
    const raw = [
      "Transaction Alert - Account Debit",
      "Amount: ₦750.00",
      "Description: GhostRide Ltd",
      "Value Date: 15-Mar-2024",
      "Transaction Alert - Account Debit",
      "Amount: ₦200.00",
      "Description: ZapTunes",
      "Value Date: 16-Mar-2024",
    ].join("\n");

    const result = splitMessages(raw);
    expect(result).toHaveLength(2);
  });

  it("splits consecutive Format B one-line alerts without blank lines", () => {
    const raw = [
      "Your account was debited NGN 1,200.00 for NeonBites Delivery on 07/04/2024. Ref: TRF-00042.",
      "Your account was debited NGN 800.00 for ZapTunes on 08/04/2024. Ref: TRF-00043.",
      "Your account was debited NGN 500.00 for GhostRide Ltd on 09/04/2024. Ref: TRF-00044.",
    ].join("\n");

    const result = splitMessages(raw);
    expect(result).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    expect(splitMessages("")).toHaveLength(0);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(splitMessages("   \n\n  \n")).toHaveLength(0);
  });

  it("trims segments", () => {
    const raw = "\nDebit Alert\nAmt: NGN 1,000.00\nDesc: ZapTunes\nDate: 15/03/2024\n";
    const result = splitMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toMatch(/^\n/);
  });
});

// ─── deduplicateRecords ──────────────────────────────────────────────────────

describe("deduplicateRecords", () => {
  const makeRecord = (
    normalisedMerchant: string,
    date: string,
    amount: number,
    displayName = normalisedMerchant
  ): DebitRecord => ({ normalisedMerchant, date, amount, displayName });

  it("removes duplicate records with the same (merchant, date, amount) triple", () => {
    const records = [
      makeRecord("zaptunes", "2024-03-15", 150000),
      makeRecord("zaptunes", "2024-03-15", 150000),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].normalisedMerchant).toBe("zaptunes");
  });

  it("keeps records with different amounts", () => {
    const records = [
      makeRecord("zaptunes", "2024-03-15", 150000),
      makeRecord("zaptunes", "2024-03-15", 200000),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("keeps records with different dates", () => {
    const records = [
      makeRecord("zaptunes", "2024-03-15", 150000),
      makeRecord("zaptunes", "2024-04-15", 150000),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("keeps records with different merchants", () => {
    const records = [
      makeRecord("zaptunes", "2024-03-15", 150000),
      makeRecord("neonbites", "2024-03-15", 150000),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(2);
  });

  it("when duplicates differ in displayName, keeps the alphabetically smallest", () => {
    const records = [
      makeRecord("zaptunes", "2024-03-15", 150000, "ZapTunes Premium"),
      makeRecord("zaptunes", "2024-03-15", 150000, "ZapTunes Basic"),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("ZapTunes Basic");
  });

  it("returns empty array when input is empty", () => {
    expect(deduplicateRecords([])).toHaveLength(0);
  });

  it("handles no duplicates — all records preserved", () => {
    const records = [
      makeRecord("zaptunes", "2024-01-15", 150000),
      makeRecord("neonbites", "2024-02-15", 120000),
      makeRecord("ghostride", "2024-03-15", 75000),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(3);
  });

  it("deduplicates more than two copies", () => {
    const records = [
      makeRecord("zaptunes", "2024-03-15", 150000),
      makeRecord("zaptunes", "2024-03-15", 150000),
      makeRecord("zaptunes", "2024-03-15", 150000),
    ];
    const result = deduplicateRecords(records);
    expect(result).toHaveLength(1);
  });
});

// ─── parseAlerts ─────────────────────────────────────────────────────────────

import { parseAlerts } from "./alertParser";

describe("parseAlerts", () => {
  const REF = "2024-03-15";

  // 1. Single well-formed Format A alert → one DebitRecord
  it("parses a single Format A alert into one DebitRecord", () => {
    const raw = [
      "Debit Alert",
      "Amt: NGN 4,500.00",
      "Desc: ZapTunes Monthly",
      "Date: 15/03/2024",
      "Acct: ****1234",
      "Bal: NGN 55,000.00",
    ].join("\n");

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(1);
    expect(result.unparseable).toHaveLength(0);
    expect(result.records[0].amount).toBe(450000);
    expect(result.records[0].date).toBe("2024-03-15");
    expect(result.records[0].normalisedMerchant).toBe("zaptunes monthly");
  });

  // 2. Single well-formed Format B alert → one DebitRecord
  it("parses a single Format B alert into one DebitRecord", () => {
    const raw =
      "Your account was debited NGN 1,200.00 for NeonBites Delivery on 07/04/2024. Ref: TRF-00042.";

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(1);
    expect(result.unparseable).toHaveLength(0);
    expect(result.records[0].amount).toBe(120000);
    expect(result.records[0].date).toBe("2024-04-07");
    expect(result.records[0].normalisedMerchant).toBe("neonbites delivery");
  });

  // 3. Single well-formed Format C alert → one DebitRecord
  it("parses a single Format C alert into one DebitRecord", () => {
    const raw = [
      "Transaction Alert - Account Debit",
      "Amount: ₦750.00",
      "Description: GhostRide Ltd REF20240315",
      "Value Date: 15-Mar-2024",
    ].join("\n");

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(1);
    expect(result.unparseable).toHaveLength(0);
    expect(result.records[0].amount).toBe(75000);
    expect(result.records[0].date).toBe("2024-03-15");
    expect(result.records[0].normalisedMerchant).toBe("ghostride ltd");
  });

  // 4. Multiple alerts separated by blank lines → correct count
  it("parses 3 Format A alerts separated by blank lines into 3 DebitRecords", () => {
    const makeFormatA = (amt: string, merchant: string, date: string) =>
      ["Debit Alert", `Amt: NGN ${amt}`, `Desc: ${merchant}`, `Date: ${date}`].join("\n");

    const raw = [
      makeFormatA("1,000.00", "ZapTunes", "01/03/2024"),
      "",
      makeFormatA("2,000.00", "NeonBites Delivery", "02/03/2024"),
      "",
      makeFormatA("500.00", "GhostRide Ltd", "03/03/2024"),
    ].join("\n");

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(3);
    expect(result.unparseable).toHaveLength(0);
  });

  // 5. Non-NGN currency → one UnparseableMessage with reason "unsupported currency"
  it("produces an unparseable entry for a non-NGN currency", () => {
    const raw = [
      "Debit Alert",
      "Amt: USD 100.00",
      "Desc: ZapTunes",
      "Date: 15/03/2024",
    ].join("\n");

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(0);
    expect(result.unparseable).toHaveLength(1);
    expect(result.unparseable[0].reason).toBe("unsupported currency");
  });

  // 6. Credit alert → excluded from both arrays
  it("silently excludes credit alerts from both arrays", () => {
    const raw = [
      "Credit Alert",
      "Amt: NGN 5,000.00",
      "Desc: FableBank Salary",
      "Date: 15/03/2024",
    ].join("\n");

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(0);
    expect(result.unparseable).toHaveLength(0);
  });

  // 7. Ambiguous alert → UnparseableMessage with reason "ambiguous alert type"
  it("marks an alert containing both debit and credit phrases as ambiguous", () => {
    const raw =
      "Your account was debited NGN 500.00 and also credited NGN 500.00 for ZapTunes on 15/03/2024.";

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(0);
    expect(result.unparseable).toHaveLength(1);
    expect(result.unparseable[0].reason).toBe("ambiguous alert type");
  });

  // 8. Empty input → empty arrays
  it("returns empty arrays for empty input", () => {
    const result = parseAlerts("", REF);
    expect(result.records).toHaveLength(0);
    expect(result.unparseable).toHaveLength(0);
  });

  // 9. Whitespace-only input → empty arrays
  it("returns empty arrays for whitespace-only input", () => {
    const result = parseAlerts("   \n\n  \n", REF);
    expect(result.records).toHaveLength(0);
    expect(result.unparseable).toHaveLength(0);
  });

  // 10. Duplicate records → deduplicated to one
  it("deduplicates identical alerts pasted twice", () => {
    const alert = [
      "Debit Alert",
      "Amt: NGN 1,500.00",
      "Desc: ZapTunes Monthly",
      "Date: 15/03/2024",
    ].join("\n");
    const raw = `${alert}\n\n${alert}`;

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(1);
  });

  // 11a. Invalid referenceDate (non-date string)
  it("returns invalid reference date error for a non-date referenceDate", () => {
    const result = parseAlerts("any text", "not-a-date");
    expect(result.records).toHaveLength(0);
    expect(result.unparseable).toHaveLength(1);
    expect(result.unparseable[0].reason).toBe("invalid reference date");
  });

  // 11b. Invalid referenceDate (impossible calendar date)
  it("returns invalid reference date error for an impossible referenceDate", () => {
    const result = parseAlerts("any text", "2024-02-30");
    expect(result.records).toHaveLength(0);
    expect(result.unparseable).toHaveLength(1);
    expect(result.unparseable[0].reason).toBe("invalid reference date");
  });

  // 12. rawText > 200,000 chars → input too large
  it("returns input too large error when rawText exceeds 200,000 characters", () => {
    const result = parseAlerts("A".repeat(200001), REF);
    expect(result.records).toHaveLength(0);
    expect(result.unparseable).toHaveLength(1);
    expect(result.unparseable[0].reason).toBe("input too large");
  });

  // 13. Leading/trailing whitespace on lines → no parse error
  it("handles extra leading/trailing whitespace on each line without error", () => {
    const raw = [
      "  Debit Alert  ",
      "  Amt: NGN 1,000.00  ",
      "  Desc: ZapTunes  ",
      "  Date: 15/03/2024  ",
    ].join("\n");

    const result = parseAlerts(raw, REF);
    expect(result.records).toHaveLength(1);
    expect(result.unparseable).toHaveLength(0);
  });
});
