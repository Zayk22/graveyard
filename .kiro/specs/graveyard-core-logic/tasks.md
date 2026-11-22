# Implementation Plan: Graveyard Core Logic

## Overview

Implement two pure TypeScript modules — `alertParser` and `hauntingDetector` — plus the `formatNaira` helper, all living under `src/lib/`. No React, no browser APIs. All monetary values travel as integers in kobo. Each module is covered by Vitest unit tests and fast-check property-based tests.

## Tasks

- [x] 1. Create shared type definitions
  - Create `src/lib/types.ts` with all exported types: `Interval`, `HauntingStatus`, `AmountResult`, `DebitRecord`, `UnparseableMessage`, `Haunting`, `ParseResult`
  - Use TypeScript strict mode; every field typed exactly as specified in the design
  - Create `vitest.config.ts` at the workspace root if it does not already exist, configured for TypeScript with no path aliases — all imports inside `src/lib/` use relative paths (e.g. `./types`, `./dedupe`, `../lib/alertParser`) and never the `@/` alias
  - _Requirements: 1.1–1.16, 2.1–2.6, 3.1–3.17, 4.1–4.2_

- [ ] 2. Implement `formatNaira`
  - [ ] 2.1 Implement `formatNaira(kobo: number): string` in `src/lib/formatNaira.ts`
    - Accept integer kobo, return `"NGN X,XXX.XX"` with comma separators and exactly two decimal places
    - Handle zero: return `"NGN 0.00"`
    - _Requirements: 2.5, 2.6_
  - [ ] 2.2 Write unit tests for `formatNaira` in `src/lib/formatNaira.test.ts`
    - Zero kobo → `"NGN 0.00"`
    - 150000 → `"NGN 1,500.00"`
    - 123456 → `"NGN 1,234.56"`
    - Large value with multiple comma groups
    - _Requirements: 2.5, 2.6_

- [ ] 3. Implement Alert Parser helpers
  - [ ] 3.1 Implement `parseNgnAmount(text: string): AmountResult` in `src/lib/alertParser.ts`
    - Strip `NGN`, `₦`, and all commas; detect non-NGN currency and return `{ ok: false, reason: "unsupported currency" }`
    - Validate naira string against `/^\d+$/` and kobo string (if present) against `/^\d{1,2}$/`; return `{ ok: false, reason: "invalid amount" }` on failure
    - Compute kobo with integer arithmetic only: `parseInt(nairaStr) * 100 + parseInt(koboStr.padEnd(2,"0").slice(0,2))`
    - Return `{ ok: false, reason: "invalid amount" }` if result exceeds `Number.MAX_SAFE_INTEGER`
    - _Requirements: 2.1–2.4_
  - [ ] 3.2 Implement `normaliseMerchant(raw: string): string` in `src/lib/alertParser.ts`
    - Lowercase; remove all-digit tokens; remove ref-style tokens (letters immediately followed by digits); strip punctuation; collapse whitespace; trim
    - Return empty string when nothing remains (caller adds to unparseable with reason `"missing merchant"`)
    - _Requirements: 1.9_
  - [ ] 3.3 Implement `deriveDisplayName(raw: string): string` in `src/lib/alertParser.ts`
    - Remove all-digit tokens and ref-style tokens; trim; truncate to 60 characters
    - _Requirements: 1.9, 1.10_
  - [ ] 3.4 Implement `parseAlertDate(text: string, refDate: string): string | "invalid" | "missing"` in `src/lib/alertParser.ts`
    - Parse `DD/MM/YYYY`, `DD-Mon-YYYY`, `YYYY-MM-DD`, and `DD/MM` formats
    - For `DD/MM`, resolve year using `refDate`; if that places the date in the future, use previous year
    - Return `"invalid"` for impossible dates (month 13, Feb 30, etc.); return `"missing"` when no date field found
    - Return ISO-8601 `YYYY-MM-DD` string on success
    - _Requirements: 1.5, 1.6, 1.7, 1.8_
  - [ ] 3.5 Implement `splitMessages(raw: string): string[]` in `src/lib/alertParser.ts`
    - Split on blank lines (zero non-whitespace characters) or alert-header patterns (`"Debit Alert"`, `"Account Debit"`, `"Transaction Alert"`)
    - Treat any line containing `"debited"` followed by an NGN/₦ amount as a self-contained Format B message boundary
    - Trim each segment; track 1-based line offset per segment
    - _Requirements: 1.1_
  - [ ] 3.6 Wire `alertParser.ts` to use the shared deduplication helper
    - `deduplicateRecords` will be in `src/lib/dedupe.ts` (see task 7.8); in this task, wire `alertParser.ts` to import and use it via `import { deduplicateRecords } from './dedupe'`
    - _Requirements: 1.15_

