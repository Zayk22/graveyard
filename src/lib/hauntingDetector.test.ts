import { describe, it, expect } from "vitest";
import type { DebitRecord, Haunting } from "./types";
import {
  computeMedian,
  filterByTolerance,
  computeGaps,
  classifyInterval,
  computeNextDate,
  computeMonthlyCost,
  assignStatus,
  stableId,
  detectHauntings,
} from "./hauntingDetector";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRecord(
  normalisedMerchant: string,
  date: string,
  amount: number,
  displayName = normalisedMerchant
): DebitRecord {
  return { normalisedMerchant, date, amount, displayName };
}

// ── computeMedian ─────────────────────────────────────────────────────────────

describe("computeMedian", () => {
  it("returns exact middle value for an odd-length array", () => {
    expect(computeMedian([100, 200, 300])).toBe(200);
  });

  it("returns exact middle value for a single-element array", () => {
    expect(computeMedian([42])).toBe(42);
  });

  it("returns 0 for an empty array", () => {
    expect(computeMedian([])).toBe(0);
  });

  it("rounds half-up for an even-length array: [100, 101] → 101", () => {
    // (100 + 101) / 2 = 100.5 → round-half-up → 101
    expect(computeMedian([100, 101])).toBe(101);
  });

  it("rounds half-up for an even-length array: [1, 2] → 2", () => {
    // (1 + 2) / 2 = 1.5 → round-half-up → 2
    expect(computeMedian([1, 2])).toBe(2);
  });

  it("sorts before computing — [300, 100, 200] still returns 200", () => {
    expect(computeMedian([300, 100, 200])).toBe(200);
  });
});

// ── filterByTolerance ─────────────────────────────────────────────────────────

describe("filterByTolerance", () => {
  // median = 1000; tolerance band = [900, 1100]
  const median = 1000;

  it("includes a record exactly at the −10% boundary (amount = 900)", () => {
    const record = makeRecord("shop", "2024-01-01", 900);
    expect(filterByTolerance([record], median)).toHaveLength(1);
  });

  it("includes a record exactly at the +10% boundary (amount = 1100)", () => {
    const record = makeRecord("shop", "2024-01-01", 1100);
    expect(filterByTolerance([record], median)).toHaveLength(1);
  });

  it("excludes a record 1 kobo below the −10% boundary (amount = 899)", () => {
    const record = makeRecord("shop", "2024-01-01", 899);
    expect(filterByTolerance([record], median)).toHaveLength(0);
  });

  it("excludes a record 1 kobo above the +10% boundary (amount = 1101)", () => {
    const record = makeRecord("shop", "2024-01-01", 1101);
    expect(filterByTolerance([record], median)).toHaveLength(0);
  });

  it("filters a mixed list correctly", () => {
    const records = [
      makeRecord("shop", "2024-01-01", 899),
      makeRecord("shop", "2024-01-02", 900),
      makeRecord("shop", "2024-01-03", 1000),
      makeRecord("shop", "2024-01-04", 1100),
      makeRecord("shop", "2024-01-05", 1101),
    ];
    const result = filterByTolerance(records, median);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.amount)).toEqual([900, 1000, 1100]);
  });
});

// ── computeGaps ───────────────────────────────────────────────────────────────

describe("computeGaps", () => {
  it("returns an empty array for a single date", () => {
    expect(computeGaps(["2024-01-01"])).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(computeGaps([])).toEqual([]);
  });

  it("computes simple gaps correctly", () => {
    expect(computeGaps(["2024-01-01", "2024-01-08", "2024-01-15"])).toEqual([7, 7]);
  });

  it("computes gap across a month boundary: 2024-01-28 → 2024-02-28 = 31 days", () => {
    expect(computeGaps(["2024-01-28", "2024-02-28"])).toEqual([31]);
  });

  it("computes gap across a year boundary: 2023-12-01 → 2024-01-01 = 31 days", () => {
    expect(computeGaps(["2023-12-01", "2024-01-01"])).toEqual([31]);
  });
});

// ── classifyInterval ──────────────────────────────────────────────────────────

