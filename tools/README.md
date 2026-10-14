Node scripts and checks that run outside the browser, such as the headless simulation (`npm run sim`).

## Headless simulation

```sh
npm run sim -- --days 3650 --seed 42
```

Plays the game from day 0 without a screen, with the shipped content, and prints one row per year: revenue, net income, cash at year end, units spoiled and lost sales. Years count from the first day of play (May 1st), so year 1 runs from day 0 to day 364 and `--days 3650` prints ten rows; a run that stops mid-year ends with a shorter one. Under the table comes the sha256 of the journal: the same seed and days always give the same hash.

| Option   | Default | Meaning                                                                                 |
| -------- | ------- | --------------------------------------------------------------------------------------- |
| `--days` | 3650    | Days to play, a whole number from 1.                                                    |
| `--seed` | 42      | Seed of the game's generator, a whole number in [0, 2^32).                              |
| `--out`  | `out/`  | Folder the result goes to, relative to the current one (the repo root under `npm run`). |

The full result goes to `<out>/sim-<seed>.json`: the seed, the days, the journal hash, the yearly rows, each day's summary (units sold, revenue, lost sales and spoilage per product) and every journal entry. Ten years make about 6.5 MB. `out/` is git-ignored.

The code is in `sim/`: `simulate.ts` plays the game and sums it up without I/O, `cli.ts` parses the options, prints the report and writes the file, and `run.ts` is the entry point `tsx` runs.

## The 10-year invariant test

`tests/invariants.test.ts`, part of `npm test`, plays ten years for seeds 1, 42 and 2026. After every day it checks that the trial balance is zero, that Actifs = Passifs + Capitaux propres and that Stocks equals the cost of the lots on hand; after every calendar month, that the cash flow statement's net change equals the change in Encaisse. It then plays each seed again through `simulate()` and compares the journal hashes. The file must finish in under 60 seconds in CI: if it gets slower, make the slow part faster rather than checking fewer days or seeds.
