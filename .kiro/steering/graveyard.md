# Graveyard rules
- Next.js App Router, TypeScript strict, Tailwind. No backend, no accounts: everything stays on the device (localStorage).
- Money is integer kobo, never floats. One helper formats naira.
- Never ask for or store bank logins or real account numbers. Demo data is made-up.
- Pure logic (parsing, detecting recurring charges) lives in src/lib, with no React.
- Every pure function has Vitest tests, and the parser and detector also have fast-check property tests.
- Design: dark, haunting, polished. Spooky elements must explain the function (hauntings = recurring charges, exorcise = cancel, graveyard = cancelled). Respect prefers-reduced-motion.
- No emojis in UI text or code.