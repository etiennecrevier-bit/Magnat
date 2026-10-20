import type { GameState, Profile } from '../engine/types.ts'
import { formatGameDate, formatShortGameDate } from './formatGameDate.ts'
import type { StoredSave } from './saves.ts'
import type { SettingsState } from './settings.ts'
import { newGame, newTutorialGame } from './store.ts'

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

/**
 * What « Commencer » of the new game form leads to for `profile`: Réal's
 * offer on the player's first game, while `settings` say it was never
 * offered (#238), else the new game on the seed `search` names.
 */
export function startFromForm(
  profile: Profile,
  settings: Pick<SettingsState, 'tutorialOffered'>,
  search: string,
): { readonly offer: Profile } | { readonly game: GameState } {
  return settings.tutorialOffered
    ? { game: newGame(search, profile) }
    : { offer: profile }
}

/**
 * The game Réal's offer starts for `profile`, once answered: the tour with
 * « Faire la visite », whose day 8 plays at the difficulty picked, else a
 * new game on the seed `search` names. Either way, `settings` keep that
 * the tour was offered, so later games start without the offer.
 */
export function answerTourOffer(
  accept: boolean,
  profile: Profile,
  settings: Pick<SettingsState, 'setTutorialOffered'>,
  search: string,
): GameState {
  settings.setTutorialOffered(true)
  return accept ? newTutorialGame(profile) : newGame(search, profile)
}
