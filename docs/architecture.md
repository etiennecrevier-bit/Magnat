# Architecture

How the game is put together at the end of phase 1: the folders and who may import whom, the frozen contract in `src/engine/types.ts`, the order in which a day is played, the event cards, how the books are written and read, where the tunable numbers come from and what the 10-year invariant test checks. `tools/architecture-doc.test.ts` keeps parts of this page in step with the code (see the last section).

## Layout and dependencies

| Folder | Holds | Imports from other folders |
| --- | --- | --- |
| `src/engine/` | Game rules: the clock, a day of business, walk-in customers, the marketing budget, the player's decisions, the owner's personal account and energy, the event cards and what their choices do, the changes they make to the street for a while, the customers who pay later, the week in numbers, lots and FIFO, money, the seeded generator, the shared types | `src/finance/` (journal, accounts, loan, receivables, statements) and `src/content/schema.ts` |
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
- the world never imports the functions that change the game, listed in `GAME_CHANGERS` (`postEntry`, `applyDecision`, `tick`, `playDay`, `drawEvent`, `resolveEvent`, `applyEffect` and `startOfDay`), nor a whole engine, finance or UI module with `import * as`, and never calls the store's `advance()`, `setState()` or `startGame()`. Its tests may, to build the states they draw;
- neither content nor the world uses dynamic `import()`.

Randomness and the browser are allowed in the world, since nothing it does reaches the engine.

## The contract

