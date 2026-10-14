# Architecture

How the game is put together at the end of phase 1: the folders and who may import whom, the frozen contract in `src/engine/types.ts`, the order in which a day is played, how the books are written and read, where the tunable numbers come from and what the 10-year invariant test checks. `tools/architecture-doc.test.ts` keeps parts of this page in step with the code (see the last section).

## Layout and dependencies

| Folder | Holds | Imports from other folders |
| --- | --- | --- |
| `src/engine/` | Game rules: the clock, a day of business, walk-in customers, the player's decisions, lots and FIFO, money, the seeded generator, the shared types | `src/finance/` (journal, accounts) and `src/content/schema.ts` |
| `src/finance/` | The journal, the chart of accounts, the three statements | `src/engine/money.ts` and `src/engine/types.ts` only |
| `src/content/` | Tunable numbers as JSON, and the zod schema that validates them | `src/engine/money.ts` only, to type money as `Cents` |
| `src/ui/` | React screens, the Zustand store and the real-time loop | engine, finance and content |
| `src/world/` | The living 2D world, drawn with PixiJS behind the panels; `src/App.tsx` mounts it | engine, finance, content and the UI store, to read only |
| `tools/sim/` | The headless simulation behind `npm run sim` | engine and finance |
| `tests/` | The 10-year invariant test | engine, finance and `tools/sim/` |

Engine and finance code never imports React, React DOM, Zustand or anything from `src/ui/`, never touches the DOM and never reads the wall clock or `Math.random()`. Two checks hold the line:
- `eslint.config.js` bans those imports, `window`, `document`, `globalThis`, dynamic `import()`, `Math.random()`, `Date`, `performance.now()` and `crypto`'s random functions in both folders.
- `tsconfig.engine.json` typechecks both folders (tests excepted) with the ES2023 library only, so browser globals such as `localStorage`, `fetch` or `setTimeout` do not compile there.

`tools/lint-guardrails.test.ts` and `tools/engine-types.test.ts` prove the two checks stay wired up.

The world draws the game state and never changes it (CLAUDE.md rule 9). `eslint.config.js` holds that line too:
- engine, finance and content code never imports `src/world/`;
- the world never imports the functions that change the game, listed in `GAME_CHANGERS` (`postEntry`, `applyDecision`, `tick` and `playDay`), nor a whole engine, finance or UI module with `import * as`, and never calls the store's `advance()` or `setState()`. Its tests may, to build the states they draw;
- neither content nor the world uses dynamic `import()`.

Randomness and the browser are allowed in the world, since nothing it does reaches the engine.

## The contract

