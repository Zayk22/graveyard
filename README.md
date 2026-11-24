# Graveyard

Paste your bank debit alerts. Graveyard finds the charges that keep coming back
(your "hauntings"), shows what they cost you each month, and lets you exorcise
the ones you no longer want.

Everything runs in your browser. There are no accounts and no servers, and your
alerts never leave your device.

**Live demo:** https://graveyard-gamma.vercel.app/
**Built for:** Kiroween 2026, Costume Contest category

> All sample data in this project is made up. Never paste real bank messages
> into a demo.

## How it works

1. **Parse.** Alerts in three formats are turned into debit records. Amounts are
   stored as whole kobo (integers), never floats. Dates are handled as UTC days.
   Credits, unsupported currencies and unreadable lines are rejected with a
   specific reason.
2. **Detect.** Records are grouped by merchant. A group counts as a haunting
   when at least three charges sit within 10% of the median amount and their
   gaps fit a weekly, monthly or yearly rhythm.
3. **Cost.** Each haunting gets an estimated monthly cost, a next expected date
   and a status: active or lapsed.
4. **Exorcise.** Cancel a haunting and it is buried in the graveyard.

Supported alert shapes, all with made-up examples:

- Format A: lines labelled `Amt`, `Desc` and `Date`
- Format B: one line, such as `debited NGN 2,500.00 for NeonBites on 2024-06-03`
- Format C: lines labelled `Amount`, `Description` and `Value Date`

## Tech

Next.js (App Router), TypeScript (strict), Tailwind, Vitest and fast-check.

The core logic lives in `src/lib/` and has no UI dependencies:

- `alertParser.ts`: parsing and rejection reasons
- `hauntingDetector.ts`: grouping, tolerance, intervals, cost and status
- `formatNaira.ts`: the only place money is formatted
- `index.ts`: the public API (`parseAlerts`, `detectHauntings`, `formatNaira`)

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # run the test suite
npx tsc --noEmit   # type check
```

## Built with Kiro

This project was built spec-first with Kiro's agent.

- **Specs:** `.kiro/specs/graveyard-core-logic/` holds the requirements, design
  and task list for the parser and detector.
- **Steering:** `.kiro/steering/` holds the project rules (integer kobo, UTC
  dates, vocabulary, design tokens and behaviour) that Kiro follows on every
  task.
- **Tests:** 198 tests currently pass. Property-based tests with fast-check are
  part of the spec. <!-- update when 13/14 are done -->
- **Hooks:** a test-on-save hook runs the suite when files in `src/lib/` change.
  <!-- add once task 16.2 is done -->

I also used Claude as a reviewer and prompt helper. Kiro's agent wrote the code.

## Licence

MIT. See `LICENSE`.

