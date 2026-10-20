# Phase 4C gate: a newcomer learns the controls alone

Gate issue: [#240](https://github.com/etiennecrevier-bit/Magnat/issues/240). Production: https://magnat.etienne-crevier.workers.dev

Checked on 2026-10-20 against `main` at [`4c08f67`](https://github.com/etiennecrevier-bit/Magnat/commit/4c08f674fa5a06a6d3cb1b0ed52de2d8a6ec8f98), which includes Réal's postcards (#239).

## Status
- Automated pre-flight of the tour: **passed**. CI is green on `main` and production serves that build. A scripted newcomer finished Réal's seven days at Moyen without help, with a mouse at 1280×800 and by touch at 390×844. It only pressed what the bubble pointed at, plus three obvious closes.
- Automated pre-flight of the five tasks: **one task cannot be done**. Task 3 asks how many croissants were too expensive yesterday. The game shows that number nowhere, although the engine counts it (see [Task 3](#task-3-cannot-be-done)). Tasks 1, 2, 4 and 5 take 1 to 3 presses each.
- Leak check: **clean for Réal**. No text of the tour, and no postcard due by the time the five tasks are done, mentions money owed, grocers or the cash trap. Other screens the player sees do touch on money owed (see [Before you ask the question](#before-you-ask-the-question)).
- Human acceptance: **pending**. The gate passes only when Étienne has played it with a real newcomer and ticked the boxes on #240. A script cannot hesitate. This record gives the paths and the likely snags, not a verdict.

| Gate criterion (#240) | Automated pre-flight | Human check |
| --- | --- | --- |
| A newcomer starts a new game in Moyen and does the tutorial, unhelped | Passed on both viewports: 14 steps, no fallback, day 8 reached | Pending |
| Right after day 7, five tasks in two minutes | Tasks 1, 2, 4, 5: found, 1 to 3 presses each. Task 3: **not possible** | Pending |
| Note the hesitations; ask « Qu'est-ce que Réal t'a appris? » | The tour's texts and the day-8 postcards are clean; other screens listed below | Pending |
| Leave the five times and the notes on #240; each hesitation becomes a card | Not applicable | Pending |

## How the pre-flight ran
- **CI.** Read from GitHub: the check runs on `4c08f67`.
- **Deployed build.** Compared the asset names in the production `index.html` with a local `npm run build` of `4c08f67`.
- **The tour.**
  - Driver: Playwright's headless Chromium 156 on Linux, driven over the Chrome DevTools Protocol by a throwaway script (not committed). It used a fresh profile and cleared `localStorage`, so this was the browser's first game, and stopped the browser afterwards.
  - Path: « Nouvelle partie », Moyen, a business name, « Commencer », then « Faire la visite ».
  - Each step: the script read the bubble's text and the hole's position, matched the text to its step in `src/content/tutorial.json`, and found which `data-tuto` anchor the hole surrounds. It then made the gesture a newcomer would make on that anchor, with real input events at the anchor's centre, so the bubble's blocking layer applied. It waited for the bubble to change, not for set delays.
  - Gestures: the bubble's button; a press on the anchor; « − » on the café price; « + » on the croissant order; the first choice of the event; a hover on the café card with the mouse, a tap by touch.
  - Desktop: 1280×800 with a mouse. Headless Chromium answers `(hover: none)` even with media emulation, so the script made that query false, as on a real desktop. Without that, the bubble showed the touch text on desktop.
  - Phone: 390×844 with touch emulation and touch events.
- **The five tasks.** Right after the tour, on the same page, the script did each task by the shortest path and recorded the presses, what the screen showed, the postcards, and the open panels.
- **Expected values.** The script forced an autosave by reporting the tab as hidden. A throwaway `tsx` script loaded that save with `deserialize` and read Encaisse (account 1000) with `balance`, and `lastDay.pricedOut` from the engine.
- **Text leak check.** A throwaway `tsx` script listed the 55 player-visible texts of `tutorial.json` (steps, fallbacks, touch texts, buttons, `coach`) and of the `tutoStory` event card. It searched them for épicerie, contrat, doit, dette, dû, comptes clients, recevoir, jours, prêt, emprunt, crédit, rouge, facture, payé, paie and intérêt.

## Results

### CI and the deployed build
- GitHub Actions, "Lint, typecheck, test, build": [success](https://github.com/etiennecrevier-bit/Magnat/actions/runs/39505386082/job/118912889609).
- Cloudflare, "Workers Builds: magnat": [success](https://github.com/etiennecrevier-bit/Magnat/runs/118913374555).
- `npm run build` on `4c08f67` gives `assets/index-DC2T2_v2.js` and `assets/index-D6BkPUAG.css`. Production serves exactly these two files.

### The tour, step by step
Réal's offer showed on the first game (« Réal t'attend au camion. »). Neither run hit a fallback: the croissants sold out on day 1, and some customers found the café too expensive on day 2.

"Target" is the anchor the bubble pointed at. A step listed more than once moved its target as the player went: the bubble follows the first anchor in reach.

| Step | Date | Target, 1280×800 | Target, 390×844 | Gesture that completed it |
| --- | --- | --- | --- | --- |
| `bienvenue` | Lundi 1er mai | none, centred | none, centred | « Allons-y » |
| `ouvrirCamion` | Lundi 1er mai | `dock.camion` | `dock.camion` | press « Camion » |
| `changerPrix` | Lundi 1er mai | `menu.cafe.price` | `menu.cafe.price` | « − » on the café: 3,75 $ → 3,70 $ |
| `lancerJour` | Lundi 1er mai | `panel.close`, then `speed.1` | same | « ✕ », then « ×1 » |
| `lireHier` | Mardi 2 mai | `yesterday` | **`cash.chip`** | press « Hier » (desktop: opens « Camion » on « Menu »); tap the cash chip (phone: opens its tooltip) |
| `commander` | Mardi 2 mai | `tab.stocks`, then `stocks.croissant` | `dock.camion`, `tab.stocks`, then `stocks.croissant` | « + » under « Commande quotidienne »: 40 → 41 |
| `tropCher` | Mercredi 3 mai | `dock.camion`, `tab.menu`, then `menu.cafe` | same | hover the café card (desktop); tap it (phone) |
| `ajuster` | Mercredi 3 mai | `menu.cafe.price` | `menu.cafe.price` | « C'est correct de même » |
| `evenement` | Jeudi 4 mai | `event.choices` | `event.choices` | « Avec plaisir » |
| `accelerer` | Vendredi 5 mai | `speed.3` | `speed.3` | « ×3 » |
| `pause` | Vendredi 5 mai | `speed.0` | `speed.0` | Pause |
| `encaisse` | Samedi 6 mai | `cash.chip` | `cash.chip` | « Compris » |
| `finances` | Samedi 6 mai | `dock.finances` | `dock.finances` | press « Finances » |
| `aurevoir` | Dimanche 7 mai | none, centred | none, centred | « Merci, Réal » |

- On desktop the `tropCher` bubble read « Passe ta souris dessus. »; on the phone, « Touche-le pour voir. ».
- On the phone, « Hier » is not on the screen: by design, it folds into the cash chip's tooltip under 700 px. So on day 2, Réal says « Plus de croissants vers midi. Regarde ce que ça a donné. » while pointing at « Encaisse ». The chip's tooltip does show « Ventes perdues ».
- **Three moments with no bubble.** After `commander` (day 2) and after `ajuster` (day 3), « Le camion » stays open, the bubble is gone, and the game waits paused until the player closes the panel. After `evenement` (day 4), the event card shows its outcome and waits for « Continuer ». The script closed each at once. A newcomer may wait there.
- **Day 8.** After « Merci, Réal », day 7 plays and the game stops paused on `Lundi 8 mai, an 1` with « Bilan de la semaine » open. It shows Ventes `2 357,00 $`, Bénéfice `-1 566,83 $`, Encaisse `10 000,00 $ → 9 001,40 $`, and Mme Prudhomme's « Une semaine sans histoire. Profitez-en pour relire votre bilan. ». « Fermer » sets the game going at ×1, about 4 s a day.
- **Four postcards come at once on day 8**, stacked top centre, in this order: `fournil` « Le local du fournil est à louer. Fais-toi une idée dans Le camion. », `embauche` « Tu peux engager quelqu'un. Va voir dans Équipe. », `ville` « La ville est à toi. Clique sur Ville. » and `amelioration` « T'as de quoi te gâter un peu. Regarde Améliorations. ». « Équipe », « Ville » and « Améliorations » pulse in the dock. On the phone the four cards cover the street between the top bar and the dock. No other postcard came before the tasks ended on `Mercredi 10 mai`, and `postcardsShown` in the save holds only these four.

### The five tasks
From the street on `Mardi 9 mai, an 1`, after « Fermer » on the weekly report. Opening « Le camion » pauses the game. Closing the report and pressing « ×3 » let it run.

| Task | Shortest path | Presses | What the tutorial taught |
| --- | --- | --- | --- |
| 1. Change the croissant's price | « Camion » (opens on « Menu »), « + » on the croissant: 3,75 $ → 3,80 $ | 2 | **By analogy only**: the same gesture on the café (day 1) |
| 2. Order more croissants for tomorrow | « Stocks », « + » under « Commande quotidienne »: 41 → 42; the card then reads « Demain : 42 par jour » | 2 with « Le camion » open, 3 from the street | Exactly (day 2) |
| 3. How many croissants were too expensive yesterday | **None.** See below | — | By analogy (the café, day 3), and that tooltip does not show it either |
| 4. Speed up, then pause | « ×3 », then Pause; Space also toggles them | 2 | Exactly (day 5) |
| 5. Cash, then Finances | Read « Encaisse 9 523 $ » on the chip, then « Finances » | 1 | Exactly (day 6) |

- Task 5's amount matches the engine: Encaisse at the close of day 8 is `9 522,88 $`; the chip rounds it to `9 523 $`, and its tooltip and « Finances » show the same.
- On the phone the paths are the same with taps. The dock shows icons only (truck, people, map, bar chart, star…), so « Camion » and « Finances » are found by their icons, as Réal showed them. A tap on the cash chip also opens « Finances ».

#### Task 3 cannot be done
- The croissant's tooltip on « Menu », after the tour: « Croissant · hier · Vendus 41 · Rupture 13 · Périmés 0 · Coût unitaire 1,15 $ · Marge unitaire 2,65 $ ». Then « vendus » per customer segment. No « Trop cher » row, and the word « cher » is nowhere on the page.
- The café's tooltip on day 3 has no such row either: « Café · hier · Vendus 38 · Rupture 0 · Périmés 0 · … ». So Réal says « Y en a qui trouvaient ton café cher. Passe ta souris dessus. », and what opens does not show it.
- Cause: `yesterdayFacts()` in `src/ui/productFacts.ts` always sets `pricedOut` to null (`PRICED_OUT_UNKNOWN`), so `productTip()` and the status line leave « Trop cher » out. Its comment says the engine counts priced-out visits only for all products together. That is no longer true: `DaySummary.pricedOut` is per product. In the phone game, the engine counted 24 croissant customers priced out on day 8.
- Likely player behaviour: give « Rupture » or « Ventes perdues » as the answer, or give up.
- This is a defect for a follow-up card (UI: show the engine's per-product `pricedOut` in the tooltip and status line). This card only reports it. Until then, task 3 cannot pass. Étienne decides whether to play the gate now and score task 3 as "not available", or wait for the fix.

#### Phone only: tooltips need a long press after the tour
During the tour, a tap on a tooltip's anchor opens the tooltip (that is how `tropCher` completes). After the tour:
- a tap on a product card lands on its controls: the script's tap at the card's centre raised the croissant's price to 3,85 $;
- a tap on the cash chip opens « Finances »;
- the tooltips open on a 500 ms long press, which the tour never shows.

On a phone, task 3, and any later reading of « hier » per product, depends on a gesture the newcomer was never taught.

### Leak check: what Réal tells, and what else the player sees
- **The tour's texts**: 55 texts. The two hits are false positives, both « jours »: « Sept jours avec Réal… » and the tag « Plus de clients pendant 3 jours ». Nothing about money owed, grocers or the cash trap.
- **Postcards**: only the four of day 8 came by `Mercredi 10 mai`. `contrat` (« Une épicerie veut tes croissants ») and `rouge` (« Ta caisse est dans le rouge ») did not. Encaisse was `9 523 $` with `3 169 $` of fixed costs due on June 1st, and « Contrats » read « Aucun contrat pour l'instant. ».
- **Other screens that touch on money owed** (not Réal, but the player may still name them):
  - « Finances », opened at Réal's request on day 6 and again in task 5, shows « À RECEVOIR 0 $ · Rien à recevoir ».
  - At Moyen the game starts with a 70 000 $ « Emprunt de démarrage », which the bilan shows under Passifs.
  - The day-8 « Bilan de la semaine » shows a loss, `-1 566,83 $`.
  - The `ville` postcard leads to a « Contrats » tab, empty for now.

## Facilitator sheet

### Before the session
- A browser that has never played Magnat: a private window, or a new profile. Réal's offer only shows on the browser's first game.
- Desktop with a mouse, ideally. On a phone, expect the long-press snag above.
- A stopwatch. Say nothing during the tour: no hint, no explanation.

### The protocol (#240)
1. The newcomer opens the production link, presses « Nouvelle partie », picks **Moyen**, names the business, then « Commencer » and « Faire la visite ».
2. They do the tour alone, until Réal says « Bon. La Floride m'attend… » and they press « Merci, Réal ».
3. Day 8 opens on « Bilan de la semaine », paused. Let them close it. Four postcards from Réal are now on screen; let them be.
4. Read the five tasks below one at a time, word for word. Time each one from the end of the sentence to done, and note every hesitation (where they looked, what they pressed first, how long they stopped).
5. Then ask the question, with nothing added.

### The five tasks, to read aloud
No word of the interface is given away beyond what the issue names.
1. « Change le prix du croissant. »
2. « Commande plus de croissants pour demain. »
3. « Trouve combien de clients ont trouvé le croissant trop cher hier. » *(Not possible in this build. See [Task 3](#task-3-cannot-be-done). Time how long until they give up or give another number, and note what they gave.)*
4. « Fais aller le jeu plus vite, puis arrête-le. »
5. « Trouve combien d'argent l'entreprise a, puis ouvre les finances. »

| Task | Seconds | Hesitations, first wrong press |
| --- | --- | --- |
| 1. Prix du croissant | | |
| 2. Commande de croissants | | |
| 3. Trop cher hier | | |
| 4. Plus vite, puis pause | | |
| 5. Encaisse, puis Finances | | |
| **Total (target: 120 s)** | | |

What to watch for, from the pre-flight:
- Task 1: the café was taught, not the croissant. Do they go to « Camion » or look for the croissant on the street?
- Task 2: « Le camion » opens on « Menu », and the order is under « Stocks ».
- Task 3: they may answer with « Rupture » or « Ventes perdues ». On a phone, do they find the long press?
- Task 4: « ×3 » or « ×10 », then Pause; Space counts too.
- Task 5: the chip is read, not pressed. On a phone, pressing it already opens « Finances ».
- The tour itself: after raising the order (day 2) and after « C'est correct de même » (day 3), the game waits for « Le camion » to close, with no bubble. Note any long stop there.

### The question
« Qu'est-ce que Réal t'a appris? »

- Ask it after the five tasks, as #240 says. By then, Réal's texts and the four day-8 postcards are all the player has had from him. None of them is about money owed, grocers or the cash trap.
- If the answer mentions money owed, grocers or the cash trap, the tutorial said too much.

#### Before you ask the question
Some screens show money owed without Réal saying it: « À recevoir » in « Finances », the startup loan in the bilan, and the day-8 loss. If the answer touches on one of these, a neutral « Où as-tu vu ça? » tells whether it came from Réal or from the screen. Note both the answer and where it came from. A mention that came from the screens is a finding about those screens, not a pass for Réal. That is Étienne's call when scoring.

### Afterwards
- Leave the five times and the notes in a comment on #240.
- Each hesitation becomes a card. Two candidates already stand from this pre-flight:
  - task 3: show « Trop cher » per product from `DaySummary.pricedOut`;
  - phone: the tour teaches a tap on tooltips, but the game needs a long press.

## What only a person can confirm
- Whether a real newcomer reads Réal's bubbles, or presses through them.
- Whether they wait after the day-2 and day-3 steps, when the bubble leaves and « Le camion » stays open.
- Whether the four postcards at once on day 8 distract from the tasks.
- Whether the five tasks take two minutes: the script needed about 9 s, with no reading or searching.
- What they say Réal taught them.

## Acceptance
- [ ] A newcomer did the tour at Moyen, unhelped.
- [ ] Right after day 7, the five tasks were timed; total under two minutes (task 3: see above).
- [ ] Hesitations noted; « Qu'est-ce que Réal t'a appris? » asked; no money owed, grocers or cash trap in the answer.
- [ ] The five times and the notes are on #240; each hesitation has a card.
