React components and browser code: reads game state and the books, never writes journal entries or holds game rules; all player-facing text is in French (Quebec).

The « Gérer le camion » panel (`ManagePanel.tsx`) is the only place the player changes decisions: it reads what they type in `decisionInput.ts`, which turns down invalid text in French before it reaches the store's `decide()` and the engine's `applyDecision()`. Any panel pauses the game while it is open and resumes it at its previous speed when it closes, through the store's `openPanel()` and `closePanel()`.
