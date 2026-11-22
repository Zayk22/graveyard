# Requirements Document

## Introduction

Graveyard Core Logic provides two pure TypeScript modules that live in `src/lib` with no React dependencies. The Alert Parser ingests raw text pasted from bank debit-alert SMS or email messages along with a Reference_Date, splits the input into individual alert messages, and returns structured debit records plus a list of unparseable messages with reasons. The Haunting Detector analyses those records, groups them by merchant, and identifies recurring charges — called "hauntings" — that repeat on a weekly, monthly, or yearly schedule with a consistent amount. A `formatNaira` helper formats integer kobo values as naira strings and is used in round-trip property tests. Both modules use integer kobo for all money values and are exercised by Vitest unit tests and fast-check property-based tests.

## Glossary

- **Alert_Parser**: The pure function (or set of functions) that accepts raw alert text and a Reference_Date and returns parsed debit records plus unparseable messages.
- **Alert_Message**: A single bank debit-alert unit within the raw input, delimited by one or more blank lines or by a recognised alert-header pattern.
- **Haunting_Detector**: The pure function that accepts an array of Debit_Records and an explicit Reference_Date, and returns an array of Hauntings.
- **Debit_Record**: A structured object produced by the Alert_Parser containing: an integer kobo amount, an ISO-8601 date string, a Normalised_Merchant string, and a Display_Name string. It does not contain balance, fee, account-number fields, or the raw alert text.
- **Display_Name**: The original merchant or description text extracted from an Alert_Message, with any run of 6 or more consecutive digits removed and the result truncated to a maximum of 60 characters, stored alongside Normalised_Merchant for display purposes.
- **Haunting**: A structured object describing a recurring charge: a stable `id`, Normalised_Merchant, Display_Name, typical kobo amount, detected Interval, last charge date, next expected date, estimated monthly cost in kobo, `chargeCount`, `sourceCharges`, and `status`.
- **Haunting_Status**: One of two values — `"active"` (the next expected date is not overdue by more than one full Interval period relative to the Reference_Date) or `"lapsed"` (the next expected date is more than one full Interval period overdue).
- **Kobo**: The smallest Nigerian currency unit. 100 kobo = 1 naira. All monetary values in the system are stored and computed as integers in kobo, never as floats.
- **Normalised_Merchant**: A lowercase, whitespace-collapsed, punctuation-stripped version of the merchant or description string with changing reference tokens (transaction IDs, reference numbers, random numeric suffixes) removed, used for grouping recurring charges.
- **Interval**: One of three recurrence periods — `weekly` (approximately 7 days), `monthly` (approximately 28–31 days), or `yearly` (approximately 365 days).
- **Unparseable_Message**: An Alert_Message that the Alert_Parser cannot fully parse into a Debit_Record, reported with the line number where the message starts in the original input and a human-readable reason string.
- **Reference_Date**: An ISO-8601 date string passed explicitly to both the Alert_Parser and the Haunting_Detector representing today's date, so both functions remain pure and testable.
- **formatNaira**: A pure function with signature `formatNaira(kobo: number): string` that formats an integer kobo value as a naira string (e.g. `150000 → "NGN 1,500.00"`).

---

## Requirements

### Requirement 1: Parse Raw Alert Text into Debit Records

**User Story:** As a user, I want to paste one or more bank debit-alert messages into the app, so that the app can extract structured charge information without me manually entering data.

#### Acceptance Criteria

