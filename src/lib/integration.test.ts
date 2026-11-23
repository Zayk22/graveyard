import { describe, it, expect } from "vitest";
import { parseAlerts, detectHauntings } from "./index";
import { formatNaira } from "./formatNaira";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REFERENCE_DATE = "2024-07-15";

/**
 * Multi-segment raw alert text covering:
 *   - Format A monthly series  (ZapTunes, 3 charges)
 *   - Format B weekly series   (NeonBites Delivery, 3 charges)
 *   - Format C yearly series   (GrimVault Backup, 3 charges)
 *   - Credit alert             (excluded silently)
 *   - Unsupported-currency alert (USD → unparseable)
 *   - Duplicate of first ZapTunes charge (deduplicated)
 *   - Garbage line             (unrecognised format → unparseable)
 */
const RAW_ALERTS = `Debit Alert
Amt: NGN 5,000.00
Desc: ZapTunes Streaming
Date: 15/04/2024

Debit Alert
Amt: NGN 5,000.00
Desc: ZapTunes Streaming
Date: 15/05/2024

Debit Alert
Amt: NGN 5,100.00
Desc: ZapTunes Streaming
Date: 15/06/2024

Your account has been debited NGN 2,500.00 for NeonBites Delivery on 01/06/2024

Your account has been debited NGN 2,500.00 for NeonBites Delivery on 08/06/2024

Your account has been debited NGN 2,500.00 for NeonBites Delivery on 15/06/2024

Account Debit
Amount: NGN 12,000.00
Description: GrimVault Backup Plan
Value Date: 2022-03-10

Account Debit
Amount: NGN 12,000.00
Description: GrimVault Backup Plan
Value Date: 2023-03-10

Account Debit
Amount: NGN 12,500.00
Description: GrimVault Backup Plan
Value Date: 2024-03-10

Credit Alert
Amt: NGN 50,000.00
Desc: Salary FableBank
Date: 01/06/2024

Debit Alert
Amt: USD 100.00
Desc: ForeignShop
Date: 10/06/2024

Debit Alert
Amt: NGN 5,000.00
Desc: ZapTunes Streaming
Date: 15/04/2024

This is not an alert at all`;

// ─── parseAlerts ─────────────────────────────────────────────────────────────

describe("integration — parseAlerts", () => {
  const { records, unparseable } = parseAlerts(RAW_ALERTS, REFERENCE_DATE);

  it("produces 9 unique debit records (credit excluded, duplicate deduplicated)", () => {
    expect(records.length).toBe(9);
  });

  it("produces exactly 2 unparseable messages", () => {
    expect(unparseable.length).toBe(2);
  });

  it("unparseable contains one 'unsupported currency' entry", () => {
    const count = unparseable.filter((u) => u.reason === "unsupported currency").length;
    expect(count).toBe(1);
  });

  it("unparseable contains one 'unrecognised format' entry", () => {
    const count = unparseable.filter((u) => u.reason === "unrecognised format").length;
    expect(count).toBe(1);
  });

  it("reports the correct starting line for each unparseable message", () => {
    const lineByReason = Object.fromEntries(
      unparseable.map((u) => [u.reason, u.lineNumber])
    );
    // Line numbers are relative to the start of RAW_ALERTS
    expect(lineByReason["unsupported currency"]).toBe(42);
    expect(lineByReason["unrecognised format"]).toBe(52);
  });
});

// ─── detectHauntings ─────────────────────────────────────────────────────────