- [ ] 4. Implement `parseMessage` and `parseAlerts` entry point
  - [ ] 4.1 Implement `parseMessage(msg: string, lineOffset: number, refDate: string): DebitRecord | UnparseableMessage | null` in `src/lib/alertParser.ts`
    - Return type is `DebitRecord | UnparseableMessage | null` where `null` means a credit alert (caller silently excludes it)
    - Run debit/credit detection first (case-insensitive phrases `"debited"`, `"Debit Alert"`, `"Account Debit"` for debit; `"credited"`, `"Credit Alert"` for credit); bare words `"debit"` / `"credit"` alone do NOT match
    - If both debit and credit patterns match, return `UnparseableMessage` with reason `"ambiguous alert type"`
    - If neither matches, return `UnparseableMessage` with reason `"unrecognised format"`
    - If credit only, return `null`
    - For debit, attempt Format A (labelled fields), then Format B (one-line narrative), then Format C (email-style)
    - If `normaliseMerchant` returns an empty string, return `UnparseableMessage` with reason `"missing merchant"`
    - Pass through `parseNgnAmount` failure reasons directly: `"invalid amount"`, `"unsupported currency"`
    - Pass through `parseAlertDate` sentinel reasons directly: `"invalid date"`, `"missing date"`
    - Return `UnparseableMessage` if no format matches
    - _Requirements: 1.1–1.14_
  - [ ] 4.2 Implement `parseAlerts(rawText: string, referenceDate: string): ParseResult` in `src/lib/alertParser.ts`
    - Validate `referenceDate` is a real ISO-8601 `YYYY-MM-DD` date; return `{ records: [], unparseable: [{ lineNumber: 1, reason: "invalid reference date", rawText: "" }] }` on failure
    - Short-circuit if `rawText.length > 200_000`: return `{ records: [], unparseable: [{ lineNumber: 1, reason: "input too large", rawText: "" }] }`
    - Wrap the full pipeline in try/catch; add any unexpected exception as unparseable with reason `"internal error"`
    - Call `splitMessages`, then `parseMessage` on each segment, then `deduplicateRecords`
    - _Requirements: 1.1–1.16_

- [ ] 5. Write unit tests for the Alert Parser
  - [ ] 5.1 Write unit tests for Alert Parser helpers in `src/lib/alertParser.test.ts`
    - `parseNgnAmount`: NGN with/without kobo, commas, non-NGN currency, invalid amount
    - `normaliseMerchant`: digit removal, ref-style token removal, punctuation stripping, empty result
    - `deriveDisplayName`: 6+ digit run removed, truncated at 60 chars
    - `parseAlertDate`: all four formats, year resolution for DD/MM, impossible date, missing date
    - `splitMessages`: blank-line split, header-pattern split, Format B consecutive alerts
    - `deduplicateRecords`: removes same triple, keeps different triples
    - _Requirements: 1.1–1.16, 2.1–2.4_
  - [ ] 5.2 Write unit tests for `parseAlerts` entry point in `src/lib/alertParser.test.ts`
    - Single well-formed Format A alert → one DebitRecord
    - Single well-formed Format B alert → one DebitRecord
    - Single well-formed Format C alert → one DebitRecord
    - Multiple alerts separated by blank lines → correct count
    - Non-NGN currency → one UnparseableMessage with reason `"unsupported currency"`
    - Credit alert → excluded from both arrays
    - Ambiguous alert → UnparseableMessage with reason `"ambiguous alert type"`
    - Empty / whitespace-only input → empty arrays
    - Duplicate records → deduplicated to one
    - Invalid referenceDate → `{ records: [], unparseable: [{ reason: "invalid reference date" }] }`
    - rawText > 200,000 chars → `{ records: [], unparseable: [{ reason: "input too large" }] }`
    - Leading/trailing whitespace on lines → no parse error
    - _Requirements: 1.1–1.16_