1. WHEN raw alert text is provided, THE Alert_Parser SHALL split it into Alert_Messages by treating one or more consecutive blank lines or a recognised alert-header pattern as a message boundary.
2. WHEN an Alert_Message contains a debit amount expressed in `NGN` or `₦` with optional comma digit-group separators, THE Alert_Parser SHALL convert that amount to an integer kobo value and store it in the Debit_Record.
3. WHEN an Alert_Message contains an amount field with a non-NGN currency symbol or code (including but not limited to `USD`, `GBP`, `EUR`, or `$`), THE Alert_Parser SHALL add that Alert_Message to Unparseable_Messages with reason `"unsupported currency"` and SHALL NOT produce a Debit_Record for it.
4. WHEN an Alert_Message contains a balance, fee, or account-number field in addition to the debit amount, THE Alert_Parser SHALL extract only the debit amount and SHALL NOT store balance, fee, account-number, or raw alert text in the Debit_Record.
5. WHEN an Alert_Message contains a date in any of the formats `DD/MM/YYYY`, `DD-Mon-YYYY`, or `YYYY-MM-DD`, THE Alert_Parser SHALL store the date as an ISO-8601 date string (`YYYY-MM-DD`).
6. WHEN an Alert_Message contains a date in the format `DD/MM` with no year component, THE Alert_Parser SHALL use the Reference_Date's year; if that would place the date in the future relative to the Reference_Date, THE Alert_Parser SHALL use the previous year instead.
7. WHEN an Alert_Message contains a date value that is impossible (e.g. month 13, February 30), THE Alert_Parser SHALL add that Alert_Message to Unparseable_Messages with reason `"invalid date"`.
8. WHEN an Alert_Message contains no recognisable date field, THE Alert_Parser SHALL add that Alert_Message to Unparseable_Messages with reason `"missing date"`.
9. WHEN an Alert_Message contains a merchant name or description field, THE Alert_Parser SHALL store a Normalised_Merchant string and a Display_Name string derived from that field.
10. WHEN the Alert_Parser derives a Display_Name from an Alert_Message, THE Alert_Parser SHALL truncate Display_Name to a maximum of 60 characters and SHALL remove any run of 6 or more consecutive digits from the Display_Name before truncation.
11. WHEN an Alert_Message matches a credit alert pattern rather than a debit alert pattern, THE Alert_Parser SHALL exclude that message from Debit_Records and SHALL NOT add it to Unparseable_Messages.
12. WHEN an Alert_Message is non-empty and does not match any debit-alert pattern and is not a credit alert, THE Alert_Parser SHALL add that message to Unparseable_Messages with the line number where the message starts in the original input and a reason string.
13. WHEN the input text is empty or contains only whitespace, THE Alert_Parser SHALL return an empty Debit_Records array and an empty Unparseable_Messages array.
14. THE Alert_Parser SHALL tolerate leading and trailing whitespace on each line within an Alert_Message without producing parse errors.
15. WHEN the Alert_Parser output contains two or more Debit_Records with the same Normalised_Merchant, same ISO-8601 date, and same kobo amount, THE Alert_Parser SHALL remove all but one of those duplicate records before returning the result.
16. FOR ALL input strings (including empty strings, strings containing only whitespace, strings with non-printable characters, and very long strings), THE Alert_Parser SHALL return a result object without throwing an exception.

---

### Requirement 2: Amount Parsing Correctness

**User Story:** As a developer, I want the amount parser to be numerically correct for any valid NGN currency string, so that kobo values are never corrupted by floating-point arithmetic.

#### Acceptance Criteria

1. WHEN a currency string represents an NGN amount with naira and kobo parts (e.g. `NGN 1,234.56`), THE Alert_Parser SHALL return exactly `(naira * 100 + kobo)` as an integer with no floating-point rounding error.
2. WHEN a currency string has no decimal part, THE Alert_Parser SHALL treat the kobo portion as zero and return `naira * 100`.
3. WHEN a currency string contains comma digit-group separators, THE Alert_Parser SHALL ignore the commas and parse the numeric value correctly.
4. FOR ALL valid NGN amount strings, parsing the string and formatting the resulting kobo value with `formatNaira` and parsing again SHALL produce the same kobo value (round-trip property).
5. THE formatNaira function SHALL accept an integer kobo value and return a string in the format `"NGN X,XXX.XX"` with comma digit-group separators and exactly two decimal places.
6. WHEN `formatNaira` receives a kobo value of zero, THE formatNaira function SHALL return `"NGN 0.00"`.

---

### Requirement 3: Haunting Detection

**User Story:** As a user, I want the app to find recurring charges automatically, so that I can see which subscriptions or regular debits I may have forgotten about.

#### Acceptance Criteria

