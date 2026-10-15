# Architecture

How the game is put together at the end of phase 1: the folders and who may import whom, the frozen contract in `src/engine/types.ts`, the order in which a day is played, how the books are written and read, where the tunable numbers come from and what the 10-year invariant test checks. `tools/architecture-doc.test.ts` keeps parts of this page in step with the code (see the last section).

## Layout and dependencies

| Folder | Holds | Imports from other folders |
| --- | --- | --- |
| `src/engine/` | Game rules: the clock, a day of business, walk-in customers, the marketing budget, the player's decisions, the owner's personal account and energy, lots and FIFO, money, the seeded generator, the shared types | `src/finance/` (journal, accounts) and `src/content/schema.ts` |
| `src/finance/` | The journal, the chart of accounts, the three statements | `src/engine/money.ts` and `src/engine/types.ts` only |
| `src/content/` | Tunable numbers as JSON, and the zod schema that validates them | `src/engine/money.ts` only, to type money as `Cents` |
| `src/ui/` | React screens, the Zustand store and the real-time loop | engine, finance and content |
| `src/world/` | The living 2D world, drawn with PixiJS behind the panels; `src/App.tsx` mounts it | engine, finance, content and the UI store, to read only |
| `tools/sim/` | The headless simulation behind `npm run sim` | engine and finance |
| `tools/balance/` | The balance bot behind `npm run balance`, which plays scripted strategies and writes `docs/balance/phase-2.md` | engine, finance, content and `tools/sim/` |
| `tests/` | The 10-year invariant test | engine, finance and `tools/sim/` |

Engine and finance code never imports React, React DOM, Zustand or anything from `src/ui/`, never touches the DOM and never reads the wall clock or `Math.random()`. Two checks hold the line:
- `eslint.config.js` bans those imports, `window`, `document`, `globalThis`, dynamic `import()`, `Math.random()`, `Date`, `performance.now()` and `crypto`'s random functions in both folders.
- `tsconfig.engine.json` typechecks both folders (tests excepted) with the ES2023 library only, so browser globals such as `localStorage`, `fetch` or `setTimeout` do not compile there.

`tools/lint-guardrails.test.ts` and `tools/engine-types.test.ts` prove the two checks stay wired up.

The world draws the game state and never changes it (CLAUDE.md rule 9). `eslint.config.js` holds that line too:
- engine, finance and content code never imports `src/world/`;
- the world never imports the functions that change the game, listed in `GAME_CHANGERS` (`postEntry`, `applyDecision`, `tick` and `playDay`), nor a whole engine, finance or UI module with `import * as`, and never calls the store's `advance()`, `setState()` or `startGame()`. Its tests may, to build the states they draw;
- neither content nor the world uses dynamic `import()`.

Randomness and the browser are allowed in the world, since nothing it does reaches the engine.

## The contract

