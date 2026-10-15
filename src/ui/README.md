React components and browser code: reads game state and the books, never writes journal entries or holds game rules; all player-facing text is in French (Quebec).

The « Gérer le camion » panel (`ManagePanel.tsx`) is the only place the player changes decisions: it reads what they type in `decisionInput.ts`, which turns down invalid text in French before it reaches the store's `decide()` and the engine's `applyDecision()`. Any panel pauses the game while it is open and resumes it at its previous speed when it closes, through the store's `openPanel(panel)` and `closePanel()`; the store's `panel` says which one is open, and a second one never opens over the first. Both panels are modal dialogs on the same cream card (`panel.css`).

## The owner

The owner is not the company, and the UI only reads what the engine keeps of them.
- **« Énergie »** (`EnergyGauge.tsx`) sits in the top bar beside the encaisse: a bar filled to the energy of this morning (`game.energy`) and a word, read through the engine's `fatigueOf`: « Reposé », « Fatigué » or « Épuisé », agreeing with the avatar (« Reposée » for a woman's). The bar is a meter for screen readers, and the word and an icon go with each colour.
- **« Vos finances »** (`FinancesPanel.tsx`) shows the owner's personal account: the « Solde », in red below zero, then the movements of one calendar month, newest first, with an « impayé » tag on a rent that went unpaid. The account stands as of the close of the last day played, so the panel shows that day's month (`personalFinances.ts`), not the month of the day in the top bar as the financial statements do: on the morning of the 1st, it still shows the month just ended, and names it. Before any day is played it says « Aucun mouvement ce mois-ci. ».
- **Messages** (`Messages.tsx`) show at the top of the screens, newest first, at most 3, each with « Fermer ». `messageTriggers.ts` compares the game before and after each update of the store: when days were played, each rent that went unpaid brings the landlord's message, and waking up exhausted, from a morning that was not, brings the owner's own, at most once a game week (Monday to Sunday). The lines are in `src/content/messages.fr.json`, picked at random, never the last one of the same kind again. A long stretch played in one update can miss a morning that dipped below the threshold and came back; the messages are flavour, so that is acceptable.

## Starting and saving a game

`src/App.tsx` opens on the start screen (`StartScreen.tsx`) over the world. The top bar, the screens, the game loop and the autosave only start once a game does, so the menu never advances time or overwrites the saved game.
- **Continuer** shows only when the game saved in this browser loads. A save that no longer loads, or a browser that blocks storage, gets a notice instead.
- **Nouvelle partie** asks for a difficulty (`src/content/difficulty.json`), a business name and an avatar (defaults in `src/content/profile.json`), then starts on a random seed from `crypto.getRandomValues`, or on the page's `?seed=`.
- **Importer une sauvegarde** loads an exported file through the engine's `deserialize()`, and shows a French message when the file is rejected. Only the last file picked counts, and only while the player is still on the menu: picking another file, continuing, opening the new game form or starting a game drops the file being read (`startMenu.ts`).

`autosave.ts` saves the game to `localStorage` (`saves.ts`, key `magnat.sauvegarde`) when it starts, on the first day of each game month and whenever the tab is hidden. Every storage access is caught: when a save fails, the game keeps going and tells the player to use « Exporter la sauvegarde », which downloads the game as a file.
