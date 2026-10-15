Node scripts and checks that run outside the browser, such as the headless simulation (`npm run sim`) and the balance bot (`npm run balance`).

## Headless simulation

```sh
npm run sim -- --days 3650 --seed 42 --difficulty moyen
```

Plays the game from day 0 without a screen, with the shipped content, at one difficulty, answering the event cards by a policy, and prints a line naming the seed, the days, the difficulty and the policy, then one row per year: revenue, net income, cash at year end, units spoiled and lost sales. Years count from the first day of play (May 1st), so year 1 runs from day 0 to day 364 and `--days 3650` prints ten rows; a run that stops mid-year ends with a shorter one. Under the table comes a line with the days each kind of change to the street was in effect (`walkIns`, `appeal`, `willingness`, `unavailable` and `closed`; a day counts once for a kind, however many changes of that kind it had), then the sha256 of the journal: the same seed, difficulty, policy and days always give the same hash.

| Option         | Default | Meaning                                                                                                                           |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--days`       | 3650    | Days to play, a whole number from 1.                                                                                              |
| `--seed`       | 42      | Seed of the game's generator, a whole number in [0, 2^32).                                                                        |
| `--difficulty` | `moyen` | How the game starts: `facile`, `moyen` or `difficile`, as on the new game screen, whose default it is. It sets the opening books and the truck's charges. |
| `--events` | `random` | How the event cards are answered: `first` takes each event's first choice, `random` a choice drawn from a generator of its own, seeded from `--seed`, and `none` plays a game where no event comes up. |
| `--out`        | `out/`  | Folder the result goes to, relative to the current one (the repo root under `npm run`).                                           |

The full result goes to `<out>/sim-<seed>-<difficulty>.json`: the seed, the difficulty, the days, the journal hash, the yearly rows, each day's summary (units sold, revenue, lost sales and spoilage per product, and the changes to the street in effect, each with the event that made it), every journal entry, and `owner`, the owner's side outside the books: `morningEnergy`, their energy each morning before the day is played, `personalCash` at the end, and `unpaidRents`, every 1st of the month whose rent went unpaid over the whole run (the game itself keeps only the last 12 months); then `events`, the policy, `eventHistory`, every event that came up with the choice made and the outcome drawn, oldest first, and `modifierDays`, the days each kind of change to the street was in effect, as the report line counts them. Ten years make about 6.5 MB. `out/` is git-ignored.

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
| `--out`   | `docs/balance/phase-2.md` | File the report goes to, relative to the current folder (the repo root under `npm run`). |

With `--events first` or `random`, the report's command shows the option, a line under "What each game plays" says how the player answers the cards, and a "Street changes" section, after the design targets, gives at each difficulty the median days of a game each kind of change to the street was in effect, over every game whatever its strategy; with `none`, the report mentions neither.

The report, in Markdown, starts with the design targets (one-year runs only, below), then the street changes (with the event cards only), then the 10 best and the 10 worst strategies at each difficulty, then ranks all 324. The best has the highest median wealth at the end: the Encaisse plus the owner's personal cash, as if the business were theirs alone. The owner's pay only moves money from one to the other, so it counts through what it does to the owner: debt stress tires them, and a tired owner serves slower. Ties go to the fewer median unpaid rents, then to the higher median net income, then to the strategy listed first in the grid; so when no pay tires the owner, $700 ranks above $1,000 by its net income, and $400 below both when it leaves a rent unpaid. For each strategy, over its games:

- the median wealth at the end, and the median and worst Encaisse at the close of the last day;
- the median net income over the game, after the owner's pay;
- the owner's median personal cash at the end, and the median count of unpaid rents;
- the lowest Encaisse after any journal entry of any game. A day pays its purchases, and the 1st of the month its charges, before its sales come in, so this catches a shortfall the cash at the close would hide;
- the share of games whose cash went below zero at any point, when the truck would have needed the bank;
- the owner's median average energy each morning, and the median mornings they started « Épuisé »;
- the median units botched at the counter;
- the median spoilage rate: units written off ÷ (units sold + units written off), every product together;
- the median visits lost to stockouts, to prices and to the line: those that bought nothing because what the customer wanted had sold out, because a price was above what they pay, or because the line was too long for them.

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

## The 10-year invariant test

`tests/invariants.test.ts`, part of `npm test`, plays ten years for seed 1 at Facile, seed 42 at Moyen and seed 2026 at Difficile, with the event cards on, the `essai` card in play, answered at random as `--events random` does. After every day it checks that the trial balance is zero, that Actifs = Passifs + Capitaux propres, that Stocks equals the cost of the lots on hand that Comptes clients equals what customers owe, and that a day the street closes the truck has no visit and a product it takes off sale sold none; each morning, that an event drawn respects the first day and the gap; after every calendar month, that `trialBalance()` agrees with the running tally the daily checks use and that the cash flow statement's net change equals the change in Encaisse. At the end, it checks that each kind of change to the street was in effect on at least 20 days. It then plays each game again through `simulate()` and compares the journal hashes. The file must finish in under 60 seconds in CI: if it gets slower, make the slow part faster rather than checking fewer days or seeds.
