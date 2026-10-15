Node scripts and checks that run outside the browser, such as the headless simulation (`npm run sim`).

## Headless simulation

```sh
npm run sim -- --days 3650 --seed 42 --difficulty moyen
```

Plays the game from day 0 without a screen, with the shipped content, at one difficulty, and prints one row per year: revenue, net income, cash at year end, units spoiled and lost sales. Years count from the first day of play (May 1st), so year 1 runs from day 0 to day 364 and `--days 3650` prints ten rows; a run that stops mid-year ends with a shorter one. Under the table comes the sha256 of the journal: the same seed and days always give the same hash.

| Option         | Default | Meaning                                                                                                                           |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--days`       | 3650    | Days to play, a whole number from 1.                                                                                              |
| `--seed`       | 42      | Seed of the game's generator, a whole number in [0, 2^32).                                                                        |
| `--difficulty` | `moyen` | How the game starts: `facile`, `moyen` or `difficile`, as on the new game screen, whose default it is. It sets the opening books and the truck's charges. |
| `--out`        | `out/`  | Folder the result goes to, relative to the current one (the repo root under `npm run`).                                           |

The full result goes to `<out>/sim-<seed>-<difficulty>.json`: the seed, the difficulty, the days, the journal hash, the yearly rows, each day's summary (units sold, revenue, lost sales and spoilage per product) and every journal entry. Ten years make about 6.5 MB. `out/` is git-ignored.

The code is in `sim/`: `simulate.ts` plays the game and sums it up without I/O, `cli.ts` parses the options, prints the report and writes the file, and `run.ts` is the entry point `tsx` runs.

### Compare with the game

A « Nouvelle partie » started at a difficulty from a page opened with `?seed=<n>` in its address, such as `http://localhost:5173/?seed=42`, plays the same days as `npm run sim -- --seed <n> --difficulty <difficulty>`; without it, or with a seed outside [0, 2^32), each new game starts on a random seed. Play at least one day, pause the game and count N, the days from May 1st, year 1, to the date in the top bar. `npm run sim -- --seed <n> --days N` then shows, for year 1, the numbers of the États financiers screen under "Depuis le début de l'année": Revenue is Ventes, Net income is Bénéfice net and Cash at year end is Encaisse. The screen's periods end on the day shown, which has not been played yet, so the sim's days 0 to N - 1 cover the same entries.

This only holds while the top bar shows year 1 (N up to 244, December 31st): the sim's years run from May to April, while the screen's year starts on January 1st.

## The 10-year invariant test

`tests/invariants.test.ts`, part of `npm test`, plays ten years for seed 1 at Facile, seed 42 at Moyen and seed 2026 at Difficile. After every day it checks that the trial balance is zero, that Actifs = Passifs + Capitaux propres and that Stocks equals the cost of the lots on hand; after every calendar month, that `trialBalance()` agrees with the running tally the daily checks use and that the cash flow statement's net change equals the change in Encaisse. It then plays each game again through `simulate()` and compares the journal hashes. The file must finish in under 60 seconds in CI: if it gets slower, make the slow part faster rather than checking fewer days or seeds.
