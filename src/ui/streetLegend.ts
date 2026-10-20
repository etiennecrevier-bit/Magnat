import type { GameState } from '../engine/types.ts'
import { ASSETS } from '../world/manifest.ts'
import type { SettingsStore, StreetLegend } from './settings.ts'
import type { GameStore } from './store.ts'

// The street's legend « Cliquez sur la rue » (#208) shows in the player's
// first game only, for its first days. The settings keep which game that
// is, by its seed, as the saves know a game by it, so it holds across
// reloads and is never shown in another game.

/**
 * Where the legend stands once `game` plays: unseen, the first game takes
 * it while still in its first `days` days; it is done once that game is
 * past them, or another game plays, or the first game the player plays is
 * already past them, as an older save loaded.
 */
export function nextStreetLegend(
  legend: StreetLegend,
  game: Pick<GameState, 'day' | 'seed'>,
  days: number,
): StreetLegend {
  if (legend === 'done') return legend
  if (game.day >= days) return 'done'
  if (legend === 'unseen') return { seed: game.seed }
  return legend.seed === game.seed ? legend : 'done'
}

/**
 * Keeps the legend's state in `settings` as the game in `store` plays (see
 * `nextStreetLegend`), at once and at each change of game. Returns the
 * function that stops.
 */
export function watchStreetLegend(
  store: Pick<GameStore, 'getState' | 'subscribe'>,
  settings: Pick<SettingsStore, 'getState'>,
  days: number = ASSETS.streetLegend.days,
): () => void {
  const follow = (game: GameState) => {
    const { streetLegend, setStreetLegend } = settings.getState()
    const next = nextStreetLegend(streetLegend, game, days)
    if (next !== streetLegend) setStreetLegend(next)
  }
  follow(store.getState().game)
  return store.subscribe((state, previous) => {
    if (state.game !== previous.game) follow(state.game)
  })
}
