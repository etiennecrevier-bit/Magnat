# Architecture

How the game is put together at the end of phase 1: the folders and who may import whom, the frozen contract in `src/engine/types.ts`, the order in which a day is played, how the books are written and read, where the tunable numbers come from and what the 10-year invariant test checks. `tools/architecture-doc.test.ts` keeps parts of this page in step with the code (see the last section).

## Layout and dependencies

| Folder | Holds | Imports from other folders |
| --- | --- | --- |
| `src/engine/` | Game rules: the clock, a day of business, lots and FIFO, money, the seeded generator, the shared types | `src/finance/` (journal, accounts) and `src/content/schema.ts` |
| `src/finance/` | The journal, the chart of accounts, the three statements | `src/engine/money.ts` and `src/engine/types.ts` only |
| `src/content/` | Tunable numbers as JSON, and the zod schema that validates them | `src/engine/money.ts` only, to type money as `Cents` |
| `src/ui/` | React screens, the Zustand store and the real-time loop | engine, finance and content |
| `tools/sim/` | The headless simulation behind `npm run sim` | engine and finance |
| `tests/` | The 10-year invariant test | engine, finance and `tools/sim/` |

Engine and finance code never imports React, React DOM, Zustand or anything from `src/ui/`, never touches the DOM and never reads the wall clock or `Math.random()`. Two checks hold the line:
- `eslint.config.js` bans those imports, `window`, `document`, `globalThis`, dynamic `import()`, `Math.random()`, `Date`, `performance.now()` and `crypto`'s random functions in both folders.
- `tsconfig.engine.json` typechecks both folders (tests excepted) with the ES2023 library only, so browser globals such as `localStorage`, `fetch` or `setTimeout` do not compile there.

`tools/lint-guardrails.test.ts` and `tools/engine-types.test.ts` prove the two checks stay wired up.

## The contract

`src/engine/types.ts` holds the types the engine, the books, the UI and the tools share. It is frozen at the end of phase 1: changing it needs a dedicated card. It holds types only, with no code.

The engine is deterministic: the same seed, played with the same code and the same content, always posts the same journal, so it always gives the same `journalHash`. A replay is only guaranteed within one version of the code and content, though. Changing the order of the generator draws, the order of a day's entries or a number in `src/content/` can change the journal a seed produces without touching `types.ts`.

## The shape of `GameState`

### `GameState`

The whole game. `createInitialState()` and `tick()` return it at the start of business day `day`, with `lastDay` summing up the day before. `playDay()`, which `tick()` calls, returns it at the close of `day`: `day` has not moved yet and `lastDay.day` equals `day`. Only `tick()` moves on to the next day.

Every function that takes a state returns a new one and never mutates it. The fields are `readonly`, so TypeScript rejects writes, but at run time only the journal (with its entries and lines) is frozen.

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | `Day` | The business day `tick()` plays next. |
| `seed` | `number` | The seed the game started from, an integer in [0, 2^32), kept so the game can be replayed. |
| `rngState` | `number` | The state of the seeded generator (mulberry32 in `src/engine/rng.ts`): one uint32 a save restores as is. |
| `journal` | `Journal` | The books: every entry posted since day 0, in order. |
| `inventory` | `readonly Lot[]` | Stock on hand, oldest lot first, with no empty lot. Its cost is the balance of Stocks (1200). |
| `lastDay` | `DaySummary \| null` | The last business day played. Null until the first day is played. |

### `Lot`

Units of one product bought together, carried at what they cost.

| Field | Type | Meaning |
| --- | --- | --- |
| `product` | `ProductId` | The product. |
| `quantity` | `number` | Units left; always above zero. |
| `unitCost` | `Cents` | What each unit cost when the lot was bought. |
| `boughtOnDay` | `Day` | The day the lot was bought. A product sells for `shelfLifeDays` days counting that day, so a lot bought on day B is written off at the close of day B + `shelfLifeDays` − 1. |

### `DaySummary`

What happened on one business day, as of its close. The Aujourd'hui panel (`src/ui/TodayPanel.tsx`) shows it, and `simulate()` keeps one per day.

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | `Day` | The business day it sums up. |
| `sold` | `PerProduct` | Units sold. |
| `revenue` | `Cents` | What customers paid for the units sold. |
| `lostSales` | `PerProduct` | Units customers asked for after the product had sold out. |
| `spoiled` | `PerProduct` | Units written off at the close because their shelf life was over. |

### `Day` and `PerProduct`

- `Day` is a whole number counting from 0. `toCalendar()` in `src/engine/clock.ts` turns it into a date: day 0 is Monday, May 1st, year 1, when food truck season starts. Years have 365 days with real month lengths and no leap years. Weekdays follow ISO 8601, from 1 = Monday to 7 = Sunday.
- `PerProduct` is a read-only record holding a whole number for each `ProductId`. The products (`cafe` and `croissant`) are the zod enum in `src/content/schema.ts`. `PRODUCTS` in `src/engine/inventory.ts` lists them in the order the game walks through them, and `perProduct()` builds a record.