describe("classifyInterval", () => {
  it('classifies all gaps in [5, 9] as "weekly"', () => {
    expect(classifyInterval([7, 7, 7])).toBe("weekly");
  });

  it('classifies gaps at the weekly boundary extremes (5 and 9) as "weekly"', () => {
    expect(classifyInterval([5, 9, 7])).toBe("weekly");
  });

  it('classifies all gaps in [25, 35] as "monthly"', () => {
    expect(classifyInterval([30, 31, 28])).toBe("monthly");
  });

  it('classifies gaps at the monthly boundary extremes (25 and 35) as "monthly"', () => {
    expect(classifyInterval([25, 35, 30])).toBe("monthly");
  });

  it('classifies all gaps in [355, 375] as "yearly"', () => {
    expect(classifyInterval([365, 365])).toBe("yearly");
  });

  it('classifies gaps at the yearly boundary extremes (355 and 375) as "yearly"', () => {
    expect(classifyInterval([355, 375])).toBe("yearly");
  });

  it("returns null for mixed gaps (weekly + monthly)", () => {
    expect(classifyInterval([7, 30])).toBeNull();
  });

  it("returns null for gaps outside all known ranges", () => {
    expect(classifyInterval([10, 20, 50])).toBeNull();
  });

  it("returns null for an empty gaps array", () => {
    expect(classifyInterval([])).toBeNull();
  });
});

// ── computeNextDate ───────────────────────────────────────────────────────────

describe("computeNextDate", () => {
  it("weekly: 2024-03-01 + 7 days → 2024-03-08", () => {
    expect(computeNextDate("2024-03-01", "weekly")).toBe("2024-03-08");
  });

  it("weekly: advances across a month boundary (2024-03-29 → 2024-04-05)", () => {
    expect(computeNextDate("2024-03-29", "weekly")).toBe("2024-04-05");
  });

  it("monthly: Jan 31 2025 → Feb 28 (non-leap, clamped)", () => {
    expect(computeNextDate("2025-01-31", "monthly")).toBe("2025-02-28");
  });

  it("monthly: Jan 31 2024 → Feb 29 (leap year 2024)", () => {
    expect(computeNextDate("2024-01-31", "monthly")).toBe("2024-02-29");
  });

  it("monthly: Mar 15 → Apr 15 (no clamping needed)", () => {
    expect(computeNextDate("2024-03-15", "monthly")).toBe("2024-04-15");
  });

  it("monthly: Dec 15 → Jan 15 of the next year", () => {
    expect(computeNextDate("2024-12-15", "monthly")).toBe("2025-01-15");
  });

  it("yearly: Feb 29 (leap) → Feb 28 when next year is non-leap", () => {
    // 2024 is leap; 2025 is not
    expect(computeNextDate("2024-02-29", "yearly")).toBe("2025-02-28");
  });

  it("yearly: Mar 15 2024 → Mar 15 2025", () => {
    expect(computeNextDate("2024-03-15", "yearly")).toBe("2025-03-15");
  });
});

// ── computeMonthlyCost ────────────────────────────────────────────────────────

describe("computeMonthlyCost", () => {
  it("weekly: roundHalfUp((amount * 52) / 12) — concrete value 120000", () => {
    // (120000 * 52) / 12 = 520000
    expect(computeMonthlyCost(120000, "weekly")).toBe(520000);
  });

  it("weekly: 100000 → roundHalfUp(5200000/12) = roundHalfUp(433333.33) = 433333", () => {
    expect(computeMonthlyCost(100000, "weekly")).toBe(433333);
  });

  it("monthly: equals typicalAmount", () => {
    expect(computeMonthlyCost(500000, "monthly")).toBe(500000);
  });

  it("yearly: roundHalfUp(amount / 12) — concrete value 1200000 → 100000", () => {
    expect(computeMonthlyCost(1200000, "yearly")).toBe(100000);
  });

  it("yearly: 1000000 → roundHalfUp(1000000/12) = roundHalfUp(83333.33) = 83333", () => {
    expect(computeMonthlyCost(1000000, "yearly")).toBe(83333);
  });
});

// ── assignStatus ──────────────────────────────────────────────────────────────