`src/engine/types.ts` holds the types the engine, the books, the UI and the tools share. It is frozen at the end of phase 1: changing it needs a dedicated card. It holds types only, with no code. P2-02 (#45) was such a card: it added `segments` and `visits` to `DaySummary`, with `SegmentSummary`, `Visit` and `VisitOutcome`. So was P2-04 (#46): it added `decisions` and `pendingDecisions` to `GameState`, with `Decisions`. And P2-11 (#53): it added `profile` to `GameState`, with `Profile`. And P2-03 (#62): it added `leftLine`, `averageWaitSeconds` and `longestWaitSeconds` to `DaySummary`, `servedMinute` and `leftMinute` to `Visit`, and `'leftLine'` to `VisitOutcome`. And P2-05 (#63): it added `marketingHistory` to `GameState`. And P2-17 (#83): it added `personal` to `GameState`, with `PersonalAccount` and `PersonalMovement`. And P2-16 (#82): it added `energy` to `GameState`, `energy` and `botched` to `DaySummary`, and `botched` to `Visit`. And P3-03 (#91): it added `events` and `receivables` to `GameState`, with `EventsState`, `PendingEvent`, `DelayedEffect`, `FollowUp`, `EventRecord`, `Headline` and `Receivable`; a version 7 save, from before it, loads as a game with no event yet and nobody owing anything. And P3-04 (#92): it added `modifiers` to `EventsState` and to `DaySummary`, with `StreetModifier`; a version 8 save, from before it, loads as a game with no change to the street. And P3-09 (#97): it added `weekSoFar`, `lastWeek` and `weekHistory` to `GameState`, with `WeekSoFar`, `WeekDay`, `WeekReport` and `WeekRecord`. A version 9 save, from before it, loads with no week reported yet and the week under way counted from its last close. And P3-11 (#99): it added `challenge` to `GameState`, with `ChallengeState`, `ChallengeProgress` and `ChallengeStatus`; a version 10 save, from before it, loads as a game that is not a Défi (`SAVE_VERSION`, 11, in `src/engine/save.ts`).

The engine is deterministic: the same seed, played with the same code, the same content and the same decisions on the same days, always posts the same journal, so it always gives the same `journalHash`. A replay is only guaranteed within one version of the code and content, though. Changing the order of the generator draws, the order of a day's entries or a number in `src/content/` can change the journal a seed produces without touching `types.ts`.

## The shape of `GameState`

### `GameState`

The whole game. `createInitialState()` and `tick()` return it at the start of business day `day`, with `lastDay` summing up the day before. `playDay()`, which `tick()` calls, returns it at the close of `day`: `day` has not moved yet and `lastDay.day` equals `day`. Only `tick()` moves on to the next day. It may return the next morning with an event waiting for the player's choice, which `resolveEvent()` plays on that same morning, before the day can be played.

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
| `energy` | `number` | The owner's energy, from 0 to 100 (`FULL_ENERGY` in `src/engine/energy.ts`): on the morning of `day`, or at its close in what `playDay()` returns. A tired owner serves slower and botches units (steps 2 and 8 below). An event's choice may change it, on the morning it is made or at the start of a later day. |
| `events` | `EventsState` | The event cards: the one waiting for the player's choice, what the choices made still have to do, and every event that came up with what the player chose. |
| `receivables` | `readonly Receivable[]` | What customers who pay later owe the business, by due day, then in the order they were sold. Their amounts add up to the balance of Comptes clients (1100). |
| `weekSoFar` | `WeekSoFar` | The days of the week under way played so far (step 10 below). |
| `lastWeek` | `WeekReport \| null` | The last week whose Sunday was played, for the « Bilan de la semaine » of the next morning. Null until one is. |
| `weekHistory` | `readonly WeekRecord[]` | The last 52 weeks whose Sunday was played, oldest first, the last one `lastWeek`'s: for the best week ever and a longer chart. |
| `challenge` | `ChallengeState \| null` | The Défi the game plays, as `startChallenge()` started it and each close updates it ("Défis" below). Null in a game that is not one. |

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
| `label` | `string` | What it was, in French: « Salaire », « Loyer » or « Dépenses de la semaine », from `LABELS` in `src/engine/personal.ts`, or the `label` of an event's `personal` effect, which `addMovement()` in the same file records. |
| `amount` | `Cents` | Above zero for « Salaire », below zero for the other two, of either sign for an event's. A movement of 0 is never recorded. |

### `EventsState` and `PendingEvent`

The event cards of a game: dilemmas from `src/content/events.json` that come up on a morning and wait for the player's choice before the day can be played. `src/engine/events.ts` draws them and plays the choices, and `src/engine/effects.ts` applies what the choices do ("Event cards" below).

| Field | Type | Meaning |
| --- | --- | --- |
| `pending` | `PendingEvent \| null` | The event waiting for the player's choice on the morning of `day`; null when none is. `playDay()`, and so `tick()`, throws an Error while one is. |
| `delayed` | `readonly DelayedEffect[]` | Effects of the choices made that run on a later day, by day, then in the order they were queued. Each runs at the start of its day, before step 0. |
| `followUps` | `readonly FollowUp[]` | Events another one brings back on a later morning, by day, then in the order they were queued. |
| `history` | `readonly EventRecord[]` | Every event that came up and what the player chose, oldest first. The `oncePerGame` and `cooldownDays` conditions read it. |
| `lastDrawnDay` | `Day \| null` | The last morning an event was drawn, follow-ups aside; null until one is. `pacing.minDaysBetween` counts from it. |
| `headlines` | `readonly Headline[]` | The La Presse-Citron headlines the choices queued, oldest first. |
| `modifiers` | `readonly StreetModifier[]` | The changes to the street the choices made that are still in effect, in the order they were made. The close of a change's last day drops it (step 9 below). |

A `PendingEvent` is the event waiting:

| Field | Type | Meaning |
| --- | --- | --- |
| `event` | `string` | The event's `id` in the content. |
| `followUp` | `boolean` | Whether another event brought it back, rather than the morning's draw. |

### `DelayedEffect` and `FollowUp`

What a choice leaves for later. A `DelayedEffect` is an effect that starts on a later day:

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | `Day` | The day it runs, at its start: after the effect's `inDays`, or on its next `onNextWeekday` (`whenDue()` in `src/engine/effects.ts`). Always after the morning the choice was made. |
| `event` | `string` | The id of the event whose choice it comes from. |
| `effect` | `EventEffect` | What it does: an effect as `eventEffectSchema` in `src/content/schema.ts` types it, without the timing the content gave it (`untimed()` in `src/engine/effects.ts`). |

A `FollowUp` is an event another one brings back:

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | `Day` | The morning it comes up, or the first one after it with no other event waiting. |
| `event` | `string` | The event's id in the content. |

### `EventRecord`

An event that came up, and what the player chose. `resolveEvent()` adds one each time it plays a choice.

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | `Day` | The morning it came up and was chosen. |
| `event` | `string` | The event's id in the content. |
| `followUp` | `boolean` | Whether another event brought it back, rather than the morning's draw. |
| `choice` | `string` | The id of the choice made. |
| `outcome` | `number` | Which of the choice's outcomes came, counting from 0. |

### `Headline`

A La Presse-Citron headline a choice queued with a `headline` effect. The ticker along the bottom of the game (`src/ui/Ticker.tsx`) shows it, with its text from `headlines.fr.json` in `src/content/`; without that file, the ticker stays hidden.

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | `Day` | The day it was queued. |
| `id` | `string` | The headline's id, as the effect names it. |

### `StreetModifier`

A change to the street a choice made, for a while: one of the effects `walkIns`, `appeal`, `willingness`, `unavailable` and `closed` ("Event cards" below). `applyEffect()` in `src/engine/effects.ts` makes one, on the morning of the choice or at the start of a delayed effect's day, so it changes that day and the ones after. `streetOn()` in `src/engine/street.ts` folds those in effect on a day together, and `inEffect()` in the same file lists them.

| Field | Type | Meaning |
| --- | --- | --- |
| `event` | `string` | The id of the event whose choice made it. The UI and the world tell the changes apart by it. |
| `change` | `StreetChange` | What it changes: the effect without its `days`, as `streetChangeSchema` in `src/content/schema.ts` types it. `walkIns` multiplies the walk-ins of every segment, or of its `segment`, by its `factor`; `appeal` one `product`'s appeal; `willingness` what every segment, or its `segment`, will pay; `unavailable` takes a `product` off sale; `closed` closes the truck. |
| `fromDay` | `Day` | The day it was made, its first day in effect. |
| `lastDay` | `Day` | Its last day in effect: `fromDay` + the effect's `days` − 1. |

### `Receivable`

What one customer owes for one sale on credit, an event's `creditSale` effect. `src/engine/effects.ts` keeps the list: the start of each day collects those due that day (before step 0 below), and the `collectReceivable`, `writeOff` and `delayReceivable` effects settle or put off what one client owes. `deserialize()` checks that the amounts add up to the balance of Comptes clients (1100).

| Field | Type | Meaning |
| --- | --- | --- |
| `client` | `string` | Who owes it, as the journal names them: the sale's memo is « Vente à crédit · » followed by it. |
| `amount` | `Cents` | What they owe; above zero. |
| `soldOnDay` | `Day` | The day of the sale. |
| `dueDay` | `Day` | The day it is collected, at the start of the day; after `soldOnDay`. |

### `WeekSoFar` and `WeekDay`

The week under way, Monday to Sunday, as its days are played. `src/engine/week.ts` keeps it: the close of each day adds the day, and the close of each Sunday sums the week up as a `WeekReport` and starts the next week (step 10 below). Day 0 is a Monday, so weeks run from day 7k to day 7k + 6; `mondayOf()` and `sundayOf()` in `src/engine/calendar.ts` find them.

| Field | Type | Meaning |
| --- | --- | --- |
| `cashAtStart` | `Cents` | Encaisse when the week started: the bilan's at the close of the Sunday before, or, for a partial week, before its first day. On day 0, that is the cash the books open with, its opening entries included (`openingWeek()` in `src/engine/week.ts`). |
| `partial` | `boolean` | Whether the week started without the close of the Sunday before: the first week of a game, or the week under way when a version 9 save loaded, which only covers the days played after it. |
| `days` | `readonly WeekDay[]` | The days played so far, one after the other; never a Sunday, whose close starts the next week. |
| `modifiers` | `readonly StreetModifier[]` | The changes to the street in effect on any of those days, from `lastDay.modifiers`, so those that ended are kept, in the order they were made. |

A `WeekDay` is one day of a week, as of its close:

| Field | Type | Meaning |
| --- | --- | --- |
| `day` | `Day` | The business day. |
| `open` | `boolean` | Whether the truck opened: one of the days open that the street did not close. |
| `sales` | `Cents` | Ventes posted that day, paid in cash or on credit: what the day's entries credit 4000 Ventes, as the état des résultats of that day has it. |
| `cashReceived` | `Cents` | Cash received from customers: what the day's entries that credit 4000 Ventes or 1100 Comptes clients debit to 1000 Encaisse, so the *Ventes au comptant*, an event's cash sale and each « Encaissement », not a sale on credit. It equals « Encaissements des clients » on the état des flux de trésorerie of that day. |
| `cashAtClose` | `Cents` | Encaisse at the close, as the bilan has it; it may be negative. |
| `customersServed` | `number` | Visits that reached the counter, those with a `servedMinute`. |
| `spoiled` | `PerProduct` | Units written off at the close, `lastDay.spoiled`. |
| `spoiledCost` | `Cents` | What they cost: the day's *Marchandises périmées*. |
| `lostToLine` | `number` | Visits that left the line, `lastDay.leftLine`. |
| `lostToPrices` | `number` | Visits that bought nothing because a price was too high: the segments' `tooExpensive`, summed. |
| `lostToStockouts` | `number` | Visits that bought nothing because what they wanted had sold out: the segments' `soldOut`, summed. |

### `WeekReport` and `WeekRecord`

A week whose Sunday was played, as `GameState.lastWeek` keeps it for the « Bilan de la semaine ». The engine computes every number; the UI only words and formats them. `weekFacts(report, content)` in `src/engine/week.ts` picks the facts worth telling (see "Where content is loaded" below).

| Field | Type | Meaning |
| --- | --- | --- |
| `firstDay` | `Day` | The week's Monday. |
| `partial` | `boolean` | As in `WeekSoFar`: the first week of a game, or the first after a version 9 save loaded. |
| `days` | `readonly WeekDay[]` | The days played, one after the other up to the Sunday: all 7 unless the week is partial and started after its Monday. |
| `sales` | `Cents` | Ventes over those days, from `incomeStatement()` in `src/finance/statements.ts`. |
| `netIncome` | `Cents` | Bénéfice net over those days, from the same état des résultats; negative for a loss. |
| `cashAtStart` | `Cents` | Encaisse when the week started, as `WeekSoFar` has it. |
| `cashAtEnd` | `Cents` | Encaisse at the close of the Sunday. |
| `lowestCash` | `Cents` | The lowest Encaisse at the close of any of the days. |
| `spoiled` | `PerProduct` | Units written off over the week. |
| `spoiledCost` | `Cents` | What they cost. |
| `lostToLine` | `number` | Visits that left the line, over the week. |
| `lostToPrices` | `number` | Visits that bought nothing because a price was too high. |
| `lostToStockouts` | `number` | Visits that bought nothing because what they wanted had sold out. |
| `energy` | `number` | The owner's energy at the close of the Sunday, before the night. |
| `daysOpenInARow` | `number` | The days in a row the truck opened up to the Sunday: back into the weeks before when every day of this one opened. |
| `receivables` | `readonly Receivable[]` | What customers still owed at the close of the Sunday, by due day. |
| `unpaidRents` | `readonly Day[]` | The days of the week the owner's rent went unpaid. |
| `events` | `readonly EventRecord[]` | The events that came up on the mornings of the week, and the choices made. |
| `modifiers` | `readonly StreetModifier[]` | The changes to the street in effect on any day of the week, in the order they were made. |
| `previousBest` | `Cents \| null` | The highest ventes of any earlier week of the game, carried from week to week so it outlives `weekHistory`; null for the first week reported, a version 9 save's included. |

A `WeekRecord` is what `weekHistory` keeps of a week:

| Field | Type | Meaning |
| --- | --- | --- |
| `firstDay` | `Day` | The week's Monday; each record's is 7 days after the one before. |
| `sales` | `Cents` | Ventes over the week. |
| `netIncome` | `Cents` | Bénéfice net over the week. |
| `cashAtEnd` | `Cents` | Encaisse at the close of the Sunday. |

### `ChallengeState`, `ChallengeProgress` and `ChallengeStatus`

A Défi under way or over: a short game from `src/content/defis.json` with one goal and a medal ("Défis" below). `src/engine/challenge.ts` keeps it: `startChallenge()` starts it with nothing played, and the close of each of its days adds the day to its progress (step 11 below).

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | The Défi's id in the content. |
| `startDay` | `Day` | The Défi's first business day, from its date in the content: day 0 is May 1st. Nothing is played before it. |
| `progress` | `ChallengeProgress` | Where the Défi stands, as of the last close. |
| `lowestEnergySinceClose` | `number` | The owner's lowest energy since the last close, that close's included, or since the Défi's first morning: every effect that moves the energy, of a choice or of the start of a day, lowers it to where the energy ends if that is lower (`withEnergyAt()` in `src/engine/challenge.ts`, which `applyEffect()` calls). So an effect that takes energy counts even when the next one gives it back at once, and a save made after a choice keeps it. The next close adds it to `progress.lowestEnergy`, then starts again from the close's energy. |
| `status` | `ChallengeStatus` | Under way, won or lost. |
| `medal` | `Medal \| null` | The medal won, `'or'`, `'argent'` or `'bronze'` (`Medal` in `src/content/schema.ts`); null unless the Défi is won. |

`ChallengeStatus` is `'enCours'` (« en cours »), `'reussi'` (« réussi », with a medal) or `'echoue'` (« échoué »: a condition broke, or the last day ended short of bronze), French ids like the content's.

A `ChallengeProgress` adds up the Défi's days played so far:

| Field | Type | Meaning |
| --- | --- | --- |
| `daysPlayed` | `number` | The Défi's days played, from `startDay` to `lastDay.day`. |
| `sales` | `Cents` | Ventes over those days, from `incomeStatement()` from `startDay` to the last close. |
| `netIncome` | `Cents` | Bénéfice net over those days, from the same; negative for a loss. |
| `lowestCash` | `Cents` | The lowest Encaisse since the books opened, after any entry up to the last close, not only at a close: a morning's purchases that leave the cash below zero count even when the day's sales bring it back. It starts at the cash the books open with. `lowestCashSince()` in `src/engine/challenge.ts` reads it from the books, as the balance bot's `lowestCash()` in `tools/balance/play.ts` does. |
| `customersServed` | `number` | Visits that reached the counter, those with a `servedMinute`, as `WeekDay` counts them. |
| `unitsSold` | `number` | Units sold to customers at the counter, from each `lastDay.sold`. |
| `unitsSpoiled` | `number` | Units written off at the close, from each `lastDay.spoiled`. The spoilage rate is `unitsSpoiled` over `unitsSold` + `unitsSpoiled`, 0 when both are 0. |
| `lowestEnergy` | `number` | The owner's lowest energy since the Défi began, up to the last close: on its first morning, then after each effect of a choice or of the start of a day, through `lowestEnergySinceClose`, and at each close, before the night. A dip a later effect, a closed day or a night makes up still counts. |

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
| `modifiers` | `readonly StreetModifier[]` | The changes to the street in effect that day, in the order they were made, each with the id of the event that made it. A change whose last day it was is here, though `events.modifiers` no longer holds it. |

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
- `energy` at 100, `FULL_ENERGY`;
- `events` from `noEvents()` in `src/engine/events.ts`: no event waiting, nothing to come, no history, no headline and a null `lastDrawnDay`;
- no `receivables`;
- `weekSoFar` from `openingWeek()` in `src/engine/week.ts`: partial, with no day, starting from the Encaisse of the opening books, a null `lastWeek` and an empty `weekHistory`;
- a null `challenge`. `startChallenge()` in the same file starts a Défi instead ("Défis" below).

## Order of operations in `tick()`

<!-- tools/architecture-doc.test.ts plays days of each difficulty and checks
that every entry a day posts is one of the memos in italics below, in the same
order, and that each of them posts. Keep every memo in italics, once, and
nothing else in italics in this section. It plays with no event, so the
entries of the event cards are in « » instead. -->

`tick(state)` in `src/engine/clock.ts` calls `playDay(state)` in `src/engine/day.ts`, which throws an Error while an event waits for the player's choice, when `events.pending` is not null, and once the game's Défi is over. It then takes the state `playDay` gave back to the next morning: `day` + 1, the pending decisions, if any, as its `decisions`, a null `pendingDecisions`, and the night's rest: `nightRest()` in `src/engine/energy.ts` adds `nightRecovery` to the owner's `energy`, up to 100. Last, `drawEvent()` in `src/engine/events.ts` may bring up that morning's event, which then waits in `events.pending` ("Event cards" below says how). It draws from the event content `tick()` takes as its last argument, `events`, which defaults to `NO_EVENTS`, an empty list in the same file: then no event ever comes up and the generator does not move. A caller turns the event cards on by passing `EVENTS` from `src/engine/day.ts`. In a Défi, the morning brings the event the Défi forces that day in place of the draw, the draw has no chance of a new event unless the Défi lets random events come, though a follow-up still comes, and the morning after the Défi ends brings nothing ("Défis" below). `playDay` reads the date of `state.day` from `toCalendar()`, plays the day with `state.decisions` and never reads `pendingDecisions`. It goes through these steps in this order. Every entry it posts is dated `state.day`.

Before step 0, every day, open or closed, comes the start of the day, by `startOfDay()` in `src/engine/effects.ts`. First the delayed effects due that day, in the order they were queued, each applied as "Event cards" below says, with the entries listed there. Then each receivable due that day, in the order they were sold, collected in full in an entry of its own, « Encaissement · » followed by the client: Dr 1000 Encaisse / Cr 1100 Comptes clients. A game with no event has neither, so its days start with step 0. Then `streetOn()` in `src/engine/street.ts` folds the changes to the street in effect that day together, those of `events.modifiers` from their `fromDay` to their `lastDay`: each segment's walk-ins, each product's appeal and what each segment will pay are 1 unless a change multiplies them, several changes multiply each other, and a change with no segment multiplies every one's. A product one change takes off sale is, and one `closed` change closes the truck.

Step 0 happens on the 1st of the month, open or closed. Steps 1 to 4 happen only on a day the truck opens, when `decisions.daysOpen` holds the weekday and no change to the street closes it. On a closed day, by the days open or by the street, nobody comes, nothing is bought and nothing is spent on marketing: no purchase, no sale, no fuel, no marketing, no walk-in drawn from the generator, and a `lastDay` with no visit and nothing sold. Step 5 happens on payday, open or closed, and steps 6 to 10 every day.

0. **The month's charges**, from `monthlyCostsCents` in the content and the difficulty in `state.profile`. Day 0 is May 1st, so the first month is charged on day 0. Entry *Permis, stationnement et cuisine*: Dr 6100 Loyer et permis / Cr 1000 Encaisse for `permitParkingAndCommissary`. Entry *Assurances*: Dr 6150 Assurances / Cr 1000 for `insurance`. Then the truck's, by how it came:
   - The truck's months count from the game's first day, as if the truck came to the business then: month `k` is `monthsSinceStart()` of the day minus that of day 0, or of a Défi's first day. So a Défi that starts in July pays its loan's first payment on August 1st, not its third.
   - Moyen pays its loan from the month after the loan: the 1st of month `k`, for `k` from 1 to `termMonths`, pays payment `k` of `loanSchedule(loanCents, annualRateBasisPoints, termMonths)` in `src/finance/loan.ts`. Entry *Intérêts sur l'emprunt*: Dr 7000 Intérêts / Cr 1000 for its interest, which a loan without interest never posts. Entry *Remboursement de l'emprunt*: Dr 2500 Emprunts bancaires / Cr 1000 for its principal.
   - Facile and Moyen depreciate the truck straight line from month 0 to month `usefulLifeMonths` − 1, then stop. Entry *Amortissement du camion*: Dr 6400 Amortissement / Cr 1510 Amortissement cumulé for `truck.priceCents` ÷ `usefulLifeMonths`, rounded down to the cent; the last month adds what the rounding left, so the months add up to the price.
   - Difficile leases it. Entry *Location du camion*: Dr 6120 Location du camion / Cr 1000 for `monthlyLeaseCents`.
1. **Morning restock.** For each product in `PRODUCTS` order, its rule in `decisions.restock` sets the order size. `buyDaily` buys `quantity` units. `topUp` buys up to `upTo` units on hand when the units on hand are below `whenBelow`. Each purchase becomes a new lot at the end of `inventory`, at the product's `unitCostCents`. A product the street takes off sale is not bought at all. Entry *Achat de marchandises*: Dr 1200 Stocks / Cr 1000 Encaisse for what the day's purchases cost.
2. **Walk-ins.** `serveWalkIns()` in `src/engine/customers.ts` serves the day's customers. `dayTypeOf()` gives the crowd: `finDeSemaine` on Saturday and Sunday, `semaine` otherwise, each with its own traffic, segment shares, product appeal and arrival curve in `walkIns.dayTypes`. Marketing brings an extra crowd on top, from `marketingCrowd()` in `src/engine/marketing.ts`. The day's awareness is what `marketingHistory` holds, summed and divided by `marketing.awarenessDays`: the average spend of the days before, a closed day or a day before the game counting as 0, and today's spend not counted, so a budget pays off from the next day. The extra crowd is `extraCustomersPerSqrtCent` × √awareness, awareness in cents, so double the budget brings √2 times the walk-ins. They come and behave like the day type's crowd, but their segments follow `marketing.segmentShares`. Prices come from `currentPrice(state, product)` in `src/engine/day.ts`, which returns the product's price in `decisions.prices`. The street changes the day as the changes in effect fold together: the crowd's appeal for each product is multiplied by the street's, each segment's reference prices by what it will pay, each rounded to the cent half away from zero by `mulRatio()` and never below 1 cent, and a product off sale counts as none on hand, however many units are. The draws come in this order, and their number never depends on the prices, the stock, the appeal or what customers will pay, so a seed brings the same customers at every price:
   1. `normal()` draws twice for a noise factor with a mean of 1 and a standard deviation of `noiseStdDevRatio`. The day's base customers are the crowd's `customers` × noise, and its extra customers the extra crowd × the same noise, each rounded and never below zero.
   2. Each base customer in turn draws once for an arrival minute (a slot of `arrivalSlotMinutes` picked by its weight in `arrivalWeights`, then the minute within it), once for a segment, picked by its share, then once per product, in `PRODUCTS` order. They want one unit when the draw is below `purchaseProbability()` in `src/engine/customers.ts`, whose doc comment gives the formula: the segment's base probability × the crowd's appeal for the product × a logistic curve in price ÷ reference price, clamped to [0, 1]. Since each customer makes all their draws before the next one starts, a bigger crowd from the same generator state brings the same customers first, wanting the same things, then more.
   3. Then each extra customer draws the same way, with a segment picked by `marketing.segmentShares`. So marketing leaves the base customers' draws as they would be without it, then brings its own. A budget does change how many draws a day takes, so the days after it bring other customers than a game without it.
   4. Then, when the street multiplies a segment's walk-ins by more than 1, the street's crowd draws the same way: for each such segment, its factor − 1 times the customers of that segment the day type's crowd and marketing bring, before the noise, rounded after the same noise, with a segment picked by each one's share of them. A segment the street cuts adds nothing to it, so a cut never takes from what another segment gains. With none above 1, it draws nothing.

   Of a segment the street multiplies by less than 1, the base and extra customers are drawn all the same, but the k-th of them, counting from 1 in draw order, comes only when round(k × factor) goes up at it: a quota, like the botched units, rather than a draw. So round(n × factor) of n come, and a cut leaves the generator where it would be without it: construction changes the walk-ins of its own days and of no other. A segment whose factors multiply to exactly 1 is left alone.

   No other step draws. Only the event cards draw besides ("Event cards" below): at the start of the day, a delayed `followUp` effect with a chance below 1, before the walk-ins; at the end of `tick()`, the next morning's draw; and on that morning, before the day is played, the player's choice in `resolveEvent()`. So with no event, these are all of a day's draws. Then the customers come to the counter by arrival minute, those of the same minute in the order they were drawn, base customers first, then marketing's, then the street's, each at the start of their minute. Every crowd shares the line and the stock. One who wants nothing walks on. One who wants something looks at the line, which `openLine()` in `src/engine/service.ts` keeps, first come, first served. They leave it at once, buying nothing, when more than `service.maxAheadInLine` customers are still waiting, not counting those at the counter, or when the wait for the first free server is longer than their patience: their segment's `patienceMinutes` × the crowd's `patienceMultiplier`. Otherwise they join and order what they want, which takes their server `service.baseSeconds` + `service.perItemSeconds` × the units ordered, divided by the server's speed; a sold-out unit takes its time too, so the line never depends on the stock. `servers(state, energy)` in the same file gives who serves: for now the avatar alone, at speed 1 when rested. How tired the owner is that morning, by `state.energy`, holds for the whole day (`fatigueOf()` and `effectsOf()` in `src/engine/energy.ts`, with the thresholds and effects of `src/content/energy.json`). Below `tired.below` (« Fatigué ») or `exhausted.below` (« Épuisé »), serving takes `serviceTimeIncrease` longer, so the avatar's speed is 1 ÷ (1 + `serviceTimeIncrease`). When they reach the counter they buy each unit they want that is left; one that is not is a lost sale, so a stockout hits the customers served later. A tired owner also botches `botchedShare` of the units they make, by a fixed quota rather than a draw: counting the units made for customers that day from 1, remakes aside, the n-th is botched when ⌊n × `botchedShare`⌋ goes up at it, so at 2 % every 50th. A botched unit leaves the stock and is thrown out, and the next unit left is made in its place; with none left, the customer loses it as a lost sale. Making it again takes no time, so the line still never depends on the stock. The counter keeps the order in which it took each product's units, sold or botched, for step 3. This step posts nothing. A closed day draws no walk-in, so the days open change which draws the later days get.
3. **Sales.** Product by product, in `PRODUCTS` order, the units the customers bought, and those botched, leave the stock, oldest lot first (FIFO, `takeFifo()` in `src/engine/inventory.ts`), in the order the counter took them, and those bought are priced at `currentPrice()`. Taking a run of a product's units at once takes the same units from the same lots as taking them one customer at a time; a rested day has a single run per product, its day total. Entry *Ventes au comptant*: Dr 1000 Encaisse / Cr 4000 Ventes for the revenue. Then entry *Coût des marchandises vendues*: Dr 5000 Coût des marchandises vendues / Cr 1200 Stocks for what the units sold cost, each at its own lot's unit cost. Then entry *Produits ratés*: Dr 5100 Pertes sur stocks / Cr 1200 for what the botched units cost, each at its own lot's unit cost; a botched unit takes no packaging. Then what the sales cost to make, paid the same day. Entry *Emballages*: Dr 5200 Emballages / Cr 1000 for each unit sold times its product's `packagingCents`. Entry *Frais de cartes*: Dr 6500 Frais bancaires et de cartes / Cr 1000 for the card fees: the revenue times `cardPayments.share` is what customers paid by card, and that times `cardPayments.feeRate` is the fee, each rounded to the cent half away from zero by `mulRatio()`. Each of these is an entry of its own, so the other lines of each cash entry stay on one row of the état des flux de trésorerie.
4. **Fuel and marketing.** Entry *Carburant et entretien*: Dr 6200 Carburant et entretien / Cr 1000 for `fuelAndMaintenancePerOpenDayCents`. Then entry *Marketing*: Dr 6300 Marketing / Cr 1000 for `decisions.marketingDaily`.
5. **Payday**, on the ISO weekday `ownerPayWeekday`. Entry *Paie du propriétaire*: Dr 6000 Salaires / Cr 1000 for `decisions.ownerWeeklyPay`. A change the player makes is paid from the next morning, like every decision.
6. **Spoilage at the close.** `removeExpired()` in `src/engine/inventory.ts` writes off every lot whose shelf life ends that day, as `Lot` describes above. Entry *Marchandises périmées*: Dr 5100 Pertes sur stocks / Cr 1200 Stocks for what those lots cost.
7. **The owner's personal account**, after the business's day, by `livePersonalDay()` in `src/engine/personal.ts`, with the owner's living costs from `src/content/personal.json`. It posts nothing and draws nothing. On payday, « Salaire » brings in `decisions.ownerWeeklyPay`, the amount the business paid in step 5. On the 1st of the month, day 0 included, « Loyer » takes out `rentCents`; when that leaves the cash below zero, the rent is unpaid and the day goes into `unpaidRents`. On payday again, « Dépenses de la semaine » takes out `weeklyExpensesCents`. So a Friday the 1st is paid, then charged its rent, then its week. A movement of 0 is not recorded. Then the movements and unpaid rents older than the months kept are dropped.
8. **The owner's energy**, by `energyAtClose()` in `src/engine/energy.ts`, with `src/content/energy.json`. It posts nothing and draws nothing. A day the truck opens costs `openDayCost`, plus `costPerCustomerServed` for each customer who reached the counter, the visits with a `servedMinute`, so a busy day tires more. A closed day gives `closedDayRecovery` back. Then, on payday, when step 7 leaves the owner's cash below zero (`inDebt()`), the stress takes `debtStress`. Each change stops at 0 and at 100. The night's `nightRecovery` comes in `tick()`, after the close.
9. **The new state.** `playDay` returns the state with the new `rngState`, `journal`, `inventory`, a `marketingHistory` with the day's spend added last (0 on a closed day) and only the last `awarenessDays` kept, a `lastDay` for `state.day`, with the day's visits, how the line went, the units botched, the energy at the close and the changes to the street in effect that day, the owner's `personal` account, their `energy` at the close, the `events` the start of the day left without the changes to the street whose last day it was, and the `receivables` the start of the day left.
10. **The week**, by `recordDay()` in `src/engine/week.ts`, on the state of step 9. It posts nothing and draws nothing. The day joins `weekSoFar.days` as a `WeekDay`: its ventes, the cash customers paid and the change in Encaisse come from the day's entries, the last of the journal, so its Encaisse at the close is the close before plus that change; the close before the first day of a week is `cashAtStart`, or nothing before day 0, whose entries open the books. The changes to the street in effect on the first day the week covers join `weekSoFar.modifiers`, then on each later day those that start on it. On a Sunday, the week is summed up as `lastWeek`, with its ventes and bénéfice net from `incomeStatement()` over its days and its best earlier ventes from the `lastWeek` before; it joins `weekHistory`, which keeps the last 52 weeks, and `weekSoFar` starts the next week, not partial, from the Sunday's close.
11. **The Défi**, in a game that plays one, by `recordChallengeDay()` in `src/engine/challenge.ts`, on the state of step 10. It posts nothing and draws nothing. The day joins the Défi's `progress`: the ventes and the bénéfice net from `incomeStatement()` over the Défi's days, the lowest Encaisse after any entry since the books opened, the visits served, the units sold and written off, and the owner's lowest energy, with `lowestEnergySinceClose`, which holds the morning, its choices and the start of the day, and the close, from which `lowestEnergySinceClose` starts again. Then `verdict()` in the same file gives the status and the medal: « échoué » as soon as a condition breaks, under way until the last day, then « réussi » with the best medal reached, or « échoué » short of bronze.

What every step shares:
- A line with a zero amount is dropped, and an entry left with no line is not posted. A day with nothing bought, nothing sold or nothing spoiled has no entry for that step, and a pay or a marketing budget of 0 posts nothing.
- Nothing checks the cash first: purchases and charges are paid even when Encaisse goes negative.

Outside unit tests, three callers advance the game:
- `advance(days)` in the UI store (`src/ui/store.ts`). The real-time loop in `src/ui/gameLoop.ts` calls it with the whole days that have passed at the current speed, paced by `src/content/pacing.json`. It passes `EVENTS` to `tick()` and stops on the morning an event comes up: the game pauses, the event card (`src/ui/EventCard.tsx`) opens, and the player's choice goes through `resolveEvent()` before the game can go on. « Journal des événements » (`src/ui/EventLog.tsx`) lists the events of this month and the eleven before, with what the player chose.
- `simulate()` in `tools/sim/simulate.ts`. With an event policy other than `none`, it passes its event content, `EVENTS` by default, to `tick()`, and each morning an event waits, answers it with `resolveEvent()` before playing the day (`eventChooser()` in the same file picks the choice).
- The invariant test, which answers the event cards as `simulate()` does with the `random` policy.

## Event cards

An event card is a dilemma from `src/content/events.json`: a character, a situation and two or three choices, each with outcomes left to chance and the effects of each outcome (`src/content/README.md` describes the file). The shipped file holds `essai`, a card that tries every effect for the tests, with a weight of 0 that keeps it out of a real game, then the twelve cards of P3-05 (#93), which come up in a game played with `EVENTS`, as the app's store and the sim's `--events first` and `--events random` play it.

`drawEvent(state, content)` in `src/engine/events.ts`, at the end of `tick()`, brings up the morning's event, if any. One morning brings one event at most: nothing changes while one waits, or once one was chosen that morning. Otherwise, in this order:
1. The first queued follow-up due that morning or before, whose event is in the content, comes up with no draw. It ignores the conditions, the first day and the gap, and leaves `lastDrawnDay` as it is. Another follow-up due waits for a later morning.
2. Otherwise nothing comes before `pacing.firstDay`, nor less than `pacing.minDaysBetween` days after `lastDrawnDay`, nor ever with a `pacing.dailyChance` of 0.
3. Otherwise the events that may come are those with a weight above 0, not `followUpOnly`, whose conditions all hold that morning, by `conditionsHold()` in the same file, whose doc comment lists them. With none, nothing is drawn.
4. Otherwise one draw against `pacing.dailyChance`, then one draw to pick among them by weight, and the event picked comes up with `lastDrawnDay` set to the day. A chance of 1, or a single event to pick, takes no draw.

`resolveEvent(state, choiceId, content, foodTruck)` in the same file plays the player's choice on the event waiting, on the same morning. One draw picks the outcome by its chance, unless the choice has a single outcome. The outcome's effects then run in order: those with no timing at once, by `applyEffect()`, and the others queued in `events.delayed` for their day, by `whenDue()` in `src/engine/effects.ts`: `inDays` days later, or the first day after the morning that falls on the ISO weekday `onNextWeekday`, so a week later when the morning is that weekday. The event goes into `history` and no longer waits, so the day can be played. It throws an Error when no event waits, and a RangeError when the content has no such event or the event no such choice.

`applyEffect(state, effect, content)` in `src/engine/effects.ts` applies one effect on `state.day`: on the morning of the choice, or at the start of a later day for a delayed one. Every entry is dated that day, and an entry of 0 is not posted. Every money effect goes through the books, never straight into the cash.
- `charge`: pays `amountCents` now, with its `description` as the memo: Dr its `account`, 6900 Autres charges by default / Cr 1000 Encaisse. The content may charge 5200, 6100, 6150, 6200, 6300, 6500 or 6900.
- `cashSale`: revenue paid now, with its `description` as the memo: Dr 1000 / Cr 4000 Ventes.
- `creditSale`: revenue now that `client` pays `dueInDays` later. « Vente à crédit · » followed by the client: Dr 1100 Comptes clients / Cr 4000, and a receivable.
- `collectReceivable`: each receivable of `client`, in order, collected now, in an entry of its own: « Encaissement · » followed by the client, Dr 1000 / Cr 1100.
- `writeOff`: each receivable of `client`, in order, written off in an entry of its own: « Mauvaise créance · » followed by the client, Dr 6950 Créances irrécouvrables / Cr 1100. For both, a client who owes nothing changes nothing.
- `delayReceivable`: each receivable of `client` comes due `days` later. No entry.
- `buyStock`: `units` of `product` bought now, a new lot after the others at the product's `unitCostCents`. « Achat de marchandises »: Dr 1200 Stocks / Cr 1000.
- `useStock`: up to `units` of `product` taken out of the stock, oldest lot first (FIFO), at what they cost. For an `order`, « Coût des marchandises vendues »: Dr 5000 / Cr 1200; for a `giveaway`, « Marchandises offertes »: Dr 6300 Marketing / Cr 1200.
- `energy`: the owner's energy moves by `amount`, held between 0 and 100 by `clampEnergy()` in `src/engine/energy.ts`. No entry. In a Défi, `challenge.lowestEnergySinceClose` counts where it ends.
- `personal`: a movement `label` of `amountCents` in the owner's personal account, by `addMovement()` in `src/engine/personal.ts`. No entry.
- `followUp`: `event` comes back `days` later, if one draw comes in below its `chance`; a chance of 1, the default, takes no draw.
- `headline`: the headline `id` is queued in `events.headlines`.
- `walkIns`, `appeal`, `willingness`, `unavailable` and `closed`: a change to the street for `days` days, that day included, kept in `events.modifiers` after the others as a `StreetModifier` with the event's id. `walkIns` multiplies the walk-ins of everyone, or of one `segment`, by `factor` (×0.65 for construction, ×1.8 for a festival); `appeal` multiplies one `product`'s appeal (×0.3 for chocolat chaud in a heat wave); `willingness` multiplies what everyone, or one `segment`, will pay, their reference prices (×1.1 on moving day); `unavailable` takes a `product` off sale, so the customers who want one find it sold out, and the morning buys none; `closed` closes the truck whatever the days open, a day that costs and rests like any closed day. Each factor is above 0. No entry and no draw.

So the event cards draw from the game's generator at three points: the morning draw in `drawEvent()`, the outcome in `resolveEvent()`, and a `followUp` effect with a chance below 1, in `resolveEvent()` or, delayed, at the start of its day. The choices a player makes change the draws of the days after.

A save holds the events, the changes to the street, the receivables and the week in numbers. `deserialize()` in `src/engine/save.ts` checks them against the event content, as its doc comment and `checkEvents()`'s say, so dropping an event or a choice from the content can stop an older save from loading.

## Défis

A Défi is a short game from `src/content/defis.json` (`src/content/README.md` describes the file), with one goal and a medal: 1 to 9 weeks from a date of the first season, a setup, changes to the street and events it forces, and a goal. The shipped file holds the six of P3-11 (#99), whose thresholds P3-14 (#102) tunes.

`startChallenge(defiId, seed, content, defis, difficulties, player)` in `src/engine/clock.ts` starts one. It opens a game as `createInitialState()` does, with the Défi's difficulty and the player's name and avatar, and with the Défi's cash, if it sets one, in place of the difficulty's `startingCashCents` (`challengeDifficulties()` in `src/engine/challenge.ts`). The books open on day 0 as always, then the game moves to the morning of the Défi's first day with nothing played before it: no entry, no event and no charge. Its decisions are the starting ones with the Défi's setup in their place (`setupDecisions()`), held to the content's limits and restock kinds. The owner's energy is the Défi's, or full. Each change to the street it forces is made as if by a choice of its card, with that card's id so the world shows it: those of the first day that morning, by `applyEffect()`, the others queued in `events.delayed` for their day. The event it forces on its first day waits, as if drawn that morning. Its `challenge` is under way with nothing counted, the lowest cash and energy at the opening's.

Then the game plays as any other, with these differences:
- `tick()` brings the event the Défi forces on a morning, as if drawn: it waits with `lastDrawnDay` set to the day. On another morning it draws with the event content it is given, with a `dailyChance` of 0 unless the Défi lets random events come, so a follow-up still comes. A follow-up due on a forced morning waits for the next.
- `resolveEvent()` throws a RangeError for a choice the Défi does not allow on the event it forces (`allowedChoices()`).
- `applyDecision()` throws a RangeError for a kind of change the Défi locks (`isLocked()`).
- The 1st of the month counts the truck's months from the Défi's first day (step 0 above).
- Each close adds the day to the Défi's progress and may end it (step 11 above). Once it is over, `playDay()`, so `tick()`, throws, and the morning after its last day brings no event.

`tick()`, `playDay()`, `applyDecision()`, `resolveEvent()` and `deserialize()` take the Défis content as their last argument, and `startChallenge()` after the food truck's content, each defaulting to `DEFIS` in `src/engine/day.ts`. A game started from other Défis must pass them to each, or the Défi is unknown.

A save holds the Défi. `deserialize()` reads the game's first day from it, so a game is checked from there: no day played and nothing waiting before it, the marketing history and the energy counted from it. `checkChallenge()` in `src/engine/save.ts` checks the rest against the books and the content, as its doc comment says: the ventes, the bénéfice and the lowest cash are read again from the books up to the last close, so not the entries of a choice made that morning, before the day is played. The save keeps no energy but the owner's now and at the last close, so the lowest energy is held within them: `lowestEnergySinceClose` is the last close's, or the Défi's starting energy, unless a choice was made that morning, and then no higher than that nor than the energy now.

## How journal entries are created

`src/finance/journal.ts` owns the books. A `Journal` is a branded type that only `emptyJournal()` and `postEntry(journal, entry)` make: a spread of a journal does not type-check as one, and `postEntry()`, `balance()`, `trialBalance()` and the statements throw a TypeError on any other object, such as a cast or untyped data. `postEntry` returns a new journal with the entry after the others. It throws an Error that names the memo and the day unless:
- the day is a whole number of at least 0, no earlier than the last entry's day;
- the entry has at least one line;
- every line uses an account from the chart;
- every amount is a whole, non-negative number of cents, and every line has an amount on exactly one side;
- the totals stay within the safe integer range, and the debits equal the credits.

The journal, its entries and their lines are frozen. `postEntry` copies the entry, so later changes to the object passed in never reach the books.

In the game, only the engine posts entries. It goes through the private helpers `post()`, `debit()` and `credit()` in `src/engine/day.ts`, and keeps the memos the player reads in that file's `MEMO` table. Each step of the day posts its own entries, as listed above.

The event cards' effects, and the receivables collected at the start of a day, post theirs through `src/engine/effects.ts`, which keeps its own `MEMO` table and posts with `postEntry()`. The entries of a customer who pays later, and a charge to 6900 Autres charges, come from the builders in `src/finance/receivables.ts`: `creditSale()`, `collection()`, `badDebt()` and `otherCharge()` each build one balanced entry and leave posting it to the engine. Their memos, « Vente à crédit », « Encaissement » and « Mauvaise créance », each followed by « · » and the client, are part of the structure of the books, so they stay in finance. A charge's or a cash sale's memo is its `description` in the content.

The chart of accounts is in `src/finance/accounts.ts`: 24 accounts with their codes, French names, types and normal balances. The game posts to 22 of them: 1000 Encaisse, 1100 Comptes clients, 1200 Stocks, 1500 Équipement, 1510 Amortissement cumulé, 2500 Emprunts bancaires, 3000 Capital-actions, 4000 Ventes, 5000 Coût des marchandises vendues, 5100 Pertes sur stocks, 5200 Emballages, 6000 Salaires, 6100 Loyer et permis, 6120 Location du camion, 6150 Assurances, 6200 Carburant et entretien, 6300 Marketing, 6400 Amortissement, 6500 Frais bancaires et de cartes, 6900 Autres charges, 6950 Créances irrécouvrables and 7000 Intérêts. It posts to 1100, 6900 and 6950 only through the event cards. The other two: 2000 Comptes fournisseurs is there for the cards to come, and 3100 Bénéfices non répartis is never posted to, as the bilan below explains.

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
- `src/content/events.json` holds the event cards and how often they come. The `pacing` is the first day one may be drawn (`firstDay`), the fewest days from one drawn event to the next (`minDaysBetween`) and the chance of one on a morning one may be (`dailyChance`). Each of the `events` has its weight, character, French text, conditions and choices, and each choice its outcomes, their chances and their effects. `loadEventContent()` in `src/content/schema.ts` validates it: besides each field, the event ids are unique, the choice ids unique within their event, each choice's chances sum to 1 and every follow-up names an event of the file.
- `src/content/report.json` holds what the « Bilan de la semaine » tells of a week: the most facts it tells (`maxFacts`), and for each fact its weight and when it holds. `profitUpCashDown`: a bénéfice net above 0 while the encaisse went down, or went up at least `minGapCents` less than the bénéfice, as the week of « La grosse commande » accepted does; it comes first whenever it holds. `unpaidRent`: the owner's rent went unpaid. `receivableDue`: a customer owes something due within `withinDays` of the Sunday. `spoilage`: the stock written off cost more than `aboveCents`. `bestWeek`: ventes above `previousBest`. `lostToLine`: more than `aboveVisits` visits left the line. `daysOpenInARow`: the truck opened at least `atLeast` days in a row. The others come by weight, the highest first, a tie in that order. `loadReportContent()` in `src/content/schema.ts` validates it, and `src/engine/week.ts` loads it once as `REPORT`, the default content of `weekFacts()`.
- `src/content/defis.json` holds the Défis: for each its id, French title and story, difficulty, start date, length, setup, the decisions it locks, the changes to the street and the events it forces, whether random events come, its goal and its conditions. `loadDefiContent()` in `src/content/schema.ts` validates it against the event cards ("Défis" above).
- `src/content/segments.json` holds the customer segments: how long each waits in line (`patienceMinutes`), for each segment and product a reference price, a base purchase probability and a sensitivity, and for the chic segment how a price far below its reference puts it off (`tooCheap`). `loadCustomerContent()` in `src/content/schema.ts` validates it the same way.
- `src/engine/day.ts` calls the seven loaders once, when the module loads, and exports the results as `FOOD_TRUCK`, `CUSTOMERS`, `DIFFICULTIES`, `PERSONAL`, `ENERGY`, `EVENTS` and `DEFIS`, the last checked against `EVENTS`. An invalid file throws as soon as the engine is imported.
- `createInitialState()`, `tick()`, `playDay()`, `openingJournal()`, `startingDecisions()` and `applyDecision()` take a `content` argument that defaults to `FOOD_TRUCK`. `tick()` and `playDay()` take a `customers` argument after it that defaults to `CUSTOMERS`, `createInitialState()`, `tick()`, `playDay()` and `openingJournal()` a `difficulties` argument that defaults to `DIFFICULTIES`, and `tick()` and `playDay()` a `personal` argument that defaults to `PERSONAL`, then an `energy` argument that defaults to `ENERGY`, so a test can play with other numbers. `tick()` takes a last `events` argument that defaults to `NO_EVENTS` in `src/engine/events.ts`, not `EVENTS`, so a game turns the event cards on by passing them. `playDay()` takes none: the start of a day only runs effects already queued. `resolveEvent()` takes the event content after the choice, defaulting to `EVENTS`, then the food truck's for the unit costs, defaulting to `FOOD_TRUCK`; `deserialize()` in `src/engine/save.ts` takes the food truck's content, then the event content, defaulting to `FOOD_TRUCK` and `EVENTS`. `drawEvent()` and `applyEffect()` take theirs with no default. `servers()` takes the energy content it reads as its second argument. The UI store passes `EVENTS` to `tick()` and `resolveEvent()`, and the defaults otherwise. The simulation passes the shipped content, with `NO_EVENTS` under its `none` policy.
- The UI reads `FOOD_TRUCK` too: product names in `src/ui/TodayPanel.tsx`, and the monthly costs for the cash gauge in `src/ui/cashLevel.ts`, which adds the truck's lease or loan payment from `DIFFICULTIES`. The new game screen reads `src/content/difficulty.json` through `src/ui/newGame.ts`.
- `src/content/pacing.json` (real milliseconds per game day, the speeds, the most days per animation frame) is read by `src/ui/gameLoop.ts` and `src/ui/TopBar.tsx`. `src/content/cashGauge.json` is read by `src/ui/cashLevel.ts`. The engine reads neither: it knows nothing of real time.

Some numbers stay in code on purpose, because they are facts rather than tunables:
- the calendar, in `src/engine/calendar.ts`, with the month lengths repeated in `src/content/schema.ts` to check an event's date;
- the 12 months the owner's personal account keeps, in `src/engine/personal.ts`, and the 52 weeks `weekHistory` keeps, in `src/engine/week.ts`;
- the owner's energy scale, 0 to 100, in `src/engine/energy.ts` and `src/content/schema.ts`;
- the first weekend day, and the lowest reference price, 1 cent, in `src/engine/customers.ts`;
- the ISO weekdays, 1 = Monday to 7 = Sunday, in `src/engine/decisions.ts` and `src/content/schema.ts`;
- the days of a week: in `src/engine/calendar.ts`, for the weekdays and the Sunday of a week; in `src/engine/effects.ts`, to find an effect's next weekday; and in `src/engine/save.ts`, to check the weeks of the history;
- the minutes in a day, in `src/content/schema.ts`;
- what fits on an event card: a situation of at most 280 characters, a choice's label of at most 45 and an outcome's result of at most 200, and on a Défi's card, a story of at most 400, in `src/content/schema.ts`;
- the first month of the first season, May, from which a Défi starts, in `src/content/schema.ts`;
- the mulberry32 constants, in `src/engine/rng.ts`;
- the chart of accounts, in `src/finance/accounts.ts`;
- the structure and labels of the statements, in `src/finance/statements.ts`.

## Invariants enforced by `tests/invariants.test.ts`

The test plays 3650 days, ten years, for three games, one per difficulty: seed 1 at Facile, seed 42 at Moyen and seed 2026 at Difficile. It calls `tick()` with the shipped content and its starting decisions, and with the event cards on: the shipped `EVENTS`, its pacing included, with the `essai` card's weight raised to 1, so the effects every card may use, follow-ups included, come up a few hundred times a game, besides the shipped cards. Each morning an event waits, it answers it with `resolveEvent()`, picking the choice with `eventChooser('random', seed)` in `tools/sim/simulate.ts`, as `npm run sim -- --events random` does.

After every day's close, it checks:
- the trial balance up to that day: total debits equal total credits. It keeps each account's balance as a running tally, adding each day's new entries once, rather than summing the whole journal again every day;
- the bilan: Actifs = Passifs + Capitaux propres;
- Stocks: the ledger balance of 1200, read from the tally, equals `inventoryValue()` of the lots on hand;
- Comptes clients: the ledger balance of 1100, read from the tally, equals what the `receivables` add up to;
- the street: a day a change closes the truck has no visit, and a product a change takes off sale sold no unit that day.

Each morning an event waits, it checks that one drawn rather than brought back as a follow-up comes no earlier than `pacing.firstDay` and at least `pacing.minDaysBetween` days after the last one drawn. At the end, it checks that at least 100 events came up, follow-ups among them, and that each kind of change to the street was in effect on at least 20 days.

At the end of every calendar month, it checks that `trialBalance()` in `src/finance/journal.ts` balances and agrees with the tally on every account, and that the état des flux de trésorerie's net change for the month equals the change in Encaisse. Day 0 is May 1st, so the run covers exactly 120 months: the whole of Moyen's loan and the whole useful life of the truck.

It then plays each game again through `simulate()` in `tools/sim/simulate.ts`, at the same difficulty, with the `random` policy and the same event content, and checks:
- the replay's `journalHash`, the sha256 of the entries, equals the first run's, so the engine, the events and the choices drawn are deterministic;
- the replay sums up as ten whole 365-day years: days 0 to 364, 365 to 729, and so on.

The whole file must finish within 60 seconds. If it gets slower, make the slow part faster rather than checking fewer days or seeds. It reports at most 10 failures per rule.

### Also enforced elsewhere

- `postEntry()` throws on an entry that does not balance or breaks another of the rules above, so the books cannot take one. `src/finance/journal.test.ts` covers each rule, and `src/finance/journal.property.test.ts` checks that the trial balance stays at zero after any run of balanced entries.
- `tools/lint-guardrails.test.ts` checks that ESLint flags the forbidden imports and calls in `src/engine/` and `src/finance/`, any import of `src/world/` from engine, finance and content, and anything in `src/world/` that would change the game, and leaves the same code alone in `src/ui/`.
- `tools/engine-types.test.ts` checks that `tsconfig.engine.json` rejects browser globals in both folders.
- `src/engine/events.property.test.ts` walks ten years of mornings with random event cards, conditions and pacing, and checks every event that comes up against the conditions, the cooldowns, the follow-ups and the gap, written out in the test apart from the engine; with a daily chance of 1, it checks every morning that brings none too. A fixed sample of games checks that each rule alone holds a card back on some morning, so the property cannot pass without putting it to the test.
- `tools/architecture-doc.test.ts` checks this page:
  - `src/engine/types.ts` starts with its frozen header;
  - every type it exports has a heading under "The shape of `GameState`", and every field of an interface has a row in that heading's table;
  - every path this page cites exists;
  - the memos in "The starting state" name every entry each difficulty's books open with;
  - every entry a day posts is one of the memos in "Order of operations in `tick()`", in the same order, and each of those memos posts within five weeks of play at the three difficulties. It checks the order of the entries only, not the order of steps that post nothing.
