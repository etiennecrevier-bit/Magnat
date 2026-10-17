Node scripts and checks that run outside the browser, such as the headless simulation (`npm run sim`) and the balance bot (`npm run balance`).

## Headless simulation

```sh
npm run sim -- --days 3650 --seed 42 --difficulty moyen
```

Plays the game from day 0 without a screen, with the shipped content, at one difficulty, answering the event cards by a policy, and prints a line naming the seed, the days, the difficulty and the policy, and the contracts policy when one is given, then one row per year: revenue, net income, cash at year end, units spoiled and lost sales. Years count from the first day of play (May 1st), so year 1 runs from day 0 to day 364 and `--days 3650` prints ten rows; a run that stops mid-year ends with a shorter one. Under the table comes a line with the days each kind of change to the street was in effect (`walkIns`, `appeal`, `willingness`, `unavailable` and `closed`; a day counts once for a kind, however many changes of that kind it had), then the sha256 of the journal: the same seed, difficulty, policy and days always give the same hash.

| Option         | Default | Meaning                                                                                                                           |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--days`       | 3650    | Days to play, a whole number from 1.                                                                                              |
| `--seed`       | 42      | Seed of the game's generator, a whole number in [0, 2^32).                                                                        |
| `--difficulty` | `moyen` | How the game starts: `facile`, `moyen` or `difficile`, as on the new game screen, whose default it is. It sets the opening books and the truck's charges. |
| `--events` | `random` | How the event cards are answered: `first` takes each event's first choice, `random` a choice drawn from a generator of its own, seeded from `--seed`, and `none` plays a game where no event comes up. With `first` or `random`, the cards of the emergency loan and the share sale (#159) come too when the encaisse closes below zero, answered like any other card; `simulate()` takes a financing policy that answers them instead, which `npm run balance` sets. |
| `--contracts` | as the events | How the grocers' cards (#156) are answered, whatever `--events` says: `all` accepts every offer and renewal, `none` refuses them all, and `first` accepts the first grocer to offer, and that grocer's renewals, and refuses the others. With `--events none`, the grocers' cards still come, alone, at the shipped pacing, unless `--contracts none`. Without it, the event policy answers them like any other card. |
| `--out`        | `out/`  | Folder the result goes to, relative to the current one (the repo root under `npm run`).                                           |

The full result goes to `<out>/sim-<seed>-<difficulty>.json`: the seed, the difficulty, the days, the journal hash, the yearly rows, each day's summary (units sold, revenue, lost sales and spoilage per product, and the changes to the street in effect, each with the event that made it), every journal entry, and `owner`, the owner's side outside the books: `morningEnergy`, their energy each morning before the day is played, `personalCash` at the end, and `unpaidRents`, every 1st of the month whose rent went unpaid over the whole run (the game itself keeps only the last 12 months); then `events`, the policy, `contracts` and `financing`, the contracts and financing policies, null when the event policy answered those cards, `eventHistory`, every event that came up with the choice made and the outcome drawn, oldest first, `loans` and `shareSales`, every emergency loan taken and round of shares sold (#159), `ended`, how and when the game ended, null when it played every day asked for (#160), and `modifierDays`, the days each kind of change to the street was in effect, as the report line counts them. Ten years make about 6.5 MB. `out/` is git-ignored.

A game that goes bankrupt (#160) stops at the close that ends it: `days` counts the days played, the last year stops there, and the report prints « Ended in bankruptcy at the close of day N » under its header. `playMorning()` returns a game that has ended as it is, so the balance tools stop there too: a bankrupt owner of `--percentiles` keeps the bénéfice net of its last close in every week after, a bakery game counts only the days it played and reads its last cash at the month ends after, and an event branch stops on the morning after the end.

The code is in `sim/`: `simulate.ts` plays the game and sums it up without I/O, `cli.ts` parses the options, prints the report and writes the file, and `run.ts` is the entry point `tsx` runs.

### Compare with the game

A « Nouvelle partie » started at a difficulty from a page opened with `?seed=<n>` in its address, such as `http://localhost:5173/?seed=42`, plays the same days as `npm run sim -- --seed <n> --difficulty <difficulty>`; without it, or with a seed outside [0, 2^32), each new game starts on a random seed. The same event cards come up on the same mornings in both: answer each with its first choice, as `--events first` does. Play at least one day, pause the game and count N, the days from May 1st, year 1, to the date in the top bar. `npm run sim -- --seed <n> --difficulty <difficulty> --events first --days N` then shows, for year 1, the numbers of the États financiers screen under "Depuis le début de l'année": Revenue is Ventes, Net income is Bénéfice net and Cash at year end is Encaisse. The screen's periods end on the day shown, which has not been played yet, so the sim's days 0 to N - 1 cover the same entries.

