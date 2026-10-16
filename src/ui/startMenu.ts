import type { GameState } from '../engine/types.ts'
import type { StoredSave } from './saves.ts'

/**
 * What « Continuer » does: plays the game the browser holds, if any.
 * `readStored` reads what it holds now, as another tab may have saved since
 * the menu showed it.
 */
export function continueStoredGame(
  readStored: () => StoredSave,
  onStart: (game: GameState) => void,
): void {
  const stored = readStored()
  if (stored.status === 'found') onStart(stored.game)
}
