import type { GameState } from '../engine/types.ts'
import { ASSETS } from '../world/manifest.ts'
import type { SettingsStore, StreetLegend } from './settings.ts'
import { isNewGame, type GameStore } from './store.ts'

// The street's legend « Cliquez sur la rue » (#208) shows in the player's
// first game only, for its first days. The settings keep which game that
// is, by its seed, as the saves know a game by it, so it holds across
// reloads. A seed alone does not tell games apart, as every game a
// `?seed=` address starts has the same, so a new game started once the
// first has taken the legend ends it too, whatever its seed.

/**
 * Where the legend stands once `game` plays, `isNew` when it was just made
 * rather than loaded (see `isNewGame`): unseen, the first game takes it
 * while still in its first `days` days; it is done once that game is past
 * them, or a new game starts, or a loaded game of another seed plays, or
 * the first game the player plays is already past them, as an older save
 * loaded.
 */
export function nextStreetLegend(
  legend: StreetLegend,
  game: Pick<GameState, 'day' | 'seed'>,
  days: number,
  isNew = false,
): StreetLegend {
  if (legend === 'done') return legend
  if (game.day >= days) return 'done'
  if (legend === 'unseen') return { seed: game.seed }
  return !isNew && legend.seed === game.seed ? legend : 'done'
}

/**
 * The new games the legend has followed, so a game is new to it once only,
 * as a watcher stopped and started again, the way React runs effects twice
 * in development, sees the same game again.
 */
const followedNewGames = new WeakSet<GameState>()

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
    const isNew = isNewGame(game) && !followedNewGames.has(game)
    if (isNew) followedNewGames.add(game)
    const next = nextStreetLegend(streetLegend, game, days, isNew)
    if (next !== streetLegend) setStreetLegend(next)
  }
  follow(store.getState().game)
  return store.subscribe((state, previous) => {
    if (state.game !== previous.game) follow(state.game)
  })
}
