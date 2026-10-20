# Phase 4B review: the new interface end to end

Review issue: [#210](https://github.com/etiennecrevier-bit/Magnat/issues/210) (4B-13). It covers the cards of the milestone, #197 to #209.

Checked on 2026-10-20 against `main` at [`518853e`](https://github.com/etiennecrevier-bit/Magnat/commit/518853e) (after #225).

## Status
- **Four of the seven items pass** (2, 5, 6, 7). Item 4 misses at both sizes, and so does item 1 through its rule 4. Item 3 misses on a phone only.
- **8 misses**, each filed as a `bug` + `phase-4b` issue: M1 to M8 below, #226 to #233. Four are about item 4, one about item 3. M1 to M3 are defects found while playing: the dock after Escape, « Hier »'s tab and the Finances drawer's scroll. Nothing is fixed in this branch: the card asks for issues.
- **9 observations**: borderline or design questions, not filed.

| # | Item (#210) | Result |
|---|---|---|
| 1 | Every rule of « The rules of the new interface » (#202) holds on every panel | Miss: rule 4 (M4 to M7); rule 3 on a phone (M8). Rules 1, 2, 5 and 6 hold |
| 2 | No number from before the milestone is missing | Pass: every row of the inventory below is one click or one hover away |
| 3 | No sentence longer than one line sits under a control | Pass at 1440 × 900; miss on a phone: M8 |
| 4 | The street is visible with nothing open; dock, top bar, « Hier » and ticker never overlap | Miss: M4, M5 (phone), M6, M7 |
| 5 | The world looks like `RueLumiere.png` and `VilleLumiere.png`; nothing has a black outline | Pass, with observation O7 (the ×10 badge is M6) |
| 6 | Every player-facing word is French (Quebec); « Le rêve » appears nowhere | Pass |
| 7 | The CLAUDE.md review checklist passes | Pass |

## How the review ran
- **Build.** `npm run build` of `518853e`, served by `vite preview`.
- **Browser.** Headless Chromium 156 (Playwright's build, with SwiftShader for Pixi), a fresh profile, driven over the Chrome DevTools Protocol by throwaway scripts (not committed). The dock, tabs, ✕, tooltips, the street and every miss's steps use real input events (`Input.dispatch*`); event choices, accordions and Journal rows were clicked through the DOM.
- **Desktop.** 1440 × 900, DPR 1, `?seed=42`, a new game in Moyen. About 30 minutes of wall clock: 2 min at ×1, 4 min at ×3, 4 min at ×10, and the rest paused in panels. The game went from `Lundi 1er mai, an 1` to `Lundi 27 mai, an 3`, with 33 event cards answered, a hire, a price change, a trip to the meunerie, the vélo bought, an emergency loan and Max Duvent's shares.
- **Phone.** 390 × 844, mobile emulation with touch, a new game in Moyen on the same seed. About 10 minutes: 2 min at ×3, 2.5 min at ×10, and touch passes through every panel, with long presses for the tooltips. The game reached `Vendredi 22 juin, an 2`, with a grocer contract.
- **Défi.** « La semaine des 1 000 $ » at 1440 × 900: the dock and the Finances tabs.
- **Audit, at every game day and every screen.** A script read the page:
  - the boxes of the top bar, the dock, « Hier », the ticker, the messages and the slide-in, and any overlap between them;
  - for each open panel: its title, tabs, headings, the status dots without words, and every text block outside a tooltip that renders on more than one line, with the control nearest above it;
  - every visible text node and every `aria-label`, `title`, `placeholder` and `alt`.

  931 audits in all: 620 at 1440 × 900 (454 of them at a new game day) and 311 at 390 × 844 (263 at a new game day). The first 2 minutes on the desktop ran at 1440 × 700 by mistake (35 audits, no overlap) and are not counted. The line counts and headings are diagnostics: each hit was read on the screenshot before it counted.
- **Screenshots.** On the unmerged branch [`screenshots/issue-210`](https://github.com/etiennecrevier-bit/Magnat/tree/screenshots/issue-210/issue-210), outside this diff. Below, « Shot » names a file there.

## Misses
Each is filed as one issue labelled `bug` and `phase-4b`. All are at seed 42, Moyen.

### M1 · After Escape, a dock button's tooltip covers its neighbours and swallows the next click (#226)
- **Where:** the dock, 1440 × 900.
- **Steps:** click « Camion » in the dock, press Escape, click « Équipe ».
- **Expected:** « Équipe » opens.
- **Actual:** nothing opens. Escape gives the focus back to « Camion », and since the last input was a key, its tooltip « Camion · Touche C » shows at once (#201's focus rule). The tooltip sits over « Équipe » and « Ville », and it takes the click (`elementFromPoint` there is `.tip__body`). It happens after every panel or drawer closed with Escape: Équipe then Ville, Finances then Améliorations. Closing with ✕ by mouse does not show the tooltip.
- **Shot:** `bug-01-tooltip-after-escape.png`.

### M2 · « Hier » opens « Le camion » on the last tab, not on « Menu » (#227)
- **Where:** « Hier », 1440 × 900.
- **Steps:** open « Le camion », go to « Fournil », close it, click « Hier ».
- **Expected:** « Le camion » on « Menu » (#202, Do 6: « A click opens Camion on its Menu tab »).
- **Actual:** it opens on « Fournil ». `Yesterday.tsx` calls `openPanel('manage')` with no tab. #218 left it so because « Menu » came only with 4B-06, and #219 added the tab memory without wiring « Hier » to it.
- **Shot:** `bug-02-hier-opens-last-tab.png`.

### M3 · Finances keeps its scroll between tabs: « Personnel » opens past « Solde » (#228)
- **Where:** the Finances drawer, 1440 × 900.
- **Steps:** open Finances on « Entreprise », scroll down to the accordions, click « Personnel ».
- **Expected:** « Personnel » from the top: « Solde », the month, then the movements.
- **Actual:** the body keeps its scroll (`scrollTop` 90 here), so « Solde » and the month are above the fold and the drawer starts mid-table. The tour's first « Personnel » screenshot came out this way.
- **Shot:** `bug-03-personnel-opens-scrolled.png`.

### M4 · On a phone, the street is not visible with nothing open (#229)
- **Where:** the street, 390 × 844.
- **Steps:** start a game on a phone, close everything.
- **Expected:** the street shows between the top bar and the dock (#202 rule 4; #210 item 4).
- **Actual:** the world fills the width, so the street is scaled to about a quarter and sits at the bottom of the canvas. The dock (top at 669 px) and the ticker (732 px) cover it: only sky shows, with the roofs' tops under the dock. The truck and the people are not visible. #218's own phone screenshot (`screenshots/issue-202`, `07-390x844-closed.png`) shows the same.
- **Shot:** `bug-04-phone-street-hidden.png`.

### M5 · On a phone, the report slide-in covers the dock and the messages (#230)
- **Where:** the slide-in, 390 × 844.
- **Steps:** play past the first four weeks at ×3 or ×10.
- **Expected:** the slide-in sits above « Hier » and never covers the dock (#202, Do 8).
- **Actual:** it is 352 px wide and covers the dock by 35 to 59 px, on 157 of the 263 game days audited on the phone. When messages show, it also covers them by 201 px. While it shows, it sits over the dock's buttons.
- **Shots:** `bug-05-phone-slide-in-over-dock.png`, `phone-19-week-report.png`.

### M6 · At ×10, the street's tally contradicts « Hier » and stays after a pause (#231)
- **Where:** the street at ×10, 1440 × 900 (P4's badge in `src/world/customers.ts`).
- **Steps:** play at ×10 on an open day, then pause.
- **Expected:** one way to say yesterday's losses on screen (#202 rules 2 and 4).
- **Actual:** a large badge over the right-hand building says « 80 clients servis » and « 29 clients perdus », while « Hier » says « Clients servis 80 » and « Ventes perdues 0 ». The badge counts the visitors who left without buying; « Hier » counts the units missing in a stock-out. Two numbers with nearly the same name disagree on the same screen. The badge stays after a pause from ×10, and the message stack slides over it.
- **Shots:** `bug-06-x10-tally-vs-hier.png`, `bug-07-messages-stay.png` (the badge under the messages).

### M7 · Messages never leave the street (#232)
- **Where:** the messages, 1440 × 900.
- **Steps:** hire someone and play on without closing the message.
- **Expected:** nothing stays open on the street by default except the top bar, the dock, « Hier » and the ticker (#202 rule 4), and a message that waits shows as a small chip top right (#202 Do 3). #202 Do 8 puts up to 3 messages top centre but says nothing about when they leave, so how they leave (after some days, or into the chip) is a design choice for this issue to settle.
- **Actual:** Amélie Gagnon's message of `3 juin, an 1` was still on the street on `15 mai, an 3`. With three messages the stack is 290 px tall, over the top centre of the street, and it shows behind the Finances and Journal drawers. The « N messages » chip already tells that something waits.
- **Shot:** `bug-07-messages-stay.png`.

### M8 · On a phone, status lines and hints under controls wrap to two lines (#233)
- **Where:** 390 × 844.
- **Expected:** at most one status line under a control; anything longer in its tooltip (#202 rule 3; #210 item 3).
- **Actual:**
  - Ville › « Aller à… »: « Votre encaisse suffit, sans prêt » and « Rien à déposer pour l'instant », beside « Y aller »;
  - Réglages: « Les effets simples allègent la rue pour les ordinateurs plus lents. » and « Les 4 premières semaines d'une partie, le bilan vient quand même chaque semaine. »;
  - Finances: the accordion « État des flux de trésorerie » with « Détail complet » beside it.

  All fit on one line at 1440 × 900.
- **Shots:** `bug-08-phone-status-wraps.png`, `phone-16-reglages.png`, `phone-10-finances-entreprise.png`.

## Observations (not filed)
- **O1 · The full weekly report.** It opens in full, and pauses, on the first four Mondays of a game and on any morning that brings an event. It keeps its old frame: a « Fermer » button where every other panel has ✕, its own header, and the chart. This is by design (`opensFullReport`), but it is the one panel that does not look like the rest (`desk-31-week-report.png`).
- **O2 · « Personnel ».** Its first screen is the whole movements table, and the net worth's parts are a bulleted list, not tiles (rule 5). #205 asked for « Vos finances » as it was (`desk-19-finances-personnel.png`).
- **O3 · Negative amounts.** The cash chip and the Encaisse tile show `-3 689 $`, while the tile's tooltip shows `(3 689,00 $)`. The statements use parentheses as CLAUDE.md asks; the tiles are not statements.
- **O4 · Two « Les changements s'appliquent demain matin ».** « Équipe » has it without a period or an icon, « Le camion » with both.
- **O5 · Steppers.** « Salaire et marketing » and the Fournil's « Fournée quotidienne » have plain fields, where « Menu » and « Stocks » have − / + steppers.
- **O6 · « Fermer ».** Messages and the weekly report close with a « Fermer » button; panels and drawers with ✕.
- **O7 · The city.** In style it matches `VilleLumiere.png`: the palette, the brick triplexes, the silo, the park, no outlines. It differs in three ways, each decided by a card: the three grocers' shops in the empty lots (the human's answer on #209: keep them as built), the labels only on hover or click, and the city framed in the right half beside « Ville » (#204, #209).
- **O8 · Messages under the drawers.** At 1440 × 900 the message stack (from x = 480) runs under the Finances and Journal drawers (to x = 535). This goes with M7.
- **O9 · « Fournil ».** Its tab has its own « Fournil » heading under the tab of the same name.

## Item 1: the rules on every panel
Every panel and tab was opened by click at 1440 × 900 and by touch at 390 × 844; the keys C and E, and the street's spots, were tried too. That covers « Le camion » (Menu, Stocks, Horaire, Salaire et marketing, Fournil), « Équipe », « Ville » (Aller à…, Contrats), Finances (Entreprise with the four accordions, Personnel; Contrats in a Défi), « Améliorations » (Vie personnelle, Entreprise), « Journal » (Événements, Bilans) and Réglages. The conditional states reached:
- the event card and its result;
- the weekly report in full and as a slide-in, and the « Bilan du mois » row;
- a hire with « Commence demain » and « Annuler l'embauche · sans frais », and « Congédier … ? » with its notice in the tooltip;
- an upgrade's confirmation, then « Acquis »;
- « Financement » (an emergency loan, then Duvent Capital's shares);
- a trip in progress, « En route vers la meunerie » on the top-left card;
- a grocer contract and its tooltip;
- a negative encaisse (« Négative »), the Finances and Journal badges and the « N messages » chip. Not reached: the « Livraison manquée » chip.

Not reached: the « Magnat » screen, a bankruptcy, a Défi's end and the Défi's energy floor.

| Rule | Result |
|---|---|
| 1. Each panel answers one question | Pass. Each panel holds only its question's controls and numbers. Finances is read-only. |
| 2. A result beside its lever | Pass. Yesterday's sales, stock-outs, spoilage and segments are on each product's price and its tooltip; stock left is on each reorder rule; the delivery of the week is on each grocer's card. M6 is the exception, on the street. |
| 3. One line visible, the rest in a tooltip | Pass at 1440 × 900: the audit found no text over one line under a control in any panel. Every status dot (3 on Menu, 3 on Stocks, 1 on Fournil, 2 to 4 on « Aller à… ») has words. Intros are one sentence. Miss on a phone: M8. |
| 4. The street stays visible | Miss: M4, M5, M6, M7. At 1440 × 900 nothing is open on load or after closing, and the shell boxes never overlapped in 620 audits. |
| 5. Depth on demand | Pass on Entreprise: tiles, then the chart and « À surveiller », then the statements in closed accordions. Observation O2 on « Personnel ». |
| 6. No rule moves | Pass: `src/engine/` and `src/finance/` are unchanged since #212 (see item 7). |

Drawers do not pause: with Finances open at ×3, the date went from `Mardi 30 mai` to `Vendredi 2 juin` in 4.5 s. The event card and the full report pause; the dock panels were opened while paused, so their pause was not re-measured (#218's tests cover it). Escape closes panels and drawers. R folds « Hier » to its pill and back. In a Défi the dock has five buttons, and V and A do nothing.

## Item 2: no number lost
The inventory is #218's « Where each number went », extended with the numbers that 4B-06 to 4B-10 moved into tooltips (#219 to #223).

| Number (before 4B) | Where now | Seen |
|---|---|---|
| Encaisse | Cash chip (whole dollars); to the cent in its tooltip | `10 570 $`; tooltip `10 569,76 $` |
| Fixed costs of the month | Cash-chip tooltip; Finances › « À surveiller » | `3 169,35 $`; « 3 169 $ de frais fixes le 1er juin » |
| Valeur nette and its weekly change | Finances › Entreprise tile; Améliorations ribbon | `28 045 $ ▼ 330 $ depuis dimanche`; `28 045 $ / 100 000 $` |
| Net worth's parts | The tile's tooltip; Finances › Personnel | Part de l'entreprise, Argent personnel, Biens personnels, Dettes personnelles |
| Owner's title | Top-left card; Améliorations ribbon; weekly report | « Débrouillard » |
| Energy | Energy pill | « Reposée » |
| Yesterday's revenue, customers served, lost sales | « Hier »; on a phone, the cash-chip tooltip | `275,25 $`, `40`, `0`; phone tooltip « Ventes hier 0 $ … » |
| Yesterday by product: sold, lost, spoiled | Menu card status line and the product's tooltip (Vendus, Rupture, Périmés) | « 31 périmés hier »; « Vendus 39 · Rupture 0 · Périmés 31 » |
| Yesterday by segment | The product's tooltip | Chasseurs d'aubaines, Habitués, Clientèle chic |
| Unit cost and margin | The product's tooltip | `1,15 $`, `2,60 $` |
| Stock left | Stocks card status line | « Il en restait 284 hier » |
| Tomorrow's price | Menu card status line | « · Demain : 3,85 $ » |
| Bakery costs (move, rent, oven, capacity) | Fournil › (i) « Ce que coûte le fournil » | `1 500,00 $`, `2 400,00 $ par mois`, `600,00 $`, `25 000,00 $`, `800 croissants par jour` |
| Croissant cost, bought and made; bakery fixed costs | Fournil › (i) « Coût d'un croissant » | `1,10 $`, `0,55 $`, `3 000,00 $` / `2 400,00 $ par mois` |
| Staff hours, wage, weekly pay, training, notice | Équipe row and its tooltip | `35 h`, `17,50 $`, `612,50 $`, Formation `612,50 $`, Préavis `1 225,00 $` |
| Role terms when hiring | Each role pill's tooltip | Livreur `10 h`, `16,00 $`, `160,00 $` |
| Trip and visit times, what a place gives | « Aller à… » rows and their tooltips | « Trajet : 40 min · visite : 30 min », « −5 % sur le prochain achat » |
| Contracts: per week, bonus, weeks left, missed, receivable by date | Ville › Contrats card and tooltip (Défi: Finances › Contrats) | `1 250 croissants à 2,25 $`, `+0,40 $`, `3`, `0 sur 3`, `25 312,50 $` |
| Financement | Finances › Financement accordion | « Duvent Capital : 30 % des actions » |
| Personal account | Finances › Personnel | « Solde 3 000,00 $ », the month's movements |
| États financiers, with their periods | Finances › Bilan, État des résultats, État des flux de trésorerie | Ce mois-ci, Mois dernier, Depuis le début de l'année |
| Journal des événements | Journal › Événements, one row each, opens to the outcome | |
| Bilans: the weeks and the month | Journal › Bilans | « Bilan du mois · Avril, an 3 », then the weeks |
| Strip numbers | « Hier » | |
| Défi chip | Top-left card | « Défi · semaine 1 de 1 » |

Not seen: the Défi's energy floor, which « La semaine des 1 000 $ » did not show.

## Item 4: overlaps
- **1440 × 900:** 454 game days audited, the slide-in showing on 422 of them and messages on 453. No overlap between the top bar, the dock, « Hier », the ticker, the messages and the slide-in. Nothing open on load, after each ✕ or after Escape.
- **390 × 844:** 263 game days audited. The slide-in overlaps the dock on 157 of them, and the messages too when they show (M5). The street itself is hidden (M4).

## Item 5: the world
- **The street** next to `RueLumiere.png` (`00-RueLumiere-reference.png`, `desk-01-street-closed.png`): the same five buildings, trees, lamp, fire escape, dépanneur and truck, in the same light. The people, the « MENU » board and the street spots (Menu, Stocks, Vous, Équipe, La ville) all work.
- **The city** next to `VilleLumiere.png`: observation O7.
- **Outlines:** none by eye on either view. The only dark strokes in `src/world/art/` (`#2b2622`, the ink, 131 times) are railings and fire escapes, as in `street-target.svg` (11) and `city-target.svg` (97). No colour literal in `src/world/*.ts` is black or near-black (`0x000000` to `0x1fffff`, `#000`, `black`).

## Item 6: French
- 3 150 distinct strings scraped at both sizes, under 126 audit labels (screens and stretches of play), aria labels and tooltips included.
- An English-word scan finds only words that are French too: « Pause », « profit », « stock », « marketing », and « pee-wee » (Quebec hockey).
- No « rêve » anywhere in the text or attributes. A first pass flagged « revenu », which a whole-word match no longer does. `src/ui/playerText.test.ts` covers the source.

## Item 7: the CLAUDE.md checklist
- [x] `npm run lint` and `npm run typecheck` pass. `npm test` (`--maxWorkers=4`): 197 files, 7511 passed, 1 skipped. `npm run build` passes.
- [x] The 10-year invariant test passes: `tests/invariants.test.ts`, 54 tests, including « checks every game within 60 s ».
- [x] No React, DOM or `src/ui/` imports in `src/engine/` or `src/finance/`. Neither folder changed in the milestone (`git diff 1f2bead..518853e`). No game rules in `src/ui/`: #219 left « trop cher » per product off rather than copy an engine rule, and #221 kept the chart to the reports' days for the same reason.
- [x] Nothing in `src/world/` changes the game: lint's rule 9 (no game changers, no `advance`, `setState` or `startGame`), and a grep finds no store action called from the world. Engine, finance and content never import it.
- [x] No floats for money; no `Math.random()` or `Date.now()` in engine or finance.
- [x] New tunables are in `src/content/`: the world's art and layout in `assets.json` (#214, #215, #224, #225), `avatarFatigue.json`, `places.json`. The numbers the UI cards added are display choices, such as the 30-day sparkline, at most 3 messages and the tooltip's 300 ms.
- [x] Each card stayed in its folders or said why: 4B-01, 4B-02, 4B-12 in world and content; 4B-03 in world; 4B-04 to 4B-06, 4B-08 (plus `docs/architecture.md`, explained in #221) and 4B-09 in ui; 4B-07 in ui plus world, as the card allows, explained in #220; 4B-10 in ui and content; 4B-11 in ui, world and content.
- [x] Player-facing text is French, code and comments English (item 6).

## Screenshots
On [`screenshots/issue-210`](https://github.com/etiennecrevier-bit/Magnat/tree/screenshots/issue-210/issue-210):
- `desk-01` to `desk-35`: every screen at 1440 × 900. There is no `desk-27`: the desktop cash-chip tooltip was read by the driver (item 2), but its screenshot missed; `phone-17-cash-tip-with-hier.png` shows the tooltip;
- `phone-00` to `phone-19`: every screen at 390 × 844;
- `bug-01` to `bug-08`: one per miss;
- `00-RueLumiere-reference.png` and `00-VilleLumiere-reference.png`, to compare.
