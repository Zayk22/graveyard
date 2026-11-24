# Graveyard UI steering

## Concept
The app is a cross-section of a graveyard. A skyline of tombstones sits above ground,
one stone per haunting. A ledger sits below, with the money detail. The theme must
carry function: a stone's size and glow show its monthly cost and its status.

## Vocabulary (use these words everywhere, never synonyms)
- haunting: a detected recurring charge
- stone: a haunting drawn as a tombstone
- exorcise: cancel a haunting (the button, the toast and the history all say "exorcise")
- graveyard: the list of exorcised hauntings
- unreadable lines: alerts the parser rejected

Parser reason -> plain text shown to the user:
- unsupported currency -> "Not in naira"
- invalid amount -> "The amount could not be read"
- invalid date -> "The date does not exist"
- missing date -> "No date found"
- missing merchant -> "No merchant name found"
- ambiguous alert type -> "Looks like both a debit and a credit"
- unrecognised format -> "Does not look like a debit alert"
- input too large -> "That is too much text. Paste fewer alerts."
- invalid reference date, internal error -> "Something went wrong. Try again."

## Design tokens
- dusk #231F38, soil #15121D, panel #1C1928, grave #2D2A3D
- limestone #CBCEC4, stone-ink #26252E
- lamp #F2B45E (active glow), zobo #B3265A (danger/exorcise), moss #5E7A5B (buried), fog #A9AEC4 (muted text)
- Fonts: Marcellus (headings, stone names), Hanken Grotesk (everything else)
- Define tokens once as CSS variables or in the Tailwind config. No hard-coded hex values in components.

## Behaviour rules
- All money is shown with formatNaira only. Never format money by hand.
- Yearly cost = estimatedMonthlyCost * 12, in integer kobo.
- The monthly total counts active hauntings only (not lapsed, not exorcised).
- The reference date is today's UTC date, computed in exactly one place.
- Persist to localStorage under the key "graveyard:v1", every read and write inside try/catch.
- "Try with made-up alerts" generates sample alerts relative to today so they are never stale.
- Exorcise is a 1-second press-and-hold with a keyboard alternative (Enter to confirm).
  After it, show an Undo toast.
- Accessibility: visible focus rings, text contrast of at least 4.5:1, every stone reachable by keyboard.
- Motion: one orchestrated moment only (the stones rising on load). Respect prefers-reduced-motion.

## Don'ts
- No real bank data, no accounts, no network calls with user data.
- No generic card grids, no gradient washes, no emoji as icons.
- Do not change anything in src/lib/. The UI only imports from src/lib/index.ts.