This only holds while the top bar shows year 1 (N up to 244, December 31st): the sim's years run from May to April, while the screen's year starts on January 1st.

## Balance bot

```sh
npm run balance -- --years 1 --games 30
```

Plays scripted strategies headless at each difficulty, to see whether the economy works before anyone plays it: which strategies win, which go broke and which decisions change nothing. A strategy holds the same decisions from day 0 to the end of the game. It sets every price at -20%, base, +20% or +40% from the starting prices (rounded half up to the price step), buys 40, 70 or 110 croissants each morning the truck opens, spends $0, $30 or $80 a day on marketing, opens 5, 6 or 7 days a week, and pays the owner $400, $700 or $1,000 a week. The schedules nest: 6 days closes on Monday, the quietest weekday, and 5 days on Sunday too. That makes 4 × 3 × 3 × 3 × 3 = 324 strategies; café and chocolat chaud keep their starting restock. Each strategy plays seeds 1 to `--games` at Facile, Moyen and Difficile, for `--years` × 365 days from May 1st, year 1.

| Option    | Default                   | Meaning                                                                                  |
| --------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| `--years` | 1                         | Years each game plays, a whole number from 1.                                            |
| `--games` | 30                        | Games per strategy and difficulty, on seeds 1 to this, a whole number from 1.            |
| `--events` | `none` | How the event cards are answered: `first`, `random` or `none`, as for `npm run sim`. The default keeps the report the economy without events. |
| `--contracts` | as the events | How the grocers' cards are answered: `all`, `none` or `first`, as for `npm run sim`. With `--events none` and `all` or `first`, the grocers' cards come alone, so a grid can test the contracts without the other cards; with `--events none` and `none`, no card comes up and no contract is offered. |
| `--financing` | `accept` | How the cards the engine brings when the encaisse closes below zero (#159) are answered, whatever `--events` and `--contracts` say: `accept` takes Mme Prudhomme's emergency loan and sells Max Duvent his shares, `refuse` turns them down. They come even with `--events none`, alone, so a strategy that runs out of cash borrows as a player would. |
| `--out`   | `docs/balance/phase-2.md` | File the report goes to, relative to the current folder (the repo root under `npm run`). |

The report's command shows `--financing`, and a line under "What each game plays" says how the player answers the financing's cards; with `accept`, the wealth at the end leaves out the cash a loan or the shares brought in, which is not the owner's, and counts what they cost by then, the fee, the interest and the dividends; the last two columns name the strategies that needed them. With `--events first` or `random`, the report's command shows the option, a line under "What each game plays" says how the player answers the cards, and a "Street changes" section, after the design targets, gives at each difficulty the median days of a game each kind of change to the street was in effect, over every game whatever its strategy; with `none`, the report mentions neither.

The report, in Markdown, starts with the design targets (one-year runs only, below), then the street changes (with the event cards only), then the 10 best and the 10 worst strategies at each difficulty, then ranks all 324. The best has the highest median wealth at the end: the Encaisse plus the owner's personal cash, as if the business were theirs alone, less the cash in it that is not theirs, what the emergency loans still owe and what the shares sold brought in. The owner's pay only moves money from one to the other, so it counts through what it does to the owner: debt stress tires them, and a tired owner serves slower. Ties go to the fewer median unpaid rents, then to the higher median net income, then to the strategy listed first in the grid; so when no pay tires the owner, $700 ranks above $1,000 by its net income, and $400 below both when it leaves a rent unpaid. For each strategy, over its games:

- the median wealth at the end, and the median and worst Encaisse at the close of the last day;
- the median net income over the game, after the owner's pay;
- the owner's median personal cash at the end, and the median count of unpaid rents;
- the lowest Encaisse after any journal entry of any game. A day pays its purchases, and the 1st of the month its charges, before its sales come in, so this catches a shortfall the cash at the close would hide;
- the share of games whose cash went below zero at any point, when the truck would have needed the bank;
- the owner's median average energy each morning, and the median mornings they started « Épuisé »;
- the median units botched at the counter;
- the median spoilage rate: units written off ÷ (units sold + units written off), every product together;
- the median visits lost to stockouts, to prices and to the line: those that bought nothing because what the customer wanted had sold out, because a price was above what they pay, or because the line was too long for them;
- the emergency loans taken and the rounds of shares sold, summed over its games.

Under each difficulty's best and worst, a "Changed nothing" line names any choice whose values all played the same books (by journal hash) for every seed, the other choices held.

### Design targets

A one-year report checks the targets of #58 at each difficulty, ✓ or ✗ with what the run measured, n/a where a target does not apply to the difficulty. A strategy beats another only by what it played, never by the order of the grid. The targets are #58's, in `balance/targets.ts`:

1. The best strategy's net income lands within $5,000 of Facile $30,000, Moyen $20,000 and Difficile $10,000.
2. Moyen and Difficile: every careless strategy (+40% and 110 croissants a day: prices far off and much too much stock) goes below zero before October 1st, in its first 5 months, in more than half of its games. Each strategy counts on its own, so the others cannot hide one that survives.
3. Facile: the starting decisions (base prices, 70 croissants, $0, 6 days, $700) never go below zero.
4. The best strategy at base or +20% beats the best at -20% or +40%.
5. At +20% and at +40%, the best strategy spending $30 a day on marketing beats the best spending $0 and the best spending $80.
6. On 5 or 6 days a week, -20% prices lose at least 5% of the visits to the line, pooled over the games, and at least twice the share base prices lose.
7. The best strategy on 5 or 6 days beats the best on 7.
8. Moyen and Difficile: paying the owner $400 a week leaves a rent unpaid in every game.

### Running it

Each difficulty plays on its own worker thread, so the three play side by side and the progress line of each comes when it is done. They play the same games in the same order as one thread would, so the report is the same. The progress and the times go to the console only, so the same options always write the same file. The default run plays 324 × 3 × 30 = 29,160 one-year games: 6 min for the committed report, on three threads. `docs/balance/phase-2.md` is committed: run the command again, and commit the new report, after any change to the engine or the content that moves the numbers.

Everything from the line `<!-- Written by hand: npm run balance keeps everything below this line. -->` to the end of the report is hand-written: a new run keeps it as it is, under the new numbers.

The code is in `balance/`: `strategies.ts` builds the grid and the decisions each strategy makes, `play.ts` plays the games through `simulate()` and sums each one up, `summary.ts` sums up each strategy's games and ranks them, `targets.ts` checks the design targets, `report.ts` writes the Markdown, all without I/O. `threads.ts` plays each difficulty on a worker thread running `worker.ts`, `cli.ts` parses the options and writes the file, and `run.ts` is the entry point `tsx` runs.

## How other owners did, and the event cards

```sh
npm run balance -- --percentiles
```

Plays the simulated owners the « Bilan de la semaine » will compare the player with (« Mieux que 64 % des propriétaires »), and measures what each choice of the event cards does. Each difficulty plays seeds 1 to `--games`, each game `--years` × 52 weeks from Monday, May 1st, year 1. The owner of seed n holds one strategy of the grid above from day 0, drawn at random from the seed, the same at every difficulty, and answers the event cards with a choice drawn at random, as `--events random` does. It writes the percentile table, `src/content/percentiles.json`, and the report, `docs/balance/phase-3.md`.

| Option          | Default                        | Meaning                                                                                  |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `--percentiles` |                                | Plays the owners rather than the grid. `--events`, `--contracts` and `--financing` do not go with it. |
| `--years`       | 2                              | Years of 52 weeks each game plays, a whole number from 1.                                |
| `--games`       | 1000                           | Games per difficulty, on seeds 1 to this, a whole number from 1.                         |
| `--out`         | `docs/balance/phase-3.md`      | File the report goes to, relative to the current folder (the repo root under `npm run`). |
| `--json`        | `src/content/percentiles.json` | File the percentile table goes to, the same way; only with `--percentiles`.              |

**The percentile table.** At each Sunday's close, a game notes its bénéfice net from day 0, after the owner's pay, as `incomeStatement()` gives it. For each difficulty and each week, the table holds the 5th, 10th, 20th … 90th and 95th percentiles of the games: linear between the closest ranks (type 7, as R and NumPy compute by default), rounded half away from zero to the cent. Prettier lays the file out as it does the other content, so `npm run format` leaves it as it is. `percentileOf(difficulty, week, cumulativeNetIncome)` in `src/engine/percentiles.ts` reads it: week n is days 7(n - 1) to 7n - 1, a week after the last reads the last, an income below the 5th percentile's amount gives 0 and one at or above the 95th's gives 95, and in between it is linear between the two percentiles around the income. The UI is to round it down.

**Facile's table.** Facile draws some cards by the player's standing, which reads this very table (#137), so its owners could not play against the table shipped before without each run moving the next. They play against the table they make: all of them play each week side by side, and once each has closed its Sunday, the week's row is made from their bénéfice net, before any of them draws Monday's card, the first that reads that row (`stagedPercentiles()`). Each Sunday is played once for its close and again once the row is made, since Monday's draw comes at the end of Sunday's play. Then the owners play again, one after the other with the finished table, to branch their cards, and `runOwners()` checks that they made the same table. So the table is the one its owners played against, and a run writes the same files whatever table was there. Holding every Facile game at once takes about 2 GB for the default run. The other difficulties read no table, so they play one owner after the other, as before.

**The event cards.** In each game, one occurrence of each card that came up is drawn at random, seeded from the game. From that morning, each choice plays 56 days, the day of the card included, and so does the same morning with no card, the baseline. Every branch plays each business day with a generator seeded from the game and the day, so they all meet the same customers whatever a choice drew; each choice draws its outcome from a stream of its own. A follow-up already queued, or queued by the choice, comes up and is answered at random, the same way in every branch, and no new card is drawn. A choice is measured against the baseline by its Encaisse at the close of the 56th day and its bénéfice net over the 56 days. A card whose choices move only the owner's own money, and their energy, is measured on that money instead, at the close of a window long enough for its last effect to land: `placementMiracle`, whose return comes 90 days later, plays 91 days. In a game, a choice is best on a measure when no other choice of its card did strictly better, a tie counting for each; it is too strong when best on all its card is measured on in more than 80 % of the games its card came up in, and too weak when best on none of it in more than 85 %. The report checks those limits at every difficulty (#137), and at Facile counts how often each standing drew each card.

**Running it.** The three difficulties play side by side on worker threads, as for the grid, about 0.3 s a game with the branches: the default run takes about 10 min on three threads, Facile the longest, and `--games 200 --years 1` about a minute, enough to try a change to `events.json`. A card that comes up seldom needs the full run: `chequeDansLaMalle`, the late cheque of « La grosse commande », comes up in about one game in 20. The same options always write the same files. After any change to the engine or the content that moves the numbers, run it again with the default options and commit both files together. Everything from the hand-written line of the report to its end stays, as in phase 2.

The code is in `balance/` too: `owners.ts` plays the owners and computes the percentiles, `eventBranches.ts` plays the choices of a card from the same morning and judges them, and `phase3.ts` writes the table and the report, all without I/O. `worker.ts` plays any kind of job: the grid's, the owners' or a Défi.

## Défis

```sh
npm run balance -- --defis
```

Plays each Défi of `src/content/defis.json` by the simulated owners and by the grid's best strategy for it, and checks its medal thresholds against the targets of #102: the owners win « Or » in under 10 % of their games, « Argent » or better in 30 % to 40 %, « Bronze » or better in 65 % to 75 %, and the best strategy wins « Or » in 80 % or more. It writes the Défis' percentile table, `src/content/defis-percentiles.json`, for « Mieux que N % des parties simulées », and the Défis section of `docs/balance/phase-3.md`.

| Option     | Default                              | Meaning                                                                                             |
| ---------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `--defis`  |                                      | Plays the Défis. `--percentiles`, `--years`, `--events`, `--contracts` and `--financing` do not go with it. |
| `--games`  | 1000                                 | Games per Défi, by the owners and by the best strategy, on seeds 1 to this, a whole number from 1.  |
| `--search` | 100                                  | Seeds each strategy of the grid plays in the search for the best, a whole number from 1; only here. |
| `--out`    | `docs/balance/phase-3.md`            | Report its section goes in, relative to the current folder (the repo root under `npm run`).         |
| `--json`   | `src/content/defis-percentiles.json` | File the table goes to, the same way.                                                               |

**A game.** Each game plays as a player would: `startChallenge()` opens the Défi, the decisions change with `applyDecision()` on its first morning, so they take effect from its second day, and `tick()` plays each day with the event cards on until the Défi is over. A decision the Défi locks does not change. Each morning, the card waiting is answered with a choice drawn at random among those the Défi allows (`allowedChoices()`), seeded from the game.

**The owners.** The owner of seed n holds the strategy of the grid that `--percentiles` draws for seed n, moved from the Défi's own opening decisions: every price moves by the strategy's % from the Défi's opening price, the croissants bought each day scale the Défi's opening quantity as the grid scales the content's starting 70, rounded half up (40, 70 and 110 for a Défi that keeps 70; 17, 30 and 47 for one that opens on 30), and the marketing budget, the days open and the owner's pay are the grid's.

**The best strategy.** Every strategy of the grid, moved the same way, plays seeds 1 to `--search`; the best has the highest median outcome, the lower middle, then the most games that broke no condition, then comes first in the grid. It then plays seeds 1 to `--games`, like the owners. A game that broke a condition ranks below every game that did not; the others rank by what the goal measured, where lower is better for a spoilage rate.

**The table.** For each Défi: its goal's metric, the share of the owners' games that broke a condition, and what the goal measured in the others at the 5th, 10th, 20th … 90th and 95th percentiles, in increasing order of the value (null if every game broke one). Cents and customers are whole, rounded half away from zero; shares and energy have 4 decimals. Its `_note` says how a lookup reads it.

**The report.** Its section lies between `<!-- npm run balance -- --defis writes this section. -->` and `<!-- End of the Défis section. -->`: `--defis` replaces only that, or puts it before the hand-written line, and `--percentiles` keeps it as it is. It holds a table of targets per Défi, the owners' outcomes at each percentile, worst first, with the thresholds they suggest (the outcomes at the 92nd, 65th and 30th percentiles), and the best strategy's outcomes the same way: « Or » at or below its 20th percentile gives it « Or » in 80 % of its games.

**Running it.** One worker thread a Défi, three at once at most. The search plays every strategy of the grid, so it takes most of the time, « Payé dans 60 jours », 64 days long, the longest: the default run takes about 3 min 40 s on three threads, and `--games 200 --search 30` about a minute, enough to try a change to `defis.json`. The same options always write the same files. After any change to the engine or the content that moves the numbers, run it again with the default options and commit both files together.

**The guardrails.** `balance/defiGuardrails.test.ts`, part of `npm test`, checks the shipped Défis on fixed seeds: the best strategy of each, as the last full run found it, wins « Or » in at least 80 % of seeds 1 to 50; an absurd play wins nothing on any of them; and P3-13's owners, who play the grid in its own values whatever the Défi opens on, win the same medals on seeds 1 to 200 as when the Défis were tuned. After retuning a Défi, copy the new best strategy from the report and the new counts into the test.

The code is in `balance/`: `defis.ts` plays the Défis and sums them up, and `defisReport.ts` writes the table and the section, both without I/O.

## The bakery

```sh
npm run balance -- --bakery
```

Plays the bakery, le fournil (#157), against twins that buy their croissants, and writes `docs/balance/phase-4.md`, keeping its hand-written part. Each difficulty plays seeds 1 to `--games` with six trucks: the starting decisions (70 croissants a day), a busy truck (110 a day, the croissant 20 % cheaper, $80 of marketing a day), the same truck making 150 a day, the volume #157 asks the bakery to win at, and that truck with the two contracts of #157, Marché Bio-Logique's and Épicerie Chez Normand's (#156), signed on day 0 by the game and its twin alike and renewed as they end; each Monday the bakery makes the deliveries' croissants first, within its capacity, and the twin buys them. Then the busy truck and the truck with contracts again, each with an employee at the truck (« Au camion », #158) hired on day 0 by the game and its twin alike. Each game opens the bakery on day 0 at each of #157's three price sets (ingredients $0.45, $0.55 or $0.65 a croissant, rent $2,000, $2,400 or $2,800 a month, at every difficulty whatever `src/content/difficulty.json` holds), with its oven leased or bought, hires a baker that day (« Boulanger », #158), so the owner never bakes, makes there the croissants its twin buys, and plays `--months` months. A game pays back in the first month at whose end its Encaisse is at least its twin's and stays so to the last month. The report checks #157's targets, the payback month of each difficulty with two contracts at the prices `src/content/difficulty.json` gives it among them, shows the break-even of each set and oven in the books, from the content, the baker's wages included, and each difficulty's payback.

| Option     | Default                   | Meaning                                                                                                             |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--bakery` |                           | Plays the bakery. `--percentiles`, `--defis`, `--years`, `--search`, `--events`, `--contracts`, `--financing` and `--json` do not go with it. |
| `--games`  | 30                        | Seeds each difficulty, truck, price set and oven plays, 1 to this, a whole number from 1.                           |
| `--months` | 24                        | Months each game plays from May 1st, year 1, a whole number from 1; only here.                                      |
| `--out`    | `docs/balance/phase-4.md` | File the report goes to, relative to the current folder (the repo root under `npm run`).                            |

**Running it.** One worker thread a difficulty and truck, three at once at most; the default run takes about a minute. The same options always write the same file. After any change to the engine or the content that moves the numbers, run it again with the default options and commit the report.

The code is in `balance/`: `bakery.ts` plays the games and their twins, and works out the break-even, and `bakeryReport.ts` writes the report, both without I/O. `simulate()`, `startGame()` and `playMorning()` in `sim/simulate.ts` take the difficulties every day of a game plays with, so a run can try other prices than the shipped ones.

## The 10-year invariant test

`tests/invariants.test.ts`, part of `npm test`, plays ten years for seed 1 at Facile, seed 42 at Moyen and seed 2026 at Difficile, with the event cards on, the `essai` card in play, answered as `--events random --contracts all --financing accept` does: every grocer's offer and renewal accepted, the emergency loan and the shares the engine offers accepted, every other card at random. After every day it checks that the trial balance is zero, that Actifs = Passifs + Capitaux propres, that Stocks equals the cost of the lots on hand that Comptes clients equals what customers owe, that a day the street closes the truck has no visit and a product it takes off sale sold none, and that the financing keeps to its rounds and loans; each morning, that an event drawn respects the first day and the gap, the financing's cards and Mme Prudhomme's letters aside, which come only after a close below zero; that no game goes bankrupt; after every calendar month, that `trialBalance()` agrees with the running tally the daily checks use and that the cash flow statement's net change equals the change in Encaisse. At the end, it checks that each kind of change to the street was in effect on at least 20 days, and that the grocers got at least 50 deliveries and paid at least 50 times, and over the games that an emergency loan was taken, shares sold and dividends paid, and that Mme Prudhomme's letters came. It then plays each game again through `simulate()` and compares the journal hashes. The file must finish in under 60 seconds in CI: if it gets slower, make the slow part faster rather than checking fewer days or seeds.
