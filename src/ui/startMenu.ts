import type { GameState } from '../engine/types.ts'
import { formatGameDate, formatShortGameDate } from './formatGameDate.ts'
import type { StoredSave } from './saves.ts'

/**
 * What « Continuer » plays: the business and the morning it is on, « Chez
 * Mimi, jeudi 1er juin, an 1 », or the day it went bankrupt, « Chez Mimi,
 * faillite le 30 novembre, an 1 ».
 */
export function savedLine({ profile, day, ended }: GameState): string {
  const when =
    ended === null
      ? formatGameDate(day).toLowerCase()
      : `faillite le ${formatShortGameDate(ended.day)}`
  return `${profile.businessName}, ${when}`
}

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
