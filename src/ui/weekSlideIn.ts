import type { WeekReport } from '../engine/types.ts'
import type { GameStore, GameStoreState } from './store.ts'

// After the first weeks of a game, the « Bilan de la semaine » slides in at
// the bottom right on a Monday morning instead of opening in full, and goes
// away on its own a few seconds later without pausing the game. It hides
// while a panel is open, so it never sits behind one, and its seconds only
// count while it shows.

/** The week the card sliding in shows; null while it does not show. */
export function slideInWeek(state: GameStoreState): WeekReport | null {
  const { slideIn, panel, game } = state
  return slideIn !== null &&
    panel === null &&
    game.lastWeek?.firstDay === slideIn
    ? game.lastWeek
    : null
}

/**
 * Takes the card sliding in away `ms` after it shows, counting again from
 * the start each time it shows again after a panel, or shows another week.
 * Returns what stops it.
 */
export function hideSlideInAfter(store: GameStore, ms: number): () => void {
  let shown: WeekReport | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const follow = (state: GameStoreState) => {
    const week = slideInWeek(state)
    if (week === shown) return
    shown = week
    if (timer !== null) clearTimeout(timer)
    timer =
      week === null
        ? null
        : setTimeout(() => store.getState().dismissSlideIn(), ms)
  }

  follow(store.getState())
  const unsubscribe = store.subscribe(follow)
  return () => {
    unsubscribe()
    if (timer !== null) clearTimeout(timer)
  }
}