describe("integration — detectHauntings", () => {
  const { records } = parseAlerts(RAW_ALERTS, REFERENCE_DATE);
  const hauntings = detectHauntings(records, REFERENCE_DATE);

  it("detects exactly 3 hauntings", () => {
    expect(hauntings.length).toBe(3);
  });

  // ── Sort order ─────────────────────────────────────────────────────────────
  // NeonBites weekly:  roundHalfUp((250000 * 52) / 12) = 1083333
  // ZapTunes monthly:  500000
  // GrimVault yearly:  roundHalfUp(1200000 / 12)       = 100000

  it("hauntings[0] is NeonBites (highest estimatedMonthlyCost)", () => {
    expect(hauntings[0].normalisedMerchant).toBe("neonbites delivery");
  });

  it("hauntings[1] is ZapTunes", () => {
    expect(hauntings[1].normalisedMerchant).toBe("zaptunes streaming");
  });

  it("hauntings[2] is GrimVault", () => {
    expect(hauntings[2].normalisedMerchant).toBe("grimvault backup plan");
  });

  // ── ZapTunes haunting ──────────────────────────────────────────────────────

  describe("ZapTunes haunting (monthly)", () => {
    it("has interval 'monthly'", () => {
      expect(hauntings[1].interval).toBe("monthly");
    });

    it("has typicalAmount 500000 kobo", () => {
      expect(hauntings[1].typicalAmount).toBe(500000);
    });

    it("has estimatedMonthlyCost 500000 kobo", () => {
      expect(hauntings[1].estimatedMonthlyCost).toBe(500000);
    });

    it("has chargeCount 3", () => {
      expect(hauntings[1].chargeCount).toBe(3);
    });

    it("has sourceCharges.length 3", () => {
      expect(hauntings[1].sourceCharges.length).toBe(3);
    });

    it("chargeCount equals sourceCharges.length", () => {
      expect(hauntings[1].chargeCount).toBe(hauntings[1].sourceCharges.length);
    });

    it("nextExpectedDate is 2024-07-15 (June 15 + 1 month)", () => {
      expect(hauntings[1].nextExpectedDate).toBe("2024-07-15");
    });

    it("status is 'active' (refDate is not past lapseDate 2024-08-15)", () => {
      expect(hauntings[1].status).toBe("active");
    });
  });

  // ── NeonBites haunting ─────────────────────────────────────────────────────

  describe("NeonBites haunting (weekly)", () => {
    it("has interval 'weekly'", () => {
      expect(hauntings[0].interval).toBe("weekly");
    });

    it("has typicalAmount 250000 kobo", () => {
      expect(hauntings[0].typicalAmount).toBe(250000);
    });

    it("has estimatedMonthlyCost 1083333 kobo", () => {
      expect(hauntings[0].estimatedMonthlyCost).toBe(1083333);
    });

    it("has chargeCount 3", () => {
      expect(hauntings[0].chargeCount).toBe(3);
    });

    it("has sourceCharges.length 3", () => {
      expect(hauntings[0].sourceCharges.length).toBe(3);
    });

    it("chargeCount equals sourceCharges.length", () => {
      expect(hauntings[0].chargeCount).toBe(hauntings[0].sourceCharges.length);
    });
  });

  // ── GrimVault haunting ─────────────────────────────────────────────────────

  describe("GrimVault haunting (yearly)", () => {
    it("has interval 'yearly'", () => {
      expect(hauntings[2].interval).toBe("yearly");
    });

    it("has typicalAmount 1200000 kobo", () => {
      expect(hauntings[2].typicalAmount).toBe(1200000);
    });

    it("has estimatedMonthlyCost 100000 kobo", () => {
      expect(hauntings[2].estimatedMonthlyCost).toBe(100000);
    });

    it("has chargeCount 3", () => {
      expect(hauntings[2].chargeCount).toBe(3);
    });

    it("has sourceCharges.length 3", () => {
      expect(hauntings[2].sourceCharges.length).toBe(3);
    });

    it("chargeCount equals sourceCharges.length", () => {
      expect(hauntings[2].chargeCount).toBe(hauntings[2].sourceCharges.length);
    });
  });

  // ── Status and next dates for the weekly and yearly hauntings ─────────────

  it("NeonBites is lapsed: last charge 2024-06-15, next 2024-06-22, lapse boundary 2024-06-29", () => {
    expect(hauntings[0].lastChargeDate).toBe("2024-06-15");
    expect(hauntings[0].nextExpectedDate).toBe("2024-06-22");
    expect(hauntings[0].status).toBe("lapsed");
  });

  it("GrimVault is active: last charge 2024-03-10, next 2025-03-10", () => {
    expect(hauntings[2].lastChargeDate).toBe("2024-03-10");
    expect(hauntings[2].nextExpectedDate).toBe("2025-03-10");
    expect(hauntings[2].status).toBe("active");
  });

  // ── sourceCharges sort order ───────────────────────────────────────────────

  it("every haunting has sourceCharges sorted by date asc then amount asc", () => {
    for (const haunting of hauntings) {
      const charges = haunting.sourceCharges;
      for (let i = 0; i < charges.length - 1; i++) {
        const a = charges[i];
        const b = charges[i + 1];
        if (a.date === b.date) {
          expect(a.amount).toBeLessThanOrEqual(b.amount);
        } else {
          expect(a.date < b.date).toBe(true);
        }
      }
    }
  });

  // ── chargeCount === sourceCharges.length for every haunting ───────────────

  it("chargeCount equals sourceCharges.length for all hauntings", () => {
    for (const haunting of hauntings) {
      expect(haunting.chargeCount).toBe(haunting.sourceCharges.length);
    }
  });
});

// ─── formatNaira smoke test ───────────────────────────────────────────────────

describe("integration — formatNaira smoke test", () => {
  it("formatNaira(500000) === 'NGN 5,000.00'", () => {
    expect(formatNaira(500000)).toBe("NGN 5,000.00");
  });
});