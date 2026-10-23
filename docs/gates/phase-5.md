# Phase 5 gate: hiring is a real choice

Gate issue: [#257](https://github.com/etiennecrevier-bit/Magnat/issues/257). Production: https://magnat.etienne-crevier.workers.dev

Checked on 2026-10-23 against `main` at [`1c888ac`](https://github.com/etiennecrevier-bit/Magnat/commit/1c888ac4bcffd5602671861d60735673d034f1d0), which includes the hiring screen and the team cards (#256), the portraits (#254) and the traits, absences and quits (#255).

> **If you are about to play the gate, read only [Before you play](#before-you-play) first.** The rest of this record names the candidates' weaknesses, who is absent when, and how to make someone quit. Read it after you have answered the four questions.

## Status
- Automated pre-flight of the hiring loop: **passed**. Production serves the build of `1c888ac`. In a browser, at Moyen, a script hired two people from « Équipe » → « Embaucher », lowered a wage, and saw each thing the four questions ask about: the weakness found out after two weeks, an absence, the warning and the quit.
- Timing: **a quit cannot happen within the two months.** An employee warns 8 weeks after their first underpaid morning and quits a week later. The earliest quit possible is Mardi 4 juillet, and Mardi 11 juillet after Réal's tour (see [No quit within two months](#no-quit-within-two-months)). The fourth question needs the session to go on to mid-July, or the answer is « no one quit ».
- CI on `main`: **red**, with two tests timing out at 5 s; the code itself passes them (see [CI and the deployed build](#ci-and-the-deployed-build)).
- Human acceptance: **pending**. The gate passes only when Étienne has played it and ticked the boxes on #257. A script cannot hesitate between two candidates or be surprised. This record gives the timings and the likely snags, not a verdict.

| Gate criterion (#257) | Automated pre-flight | Human check |
| --- | --- | --- |
| Play two months in Moyen and hire at least two people | Done by script on seed 20261020: two hires in the browser on Lundi 1er mai, and engine saves of a game with two hires on Mardi 9 mai, played to mid-July | Pending |
| Hesitate between two candidates? | 12 candidates per role, each with a strength, a hidden weakness and an asking wage. No trait numbers show. | Pending |
| A weakness surprises? | Found out 14 days after the start, as a message from « Vous » and a ▼ chip | Pending |
| A wage raised or lowered on purpose? | « − » / « + » steps of 0,50 $; « ⚠︎ demande 18 $ » once below. A raise above the asking wage changes nothing but the pay. | Pending |
| Someone quit, and was it clear why? | Warning and quit seen, but only from July on: **not within two months** | Pending |
| Three lines on #257: fun, boring, confusing | Not applicable | Pending |

## How the pre-flight ran
- **CI.** Read from GitHub: the check runs on `1c888ac` and the CI history of `main`.
- **Deployed build.** Compared the asset names in production's `index.html` with a local `npm run build` of `1c888ac`.
- **Two-month balance.** `npm run balance -- --hiring --games 30 --months 2`, written to `/tmp`, not committed. It is the hiring run of `docs/balance/phase-5.md` cut at two months.
- **Engine timeline.** Throwaway `tsx` scripts outside the repo (not committed). They played Moyen through `playMorning` of `tools/sim/simulate.ts`, answering each event card with its first choice. They ran two ways, on the tutorial's seed 20261020: with the tour skipped on day 0, and as a plain game on the same seed, which is what `?seed=20261020` and « Passer » start. Each hired Amélie Gagnon « Au camion » and Mathieu Pelletier « Livreur » at their asking wages, lowered Amélie's by 0,50 $ the next morning, and recorded the training entries, `knownTraits`, `lastDay.absent`, `lastDay.quits`, `staffNotices`, `warnsOnDay` and `quitsOnDay`. A third run tested raising the wage back for a day, then lowering it again. A last one counted, over seeds 1 to 30, the days a grocer's offer came by 30 juin.
- **Browser.**
  - Driver: Playwright's headless Chromium (`playwright-core` 1.64) on Linux, against `vite preview` of the local build, at 1280×800, with a fresh profile. The script was throwaway (not committed); the browser and the server were stopped afterwards.
  - Live part: `?seed=20261020`, « Nouvelle partie », Moyen, « Commencer », « Passer ». In « Équipe » → « Embaucher », it read the cards of each role and hovered the first card. It hired Amélie « Au camion » and Mathieu « Livreur », pressed « − » on Amélie's wage, played a day at ×1 and read « L'équipe ».
  - Saves part: the plain-game run above wrote saves on the mornings of 23 mai, 26 mai, 27 mai, 5 juillet and 12 juillet. For each, the script stored it under `magnat.sauvegarde`, pressed « Continuer », played one or two days at ×1, and read the messages and « L'équipe ».

## Results

### CI and the deployed build
- Cloudflare, "Workers Builds: magnat": [success](https://github.com/etiennecrevier-bit/Magnat/runs/120506105274).
- GitHub Actions, "Lint, typecheck, test, build": [failure](https://github.com/etiennecrevier-bit/Magnat/actions/runs/39980281527/job/120505472427). Two tests went over Vitest's 5 s timeout, and no assertion failed:
  - `src/engine/customers.test.ts` › « sends fewer customers away with faster service » (5.2 s);
  - `tools/balance/defiGuardrails.test.ts` › « payeDans60Jours: P3-13's owners win the same medals » (9.7 s).
- The same timeouts failed the runs of `51c576b` and `006d51f`. Every merge to `main` since `1f9f4e4`, ten runs, ended red. The logs of the older runs I tried would not load, so their cause is not checked here. This is a follow-up candidate (tooling: raise those tests' timeouts, or make them lighter); this card changes no test.
- Locally, on this branch (`main` plus this record), `npm run lint`, `npm run typecheck` and `npx vitest run --maxWorkers=4` pass: 218 files, 8,225 tests passed, 1 skipped.
- `npm run build` on `1c888ac` gives `assets/index-5eEiROGc.js` and `assets/index-D1vJTKxi.css`, plus nine PixiJS chunks. Production serves exactly these eleven files.

### The two-month balance
This is a controlled scenario, not what a fresh session will see. Each game is a busy business set up on day 0 and hires one candidate that day at their asking wage. Its twin plays the same seed with nobody hired. No other event card comes up, and the owner works throughout. The deliverer's games sign the two contracts on day 0. The baker's games also open the bakery on day 0, with the owner baking in the twin (see `docs/balance/phase-5.md` for the businesses). The gap is the game's Encaisse less its twin's on 30 juin, median over 30 seeds.

| Role | Twins' Encaisse | Gap: best | Gap: worst | Spread |
| --- | ---: | ---: | ---: | ---: |
| « Au camion » | $12,088.07 | Olivier Girard, -$3,855.34 | Maude Leblanc, -$5,575.07 | $1,719.73 |
| « Livreur » | -$5,511.94 | Olivier Girard, -$500.00 | Sophie Roy, Jonathan Côté, Maude Leblanc, -$1,750.00 | $1,250.00 |
| « Boulanger » | -$10,833.75 | Thierry Nguyen, -$249.27 | Jonathan Côté, -$650.00 | $400.73 |

- After two months, every hire costs money, in every role. The 12-month report's second target (the weakest candidate beats no hire in at least one role) is not met at two months: the best is Jonathan Côté as a baker, at -$650.00. That is expected, since the training and the first weeks are paid before a hire earns anything back. Over 12 months, bakers gain $507 to $2,480.
- At the truck the cheapest candidates come first. The three who ask $16.00 (Olivier, Nadia, Thierry, all weak in fiabilité) lose about $1,000 to $1,700 less than the three who ask $19.00 (Sophie, Jonathan, Maude, strong in fiabilité). In money, the choice at the truck is mostly the wage.
- The deliverer's gap is the wages and the training, $1,600 to $1,750, except for those absent on a delivery Monday. Olivier, absent half a day at the median, comes out $1,100 better. Most likely, the croissants of the missed delivery were not bought, while the grocer pays at 60 days, after the window. Not examined further.

### The engine timeline
Days are calendar days of year 1, with the engine `day` in parentheses (day 0 is Lundi 1er mai). The same on both runs.

| What | When |
| --- | --- |
| Hires decided (both at the asking wage: Amélie 18,00 $, Mathieu 16,50 $) | Mardi 9 mai (8) |
| They start; « Formation · Amélie Gagnon » 630,00 $ and « Formation · Mathieu Pelletier » 165,00 $ | Mercredi 10 mai (9) |
| Amélie's wage lowered to 17,50 $, taking effect the next morning | decided Mercredi 10 mai (9), `underpaidSince` Jeudi 11 mai (10) |
| Both weaknesses found out (`hiredOnDay` + 14) | Mercredi 24 mai (23) |
| Amélie absent (weak in rapidité, normal fiabilité: 2 % a day) | Samedi 27 mai (26) |
| Mathieu absent, but with no delivery to make, so not counted | Mercredi 17 mai (16) |
| Two months end | Vendredi 30 juin (60) |
| Amélie warns, `underpaid` | Jeudi 6 juillet (66) |
| Amélie quits, `quit`, no notice paid | Jeudi 13 juillet (73) |

- **No work for the deliverer.** No grocer's offer came by 30 juin on the tutorial seed with the tour skipped, so Mathieu delivered nothing and drew 165,00 $ a week. Over seeds 1 to 30 at Moyen, an offer came by 30 juin in 3 games only, on days 50, 57 and 58. In the browser run, Normand's offer came on Vendredi 14 juillet.
- **The baker** needs the bakery open. Réal's `fournil` postcard says it can open from the first morning the postcards come.
- **Absences are a draw of the seed, the day and the candidate**, the same in every role and however the game is played. On the tutorial seed, from day 8 to day 60, the three weak in fiabilité are absent 2 to 5 times each (Thierry on 5 days, Olivier 3, Nadia 2), the three strong never, and the six others 0 to 3 times (Kevin 3, Chloé none). On a single seed, luck weighs as much as the trait. An absence on a day with no work for the role (a closed day, or a deliverer with no contract) shows nowhere.

### The UI walkthrough
- **The postcards.** With « Passer », Réal's four postcards come at once on Lundi 1er mai, `embauche` (« Tu peux engager quelqu'un. Va voir dans Équipe. ») among them.
- **« Équipe »** opens on « L'équipe », with only « Vous · Propriétaire ». The « Embaucher » tab shows the three roles as pills, and 12 cards for the role picked, in the content's order. Each card has a face, a name, « ▲ Force : Accueil », « Faiblesse : ? », « Demande 18 $ de l'heure », « Formation : 1 semaine payée » and « Embaucher ». No trait number shows anywhere.
  - A card's tooltip at the truck: « Rôle · Au camion », « Heures par semaine · 35 h », « Demande · 18,00 $ de l'heure », « Salaire par semaine · 630,00 $ », « Formation · 630,00 $ », « Force · Accueil · Attire plus d'habitués », « Faiblesse · Se révèle après 2 semaines de travail ».
  - The same candidate as « Livreur » reads « Sans effet en livraison » for the strength, and as « Boulanger » « Sans effet au fournil ». So the tooltip tells which traits matter in a role.
  - Asking wages, as shown: at the truck 16 $ (Nadia, Olivier, Thierry), 18 $ (six candidates) and 19 $ (Sophie, Jonathan, Maude); « Livreur » 16 $, 16,50 $ or 17,50 $; « Boulanger » 20,50 $, 22,50 $ or 23,50 $.
- **After « Embaucher ».** Each hire's card reads « Commence demain », with the « Salaire horaire » field between « − » and « + » (0,50 $ steps), « demande 18 $ » and « Annuler l'embauche · sans frais ». One press on « − » turns that line into « ⚠︎ demande 18 $ ». Nothing else says what being below the asking wage leads to.
- **The next morning.** Amélie reads « Au camion », still « ⚠︎ demande 18 $ ». Mathieu reads « Congé ». « Annuler l'embauche » has become « Congédier ».
- **The weakness, Mercredi 24 mai.** Two messages from « Vous », dated 24 mai: « Mathieu ne rate rien, mais il oublie de sourire aux habitués. » and « Les habitués adorent Amélie, mais la file avance lentement quand elle sert. ». On their cards, « ▼ Faiblesse : Rapidité » and « ▼ Faiblesse : Accueil ». Accueil has no effect on a deliverer, but the message still comes.
- **The absence, Samedi 27 mai.** That morning Amélie's card reads « Absent ». The next morning it reads « Hier : absence ». The street's « Hier » panel does not mention it (« Ventes 517 $ · Clients servis 85 »).
- **The deliverer with no contract.** Mathieu's card reads « Congé » and « Hier : 0 livraison · 0 $ facturés » every day, all through the run.
- **The warning, Jeudi 6 juillet.** A message from « Amélie Gagnon », dated 6 juillet: « Je vous aime bien, mais mon salaire ne suit pas. Si rien ne change d'ici une semaine, je pars. ». Her card adds « Pense à partir ».
- **The quit, Jeudi 13 juillet.** That morning her card reads « Parti ce matin · 17,50 $ de l'heure », and she is gone from « L'équipe » the next day. Her message, dated « 13 juillet », only comes the next morning, Vendredi 14 juillet, with the engine's `quit` notice. That morning Normand's offer also came, with Réal's `contrat` postcard. So the quit can arrive in a crowd, a day after the card showed it.

## Findings

### No quit within two months
- Being underpaid can only start when the player lowers a wage, since « Embaucher » hires at the asking wage (#256). The warning comes `underpaidWeeks` (8) × 7 = 56 days after the first underpaid morning, and the quit `warningWeeks` (1) × 7 = 7 days after that.
- A wage set on a morning takes effect the next morning, as does a hire. A hire can be lowered while it still reads « Commence demain », so the earliest underpaid morning is the hire's first day.

| Hire and cut decided | First underpaid morning | Warning | Quit |
| --- | --- | --- | --- |
| Lundi 1er mai (0), with « Passer » | Mardi 2 mai (1) | Mardi 27 juin (57) | Mardi 4 juillet (64) |
| Lundi 8 mai (7), right after Réal's tour | Mardi 9 mai (8) | Mardi 4 juillet (64) | Mardi 11 juillet (71) |
| Mardi 9 mai (8), then cut the next morning (this run) | Jeudi 11 mai (10) | Jeudi 6 juillet (66) | Jeudi 13 juillet (73) |

- So within the gate's two months (to Vendredi 30 juin), a warning is possible only by skipping the tour and lowering a wage in the first week. A quit is not possible at all. The fourth question needs the session to run into July, or a separate decision: Étienne's call (see [An optional extension](#an-optional-extension-to-see-a-warning-and-a-quit)). Shortening `underpaidWeeks` would be a content card, not this one.

### Some wages cannot be lowered
- Wages stay within the role's [min, max] (`src/content/staff.json`).
  - « Au camion »: min 16,00 $. Nadia, Olivier and Thierry already ask 16,00 $, so they cannot be underpaid. The others can be lowered by 2,00 $ or 3,00 $ an hour.
  - « Livreur »: min 16,00 $, as is the start. Nadia, Olivier and Thierry cannot be underpaid. The others can be lowered by 0,50 $ to 1,50 $ an hour, 5 $ to 15 $ a week.
  - « Boulanger »: min 18,00 $. Everyone can be lowered, by 2,50 $ to 5,50 $ an hour.
- A player who hires the cheapest at the truck, which the balance favours, has no wage to lower.

### A raise above the asking wage does nothing
- In `src/engine/staff.ts`, `hourlyWage` is used only to pay, and to compare with `askingWage()`. Paying above the asking wage buys nothing.
- A raise matters in one case only: to bring an underpaid employee back to their asking wage before they quit. A player asked « did you raise a wage on purpose? » can only have had that reason, or a misreading.

### One day at the asking wage restarts the eight weeks
- `staffMorning` drops `underpaidSince` on the first morning the wage is at or above the asking wage. A later cut starts a new period. `src/engine/staff.test.ts` tests this on purpose, so it is the design, not a defect.
- The timeline shows what it allows. Amélie was underpaid from Jeudi 11 mai, raised back to 18,00 $ from Dimanche 11 juin and lowered again from Lundi 12 juin. She then warned on Lundi 7 août (98) and quit on Lundi 14 août (105), instead of Jeudi 6 juillet and Jeudi 13 juillet.
- Wages are paid on Fridays, a full week at that morning's wage. So the day at the asking wage costs nothing unless it is a Friday. On Samedi 1er juillet, both runs had the same Encaisse, 6 165,83 $.
- A player who finds this can underpay forever at no cost. Whether that matters is a design decision for Étienne. It is a follow-up candidate, not a fix: for instance, recover from underpay only after a full payday at the asking wage.

### The deliverer will likely have nothing to do
- Over seeds 1 to 30, a grocer's offer came by 30 juin in 3 games, and none came on the tutorial seed.
- The hiring screen does not say there is nothing to deliver. The team card shows it from the first day: « Congé », « Hier : 0 livraison · 0 $ facturés ».
- A hire made to reach "at least two people" may well be a deliverer paid to wait. That is a lesson about fixed costs, and possibly something Étienne remarks on as boring or confusing.

### Smaller notes
- The quit's message comes the morning after « Parti ce matin », dated the day before (see the UI walkthrough). Minor, but it is where « did you understand why » is answered.
- A weakness with no effect in the role is still found out and announced: Mathieu's accueil as a deliverer.
- CI on `main` is red on two timeouts (see above).

## Facilitator sheet
Étienne is both the player and the facilitator here. So the sheet comes in two parts: what to know before playing, which gives nothing away, and what to compare after answering.

### Before you play
- Open the production link. If Réal's offer shows, either choice works. « Faire la visite » plays seven days with Réal on his own seed, and the postcards then come on Lundi 8 mai. « Passer » starts at once on the address's seed, or a random one, and the postcards come on Lundi 1er mai.
- Pick **Moyen**.
- Play at least to **Vendredi 30 juin, an 1**: two months. Hire at least two people, in whatever roles and at whatever time feel right. Change wages only if you want to.
- Keep notes as you go, in the table below: what you looked at before hiring, and anything that made you stop.
- Do not read past this section until you have answered the four questions.

| Date in game | What happened | What you thought or did |
| --- | --- | --- |
| | | |
| | | |
| | | |

### The four questions (#257, word for word)
Answer them at the end of the two months, before reading on:
1. Did you hesitate between two candidates?
2. Did a weakness surprise you?
3. Did you raise or lower a wage on purpose?
4. Did someone quit and did you understand why?

Then leave three lines in a comment on #257: what was fun, what was boring, what confused you.

### After answering: what the pre-flight expects
- **Question 1.** Every candidate shows one strength and asks a wage. At the truck the balance favours the cheapest (16 $, all three weak in fiabilité), so a hesitation may come down to the wage. Did you open the tooltips? They show what the strength does in that role, or « Sans effet… ».
- **Question 2.** The weakness shows 14 days after the start, as a message from « Vous » and a ▼ chip. Did you see the message, or only the chip later? Was the weakness one that acts in the role?
- **Question 3.** Lowering is possible only for those who ask above the role's minimum. A raise above the asking wage changes nothing but the pay (see [A raise above the asking wage does nothing](#a-raise-above-the-asking-wage-does-nothing)). If you lowered a wage, did you notice « ⚠︎ demande … $ », and did you expect anything to follow?
- **Question 4.** Within two months, no one can quit (see [No quit within two months](#no-quit-within-two-months)). « No » is the expected answer, unless the session went on into July. If you hired a deliverer, did you notice « 0 livraison »?

### An optional extension: to see a warning and a quit
Only after the four answers are recorded, and recorded apart from them:
1. Pick an employee whose asking wage is above the role's minimum (not Nadia, Olivier or Thierry at the truck or delivering), and lower their wage by one step.
2. Play on, without raising it again. About 8 weeks after the first morning at the lower wage, they warn: a message in their own words, and « Pense à partir » on their card. A week later, their card reads « Parti ce matin », and their message comes the next morning. On the dates above, that means mid-July or later.
3. Note whether the warning was clear, whether you raised the wage back, and whether the quit made sense.

| Extension | Date in game | Notes |
| --- | --- | --- |
| Wage lowered | | |
| Warning seen | | |
| Raised back, or let go | | |
| Quit seen | | |

## What only a person can confirm
- Whether choosing between candidates feels like a choice, or like picking the cheapest.
- Whether the weakness feels like a surprise, or like a label that appears.
- Whether « ⚠︎ demande … $ » reads as a risk.
- Whether a warning and a quit, when they finally come, feel caused by your wage choice.
- What was fun, boring and confusing.

## Acceptance
- [ ] Played two months in Moyen and hired at least two people.
- [ ] Answered: hesitated between two candidates? A weakness surprised? A wage raised or lowered on purpose? Someone quit, and understood why?
- [ ] Three lines on #257: what was fun, what was boring, what confused you.
