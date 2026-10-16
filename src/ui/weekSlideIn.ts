import type { WeekReport } from '../engine/types.ts'
import type { MonthReport } from './monthlyReport.ts'
import type { GameStore, GameStoreState } from './store.ts'

// After the first weeks of a game, the « Bilan » of the week, or of the
// month, slides in at the bottom right on the morning it comes instead of
// opening in full, and goes away on its own a few seconds later without
// pausing the game. It hides while a panel is open, so it never sits
// behind one, and its seconds only count while it shows.

/**
 * The report the card sliding in shows, the week's or the month's (see
 * `reportShown`); null while it does not show.
 */
export function slideInReport(
  state: GameStoreState,
): WeekReport | MonthReport | null {
  const { slideIn, panel, game, reportShown, monthReport } = state
  if (slideIn === null || panel !== null) return null
  const report = reportShown === 'month' ? monthReport : game.lastWeek
  return report?.firstDay === slideIn ? report : null
}

/**
 * Takes the card sliding in away `ms` after it shows, counting again from
 * the start each time it shows again after a panel, or shows another
 * report. Returns what stops it.
 */
export function hideSlideInAfter(store: GameStore, ms: number): () => void {
  let shown: WeekReport | MonthReport | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const follow = (state: GameStoreState) => {
    const report = slideInReport(state)
    if (report === shown) return
    shown = report
    if (timer !== null) clearTimeout(timer)
    timer =
      report === null
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