### The starting state

`createInitialState(seed)` in `src/engine/clock.ts` throws a RangeError unless `seed` is an integer in [0, 2^32). Otherwise it returns:
- `day` 0, the `seed`, and `rngState` from `seedRng(seed)`, which is the seed itself;
- `journal` from `openingJournal()`: one entry on day 0, *Mise de fonds*, Dr 1000 Encaisse / Cr 3000 Capital-actions for `startingCapitalCents`;
- an empty `inventory` and a null `lastDay`.

## Order of operations in `tick()`

<!-- tools/architecture-doc.test.ts plays days and checks that the memos in
italics below are exactly the entries each day posts, in the same order. Keep
every memo in italics, once, and nothing else in italics in this section. -->

`tick(state)` in `src/engine/clock.ts` calls `playDay(state, weekday)` in `src/engine/day.ts`, with the weekday of `state.day` from `toCalendar()`. It then returns the state `playDay` gave back with `day` + 1. `playDay` goes through these steps in this order. Every entry it posts is dated `state.day`.

1. **Morning restock.** For each product in `PRODUCTS` order, its rule in `restockPolicy` sets the order size. `buyDaily` buys `quantity` units. `topUp` buys up to `upTo` units on hand when the units on hand are below `whenBelow`. Each purchase becomes a new lot at the end of `inventory`, at the product's `unitCostCents`. Entry *Achat de marchandises*: Dr 1200 Stocks / Cr 1000 Encaisse for what the day's purchases cost.
2. **Walk-in demand.** Traffic is `weekendCustomers` on Saturday and Sunday and `weekdayCustomers` otherwise. `normal()` draws twice for a noise factor with a mean of 1 and a standard deviation of `noiseStdDevRatio`, and the day's customers are traffic × noise, rounded and never below zero. Then each customer draws once per product, in `PRODUCTS` order, and wants one unit when the draw is below the product's `purchaseProbability`. No other step draws, so these are all of a day's draws. This step posts nothing.
3. **Sales.** Product by product, in `PRODUCTS` order, customers get what they want from the stock on hand, oldest lot first (FIFO, `takeFifo()` in `src/engine/inventory.ts`), at the product's `basePriceCents`. The units still wanted after a product sells out are lost sales. Entry *Ventes au comptant*: Dr 1000 Encaisse / Cr 4000 Ventes for the revenue. Then entry *Coût des marchandises vendues*: Dr 5000 Coût des marchandises vendues / Cr 1200 Stocks for what the units sold cost, each at its own lot's unit cost. These are two entries rather than one, so the other lines of each cash entry stay on one row of the état des flux de trésorerie.
4. **Fixed costs.** Entry *Loyer, permis, carburant et entretien*: Dr 6100 Loyer et permis for `rentAndPermit` and Dr 6200 Carburant et entretien for `fuelAndMaintenance` / Cr 1000 Encaisse for both, from `dailyFixedCostsCents`.
5. **Spoilage at the close.** `removeExpired()` in `src/engine/inventory.ts` writes off every lot whose shelf life ends that day, as `Lot` describes above. Entry *Marchandises périmées*: Dr 5100 Pertes sur stocks / Cr 1200 Stocks for what those lots cost.
6. **The new state.** `playDay` returns the state with the new `rngState`, `journal`, `inventory` and a `lastDay` for `state.day`.

What every step shares:
- A line with a zero amount is dropped, and an entry left with no line is not posted. A day with nothing bought or nothing spoiled has no entry for that step.
- Nothing checks the cash first: purchases and fixed costs are paid even when Encaisse goes negative.

Outside unit tests, three callers advance the game:
- `advance(days)` in the UI store (`src/ui/store.ts`). The real-time loop in `src/ui/gameLoop.ts` calls it with the whole days that have passed at the current speed, paced by `src/content/pacing.json`.
- `simulate()` in `tools/sim/simulate.ts`.
- The invariant test.

## How journal entries are created

`src/finance/journal.ts` owns the books. A `Journal` is a branded type that only `emptyJournal()` and `postEntry(journal, entry)` make: a spread of a journal does not type-check as one, and `postEntry()`, `balance()`, `trialBalance()` and the statements throw a TypeError on any other object, such as a cast or untyped data. `postEntry` returns a new journal with the entry after the others. It throws an Error that names the memo and the day unless:
- the day is a whole number of at least 0, no earlier than the last entry's day;
- the entry has at least one line;
- every line uses an account from the chart;
- every amount is a whole, non-negative number of cents, and every line has an amount on exactly one side;
- the totals stay within the safe integer range, and the debits equal the credits.

The journal, its entries and their lines are frozen. `postEntry` copies the entry, so later changes to the object passed in never reach the books.

In the game, only the engine posts entries. It goes through the private helpers `post()`, `debit()` and `credit()` in `src/engine/day.ts`, and keeps the memos the player reads in that file's `MEMO` table. Each step of the day posts its own entries, as listed above.