- [ ] 6. Checkpoint — Alert Parser complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement Haunting Detector helpers
  - [ ] 7.1 Implement `roundHalfUp(n: number): number` and `computeMedian(amounts: number[]): number` in `src/lib/hauntingDetector.ts`
    - `roundHalfUp`: `Math.floor(n + 0.5)`
    - `computeMedian`: sort the array, return middle value for odd length; for even length, average of two middle values using `roundHalfUp`
    - _Requirements: 3.7_
  - [ ] 7.2 Implement `filterByTolerance(records: DebitRecord[], median: number): DebitRecord[]` in `src/lib/hauntingDetector.ts`
    - Return records whose `amount` is within ±10% of `median`
    - _Requirements: 3.3, 3.8_
  - [ ] 7.3 Implement `computeGaps(sortedDates: string[]): number[]` and `classifyInterval(gaps: number[]): Interval | null` in `src/lib/hauntingDetector.ts`
    - `computeGaps`: compute UTC day-difference between consecutive ISO-8601 dates using `Date.UTC`; never local time
    - `classifyInterval`: return `"weekly"` if every gap is 5–9, `"monthly"` if 25–35, `"yearly"` if 355–375; null otherwise
    - _Requirements: 3.4, 3.5, 3.6, 3.17_
  - [ ] 7.4 Implement `computeNextDate(lastDate: string, interval: Interval): string` in `src/lib/hauntingDetector.ts`
    - Weekly: `lastDate + 7` days using UTC day arithmetic
    - Monthly: same day + 1 calendar month with month-end clamping (Jan 31 → Feb 28/29)
    - Yearly: same day + 1 year with leap-year clamping (Feb 29 → Feb 28 in non-leap years)
    - Return ISO-8601 string
    - _Requirements: 3.9, 3.10, 3.11_
  - [ ] 7.5 Implement `computeMonthlyCost(typicalAmount: number, interval: Interval): number` in `src/lib/hauntingDetector.ts`
    - Weekly: `roundHalfUp((typicalAmount * 52) / 12)`
    - Monthly: `typicalAmount`
    - Yearly: `roundHalfUp(typicalAmount / 12)`
    - _Requirements: 3.12_
  - [ ] 7.6 Implement `assignStatus(nextDate: string, interval: Interval, refDate: string): HauntingStatus` in `src/lib/hauntingDetector.ts`
    - Compute one full interval period past `nextDate`; if `refDate` exceeds that, return `"lapsed"`; otherwise `"active"`
    - All comparisons use UTC day numbers
    - _Requirements: 3.13_
  - [ ] 7.7 Implement `stableId(normalisedMerchant: string, interval: Interval): string` in `src/lib/hauntingDetector.ts`
    - Return `${normalisedMerchant}-${interval}` with spaces replaced by hyphens
    - _Requirements: 3.14_
  - [x] 7.8 Create shared deduplication helper in `src/lib/dedupe.ts`
    - Implement `deduplicateRecords(records: DebitRecord[]): DebitRecord[]` in `src/lib/dedupe.ts`
    - Removes records sharing the same `(normalisedMerchant, date, amount)` triple
    - Export it from `dedupe.ts`; import it in both `alertParser.ts` (replacing task 3.6's local implementation) and `hauntingDetector.ts` (replacing the duplicate in task 7.8)
    - Both modules use a relative import: `import { deduplicateRecords } from "./dedupe"`
    - Delete or do not create the duplicate `deduplicateRecords` in `hauntingDetector.ts`
    - _Requirements: 1.15, 3.2_

- [ ] 8. Implement `sortHauntings` and `detectHauntings` entry point
  - [ ] 8.1 Implement `sortHauntings(hauntings: Haunting[]): Haunting[]` in `src/lib/hauntingDetector.ts`
    - Sort by `estimatedMonthlyCost` descending, then `id` ascending
    - _Requirements: 4.2_
  - [ ] 8.2 Implement `detectHauntings(records: DebitRecord[], referenceDate: string): Haunting[]` in `src/lib/hauntingDetector.ts`
    - Validate `referenceDate`; return `[]` on failure
    - Call `groupByMerchant`, then per group:
      1. `deduplicateRecords` on the group
      2. Compute initial median via `computeMedian` on all amounts in the de-duplicated group
      3. Apply `filterByTolerance` to get qualifying charges
      4. Check ≥3 qualifying charges; skip group if fewer
      5. Recompute `typicalAmount` as `computeMedian` of the qualifying charges' amounts only (not the whole group)
      6. Sort qualifying charges by date ascending; compute `computeGaps` from those sorted dates; call `classifyInterval`; skip group if null interval
      7. `lastChargeDate` is the most recent date in the entire de-duplicated group (requirement 3.9), not just the qualifying charges
      8. Determine `displayName` from most recent charge in the whole de-duplicated group (alphabetically first if tied on date)
      9. Sort `sourceCharges` (all de-duplicated records, including out-of-tolerance) by date ascending then amount ascending
      10. Build `Haunting` object; call `computeNextDate`, `computeMonthlyCost`, `assignStatus`, `stableId`
      11. Wrap per-group processing in try/catch so one bad group cannot poison others
    - Call `sortHauntings` on the result before returning
    - _Requirements: 3.1–3.17, 4.1–4.2_

- [ ] 9. Write unit tests for the Haunting Detector
  - [ ] 9.1 Write unit tests for Haunting Detector helpers in `src/lib/hauntingDetector.test.ts`
    - `computeMedian`: odd and even arrays, round-half-up for even
    - `filterByTolerance`: boundary values at exactly ±10%
    - `computeGaps`: gaps across month boundaries, year boundaries
    - `classifyInterval`: weekly, monthly, yearly, inconsistent → null
    - `computeNextDate`: monthly Jan 31 → Feb 28/29, yearly Feb 29 → Feb 28 (non-leap), weekly arithmetic
    - `computeMonthlyCost`: all three intervals
    - `assignStatus`: active just before lapse boundary, lapsed just after
    - `stableId`: spaces → hyphens, deterministic output
    - _Requirements: 3.4–3.14_
  - [ ] 9.2 Write unit tests for `detectHauntings` entry point in `src/lib/hauntingDetector.test.ts`
    - Fewer than 3 qualifying charges → no haunting
    - 3 monthly charges → one haunting with correct `typicalAmount`, `nextExpectedDate`, `status`
    - Out-of-tolerance charges included in `chargeCount`/`sourceCharges`, excluded from median
    - Weekly interval detection
    - Yearly interval detection
    - Lapsed status when overdue by more than one interval
    - Output sorted by `estimatedMonthlyCost` desc, then `id` asc
    - Inconsistent gaps → no haunting
    - Invalid `referenceDate` → returns `[]`
    - `sourceCharges` sorted by date asc then amount asc
    - `displayName` taken from most recent charge; alphabetically first when dates tie
    - _Requirements: 3.1–3.17, 4.1–4.2_

- [ ] 10. Create the public API re-export
  - Create `src/lib/index.ts` re-exporting `parseAlerts`, `detectHauntings`, and `formatNaira`
  - _Requirements: 1.1, 2.5, 3.1_

- [ ] 11. Write integration test
  - Create `src/lib/integration.test.ts`
  - Compose a fictional multi-month scenario using all three alert formats (Format A, B, and C), mixing in credit alerts, one unsupported-currency alert, and one duplicate
  - Call `parseAlerts(rawText, referenceDate)` with the composed input and assert the returned `records` count and that `unparseable` contains the expected reasons
  - Call `detectHauntings(records, referenceDate)` and assert:
    - The expected number of hauntings are returned
    - At least one haunting has `interval: "monthly"` with the correct `typicalAmount`
    - The hauntings are sorted by `estimatedMonthlyCost` descending then `id` ascending
    - Each haunting has `chargeCount === sourceCharges.length`
  - All fixtures use fictional data only (fictional bank names, fictional merchants, invented references)
  - _Requirements: 1.1–1.16, 3.1–3.17, 4.1–4.2, 5.1–5.3_

- [ ] 12. Checkpoint — Core implementation complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Write property-based tests — formatNaira and Alert Parser
  - [ ] 13.1 Write Property 1 (formatNaira round-trip) in `src/lib/alertParser.property.test.ts`
    - Arbitrary: `fc.integer({ min: 0, max: 999_999_999 })`
    - Assert `parseNgnAmount(formatNaira(kobo))` returns `{ ok: true, kobo }` for all generated values
    - `{ numRuns: 100 }`
    - **Property 1: formatNaira/parseNgnAmount round-trip**
    - **Validates: Requirements 2.4**
  - [ ] 13.2 Write Property 2 (parser never throws) in `src/lib/alertParser.property.test.ts`
    - Arbitrary: `fc.string()` and a date-string mapped from `fc.date({ min: new Date("2000-01-01"), max: new Date("2099-12-31") })`
    - Assert `parseAlerts` does not throw and returns an object where `records` and `unparseable` are both arrays (they may be non-empty for inputs that happen to match a debit format)
    - `{ numRuns: 100 }`
    - **Property 2: Parser never throws**
    - **Validates: Requirements 1.16**

- [ ] 14. Write property-based tests — Haunting Detector
  - [ ] 14.1 Write Property 3 (haunting requires ≥3 qualifying charges) in `src/lib/hauntingDetector.property.test.ts`
    - Build `debitRecordArbitrary`; generate arrays where every merchant group has 1–2 records
    - Assert `detectHauntings` returns `[]`
    - `{ numRuns: 100 }`
    - **Property 3: Haunting detection requires at least 3 qualifying charges**
    - **Validates: Requirements 3.3**
  - [ ] 14.2 Write Property 4 (shuffle invariance) in `src/lib/hauntingDetector.property.test.ts`
    - Arbitrary: `fc.array(debitRecordArbitrary, { minLength: 0, maxLength: 30 })`; apply Fisher-Yates shuffle inside the property
    - Assert shuffled and unshuffled calls produce hauntings with the same ids and values
    - `{ numRuns: 100 }`
    - **Property 4: Haunting detection is order-independent**
    - **Validates: Requirements 4.1**
  - [ ] 14.3 Write Property 5 (deduplication idempotence) in `src/lib/hauntingDetector.property.test.ts`
    - Arbitrary: same array; concat with itself to double every record
    - Assert `detectHauntings(doubled, refDate)` equals `detectHauntings(original, refDate)`
    - `{ numRuns: 100 }`
    - **Property 5: Deduplication is idempotent**
    - **Validates: Requirements 3.2**
  - [ ] 14.4 Write Property 6 (generated monthly series yields exactly one haunting) in `src/lib/hauntingDetector.property.test.ts`
    - Arbitrary: `fc.integer({ min: 3, max: 12 })` count, `fc.integer({ min: 1, max: 100_000_000 })` fixed amount, dates by adding `fc.integer({ min: 28, max: 31 })` days successively from a base date
    - Assert result has exactly one haunting with `interval === "monthly"`
    - `{ numRuns: 100 }`
    - **Property 6: Generated monthly series yields exactly one haunting**
    - **Validates: Requirements 3.5**
  - [ ] 14.5 Write Property 7 (output is sorted correctly) in `src/lib/hauntingDetector.property.test.ts`
    - Arbitrary: `fc.array(debitRecordArbitrary, { minLength: 0, maxLength: 30 })`
    - For every adjacent pair `[a, b]`, assert `a.estimatedMonthlyCost > b.estimatedMonthlyCost || (a.estimatedMonthlyCost === b.estimatedMonthlyCost && a.id <= b.id)`
    - `{ numRuns: 100 }`
    - **Property 7: Output is sorted correctly**
    - **Validates: Requirements 4.2**
  - [ ] 14.6 Write Property 8 (chargeCount equals sourceCharges.length) in `src/lib/hauntingDetector.property.test.ts`
    - Arbitrary: `fc.array(debitRecordArbitrary, { minLength: 0, maxLength: 30 })`
    - Assert every haunting satisfies `haunting.chargeCount === haunting.sourceCharges.length`
    - `{ numRuns: 100 }`
    - **Property 8: chargeCount equals sourceCharges.length**
    - **Validates: Requirements 3.15, 3.16**
  - [ ] 14.7 Write Property 9 (every haunting has ≥3 charges within tolerance) in `src/lib/hauntingDetector.property.test.ts`
    - Arbitrary: `fc.array(debitRecordArbitrary, { minLength: 0, maxLength: 30 })`
    - Assert every haunting: filtering `sourceCharges` to `amount` within ±10% of `typicalAmount` yields ≥3 records
    - `{ numRuns: 100 }`
    - **Property 9: Every haunting has at least 3 charges within tolerance**
    - **Validates: Requirements 3.3, 3.8**

- [ ] 15. Final checkpoint — All tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Add dev-time tooling
  - [ ] 16.1 Add `"typecheck": "tsc --noEmit"` to the `scripts` section of `package.json`
  - [ ] 16.2 Create a Kiro agent hook at `.kiro/hooks/test-on-save.json` that runs `npm test` whenever a file matching `src/lib/**` is saved (trigger: `PostFileSave`, matcher: `src/lib/`)
    - Hook JSON format: `{ "version": "v1", "hooks": [{ "name": "Run tests on lib save", "trigger": "PostFileSave", "matcher": "src/lib/", "action": { "type": "command", "command": "npm test" } }] }`
  - _Requirements: 5.1–5.3_

## Notes

- All imports within `src/lib/` use relative paths. No `@/` alias is used anywhere in the lib layer.
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical breaks
- Property tests validate universal correctness properties; unit tests validate specific examples and edge cases
- All test fixtures must use fictional data only: fictional bank names (e.g. "FableBank"), fictional merchants (e.g. "ZapTunes", "NeonBites Delivery"), invented references — per Requirement 5

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "7.8"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["5.1", "5.2"] },
    { "id": 6, "tasks": ["6"] },
    { "id": 7, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7"] },
    { "id": 8, "tasks": ["8.1"] },
    { "id": 9, "tasks": ["8.2"] },
    { "id": 10, "tasks": ["9.1", "9.2"] },
    { "id": 11, "tasks": ["10"] },
    { "id": 12, "tasks": ["11"] },
    { "id": 13, "tasks": ["12"] },
    { "id": 14, "tasks": ["13.1", "13.2"] },
    { "id": 15, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7"] },
    { "id": 16, "tasks": ["15"] },
    { "id": 17, "tasks": ["16.1", "16.2"] }
  ]
}
```
