# Phase 1 gate: the balance sheet balances over a 10-year test game

Gate issue: [#22](https://github.com/etiennecrevier-bit/Magnat/issues/22). Production: https://magnat.etienne-crevier.workers.dev

The game the pre-flight played: **https://magnat.etienne-crevier.workers.dev/?seed=42**. Tap ×10 and pause on `Mardi 1er mai, an 2` (about 2.5 minutes). Mois dernier then shows exactly the April numbers below. It shows them on any day in May, year 2, so a late pause changes nothing there.

Checked on 2026-10-14 against `main` at [`f760a90`](https://github.com/etiennecrevier-bit/Magnat/commit/f760a902cf4b9dc1451f3d29933e5a11f8043330).

## Status
- Automated pre-flight: **passed**. CI is green on `main`. Production serves that build. One year at ×10 on production gives statements that match the engine on all 196 rows.
- Human acceptance: **pending**. The gate passes only when Étienne ticks the three boxes on #22. The gut check is his: this record gives numbers and candidates, not a verdict.

| Gate criterion (#22) | Automated pre-flight | Human check |
| --- | --- | --- |
| CI is green on `main`, including the 10-year invariant test | Passed: both checks green on `f760a90`; invariants ran 3 seeds × 3650 days in 38.6 s (budget 60 s) | Pending |
| Play one game year (×10 is fine) on the production link, then open the statements | Passed: 365 days at ×10 on `?seed=42`; 12 statement views, 196 rows, all match | Pending |
| Gut check, as an owner | Input only: the owner's read and the candidates below | Pending |

## How the pre-flight ran
- **CI.** Read from GitHub: the Actions run, its log and the check runs on `f760a90`.
- **Deployed build.** Compared the asset names in the production `index.html` with a local `npm run build` of `f760a90`.
- **One year on production.**
  - Driver: headless Chrome 155 on Windows, driven over the Chrome DevTools Protocol by a throwaway script (not committed). It started its own browser with a temporary profile and stopped it afterwards.
  - Run: at 1280×800 it loaded the seed link, clicked ×10, polled the top bar every 100 ms and clicked Pause once the date reached May 1st, year 2.
  - Statements: it opened États financiers. For each of the three statements and three periods, it clicked the buttons and read the dates line and every row (kind, label, amount). It then switched the same page to a 375×812 phone viewport, without a reload so the game stayed the same, and read the three statements again for Depuis le début de l'année.
- **Expected values.** A throwaway `tsx` script found the day N whose `formatGameDate` is the date on the top bar. It played seed 42 with `createInitialState` and N calls to `tick`. For each period it ran `periodFor` and `computeStatements`, then formatted the rows with `formatStatementAmount` and the dates with `formatGamePeriod` and `formatShortGameDate`. Every row had to match in order: kind, label and amount.
- **Owner's read.** `npm run sim -- --days 3650` for seeds 1, 42 and 2026. A throwaway script derived the ratios from each run's journal and day summaries.

## Results

### CI on `main`
- GitHub Actions, "Lint, typecheck, test, build": [success](https://github.com/etiennecrevier-bit/Magnat/actions/runs/38599957099/job/115976345505). 33 test files, 658 tests passed.
- The 10-year invariant test (`tests/invariants.test.ts`) logged `Invariants: 3 seeds × 3650 days in 38633 ms`. For seeds 1, 42 and 2026 it checks the close of every day: the trial balance is zero, Actifs = Passifs + Capitaux propres, and Stocks equal the cost of the lots on hand. Each month's net cash flow must equal the change in Encaisse. Each seed is played twice and must post the same journal.
- Cloudflare, "Workers Builds: magnat" (the production deploy): [success](https://github.com/etiennecrevier-bit/Magnat/runs/115976601097).

### Deployed build is `main`
`npm run build` on `f760a90` produces `assets/index-CPtiBkvJ.js` and `assets/index-DjT8wmbU.css`. The production `index.html` serves exactly these two files.

### One year on production (seed 42)
- On load: `Lundi 1er mai, an 1`, Encaisse `10 000,00 $`, ×1 pressed, page visible.
- At ×10: 365 date changes in 146.2 s, one every 400 ms on average (400 expected).
- Pause landed on `Mardi 1er mai, an 2`, which is day N = 365. Pause showed as pressed and the date did not move in the next 3.5 s. Days 0 to 364 were played, so the last day played is `Lundi 30 avril, an 2`.
- The top bar's Encaisse, `93 879,50 $`, matches.
- Aujourd'hui shows `Hier : Lundi 30 avril, an 2`: Café 114 sold, 0 lost, 0 spoiled; Croissant 70 sold, 11 lost, 0 spoiled; Chiffre d'affaires `512,50 $`. All of it matches.
- All 9 views at 1280×800 and 3 views at 375×812 match the engine on every row, 196 rows in all. In each of the 4 Bilan views, Total des actifs = Total des passifs et des capitaux propres = `93 897,50 $` on screen.
- At 375×812: no horizontal scroll, zoom 1, amounts at 16 px, none clipped. Some long labels wrap onto two lines, such as "Flux de trésorerie liés aux activités d'exploitation". Amounts never wrap.
- The screenshots (not committed) were checked by eye.

#### Days each period covers at N = 365
The periods include today, day N, which the game plays next. Its entries are not posted yet.

| Period | Days | Dates shown | Entries posted through |
| --- | --- | --- | --- |
| Ce mois-ci | 365 | `Le 1er mai, an 2`; Bilan `Au 1er mai, an 2` | None: day 365 is not played yet. Every flow is `0,00 $` and the bilan equals April 30th's. |
| Mois dernier | 335–364 | `Du 1er avril au 30 avril, an 2`; Bilan `Au 30 avril, an 2` | `Lundi 30 avril, an 2` |
| Depuis le début de l'année | 245–365 | `Du 1er janvier au 1er mai, an 2` | `Lundi 30 avril, an 2` |

Depuis le début de l'année is the calendar year to date. It is not the sim's year 1, which runs from May 1st, year 1 to April 30th, year 2.

#### What the statements show
| Row | Mois dernier (April, year 2) | Depuis le début de l'année |
| --- | --- | --- |
| Ventes | `11 867,25 $` | `46 655,75 $` |
| Coût des marchandises vendues | `2 526,90 $` | `9 916,30 $` |
| Marge brute | `9 340,35 $` | `36 739,45 $` |
| Pertes sur stocks | `402,30 $` | `1 754,10 $` |
| Loyer et permis | `1 350,00 $` | `5 400,00 $` |
| Carburant et entretien | `600,00 $` | `2 400,00 $` |
| Bénéfice net | `6 988,05 $` | `27 185,35 $` |
| Flux de trésorerie liés aux activités d'exploitation | `7 068,45 $` | `27 235,75 $` |
| Encaisse au début / à la fin de la période | `86 811,05 $` / `93 879,50 $` | `66 643,75 $` / `93 879,50 $` |

Bilan au 1er mai, an 2: Encaisse `93 879,50 $`, Stocks `18,00 $`, Total des actifs `93 897,50 $`, no passifs, Capital-actions `10 000,00 $`, Bénéfices non répartis `83 897,50 $`. These rows read `0,00 $` in every view: Salaires, Marketing, Amortissement, Intérêts, Équipement, Amortissement cumulé, Comptes clients, Comptes fournisseurs, Emprunts bancaires, and the investing and financing flows.

### Owner's read (10-year sims)
Seed 42, as `npm run sim` prints it (a developer report, in English):

```
Year       Days      Revenue  Net income  Cash at year end  Units spoiled  Lost sales
   1      0-364  $143,357.50  $83,897.50        $93,879.50           5940         299
   2    365-729  $144,922.75  $85,330.35       $179,203.85           5713         393
   3   730-1094  $142,396.25  $83,066.65       $262,210.50           5985         324
   4  1095-1459  $143,560.50  $84,132.50       $346,401.80           5816         259
   5  1460-1824  $144,255.25  $84,733.25       $431,085.05           5783         305
   6  1825-2189  $144,294.75  $84,759.15       $515,904.20           5797         396
   7  2190-2554  $142,993.00  $83,635.00       $599,515.20           5856         336
   8  2555-2919  $141,789.00  $82,445.80       $681,944.20           6198         403
   9  2920-3284  $141,599.50  $82,382.30       $764,382.50           6014         271
  10  3285-3649  $143,749.50  $84,287.10       $848,583.20           5824         456
```

Journal sha256 after 3650 days:
- Seed 42: `346f265a9b56080cd32a2c295c07f6490fc63e6c871ef13a30bbf2f82e7e020a`
- Seed 1: `1796168e5d4e2000f86bed3925186757ca41f3333c868a5b63dd953af29e4c2f`
- Seed 2026: `e87ff852ed5f8ae420887275246cca537c93a24687e1217c001e2b1059d7a408`

Year 1 (days 0–364) for each seed. Ratios are % of Ventes.

| Measure | Seed 42 | Seed 1 | Seed 2026 |
| --- | --- | --- | --- |
| Ventes | $143,357.50 | $143,859.75 | $144,266.25 |
| Coût des marchandises vendues | 21.2% | 21.2% | 21.2% |
| Pertes sur stocks | 3.7% | 3.6% | 3.6% |
| Loyer et permis | 11.5% | 11.4% | 11.4% |
| Carburant et entretien | 5.1% | 5.1% | 5.1% |
| Bénéfice net | 58.5% | 58.7% | 58.8% |
| Croissants spoiled, of 25,550 bought | 5,940 (23.2%) | 5,827 (22.8%) | 5,735 (22.4%) |
| Days all 70 croissants sold | 51 | 61 | 44 |
| Days with croissant lost sales | 46 | 53 | 37 |
| Croissant lost sales, % of demand | 254 (1.3%) | 347 (1.7%) | 204 (1.0%) |
| Café spoiled | None observed | None observed | None observed |
| Café lost sales | 45 over 5 days | 132 over 10 days | 51 over 3 days |
| Encaisse at the end of year 10 | $848,583.20 | $844,818.20 | $847,540.85 |

- Croissants by day of the week (seed 42; the other seeds are within 0.8 of these):
  - Weekdays: 59.0 sold and 11.0 spoiled a day on average.
  - Weekends: 40.5 sold and 29.5 spoiled.
  - Every lost croissant sale falls on a weekday.
- Café keeps 90 days, so the runs never spoil any. That is not a rule that café never spoils.
- In every seed and every year, Encaisse grows by $81,600 to $85,400.

## Candidates for the owner
None of these is an issue yet. Étienne picks which ones become `bug` issues with the `phase-1` label. The groups are the ones he set on 2026-10-14.

**Phase-1 bug: the books are wrong now, or miss something a real bilan would have today**
- **The truck is not on the bilan.** Actifs à long terme stay at `0,00 $` all game, so there is no Amortissement either. The bilan shows only Encaisse and Stocks. The chart of accounts already has Équipement and Amortissement cumulé.

**Already planned in [`docs/game-design.md`](../game-design.md)**
- **A fixed 70 croissants a day, weekends included** → phase 2 (stock and spoilage). Weekends have a third fewer customers, and 29.5 of the 70 spoil.
- **No wages, no staff** → phase 3 (capacity). Salaires stays at `0,00 $`.
- **Cash piles up; net margin of 58.5%** → phase 2 balancing (first balance-bot runs). There are no owner draws either.

**Not in the brief (Étienne's call)**
- No taxes: no TPS/TVQ on sales, no income tax.
- No seasonality: the truck sells 365 days a year, with the same traffic in January as in July.
- No packaging, card fees or insurance.
- On the 1st of a month, Ce mois-ci covers only today, which is not played yet, so every flow reads `0,00 $`. Likewise, Depuis le début de l'année reads "au 1er mai" while its entries stop on April 30th. Both come from the periods including today (`src/ui/statementPeriods.ts`).

## Acceptance (Étienne, on #22)
- [ ] CI is green on `main`, including the 10-year invariant test.
- [ ] Play one game year (×10 is fine) on the production link, then open the statements.
- [ ] Gut check, as an owner: do the bilan, état des résultats and flux de trésorerie look like a real small business's books? Do spoilage and lost sales feel believable for a coffee and croissant truck?