The chart of accounts is in `src/finance/accounts.ts`: 18 accounts with their codes, French names, types and normal balances. Phase 1 posts to eight of them: 1000 Encaisse, 1200 Stocks, 3000 Capital-actions, 4000 Ventes, 5000 Coût des marchandises vendues, 5100 Pertes sur stocks, 6100 Loyer et permis and 6200 Carburant et entretien. The other ten are there for the phases to come.

Everything else only reads the books:
- `balance()` and `trialBalance()` in `src/finance/journal.ts` sum the entries up to a day.
- `incomeStatement()`, `balanceSheet()` and `cashFlowStatement()` in `src/finance/statements.ts` build the état des résultats, the bilan and the état des flux de trésorerie (direct method) as plain data: French labels and amounts in cents. There are no closing entries: the bilan adds the net income since the first entry to Bénéfices non répartis.
- The UI reads the books through these functions and never posts. It formats money in fr-CA in `src/ui/formatMoney.ts`.

Money is `Cents` from `src/engine/money.ts`: a branded number that only `cents()` and the helpers built on it (`add`, `sub`, `mulInt`, `mulRatio`, `sum`) make. Each of them throws a RangeError rather than leave the safe integer range, so every amount is a whole number of cents.

## Where content is loaded

- `src/content/foodtruck.json` holds the food truck's numbers: starting capital, products, fixed costs, walk-ins, purchase probabilities and restocking rules. `loadFoodTruckContent()` in `src/content/schema.ts` validates it with zod and types its money as `Cents`. Every object is strict, so a mistyped key fails instead of being dropped.
- `src/engine/day.ts` calls `loadFoodTruckContent()` once, when the module loads, and exports the result as `FOOD_TRUCK`. An invalid file throws as soon as the engine is imported.
- `createInitialState()`, `tick()`, `playDay()` and `openingJournal()` take a `content` argument that defaults to `FOOD_TRUCK`, so a test can play with other numbers. The UI, the simulation and the invariant test use the default.
- The UI reads `FOOD_TRUCK` too: product names in `src/ui/TodayPanel.tsx`, and the daily fixed costs for the cash gauge in `src/ui/cashLevel.ts`.
- `src/content/pacing.json` (real milliseconds per game day, the speeds, the most days per animation frame) is read by `src/ui/gameLoop.ts` and `src/ui/TopBar.tsx`. `src/content/cashGauge.json` is read by `src/ui/cashLevel.ts`. The engine reads neither: it knows nothing of real time.

Some numbers stay in code on purpose, because they are facts rather than tunables:
- the calendar, in `src/engine/clock.ts`;
- the first weekend day, in `src/engine/day.ts`;
- the mulberry32 constants, in `src/engine/rng.ts`;
- the chart of accounts, in `src/finance/accounts.ts`;
- the structure and labels of the statements, in `src/finance/statements.ts`.

## Invariants enforced by `tests/invariants.test.ts`

The test plays 3650 days, ten years, for each of the seeds 1, 42 and 2026, calling `tick()` with the shipped content.

After every day's close, it checks:
- the trial balance up to that day: total debits equal total credits;
- the bilan: Actifs = Passifs + Capitaux propres;
- Stocks: the ledger balance of 1200, read from the trial balance, equals `inventoryValue()` of the lots on hand.

At the end of every calendar month, it checks that the état des flux de trésorerie's net change for the month equals the change in Encaisse. Day 0 is May 1st, so the run covers exactly 120 months.

It then plays each seed again through `simulate()` in `tools/sim/simulate.ts` and checks:
- the replay's `journalHash`, the sha256 of the entries, equals the first run's, so the engine is deterministic;
- the replay sums up as ten whole 365-day years: days 0 to 364, 365 to 729, and so on.

The whole file must finish within 60 seconds. If it gets slower, make the slow part faster rather than checking fewer days or seeds. It reports at most 10 failures per rule.

### Also enforced elsewhere

- `postEntry()` throws on an entry that does not balance or breaks another of the rules above, so the books cannot take one. `src/finance/journal.test.ts` covers each rule, and `src/finance/journal.property.test.ts` checks that the trial balance stays at zero after any run of balanced entries.
- `tools/lint-guardrails.test.ts` checks that ESLint flags the forbidden imports and calls in `src/engine/` and `src/finance/`, and leaves the same code alone in `src/ui/`.
- `tools/engine-types.test.ts` checks that `tsconfig.engine.json` rejects browser globals in both folders.
- `tools/architecture-doc.test.ts` checks this page:
  - `src/engine/types.ts` starts with its frozen header;
  - every type it exports has a heading under "The shape of `GameState`", and every field of an interface has a row in that heading's table;
  - every path this page cites exists;
  - the memos in "Order of operations in `tick()`" are exactly the entries each day posts, in the same order. It checks the order of the entries only, not the order of steps that post nothing.