describe("assignStatus", () => {
  it('returns "active" when refDate is before the lapse boundary', () => {
    // nextExpectedDate = 2024-04-15 (monthly)
    // lapseDate = computeNextDate("2024-04-15", "monthly") = 2024-05-15
    // refDate = 2024-05-01 is NOT after 2024-05-15 → active
    expect(assignStatus("2024-04-15", "monthly", "2024-05-01")).toBe("active");
  });

  it('returns "lapsed" when refDate is strictly after one full interval past nextExpectedDate', () => {
    // nextExpectedDate = 2024-04-15 (monthly)
    // lapseDate = 2024-05-15
    // refDate = 2024-05-16 is after 2024-05-15 → lapsed
    expect(assignStatus("2024-04-15", "monthly", "2024-05-16")).toBe("lapsed");
  });

  it('returns "active" when refDate equals nextExpectedDate', () => {
    expect(assignStatus("2024-04-15", "monthly", "2024-04-15")).toBe("active");
  });

  it('returns "active" when refDate equals the lapse boundary', () => {
    // lapse boundary = 2024-05-15; refDate = 2024-05-15 → NOT strictly after → active
    expect(assignStatus("2024-04-15", "monthly", "2024-05-15")).toBe("active");
  });

  it('returns "lapsed" for a weekly nextDate that has long passed', () => {
    // nextExpectedDate = 2024-01-08 (weekly); lapseDate = 2024-01-15
    // refDate = 2024-06-01 → lapsed
    expect(assignStatus("2024-01-08", "weekly", "2024-06-01")).toBe("lapsed");
  });
});

// ── stableId ──────────────────────────────────────────────────────────────────

describe("stableId", () => {
  it('replaces spaces with hyphens: "zap tunes" + "monthly" → "zap-tunes-monthly"', () => {
    expect(stableId("zap tunes", "monthly")).toBe("zap-tunes-monthly");
  });

  it("handles no spaces in the merchant — no extra hyphens added", () => {
    expect(stableId("zapstream", "weekly")).toBe("zapstream-weekly");
  });

  it("handles multiple spaces", () => {
    expect(stableId("neo n bites", "yearly")).toBe("neo-n-bites-yearly");
  });
});

// ── detectHauntings ───────────────────────────────────────────────────────────

