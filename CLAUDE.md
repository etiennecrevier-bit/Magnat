# Magnat

Single-player browser tycoon game in French (Quebec). The player grows a food truck into a business empire and learns finance and operations without being taught. Full design brief: `docs/game-design.md`.

## Commands
- `npm run dev`: local dev server
- `npm run build`: production build into `dist/`
- `npm test`: Vitest
- `npm run lint`, `npm run typecheck`
- `npm run sim -- --days 3650 --seed 42`: headless simulation (from phase 1)

## Architecture rules (non-negotiable)
1. `src/engine/` is pure TypeScript game logic. It never imports React, the DOM or anything from `src/ui/`.
2. `src/finance/` owns the journal and the financial statements. Only engine and finance write journal entries; the UI only reads.
3. The engine is deterministic: no `Date.now()`, no `Math.random()`, no wall clock. Randomness comes from the seeded RNG in `src/engine/rng.ts`. Game time advances only through `tick()`.
4. Money is integer cents (`Cents`). Never use floats for money. Formatting happens only in the UI.
5. Every tunable number (prices, costs, pacing, demand) lives in JSON under `src/content/`. No magic numbers in engine code.
6. `src/engine/types.ts` is the shared contract. Do not change it unless your card explicitly says so.
7. Every journal entry balances (debits = credits). Posting an unbalanced entry throws.
8. Any card that adds a field to `GameState` extends the save schema and its tests. Bump `saveVersion` when an older save can no longer load.

## Language
- Code, comments, commits, pull requests and docs: English.
- Everything the player sees: French (Quebec). Statements use real accounting terms: état des résultats, bilan, état des flux de trésorerie, encaisse, comptes clients, comptes fournisseurs, stocks. Never explain them in the UI.
- Money displays in fr-CA format: `1 234,56 $`. Negative amounts in parentheses on statements.

## Workflow
- One card = one branch = one pull request. Branch: `feat/<area>-<short-task>` with area in engine, finance, ui, content, tooling.
- Stay inside the folder(s) named on the card. If you must touch another folder, explain why in the PR description.
- Every feature ships with tests. Lint, typecheck and tests pass before the PR is opened.
- Keep PRs small. If a card is bigger than one run, stop, ship what is coherent, and describe the remainder in the PR.

## Review checklist (used by review cards)
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass.
- [ ] From phase 1: the 10-year invariant test passes (balance sheet balances every day, simulation is deterministic).
- [ ] No React, DOM or `src/ui/` imports in `src/engine/` or `src/finance/`; no game rules in `src/ui/`.
- [ ] No floats for money; no `Math.random()` or `Date.now()` in engine or finance.
- [ ] New tunable numbers are in `src/content/` JSON, not in code.
- [ ] The branch stayed in its folder(s) or justified why not.
- [ ] Player-facing text is in French; code and comments in English.
