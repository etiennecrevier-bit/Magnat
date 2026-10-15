Node scripts and checks that run outside the browser, such as the headless simulation (`npm run sim`) and the balance bot (`npm run balance`).

## Headless simulation

```sh
npm run sim -- --days 3650 --seed 42 --difficulty moyen
```

Plays the game from day 0 without a screen, with the shipped content, at one difficulty, and prints one row per year: revenue, net income, cash at year end, units spoiled and lost sales. Years count from the first day of play (May 1st), so year 1 runs from day 0 to day 364 and `--days 3650` prints ten rows; a run that stops mid-year ends with a shorter one. Under the table comes the sha256 of the journal: the same seed, difficulty and days always give the same hash.

| Option         | Default | Meaning                                                                                                                           |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--days`       | 3650    | Days to play, a whole number from 1.                                                                                              |
| `--seed`       | 42      | Seed of the game's generator, a whole number in [0, 2^32).                                                                        |
| `--difficulty` | `moyen` | How the game starts: `facile`, `moyen` or `difficile`, as on the new game screen, whose default it is. It sets the opening books and the truck's charges. |
| `--out`        | `out/`  | Folder the result goes to, relative to the current one (the repo root under `npm run`).                                           |

The full result goes to `<out>/sim-<seed>-<difficulty>.json`: the seed, the difficulty, the days, the journal hash, the yearly rows, each day's summary (units sold, revenue, lost sales and spoilage per product) and every journal entry. Ten years make about 6.5 MB. `out/` is git-ignored.

The code is in `sim/`: `simulate.ts` plays the game and sums it up without I/O, `cli.ts` parses the options, prints the report and writes the file, and `run.ts` is the entry point `tsx` runs.

### Compare with the game

A « Nouvelle partie » started at a difficulty from a page opened with `?seed=<n>` in its address, such as `http://localhost:5173/?seed=42`, plays the same days as `npm run sim -- --seed <n> --difficulty <difficulty>`; without it, or with a seed outside [0, 2^32), each new game starts on a random seed. Play at least one day, pause the game and count N, the days from May 1st, year 1, to the date in the top bar. `npm run sim -- --seed <n> --difficulty <difficulty> --days N` then shows, for year 1, the numbers of the États financiers screen under "Depuis le début de l'année": Revenue is Ventes, Net income is Bénéfice net and Cash at year end is Encaisse. The screen's periods end on the day shown, which has not been played yet, so the sim's days 0 to N - 1 cover the same entries.

This only holds while the top bar shows year 1 (N up to 244, December 31st): the sim's years run from May to April, while the screen's year starts on January 1st.

## Balance bot

```sh
npm run balance -- --years 1 --games 30
```

Plays scripted strategies headless at each difficulty, to see whether the economy works before anyone plays it: which strategies win, which go broke and which decisions change nothing. A strategy holds the same decisions from day 0 to the end of the game. It sets every price at -20%, base, +20% or +40% from the starting prices (rounded half up to the price step), buys 40, 70 or 110 croissants each morning the truck opens, spends $0, $30 or $80 a day on marketing, and opens 6 days (closed on Monday) or 7. That makes 72 strategies; café and chocolat chaud keep their starting restock and the owner their starting pay. Each strategy plays seeds 1 to `--games` at Facile, Moyen and Difficile, for `--years` × 365 days from May 1st, year 1.

| Option    | Default                   | Meaning                                                                                  |
| --------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| `--years` | 1                         | Years each game plays, a whole number from 1.                                            |
| `--games` | 30                        | Games per strategy and difficulty, on seeds 1 to this, a whole number from 1.            |
| `--out`   | `docs/balance/phase-2.md` | File the report goes to, relative to the current folder (the repo root under `npm run`). |

The report, in Markdown, starts with the 10 best and the 10 worst strategies at each difficulty, then ranks all 72. The best has the highest median cash at the end; ties go to the higher median net income, then to the strategy listed first in the grid. For each strategy, over its games:

- the median and the worst Encaisse at the close of the last day;
- the median net income over the game;
- the lowest Encaisse after any journal entry of any game. A day pays its purchases, and the 1st of the month its charges, before its sales come in, so this catches a shortfall the cash at the close would hide;
- the share of games whose cash went below zero at any point, when the truck would have needed the bank;
- the median spoilage rate: units written off ÷ (units sold + units written off), every product together;
- the median visits lost to stockouts and to prices: those that bought nothing because what the customer wanted had sold out, or because a price was above what they pay. Customers lost to the line are not counted until the game has one (#62).

Under each difficulty's best and worst, a "Changed nothing" line names any choice whose values all played the same books (by journal hash) for every seed, the other choices held, such as the marketing budget while the engine does not charge it (#63).

The progress and the time each difficulty took go to the console only, so the same options always write the same file. The default run plays 72 × 3 × 30 = 6,480 one-year games on one thread: 2 min 17 s, about 45 s per difficulty, for the committed report. `docs/balance/phase-2.md` is committed: run the command again, and commit the new report, after any change to the engine or the content that moves the numbers.

The code is in `balance/`: `strategies.ts` builds the grid and the decisions each strategy makes, `play.ts` plays the games through `simulate()` and sums each one up, `report.ts` ranks the strategies and writes the Markdown without I/O, `cli.ts` parses the options and writes the file, and `run.ts` is the entry point `tsx` runs.

## The 10-year invariant test

`tests/invariants.test.ts`, part of `npm test`, plays ten years for seed 1 at Facile, seed 42 at Moyen and seed 2026 at Difficile. After every day it checks that the trial balance is zero, that Actifs = Passifs + Capitaux propres and that Stocks equals the cost of the lots on hand; after every calendar month, that `trialBalance()` agrees with the running tally the daily checks use and that the cash flow statement's net change equals the change in Encaisse. It then plays each game again through `simulate()` and compares the journal hashes. The file must finish in under 60 seconds in CI: if it gets slower, make the slow part faster rather than checking fewer days or seeds.