`src/engine/types.ts` holds the types the engine, the books, the UI and the tools share. It is frozen at the end of phase 1: changing it needs a dedicated card. It holds types only, with no code. P2-02 (#45) was such a card: it added `segments` and `visits` to `DaySummary`, with `SegmentSummary`, `Visit` and `VisitOutcome`. So was P2-04 (#46): it added `decisions` and `pendingDecisions` to `GameState`, with `Decisions`. And P2-11 (#53): it added `profile` to `GameState`, with `Profile`.

The engine is deterministic: the same seed, played with the same code, the same content and the same decisions on the same days, always posts the same journal, so it always gives the same `journalHash`. A replay is only guaranteed within one version of the code and content, though. Changing the order of the generator draws, the order of a day's entries or a number in `src/content/` can change the journal a seed produces without touching `types.ts`.

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
| `decisions` | `Decisions` | How the player runs the truck on day `day`: what `tick()` plays the day with. |
| `pendingDecisions` | `Decisions \| null` | What the player decided since day `day` began, waiting for the next morning. Null when nothing waits. |
| `profile` | `Profile` | Who the player is: the business name, the avatar and the difficulty picked on the new game screen. It never changes once the game has started. |

A decision never changes the day under way. The UI shows `day` as today and plays it once its real time is over, so the player's changes land in `pendingDecisions`, and `tick()` makes them the next day's `decisions`. `latestDecisions(state)` in `src/engine/decisions.ts` gives what the player last left: `pendingDecisions`, or else `decisions`.

### `Decisions`

How the player runs the truck. `startingDecisions()` in `src/engine/decisions.ts` reads the ones a game starts with from `startingDecisions` in the content. `applyDecision(state, change)` makes one `DecisionChange` on top of the latest decisions and leaves the result in `pendingDecisions`. It returns a new state and never mutates. It throws a RangeError naming the field when the change names an unknown kind or product, gives a product another kind of restock rule than it has, or leaves a field outside `decisionLimits` in the content. `validateDecisions()` holds the decisions to those limits.

| Field | Type | Meaning |
| --- | --- | --- |
| `prices` | `Readonly<Record<ProductId, Cents>>` | What one unit of each product sells for: a whole multiple of `priceCents.step` within `priceCents`. `currentPrice(state, product)` in `src/engine/day.ts` reads it. |
| `restock` | `Readonly<Record<ProductId, RestockRule>>` | How each product is restocked each morning the truck opens: `buyDaily` buys `quantity` units, `topUp` buys back up to `upTo` units on hand once they fall below `whenBelow`. Each count is within `units`, and `whenBelow` is no higher than `upTo`. A product keeps the kind of rule it starts with: the croissants are a daily order, the drinks are topped up. |
| `daysOpen` | `readonly number[]` | The ISO weekdays the truck opens, from 1 = Monday to 7 = Sunday: ascending, each once, at least `minDaysOpen` of them. `applyDecision` sorts the weekdays it is given. |
| `ownerWeeklyPay` | `Cents` | What the owner pays themself each week, within `ownerWeeklyPayCents`. Stored only: P2-14 pays it. |
| `marketingDaily` | `Cents` | What the truck spends on marketing each day, within `marketingDailyCents`. Stored only: P2-05 spends it. |

### `Profile`

Who the player is, as they set it up on the new game screen. `defaultProfile()` in `src/engine/profile.ts` reads the screen's defaults from `src/content/profile.json`. `validateProfile()` throws a RangeError naming the field unless the business name holds 1 to `businessNameMaxLength` characters (counted as code points, so é or an emoji counts once) with no space at either end and no control character, and the avatar and the difficulty are ones the content knows. `createInitialState()` and `deserialize()` both hold the profile to it.

| Field | Type | Meaning |
| --- | --- | --- |
| `businessName` | `string` | The business's name: on the truck's sign and in the top bar. |
| `avatar` | `Avatar` | The owner's avatar: `femme` or `homme`, the zod enum in `src/content/schema.ts`. |
| `difficulty` | `DifficultyId` | How the game started: `facile`, `moyen` or `difficile`, the zod enum in `src/content/schema.ts`. `src/content/difficulty.json` says what each one means. Every difficulty opens the same books until P2-14 makes them follow it. |

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
| `segments` | `Readonly<Record<SegmentId, SegmentSummary>>` | Each customer segment's visits, counted by how they ended. |
| `visits` | `readonly Visit[]` | Every walk-in's visit, in arrival order. Their `bought` units add up to `sold`, and their count to the day's walk-ins. |

### `SegmentSummary`

One customer segment's visits on a business day. The segments (`aubaine`, `habitue`, `chic`) are the zod enum `SegmentId` in `src/content/schema.ts`, and `SEGMENTS` in `src/engine/customers.ts` lists them. Each count is a number of visits, so `buyers`, `tooExpensive` and `soldOut` count the visits with that `outcome`.

| Field | Type | Meaning |
| --- | --- | --- |
| `visits` | `number` | Walk-ins of this segment. |
| `buyers` | `number` | Visits that bought at least one unit. |
| `tooExpensive` | `number` | Visits that bought nothing because a price was above what they pay. |
| `soldOut` | `number` | Visits that bought nothing because something they wanted had sold out. |

### `Visit` and `VisitOutcome`

One walk-in customer at the truck.

| Field | Type | Meaning |
| --- | --- | --- |
| `arrivalMinute` | `number` | When they arrived, in minutes from midnight: 450 is 7 h 30. Always within the opening hours. |
| `segment` | `SegmentId` | The customer segment they belong to. |
| `bought` | `PerProduct` | Units they bought: 0 or 1 of each product. |
| `outcome` | `VisitOutcome` | How the visit ended. |

`VisitOutcome` is `'bought'` when they bought anything. Otherwise it is `'soldOut'` when something they wanted had sold out, then `'tooExpensive'` when a price above their reference price kept them from buying a product they would have bought at that reference, and `'browsed'` when neither.

### `Day` and `PerProduct`

- `Day` is a whole number counting from 0. `toCalendar()` in `src/engine/clock.ts` turns it into a date: day 0 is Monday, May 1st, year 1, when food truck season starts. Years have 365 days with real month lengths and no leap years. Weekdays follow ISO 8601, from 1 = Monday to 7 = Sunday.
- `PerProduct` is a read-only record holding a whole number for each `ProductId`. The products (`cafe`, `chocolat` and `croissant`) are the zod enum in `src/content/schema.ts`. `PRODUCTS` in `src/engine/inventory.ts` lists them in the order the game walks through them, and `perProduct()` builds a record.

### The starting state

`createInitialState(seed, content, profile)` in `src/engine/clock.ts` throws a RangeError unless `seed` is an integer in [0, 2^32) and `profile` passes `validateProfile()`. Otherwise it returns:
- `day` 0, the `seed`, and `rngState` from `seedRng(seed)`, which is the seed itself;
- `journal` from `openingJournal()`: one entry on day 0, *Mise de fonds*, Dr 1000 Encaisse / Cr 3000 Capital-actions for `startingCapitalCents`;
- an empty `inventory` and a null `lastDay`;
- `decisions` from `startingDecisions()`, which throws a RangeError if the content's starting decisions break its own limits, and a null `pendingDecisions`.
- a copy of `profile`, which is `defaultProfile()` unless the new game screen gives another.

## Order of operations in `tick()`

<!-- tools/architecture-doc.test.ts plays days and checks that the memos in
italics below are exactly the entries each day posts, in the same order. Keep
every memo in italics, once, and nothing else in italics in this section. -->

`tick(state)` in `src/engine/clock.ts` calls `playDay(state, weekday)` in `src/engine/day.ts`, with the weekday of `state.day` from `toCalendar()`. It then returns the state `playDay` gave back with `day` + 1, the pending decisions, if any, as its `decisions`, and a null `pendingDecisions`. `playDay` plays the day with `state.decisions` and never reads `pendingDecisions`. It goes through these steps in this order. Every entry it posts is dated `state.day`.

Steps 1 to 3 happen only on a day the truck opens, when `decisions.daysOpen` holds the weekday. On a closed day nobody comes and nothing is bought: no purchase, no sale, no draw from the generator, and a `lastDay` with no visit and nothing sold. Steps 4 to 6 happen every day.

1. **Morning restock.** For each product in `PRODUCTS` order, its rule in `decisions.restock` sets the order size. `buyDaily` buys `quantity` units. `topUp` buys up to `upTo` units on hand when the units on hand are below `whenBelow`. Each purchase becomes a new lot at the end of `inventory`, at the product's `unitCostCents`. Entry *Achat de marchandises*: Dr 1200 Stocks / Cr 1000 Encaisse for what the day's purchases cost.
2. **Walk-ins.** `serveWalkIns()` in `src/engine/customers.ts` serves the day's customers. `dayTypeOf()` gives the crowd: `finDeSemaine` on Saturday and Sunday, `semaine` otherwise, each with its own traffic, segment shares, product appeal and arrival curve in `walkIns.dayTypes`. Prices come from `currentPrice(state, product)` in `src/engine/day.ts`, which returns the product's price in `decisions.prices`. The draws come in this order, and their number never depends on the prices or the stock, so a seed brings the same customers at every price:
   1. `normal()` draws twice for a noise factor with a mean of 1 and a standard deviation of `noiseStdDevRatio`. The day's customers are the crowd's `customers` × noise, rounded and never below zero.
   2. Each customer draws once for an arrival minute (a slot of `arrivalSlotMinutes` picked by its weight in `arrivalWeights`, then the minute within it), then once for a segment, picked by its share.
   3. The customers line up by arrival minute; those arriving the same minute keep the order they were drawn in.
   4. In that order, each customer draws once per product, in `PRODUCTS` order. They want one unit when the draw is below `purchaseProbability()` in `src/engine/customers.ts`, whose doc comment gives the formula: the segment's base probability × the crowd's appeal for the product × a logistic curve in price ÷ reference price, clamped to [0, 1]. They buy it when a unit is left; otherwise it is a lost sale, so a stockout hits the customers who come later.

   No other step draws, so these are all of a day's draws. This step posts nothing. A closed day draws nothing, so the days open change which draws the later days get.
3. **Sales.** Product by product, in `PRODUCTS` order, the units the customers bought leave the stock, oldest lot first (FIFO, `takeFifo()` in `src/engine/inventory.ts`), priced at `currentPrice()`. Taking a product's day total at once takes the same units from the same lots as taking them one customer at a time. Entry *Ventes au comptant*: Dr 1000 Encaisse / Cr 4000 Ventes for the revenue. Then entry *Coût des marchandises vendues*: Dr 5000 Coût des marchandises vendues / Cr 1200 Stocks for what the units sold cost, each at its own lot's unit cost. These are two entries rather than one, so the other lines of each cash entry stay on one row of the état des flux de trésorerie.
4. **Fixed costs.** Entry *Loyer, permis, carburant et entretien*: Dr 6100 Loyer et permis for `rentAndPermit` and Dr 6200 Carburant et entretien for `fuelAndMaintenance` / Cr 1000 Encaisse for both, from `dailyFixedCostsCents`.
5. **Spoilage at the close.** `removeExpired()` in `src/engine/inventory.ts` writes off every lot whose shelf life ends that day, as `Lot` describes above. Entry *Marchandises périmées*: Dr 5100 Pertes sur stocks / Cr 1200 Stocks for what those lots cost.
6. **The new state.** `playDay` returns the state with the new `rngState`, `journal`, `inventory` and a `lastDay` for `state.day`, with the day's visits.

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

- `src/content/foodtruck.json` holds the food truck's numbers: starting capital, products, fixed costs, walk-ins, the decisions a game starts with (`startingDecisions`) and the limits the player's decisions are held to (`decisionLimits`). The walk-ins are the crowds of the truck's spot: the opening hours, the arrival slots, the noise, and for each type of day (`semaine`, `finDeSemaine`) its traffic, segment shares, product appeal, patience and arrival curve. `loadFoodTruckContent()` in `src/content/schema.ts` validates it with zod and types its money as `Cents`. Every object is strict, so a mistyped key fails instead of being dropped.
- `src/content/segments.json` holds the customer segments: for each segment and product, a reference price, a base purchase probability and a sensitivity, and for the chic segment how a price far below its reference puts it off (`tooCheap`). `loadCustomerContent()` in `src/content/schema.ts` validates it the same way.
- `src/engine/day.ts` calls both loaders once, when the module loads, and exports the results as `FOOD_TRUCK` and `CUSTOMERS`. An invalid file throws as soon as the engine is imported.
- `createInitialState()`, `tick()`, `playDay()`, `openingJournal()`, `startingDecisions()` and `applyDecision()` take a `content` argument that defaults to `FOOD_TRUCK`, and `tick()` and `playDay()` take a `customers` argument after it that defaults to `CUSTOMERS`, so a test can play with other numbers. The UI, the simulation and the invariant test use the defaults.
- The UI reads `FOOD_TRUCK` too: product names in `src/ui/TodayPanel.tsx`, and the daily fixed costs for the cash gauge in `src/ui/cashLevel.ts`.
- `src/content/pacing.json` (real milliseconds per game day, the speeds, the most days per animation frame) is read by `src/ui/gameLoop.ts` and `src/ui/TopBar.tsx`. `src/content/cashGauge.json` is read by `src/ui/cashLevel.ts`. The engine reads neither: it knows nothing of real time.

Some numbers stay in code on purpose, because they are facts rather than tunables:
- the calendar, in `src/engine/clock.ts`;
- the first weekend day, in `src/engine/customers.ts`;
- the ISO weekdays, 1 = Monday to 7 = Sunday, in `src/engine/decisions.ts` and `src/content/schema.ts`;
- the minutes in a day, in `src/content/schema.ts`;
- the mulberry32 constants, in `src/engine/rng.ts`;
- the chart of accounts, in `src/finance/accounts.ts`;
- the structure and labels of the statements, in `src/finance/statements.ts`.

## Invariants enforced by `tests/invariants.test.ts`

The test plays 3650 days, ten years, for each of the seeds 1, 42 and 2026, calling `tick()` with the shipped content and its starting decisions.

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
- `tools/lint-guardrails.test.ts` checks that ESLint flags the forbidden imports and calls in `src/engine/` and `src/finance/`, any import of `src/world/` from engine, finance and content, and anything in `src/world/` that would change the game, and leaves the same code alone in `src/ui/`.
- `tools/engine-types.test.ts` checks that `tsconfig.engine.json` rejects browser globals in both folders.
- `tools/architecture-doc.test.ts` checks this page:
  - `src/engine/types.ts` starts with its frozen header;
  - every type it exports has a heading under "The shape of `GameState`", and every field of an interface has a row in that heading's table;
  - every path this page cites exists;
  - the memos in "Order of operations in `tick()`" are exactly the entries each day posts, in the same order. It checks the order of the entries only, not the order of steps that post nothing.
