import { toCalendar } from '../engine/clock.ts'
import { isProtected } from '../engine/tutorial.ts'
import type { Day, GameState } from '../engine/types.ts'
import { browserHost, type LoopHost } from './gameLoop.ts'
import type { GameStore, GameStoreState } from './store.ts'

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
 * and trying a Défi must not replace the long one. A game that has ended,
 * in bankruptcy, is handed over once, the moment it ends, whatever its
 * month, or when it is started in place of another, and never again, so
 * « Continuer » shows its end; one continued already ended is not handed
 * over at all. A tour of Réal's replayed over the saved game (`keepsSave`)
 * is not handed over while it is protected, so « Continuer » keeps the
 * game saved before it; the moment its protection ends, on day 8 or as it
 * is skipped, it is handed over at once, with `replaces` set. Returns a
 * function that stops it.
 */
export function startAutosave(
  store: GameStore,
  writeGame: (game: GameState, replaces: boolean) => void,
  host: AutosaveHost = browserHost,
): () => void {
  const write = (game: GameState, replaces = false) => {
    if (game.challenge === null) writeGame(game, replaces)
  }
  // A replayed tour keeps the saved game while it is protected.
  const holds = ({
    keepsSave,
    game,
  }: Pick<GameStoreState, 'keepsSave' | 'game'>) =>
    keepsSave && isProtected(game)
  const first = store.getState().game
  let savedMonth = monthOf(first.day)
  if (first.ended === null && !holds(store.getState())) write(first)

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.game === previous.game) return
    const started = state.gamesStarted !== previous.gamesStarted
    if (holds(state)) return
    if (state.keepsSave && !started && holds(previous)) {
      savedMonth = monthOf(state.game.day)
      write(state.game, true)
      return
    }
    if (state.game.ended !== null) {
      if (started || previous.game.ended === null) write(state.game, started)
      return
    }
    const month = monthOf(state.game.day)
    if (month === savedMonth && !started) return
    savedMonth = month
    write(state.game, started)
  })
  const stopWatching = host.onVisibilityChange(() => {
    const state = store.getState()
    if (host.isHidden() && state.game.ended === null && !holds(state)) {
      write(state.game)
    }
  })

  return () => {
    unsubscribe()
    stopWatching()
  }
}
