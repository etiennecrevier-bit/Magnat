React components and browser code: reads game state and the books, never writes journal entries or holds game rules; all player-facing text is in French (Quebec).

The « Gérer le camion » panel (`ManagePanel.tsx`) is the only place the player changes decisions: it reads what they type in `decisionInput.ts`, which turns down invalid text in French before it reaches the store's `decide()` and the engine's `applyDecision()`. Any panel pauses the game while it is open and resumes it at its previous speed when it closes, through the store's `openPanel()` and `closePanel()`.

## Starting and saving a game

`src/App.tsx` opens on the start screen (`StartScreen.tsx`) over the world. The top bar, the screens, the game loop and the autosave only start once a game does, so the menu never advances time or overwrites the saved game.
- **Continuer** shows only when the game saved in this browser loads. A save that no longer loads, or a browser that blocks storage, gets a notice instead.
- **Nouvelle partie** asks for a difficulty (`src/content/difficulty.json`), a business name and an avatar (defaults in `src/content/profile.json`), then starts on a random seed from `crypto.getRandomValues`, or on the page's `?seed=`.
- **Importer une sauvegarde** loads an exported file through the engine's `deserialize()`, and shows a French message when the file is rejected. Only the last file picked counts, and only while the player is still on the menu: picking another file, continuing, opening the new game form or starting a game drops the file being read (`startMenu.ts`).

`autosave.ts` saves the game to `localStorage` (`saves.ts`, key `magnat.sauvegarde`) when it starts, on the first day of each game month and whenever the tab is hidden. Every storage access is caught: when a save fails, the game keeps going and tells the player to use « Exporter la sauvegarde », which downloads the game as a file.