describe("detectHauntings", () => {
  // Case 1 — Clean monthly series
  it("Case 1: detects a clean monthly series with correct fields", () => {
    const records: DebitRecord[] = [
      makeRecord("zapstream", "2024-01-15", 500000, "ZapStream"),
      makeRecord("zapstream", "2024-02-15", 500000, "ZapStream"),
      makeRecord("zapstream", "2024-03-15", 500000, "ZapStream"),
    ];
    const result = detectHauntings(records, "2024-04-01");

    expect(result).toHaveLength(1);
    const h = result[0];
    expect(h.interval).toBe("monthly");
    expect(h.typicalAmount).toBe(500000);
    expect(h.lastChargeDate).toBe("2024-03-15");
    expect(h.nextExpectedDate).toBe("2024-04-15");
    expect(h.estimatedMonthlyCost).toBe(500000);
    expect(h.status).toBe("active");
  });

  // Case 2 — Weekly series
  it("Case 2: detects a weekly series", () => {
    const records: DebitRecord[] = [
      makeRecord("neonbites", "2024-01-01", 120000, "NeonBites"),
      makeRecord("neonbites", "2024-01-08", 120000, "NeonBites"),
      makeRecord("neonbites", "2024-01-15", 120000, "NeonBites"),
    ];
    const result = detectHauntings(records, "2024-01-20");

    expect(result).toHaveLength(1);
    expect(result[0].interval).toBe("weekly");
  });

  // Case 2b — Yearly series
  it("Case 2b: detects a yearly series", () => {
    const records: DebitRecord[] = [
      makeRecord("annualclub", "2022-06-01", 1200000, "AnnualClub"),
      makeRecord("annualclub", "2023-06-01", 1200000, "AnnualClub"),
      makeRecord("annualclub", "2024-06-01", 1200000, "AnnualClub"),
    ];
    const result = detectHauntings(records, "2024-07-01");

    expect(result).toHaveLength(1);
    expect(result[0].interval).toBe("yearly");
  });

  // Case 3 — Only 2 charges → no haunting
  it("Case 3: returns [] when a merchant has only 2 charges", () => {
    const records: DebitRecord[] = [
      makeRecord("ghostpay", "2024-01-01", 100000),
      makeRecord("ghostpay", "2024-02-01", 100000),
    ];
    expect(detectHauntings(records, "2024-03-01")).toHaveLength(0);
  });

   // Case 4 — Outlier excluded from typicalAmount
  it("Case 4: excludes outlier from typicalAmount but counts it in chargeCount", () => {
    const records: DebitRecord[] = [
      makeRecord("steadypay", "2024-01-15", 300000, "SteadyPay"),
      makeRecord("steadypay", "2024-02-15", 300000, "SteadyPay"),
      makeRecord("steadypay", "2024-03-15", 300000, "SteadyPay"),
      makeRecord("steadypay", "2024-04-15", 900000, "SteadyPay"), // outlier
    ];
    const result = detectHauntings(records, "2024-05-01");

    expect(result).toHaveLength(1);
    expect(result[0].typicalAmount).toBe(300000);
    // All 4 deduped records appear in sourceCharges
    expect(result[0].chargeCount).toBe(4);
    // lastChargeDate and sourceCharges come from the WHOLE group, outlier included
    expect(result[0].lastChargeDate).toBe("2024-04-15");
    expect(result[0].nextExpectedDate).toBe("2024-05-15");
    expect(result[0].sourceCharges.map((r) => r.date)).toEqual([
      "2024-01-15",
      "2024-02-15",
      "2024-03-15",
      "2024-04-15",
    ]);
  });

  // Case 5 — Lapsed status
  it("Case 5: assigns lapsed status when referenceDate is well past the lapse boundary", () => {
    const records: DebitRecord[] = [
      makeRecord("oldservice", "2022-11-15", 150000, "OldService"),
      makeRecord("oldservice", "2022-12-15", 150000, "OldService"),
      makeRecord("oldservice", "2023-01-15", 150000, "OldService"),
    ];
    const result = detectHauntings(records, "2024-06-01");

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("lapsed");
  });

  // Case 6 — Month-end clamping
  it("Case 6: clamps nextExpectedDate to last day of February when day > 28", () => {
    const records: DebitRecord[] = [
      makeRecord("rentpay", "2024-11-30", 200000, "RentPay"),
      makeRecord("rentpay", "2024-12-31", 200000, "RentPay"),
      makeRecord("rentpay", "2025-01-31", 200000, "RentPay"),
    ];
    const result = detectHauntings(records, "2025-02-15");

    expect(result).toHaveLength(1);
    // lastChargeDate = 2025-01-31; nextExpectedDate for monthly → Feb 2025 has 28 days
    expect(result[0].nextExpectedDate).toBe("2025-02-28");
  });

  // Case 7 — Sort order: higher estimatedMonthlyCost first
  it("Case 7: sorts hauntings by estimatedMonthlyCost descending", () => {
    const records: DebitRecord[] = [
      // alphapay: 500000/month
      makeRecord("alphapay", "2024-01-15", 500000, "AlphaPay"),
      makeRecord("alphapay", "2024-02-15", 500000, "AlphaPay"),
      makeRecord("alphapay", "2024-03-15", 500000, "AlphaPay"),
      // zetapay: 300000/month
      makeRecord("zetapay", "2024-01-15", 300000, "ZetaPay"),
      makeRecord("zetapay", "2024-02-15", 300000, "ZetaPay"),
      makeRecord("zetapay", "2024-03-15", 300000, "ZetaPay"),
    ];
    const result = detectHauntings(records, "2024-04-01");

    expect(result).toHaveLength(2);
    expect(result[0].normalisedMerchant).toBe("alphapay");
    expect(result[1].normalisedMerchant).toBe("zetapay");
  });

  it("Case 7 tie-breaker: same estimatedMonthlyCost → sorted by id ascending", () => {
    const records: DebitRecord[] = [
      // Both merchants: 3 × 400000 monthly → same estimatedMonthlyCost
      makeRecord("zetasub", "2024-01-15", 400000, "ZetaSub"),
      makeRecord("zetasub", "2024-02-15", 400000, "ZetaSub"),
      makeRecord("zetasub", "2024-03-15", 400000, "ZetaSub"),
      makeRecord("alphasub", "2024-01-15", 400000, "AlphaSub"),
      makeRecord("alphasub", "2024-02-15", 400000, "AlphaSub"),
      makeRecord("alphasub", "2024-03-15", 400000, "AlphaSub"),
    ];
    const result = detectHauntings(records, "2024-04-01");

    expect(result).toHaveLength(2);
    // id = "alphasub-monthly" < "zetasub-monthly" alphabetically
    expect(result[0].id).toBe("alphasub-monthly");
    expect(result[1].id).toBe("zetasub-monthly");
  });

  // Case 8 — Invalid referenceDate
  it('Case 8a: returns [] for a non-date referenceDate ("not-a-date")', () => {
    const records: DebitRecord[] = [
      makeRecord("zapstream", "2024-01-15", 500000),
      makeRecord("zapstream", "2024-02-15", 500000),
      makeRecord("zapstream", "2024-03-15", 500000),
    ];
    expect(detectHauntings(records, "not-a-date")).toEqual([]);
  });

  it('Case 8b: returns [] for an impossible calendar date ("2024-13-01")', () => {
    const records: DebitRecord[] = [
      makeRecord("zapstream", "2024-01-15", 500000),
      makeRecord("zapstream", "2024-02-15", 500000),
      makeRecord("zapstream", "2024-03-15", 500000),
    ];
    expect(detectHauntings(records, "2024-13-01")).toEqual([]);
  });

  // Case 9 — Irregular gaps → no haunting
  it("Case 9: returns [] when gaps are irregular (not weekly/monthly/yearly)", () => {
    // Gaps: 2024-01-01 → 2024-01-11 (10), 2024-01-11 → 2024-01-31 (20), 2024-01-31 → 2024-03-21 (50)
    const records: DebitRecord[] = [
      makeRecord("erratic", "2024-01-01", 100000),
      makeRecord("erratic", "2024-01-11", 100000),
      makeRecord("erratic", "2024-01-31", 100000),
      makeRecord("erratic", "2024-03-21", 100000),
    ];
    expect(detectHauntings(records, "2024-04-01")).toHaveLength(0);
  });

  // Additional: empty input
  it("returns [] for an empty records array", () => {
    expect(detectHauntings([], "2024-04-01")).toEqual([]);
  });

  // chargeCount includes all deduped records (source charges)
  it("chargeCount reflects total deduped records for the merchant group", () => {
    const records: DebitRecord[] = [
      makeRecord("zapstream", "2024-01-15", 500000, "ZapStream"),
      makeRecord("zapstream", "2024-02-15", 500000, "ZapStream"),
      makeRecord("zapstream", "2024-03-15", 500000, "ZapStream"),
    ];
    const result = detectHauntings(records, "2024-04-01");
    expect(result[0].chargeCount).toBe(3);
  });

  // displayName from most recent charge
  it("uses displayName from the most recent charge in the merchant group", () => {
    const records: DebitRecord[] = [
      makeRecord("zapstream", "2024-01-15", 500000, "ZapStream Old"),
      makeRecord("zapstream", "2024-02-15", 500000, "ZapStream Mid"),
      makeRecord("zapstream", "2024-03-15", 500000, "ZapStream New"),
    ];
    const result = detectHauntings(records, "2024-04-01");
    expect(result[0].displayName).toBe("ZapStream New");
  });

  // id construction
  it("constructs id as normalisedMerchant-with-hyphens + interval", () => {
    const records: DebitRecord[] = [
      makeRecord("zap stream", "2024-01-15", 500000, "Zap Stream"),
      makeRecord("zap stream", "2024-02-15", 500000, "Zap Stream"),
      makeRecord("zap stream", "2024-03-15", 500000, "Zap Stream"),
    ];
    const result = detectHauntings(records, "2024-04-01");
    expect(result[0].id).toBe("zap-stream-monthly");
  });
});