`src/engine/types.ts` holds the types the engine, the books, the UI and the tools share. It is frozen at the end of phase 1: changing it needs a dedicated card. It holds types only, with no code. P2-02 (#45) was such a card: it added `segments` and `visits` to `DaySummary`, with `SegmentSummary`, `Visit` and `VisitOutcome`. So was P2-04 (#46): it added `decisions` and `pendingDecisions` to `GameState`, with `Decisions`. And P2-11 (#53): it added `profile` to `GameState`, with `Profile`. And P2-03 (#62): it added `leftLine`, `averageWaitSeconds` and `longestWaitSeconds` to `DaySummary`, `servedMinute` and `leftMinute` to `Visit`, and `'leftLine'` to `VisitOutcome`. And P2-05 (#63): it added `marketingHistory` to `GameState`. And P2-17 (#83): it added `personal` to `GameState`, with `PersonalAccount` and `PersonalMovement`. And P2-16 (#82): it added `energy` to `GameState`, `energy` and `botched` to `DaySummary`, and `botched` to `Visit`.

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
| `marketingHistory` | `readonly Cents[]` | What marketing spent on each of the last business days played, oldest first, 0 on a day the truck was closed: the last `marketing.awarenessDays` in the content, or every day played until there are that many. So it holds `lastDay.day` + 1 days, up to `awarenessDays`. The day's awareness, and the walk-ins marketing brings, follow from it (step 2 below). |
| `decisions` | `Decisions` | How the player runs the truck on day `day`: what `tick()` plays the day with. |
| `pendingDecisions` | `Decisions \| null` | What the player decided since day `day` began, waiting for the next morning. Null when nothing waits. |
| `profile` | `Profile` | Who the player is: the business name, the avatar and the difficulty picked on the new game screen. It never changes once the game has started. |
| `personal` | `PersonalAccount` | The owner's own money, outside the company's books (step 7 below). |
| `energy` | `number` | The owner's energy, from 0 to 100 (`FULL_ENERGY` in `src/engine/energy.ts`): on the morning of `day`, or at its close in what `playDay()` returns. A tired owner serves slower and botches units (steps 2 and 8 below). |

A decision never changes the day under way. The UI shows `day` as today and plays it once its real time is over, so the player's changes land in `pendingDecisions`, and `tick()` makes them the next day's `decisions`. `latestDecisions(state)` in `src/engine/decisions.ts` gives what the player last left: `pendingDecisions`, or else `decisions`.

### `Decisions`

How the player runs the truck. `startingDecisions()` in `src/engine/decisions.ts` reads the ones a game starts with from `startingDecisions` in the content. `applyDecision(state, change)` makes one `DecisionChange` on top of the latest decisions and leaves the result in `pendingDecisions`. It returns a new state and never mutates. It throws a RangeError naming the field when the change names an unknown kind or product, gives a product another kind of restock rule than it has, or leaves a field outside `decisionLimits` in the content. `validateDecisions()` holds the decisions to those limits.

| Field | Type | Meaning |
| --- | --- | --- |
| `prices` | `Readonly<Record<ProductId, Cents>>` | What one unit of each product sells for: a whole multiple of `priceCents.step` within `priceCents`. `currentPrice(state, product)` in `src/engine/day.ts` reads it. |
| `restock` | `Readonly<Record<ProductId, RestockRule>>` | How each product is restocked each morning the truck opens: `buyDaily` buys `quantity` units, `topUp` buys back up to `upTo` units on hand once they fall below `whenBelow`. Each count is within `units`, and `whenBelow` is no higher than `upTo`. A product keeps the kind of rule it starts with: the croissants are a daily order, the drinks are topped up. |
| `daysOpen` | `readonly number[]` | The ISO weekdays the truck opens, from 1 = Monday to 7 = Sunday: ascending, each once, at least `minDaysOpen` of them. `applyDecision` sorts the weekdays it is given. |
| `ownerWeeklyPay` | `Cents` | What the owner pays themself each week, within `ownerWeeklyPayCents`. The business pays it on payday, `ownerPayWeekday` in the content, whether the truck opens or not. |
| `marketingDaily` | `Cents` | What the truck spends on marketing each day it opens, within `marketingDailyCents` (step 4 below). It brings customers from the next day on (step 2). |

### `Profile`

Who the player is, as they set it up on the new game screen. `defaultProfile()` in `src/engine/profile.ts` reads the screen's defaults from `src/content/profile.json`. `validateProfile()` throws a RangeError naming the field unless the business name holds 1 to `businessNameMaxLength` characters (counted as code points, so é or an emoji counts once) with no space at either end and no control character, and the avatar and the difficulty are ones the content knows. `createInitialState()` and `deserialize()` both hold the profile to it.

| Field | Type | Meaning |
| --- | --- | --- |
| `businessName` | `string` | The business's name: on the truck's sign and in the top bar. |
| `avatar` | `Avatar` | The owner's avatar: `femme` or `homme`, the zod enum in `src/content/schema.ts`. |
| `difficulty` | `DifficultyId` | How the game started: `facile`, `moyen` or `difficile`, the zod enum in `src/content/schema.ts`. `src/content/difficulty.json` says what each one means. It sets the books the game opens with (see the starting state below) and what the truck costs each month. |

### `PersonalAccount` and `PersonalMovement`

The owner is not the company. The business pays the owner's weekly pay (step 5 below); from there the money is the owner's, and their own life costs money. The account lives outside the books: nothing in it posts a journal entry or draws from the generator. `src/engine/personal.ts` keeps it. `inDebt()` there says whether the owner's cash is below zero; each payday it is, the stress drains the owner's energy (step 8 below). That is the only way the owner's money reaches the business: a tired owner serves slower and botches units, which changes the books from then on. So two games that differ only in living costs or savings post the same journal as long as neither owner is ever in debt on payday, or as long as the stress never tires them below `tired.below`.

| Field | Type | Meaning |
| --- | --- | --- |
| `cash` | `Cents` | What the owner has of their own. It may be negative. |
| `movements` | `readonly PersonalMovement[]` | Every movement of the calendar month of `lastDay.day` and the 11 before, by `monthsSinceStart()`, oldest first and in the order they happened. `isKept()` in `src/engine/personal.ts` is that rule. Empty until the first day is played. |
| `unpaidRents` | `readonly Day[]` | The days the rent went unpaid, « Loyer impayé », ascending, over the same months. Each is a day with a « Loyer » movement. |

A `PersonalMovement` is one movement of the account:

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | `Day` | The day it happened. |
| `label` | `string` | What it was, in French: « Salaire », « Loyer » or « Dépenses de la semaine », from `LABELS` in `src/engine/personal.ts`. |
| `amount` | `Cents` | Above zero for « Salaire », below zero for the others. A movement of 0 is never recorded. |

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
| `leftLine` | `number` | Visits that left the line without being served: the visits whose `outcome` is `'leftLine'`. |
| `averageWaitSeconds` | `number` | The average wait in line, in whole seconds, of the customers who reached the counter. 0 when nobody did. |
| `longestWaitSeconds` | `number` | The longest wait in line, in whole seconds, of a customer who reached the counter. 0 when nobody did. |
| `energy` | `number` | The owner's energy at the close, from 0 to 100, before the night gives some back. `GameState.energy` equals it in what `playDay()` returns. |
| `botched` | `number` | Units botched at the counter and thrown out, written off as *Produits ratés* (step 3 below): the visits' `botched`, summed. 0 when the owner was rested. |

### `SegmentSummary`

One customer segment's visits on a business day. The segments (`aubaine`, `habitue`, `chic`) are the zod enum `SegmentId` in `src/content/schema.ts`, and `SEGMENTS` in `src/engine/customers.ts` lists them. Each count is a number of visits, so `buyers`, `tooExpensive` and `soldOut` count the visits with that `outcome`. A visit that left the line counts only in `visits`; `DaySummary.leftLine` counts them for the whole day.

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
| `servedMinute` | `number \| null` | When they reached the counter, in minutes from midnight. Null when they never lined up: they wanted nothing, or they left the line. Service may run past closing time. |
| `leftMinute` | `number \| null` | When they left the line without being served, in minutes from midnight: their `arrivalMinute`, since customers only leave on arrival. Null unless the visit ended in `'leftLine'`. |
| `botched` | `number` | Units of their order the owner botched and threw out, each made again if a unit was left (step 2 below). 0 when the owner is rested. |

`VisitOutcome` is `'bought'` when they bought anything. Otherwise it is `'leftLine'` when they wanted something but left the line before being served, then `'soldOut'` when something they wanted had sold out, then `'tooExpensive'` when a price above their reference price kept them from buying a product they would have bought at that reference, and `'browsed'` when neither.

### `Day` and `PerProduct`

- `Day` is a whole number counting from 0. `toCalendar()` in `src/engine/calendar.ts`, which `src/engine/clock.ts` exports too, turns it into a date: day 0 is Monday, May 1st, year 1, when food truck season starts. Years have 365 days with real month lengths and no leap years. Weekdays follow ISO 8601, from 1 = Monday to 7 = Sunday. `monthsSinceStart()` in the same file counts the calendar months from day 0's: 0 all through the first May, 1 in June, 12 from May 1st, year 2.
- `PerProduct` is a read-only record holding a whole number for each `ProductId`. The products (`cafe`, `chocolat` and `croissant`) are the zod enum in `src/content/schema.ts`. `PRODUCTS` in `src/engine/inventory.ts` lists them in the order the game walks through them, and `perProduct()` builds a record.

### The starting state

`createInitialState(seed, content, profile, difficulties)` in `src/engine/clock.ts` throws a RangeError unless `seed` is an integer in [0, 2^32) and `profile` passes `validateProfile()`, or if the difficulty's loan is more than the truck and the starting cash together. Otherwise it returns:
- `day` 0, the `seed`, and `rngState` from `seedRng(seed)`, which is the seed itself;
- `journal` from `openingJournal(profile.difficulty)` in `src/engine/day.ts`: the entries of day 0, which leave `startingCashCents` of the difficulty in Encaisse. The truck's price is `truck.priceCents` in `src/content/foodtruck.json`.
  - Facile: *Mise de fonds*, Dr 1000 Encaisse / Cr 3000 Capital-actions for the starting cash; then *Camion apporté par le propriétaire*, Dr 1500 Équipement / Cr 3000 Capital-actions for the truck's price, which moves no cash.
  - Moyen: *Mise de fonds*, Dr 1000 / Cr 3000 for the starting cash plus the truck's price minus the loan; then *Emprunt de démarrage*, Dr 1000 / Cr 2500 Emprunts bancaires for `loanCents`; then *Achat du camion*, Dr 1500 / Cr 1000 for the truck's price.
  - Difficile: *Mise de fonds* only. The truck is leased, so the books never carry it.
- an empty `inventory`, a null `lastDay` and an empty `marketingHistory`;
- `decisions` from `startingDecisions()`, which throws a RangeError if the content's starting decisions break its own limits, and a null `pendingDecisions`;
- a copy of `profile`, which is `defaultProfile()` unless the new game screen gives another;
- `personal` from `openingAccount()` in `src/engine/personal.ts`: the difficulty's `startingPersonalCashCents` as its cash, no movement and no unpaid rent. Day 0's rent is charged when day 0 is played;
- `energy` at 100, `FULL_ENERGY`.

## Order of operations in `tick()`

<!-- tools/architecture-doc.test.ts plays days of each difficulty and checks
that every entry a day posts is one of the memos in italics below, in the same
order, and that each of them posts. Keep every memo in italics, once, and
nothing else in italics in this section. -->

`tick(state)` in `src/engine/clock.ts` calls `playDay(state)` in `src/engine/day.ts`. It then returns the state `playDay` gave back with `day` + 1, the pending decisions, if any, as its `decisions`, a null `pendingDecisions`, and the night's rest: `nightRest()` in `src/engine/energy.ts` adds `nightRecovery` to the owner's `energy`, up to 100. `playDay` reads the date of `state.day` from `toCalendar()`, plays the day with `state.decisions` and never reads `pendingDecisions`. It goes through these steps in this order. Every entry it posts is dated `state.day`.

Step 0 happens on the 1st of the month, open or closed. Steps 1 to 4 happen only on a day the truck opens, when `decisions.daysOpen` holds the weekday. On a closed day nobody comes, nothing is bought and nothing is spent on marketing: no purchase, no sale, no fuel, no marketing, no draw from the generator, and a `lastDay` with no visit and nothing sold. Step 5 happens on payday, open or closed, and steps 6 to 9 every day.

0. **The month's charges**, from `monthlyCostsCents` in the content and the difficulty in `state.profile`. Day 0 is May 1st, so the first month is charged on day 0. Entry *Permis, stationnement et cuisine*: Dr 6100 Loyer et permis / Cr 1000 Encaisse for `permitParkingAndCommissary`. Entry *Assurances*: Dr 6150 Assurances / Cr 1000 for `insurance`. Then the truck's, by how it came:
   - Moyen pays its loan from the month after the loan: the 1st of month `k` from `monthsSinceStart()`, for `k` from 1 to `termMonths`, pays payment `k` of `loanSchedule(loanCents, annualRateBasisPoints, termMonths)` in `src/finance/loan.ts`. Entry *Intérêts sur l'emprunt*: Dr 7000 Intérêts / Cr 1000 for its interest, which a loan without interest never posts. Entry *Remboursement de l'emprunt*: Dr 2500 Emprunts bancaires / Cr 1000 for its principal.
   - Facile and Moyen depreciate the truck straight line from month 0 to month `usefulLifeMonths` − 1, then stop. Entry *Amortissement du camion*: Dr 6400 Amortissement / Cr 1510 Amortissement cumulé for `truck.priceCents` ÷ `usefulLifeMonths`, rounded down to the cent; the last month adds what the rounding left, so the months add up to the price.
   - Difficile leases it. Entry *Location du camion*: Dr 6120 Location du camion / Cr 1000 for `monthlyLeaseCents`.
1. **Morning restock.** For each product in `PRODUCTS` order, its rule in `decisions.restock` sets the order size. `buyDaily` buys `quantity` units. `topUp` buys up to `upTo` units on hand when the units on hand are below `whenBelow`. Each purchase becomes a new lot at the end of `inventory`, at the product's `unitCostCents`. Entry *Achat de marchandises*: Dr 1200 Stocks / Cr 1000 Encaisse for what the day's purchases cost.
2. **Walk-ins.** `serveWalkIns()` in `src/engine/customers.ts` serves the day's customers. `dayTypeOf()` gives the crowd: `finDeSemaine` on Saturday and Sunday, `semaine` otherwise, each with its own traffic, segment shares, product appeal and arrival curve in `walkIns.dayTypes`. Marketing brings an extra crowd on top, from `marketingCrowd()` in `src/engine/marketing.ts`. The day's awareness is what `marketingHistory` holds, summed and divided by `marketing.awarenessDays`: the average spend of the days before, a closed day or a day before the game counting as 0, and today's spend not counted, so a budget pays off from the next day. The extra crowd is `extraCustomersPerSqrtCent` × √awareness, awareness in cents, so double the budget brings √2 times the walk-ins. They come and behave like the day type's crowd, but their segments follow `marketing.segmentShares`. Prices come from `currentPrice(state, product)` in `src/engine/day.ts`, which returns the product's price in `decisions.prices`. The draws come in this order, and their number never depends on the prices or the stock, so a seed brings the same customers at every price:
   1. `normal()` draws twice for a noise factor with a mean of 1 and a standard deviation of `noiseStdDevRatio`. The day's base customers are the crowd's `customers` × noise, and its extra customers the extra crowd × the same noise, each rounded and never below zero.
   2. Each base customer in turn draws once for an arrival minute (a slot of `arrivalSlotMinutes` picked by its weight in `arrivalWeights`, then the minute within it), once for a segment, picked by its share, then once per product, in `PRODUCTS` order. They want one unit when the draw is below `purchaseProbability()` in `src/engine/customers.ts`, whose doc comment gives the formula: the segment's base probability × the crowd's appeal for the product × a logistic curve in price ÷ reference price, clamped to [0, 1]. Since each customer makes all their draws before the next one starts, a bigger crowd from the same generator state brings the same customers first, wanting the same things, then more.
   3. Then each extra customer draws the same way, with a segment picked by `marketing.segmentShares`. So marketing leaves the base customers' draws as they would be without it, then brings its own. A budget does change how many draws a day takes, so the days after it bring other customers than a game without it.

   No other step draws, so these are all of a day's draws. Then the customers come to the counter by arrival minute, those of the same minute in the order they were drawn, base customers first, each at the start of their minute. Both crowds share the line and the stock. One who wants nothing walks on. One who wants something looks at the line, which `openLine()` in `src/engine/service.ts` keeps, first come, first served. They leave it at once, buying nothing, when more than `service.maxAheadInLine` customers are still waiting, not counting those at the counter, or when the wait for the first free server is longer than their patience: their segment's `patienceMinutes` × the crowd's `patienceMultiplier`. Otherwise they join and order what they want, which takes their server `service.baseSeconds` + `service.perItemSeconds` × the units ordered, divided by the server's speed; a sold-out unit takes its time too, so the line never depends on the stock. `servers(state, energy)` in the same file gives who serves: for now the avatar alone, at speed 1 when rested. How tired the owner is that morning, by `state.energy`, holds for the whole day (`fatigueOf()` and `effectsOf()` in `src/engine/energy.ts`, with the thresholds and effects of `src/content/energy.json`). Below `tired.below` (« Fatigué ») or `exhausted.below` (« Épuisé »), serving takes `serviceTimeIncrease` longer, so the avatar's speed is 1 ÷ (1 + `serviceTimeIncrease`). When they reach the counter they buy each unit they want that is left; one that is not is a lost sale, so a stockout hits the customers served later. A tired owner also botches `botchedShare` of the units they make, by a fixed quota rather than a draw: counting the units made for customers that day from 1, remakes aside, the n-th is botched when ⌊n × `botchedShare`⌋ goes up at it, so at 2 % every 50th. A botched unit leaves the stock and is thrown out, and the next unit left is made in its place; with none left, the customer loses it as a lost sale. Making it again takes no time, so the line still never depends on the stock. The counter keeps the order in which it took each product's units, sold or botched, for step 3. This step posts nothing. A closed day draws nothing, so the days open change which draws the later days get.
3. **Sales.** Product by product, in `PRODUCTS` order, the units the customers bought, and those botched, leave the stock, oldest lot first (FIFO, `takeFifo()` in `src/engine/inventory.ts`), in the order the counter took them, and those bought are priced at `currentPrice()`. Taking a run of a product's units at once takes the same units from the same lots as taking them one customer at a time; a rested day has a single run per product, its day total. Entry *Ventes au comptant*: Dr 1000 Encaisse / Cr 4000 Ventes for the revenue. Then entry *Coût des marchandises vendues*: Dr 5000 Coût des marchandises vendues / Cr 1200 Stocks for what the units sold cost, each at its own lot's unit cost. Then entry *Produits ratés*: Dr 5100 Pertes sur stocks / Cr 1200 for what the botched units cost, each at its own lot's unit cost; a botched unit takes no packaging. Then what the sales cost to make, paid the same day. Entry *Emballages*: Dr 5200 Emballages / Cr 1000 for each unit sold times its product's `packagingCents`. Entry *Frais de cartes*: Dr 6500 Frais bancaires et de cartes / Cr 1000 for the card fees: the revenue times `cardPayments.share` is what customers paid by card, and that times `cardPayments.feeRate` is the fee, each rounded to the cent half away from zero by `mulRatio()`. Each of these is an entry of its own, so the other lines of each cash entry stay on one row of the état des flux de trésorerie.
4. **Fuel and marketing.** Entry *Carburant et entretien*: Dr 6200 Carburant et entretien / Cr 1000 for `fuelAndMaintenancePerOpenDayCents`. Then entry *Marketing*: Dr 6300 Marketing / Cr 1000 for `decisions.marketingDaily`.
5. **Payday**, on the ISO weekday `ownerPayWeekday`. Entry *Paie du propriétaire*: Dr 6000 Salaires / Cr 1000 for `decisions.ownerWeeklyPay`. A change the player makes is paid from the next morning, like every decision.
6. **Spoilage at the close.** `removeExpired()` in `src/engine/inventory.ts` writes off every lot whose shelf life ends that day, as `Lot` describes above. Entry *Marchandises périmées*: Dr 5100 Pertes sur stocks / Cr 1200 Stocks for what those lots cost.
7. **The owner's personal account**, after the business's day, by `livePersonalDay()` in `src/engine/personal.ts`, with the owner's living costs from `src/content/personal.json`. It posts nothing and draws nothing. On payday, « Salaire » brings in `decisions.ownerWeeklyPay`, the amount the business paid in step 5. On the 1st of the month, day 0 included, « Loyer » takes out `rentCents`; when that leaves the cash below zero, the rent is unpaid and the day goes into `unpaidRents`. On payday again, « Dépenses de la semaine » takes out `weeklyExpensesCents`. So a Friday the 1st is paid, then charged its rent, then its week. A movement of 0 is not recorded. Then the movements and unpaid rents older than the months kept are dropped.
8. **The owner's energy**, by `energyAtClose()` in `src/engine/energy.ts`, with `src/content/energy.json`. It posts nothing and draws nothing. A day the truck opens costs `openDayCost`, plus `costPerCustomerServed` for each customer who reached the counter, the visits with a `servedMinute`, so a busy day tires more. A closed day gives `closedDayRecovery` back. Then, on payday, when step 7 leaves the owner's cash below zero (`inDebt()`), the stress takes `debtStress`. Each change stops at 0 and at 100. The night's `nightRecovery` comes in `tick()`, after the close.
9. **The new state.** `playDay` returns the state with the new `rngState`, `journal`, `inventory`, a `marketingHistory` with the day's spend added last (0 on a closed day) and only the last `awarenessDays` kept, a `lastDay` for `state.day`, with the day's visits, how the line went, the units botched and the energy at the close, the owner's `personal` account, and their `energy` at the close.

What every step shares:
- A line with a zero amount is dropped, and an entry left with no line is not posted. A day with nothing bought, nothing sold or nothing spoiled has no entry for that step, and a pay or a marketing budget of 0 posts nothing.
- Nothing checks the cash first: purchases and charges are paid even when Encaisse goes negative.

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

The chart of accounts is in `src/finance/accounts.ts`: 22 accounts with their codes, French names, types and normal balances. The game posts to 19 of them: 1000 Encaisse, 1200 Stocks, 1500 Équipement, 1510 Amortissement cumulé, 2500 Emprunts bancaires, 3000 Capital-actions, 4000 Ventes, 5000 Coût des marchandises vendues, 5100 Pertes sur stocks, 5200 Emballages, 6000 Salaires, 6100 Loyer et permis, 6120 Location du camion, 6150 Assurances, 6200 Carburant et entretien, 6300 Marketing, 6400 Amortissement, 6500 Frais bancaires et de cartes and 7000 Intérêts. The other two (1100 Comptes clients and 2000 Comptes fournisseurs) are there for the cards to come; 3100 Bénéfices non répartis is never posted to, as the bilan below explains.

Everything else only reads the books:
- `balance()` and `trialBalance()` in `src/finance/journal.ts` sum the entries up to a day.
- `incomeStatement()`, `balanceSheet()` and `cashFlowStatement()` in `src/finance/statements.ts` build the état des résultats, the bilan and the état des flux de trésorerie (direct method) as plain data: French labels and amounts in cents. There are no closing entries: the bilan adds the net income since the first entry to Bénéfices non répartis.
- The UI reads the books through these functions and never posts. It formats money in fr-CA in `src/ui/formatMoney.ts`.

Money is `Cents` from `src/engine/money.ts`: a branded number that only `cents()` and the helpers built on it (`add`, `sub`, `mulInt`, `mulRatio`, `sum`) make. Each of them throws a RangeError rather than leave the safe integer range, so every amount is a whole number of cents.

## Where content is loaded

- `src/content/foodtruck.json` holds the food truck's numbers: the products (with their packaging), the truck's price and useful life, the monthly costs, the fuel per open day, the card payments, payday, walk-ins, the decisions a game starts with (`startingDecisions`) and the limits the player's decisions are held to (`decisionLimits`). The walk-ins are the crowds of the truck's spot: the opening hours, the arrival slots, the noise, and for each type of day (`semaine`, `finDeSemaine`) its traffic, segment shares, product appeal, patience and arrival curve. The `service` is how long serving a customer takes, a base plus a time per unit ordered, and how many customers still waiting a newcomer will stand behind. The `marketing` is what the budget brings: the days awareness averages (`awarenessDays`), the extra walk-ins per square root of a cent of awareness (`extraCustomersPerSqrtCent`) and their segment shares. `loadFoodTruckContent()` in `src/content/schema.ts` validates it with zod and types its money as `Cents`. Every object is strict, so a mistyped key fails instead of being dropped.
- `src/content/difficulty.json` holds the three ways to start a game: the cash in the bank once the truck is settled, how the truck comes, owned, bought with a loan (its amount, yearly rate in basis points and term in months) or leased (its monthly lease), and the owner's own savings. `loadDifficultyContent()` in `src/content/schema.ts` validates it.
- `src/content/personal.json` holds what the owner's own life costs: the rent on the 1st of each month (`rentCents`) and the week's other expenses on payday (`weeklyExpensesCents`). The savings the owner starts with are each difficulty's `startingPersonalCashCents` in `src/content/difficulty.json`. `loadPersonalContent()` in `src/content/schema.ts` validates it.
- `src/content/energy.json` holds what tires the owner and what fatigue does, on the energy scale of 0 to 100: the cost of an open day (`openDayCost`) and of each customer served (`costPerCustomerServed`), what a night (`nightRecovery`) and a closed day (`closedDayRecovery`) give back, the stress of a payday in debt (`debtStress`), and for `tired` (« Fatigué ») and `exhausted` (« Épuisé ») the energy they start below, how much longer serving takes and the share of units botched. `loadEnergyContent()` in `src/content/schema.ts` validates it, with `exhausted.below` under `tired.below`.
- `src/content/segments.json` holds the customer segments: how long each waits in line (`patienceMinutes`), for each segment and product a reference price, a base purchase probability and a sensitivity, and for the chic segment how a price far below its reference puts it off (`tooCheap`). `loadCustomerContent()` in `src/content/schema.ts` validates it the same way.
- `src/engine/day.ts` calls the five loaders once, when the module loads, and exports the results as `FOOD_TRUCK`, `CUSTOMERS`, `DIFFICULTIES`, `PERSONAL` and `ENERGY`. An invalid file throws as soon as the engine is imported.
- `createInitialState()`, `tick()`, `playDay()`, `openingJournal()`, `startingDecisions()` and `applyDecision()` take a `content` argument that defaults to `FOOD_TRUCK`. `tick()` and `playDay()` take a `customers` argument after it that defaults to `CUSTOMERS`, `createInitialState()`, `tick()`, `playDay()` and `openingJournal()` a `difficulties` argument that defaults to `DIFFICULTIES`, and `tick()` and `playDay()` a `personal` argument that defaults to `PERSONAL`, then a last `energy` argument that defaults to `ENERGY`, so a test can play with other numbers. `servers()` takes the energy content it reads as its second argument. The UI, the simulation and the invariant test use the defaults.
- The UI reads `FOOD_TRUCK` too: product names in `src/ui/TodayPanel.tsx`, and the monthly costs for the cash gauge in `src/ui/cashLevel.ts`. The new game screen reads `src/content/difficulty.json` through `src/ui/newGame.ts`.
- `src/content/pacing.json` (real milliseconds per game day, the speeds, the most days per animation frame) is read by `src/ui/gameLoop.ts` and `src/ui/TopBar.tsx`. `src/content/cashGauge.json` is read by `src/ui/cashLevel.ts`. The engine reads neither: it knows nothing of real time.

Some numbers stay in code on purpose, because they are facts rather than tunables:
- the calendar, in `src/engine/calendar.ts`;
- the 12 months the owner's personal account keeps, in `src/engine/personal.ts`;
- the owner's energy scale, 0 to 100, in `src/engine/energy.ts` and `src/content/schema.ts`;
- the first weekend day, in `src/engine/customers.ts`;
- the ISO weekdays, 1 = Monday to 7 = Sunday, in `src/engine/decisions.ts` and `src/content/schema.ts`;
- the minutes in a day, in `src/content/schema.ts`;
- the mulberry32 constants, in `src/engine/rng.ts`;
- the chart of accounts, in `src/finance/accounts.ts`;
- the structure and labels of the statements, in `src/finance/statements.ts`.

## Invariants enforced by `tests/invariants.test.ts`

The test plays 3650 days, ten years, for three games, one per difficulty: seed 1 at Facile, seed 42 at Moyen and seed 2026 at Difficile. It calls `tick()` with the shipped content and its starting decisions.

After every day's close, it checks:
- the trial balance up to that day: total debits equal total credits. It keeps each account's balance as a running tally, adding each day's new entries once, rather than summing the whole journal again every day;
- the bilan: Actifs = Passifs + Capitaux propres;
- Stocks: the ledger balance of 1200, read from the tally, equals `inventoryValue()` of the lots on hand.

At the end of every calendar month, it checks that `trialBalance()` in `src/finance/journal.ts` balances and agrees with the tally on every account, and that the état des flux de trésorerie's net change for the month equals the change in Encaisse. Day 0 is May 1st, so the run covers exactly 120 months: the whole of Moyen's loan and the whole useful life of the truck.

It then plays each game again through `simulate()` in `tools/sim/simulate.ts`, at the same difficulty, and checks:
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
  - the memos in "The starting state" name every entry each difficulty's books open with;
  - every entry a day posts is one of the memos in "Order of operations in `tick()`", in the same order, and each of those memos posts within five weeks of play at the three difficulties. It checks the order of the entries only, not the order of steps that post nothing.
