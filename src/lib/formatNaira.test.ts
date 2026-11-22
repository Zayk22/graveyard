import { describe, it, expect } from "vitest";
import { formatNaira } from "./formatNaira";

describe("formatNaira", () => {
  it("formats zero kobo as NGN 0.00", () => {
    expect(formatNaira(0)).toBe("NGN 0.00");
  });

  it("formats 150000 kobo as NGN 1,500.00", () => {
    expect(formatNaira(150000)).toBe("NGN 1,500.00");
  });

  it("formats 123456 kobo as NGN 1,234.56", () => {
    expect(formatNaira(123456)).toBe("NGN 1,234.56");
  });

  it("formats a large value with multiple comma groups", () => {
    // 10,000,000 naira = 1,000,000,000 kobo
    expect(formatNaira(1_000_000_000)).toBe("NGN 10,000,000.00");
  });

  it("formats a value with non-zero kobo part below 10 (single digit padding)", () => {
    // 100 naira + 5 kobo = 10005 kobo
    expect(formatNaira(10005)).toBe("NGN 100.05");
  });

  it("formats 100 kobo as NGN 1.00", () => {
    expect(formatNaira(100)).toBe("NGN 1.00");
  });

  it("formats 99 kobo as NGN 0.99", () => {
    expect(formatNaira(99)).toBe("NGN 0.99");
  });
});