1. WHEN the Haunting_Detector receives an array of Debit_Records and a Reference_Date, THE Haunting_Detector SHALL group records by Normalised_Merchant before evaluating recurrence.
2. WHEN the Haunting_Detector receives Debit_Records that contain duplicates (same Normalised_Merchant, same ISO-8601 date, same kobo amount), THE Haunting_Detector SHALL de-duplicate within each merchant group before evaluating recurrence, so that the detector produces correct results even if the caller did not de-duplicate first.
3. WHEN a merchant group contains fewer than 3 Debit_Records whose amounts are within ±10% of the median, THE Haunting_Detector SHALL NOT include that merchant in the returned hauntings array.
4. WHEN a merchant group contains 3 or more qualifying Debit_Records with consistent inter-charge gaps that fall within the weekly range (5–9 days), THE Haunting_Detector SHALL classify the Interval as `weekly`. "Consistent" means every consecutive gap between sorted charge dates falls within the same interval range.
5. WHEN a merchant group contains 3 or more qualifying Debit_Records with consistent inter-charge gaps that fall within the monthly range (25–35 days), THE Haunting_Detector SHALL classify the Interval as `monthly`. "Consistent" means every consecutive gap between sorted charge dates falls within the same interval range.
6. WHEN a merchant group contains 3 or more qualifying Debit_Records with consistent inter-charge gaps that fall within the yearly range (355–375 days), THE Haunting_Detector SHALL classify the Interval as `yearly`. "Consistent" means every consecutive gap between sorted charge dates falls within the same interval range.
7. WHEN a haunting is detected, THE Haunting_Detector SHALL compute the typical kobo amount (`typicalAmount`) as the median of the recorded amounts in that merchant group. For an even number of records, the median is the average of the two middle values, rounded half-up to the nearest integer kobo.
8. WHEN a haunting is detected and one or more Debit_Records in the group have amounts outside ±10% of the median, THE Haunting_Detector SHALL include those records in `chargeCount` and `sourceCharges` but SHALL exclude their amounts from the median recalculation used to set `typicalAmount`.
9. WHEN a haunting is detected, THE Haunting_Detector SHALL set the last-charge date to the most recent Debit_Record date in the group.
10. WHEN a haunting is detected and the Interval is `monthly` and the last-charge date is the 29th, 30th, or 31st of a month, THE Haunting_Detector SHALL compute the next expected date by clamping to the last valid day of the target month (e.g. adding 1 month to January 31 yields February 28, or February 29 in a leap year).
11. WHEN a haunting is detected and the Interval is `yearly` and the last-charge date is February 29, THE Haunting_Detector SHALL compute the next expected date as February 28 in a non-leap year.
12. WHEN a haunting is detected, THE Haunting_Detector SHALL compute the estimated monthly cost using round-half-up arithmetic: for `weekly` intervals as `round((typicalAmount * 52) / 12)`; for `monthly` intervals as `typicalAmount`; for `yearly` intervals as `round(typicalAmount / 12)`.
13. WHEN a haunting is detected, THE Haunting_Detector SHALL set `status` to `"active"` if the next expected date is not more than one full Interval period overdue relative to the Reference_Date, and SHALL set `status` to `"lapsed"` otherwise.
14. WHEN a haunting is detected, THE Haunting_Detector SHALL assign a stable `id` derived deterministically from the Normalised_Merchant and Interval (e.g. a hash or slug), such that the same merchant and interval always produce the same `id`.
15. WHEN a haunting is detected, THE Haunting_Detector SHALL set `chargeCount` to the total number of Debit_Records in that merchant group, including records with amounts outside the ±10% tolerance.
16. WHEN a haunting is detected, THE Haunting_Detector SHALL set `sourceCharges` to the array of all Debit_Records in that merchant group, including records with amounts outside the ±10% tolerance.
17. WHEN a merchant group has inter-charge gaps that do not consistently match any supported Interval, THE Haunting_Detector SHALL not include that merchant in the returned hauntings array.

---

### Requirement 4: Deterministic and Order-Independent Detection

**User Story:** As a developer, I want the haunting detector to produce consistent results regardless of input order, so that the output is reliable and testable.

#### Acceptance Criteria

1. FOR ALL arrays of Debit_Records and any Reference_Date, THE Haunting_Detector SHALL return the same set of hauntings regardless of the order in which records appear in the input array (order-independence property).
2. THE Haunting_Detector SHALL return hauntings sorted first by estimated monthly cost descending, then by `id` ascending, so that the output order is fully deterministic when two hauntings have the same estimated monthly cost.

---

### Requirement 5: Test Data Constraints

**User Story:** As a developer, I want all tests to use made-up sample alert formats, so that no real customer bank data ever appears in the codebase.

#### Acceptance Criteria

1. THE Alert_Parser tests SHALL use only fictional bank names, fictional merchant names, and invented transaction references.
2. THE Haunting_Detector tests SHALL use only Debit_Records constructed from made-up data.
3. THE test suite SHALL NOT include real Nigerian bank alert message text, real account numbers, or real personal names.
