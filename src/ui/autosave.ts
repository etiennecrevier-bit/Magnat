import { toCalendar } from '../engine/clock.ts'
import type { Day, GameState } from '../engine/types.ts'
import { browserHost, type LoopHost } from './gameLoop.ts'
import type { GameStore } from './store.ts'

/** The browser APIs the autosave needs, injectable so tests can fake them. */
export type AutosaveHost = Pick<LoopHost, 'isHidden' | 'onVisibilityChange'>

function monthOf(day: Day): string {
  const { year, month } = toCalendar(day)
  return `${year}-${month}`
}

/**
 * Hands the game in `store` to `write` now, again each time it reaches a new
 * game month, and whenever the page is hidden, so closing the tab or
 * switching away loses nothing. Days the loop plays in one go count once,
 * whatever months they cross. A game started in place of the one played,
 * such as one imported mid-game, is handed over at once, whatever its month,
 * with `replaces` set: the player chose it over the saved game (see
 * `SaveWriter`). A Défi is never handed over: the browser keeps one game,
 * and trying a Défi must not replace the long one. Returns a function that
 * stops it.
 */
export function startAutosave(
  store: GameStore,
  writeGame: (game: GameState, replaces: boolean) => void,
  host: AutosaveHost = browserHost,
): () => void {
  const write = (game: GameState, replaces = false) => {
    if (game.challenge === null) writeGame(game, replaces)
  }
  let savedMonth = monthOf(store.getState().game.day)
  write(store.getState().game)

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.game === previous.game) return
    const month = monthOf(state.game.day)
    const started = state.gamesStarted !== previous.gamesStarted
    if (month === savedMonth && !started) return
    savedMonth = month
    write(state.game, started)
  })
  const stopWatching = host.onVisibilityChange(() => {
    if (host.isHidden()) write(store.getState().game)
  })

  return () => {
    unsubscribe()
    stopWatching()
  }
}
