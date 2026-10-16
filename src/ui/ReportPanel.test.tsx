import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import type { GameState } from '../engine/types.ts'
import ReportPanel from './ReportPanel.tsx'
import { createGameStore, gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// panel reads the app store's current state through this stand-in.
vi.mock('./store.ts', async (importOriginal) => {
  const store = await importOriginal<typeof import('./store.ts')>()
  return {
    ...store,
    useGame: <T,>(selector: (state: GameStoreState) => T): T =>
      selector(store.gameStore.getState()),
  }
})

afterEach(() => {
  gameStore.setState(gameStore.getInitialState(), true)
})

/** A seed-1 game played with no event card to the morning of `day`. */
function playedTo(day: number): GameState {
  let game = createInitialState(1)
  while (game.day < day) {
    game = tick(
      game,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
    )
  }
  return game
}

/** The app store's state on June 1st, with May's report come in full. */
function juneFirst(): Partial<GameStoreState> {
  const store = createGameStore(playedTo(29), NO_EVENTS, {
    everyWeek: () => true,
    cadence: () => 'month',
  })
  store.getState().advance(10)
  const { game, panel, monthReport, reportShown } = store.getState()
  return { game, panel, monthReport, reportShown }
}

describe('ReportPanel', () => {
  it("shows the app store's last week in a dialog, with Fermer first", () => {
    gameStore.setState({ game: playedTo(7), panel: 'report' })
    const html = renderToStaticMarkup(<ReportPanel />)
    expect(html).toMatch(
      /^<dialog class="panel weekly-report-panel" aria-labelledby="weekly-report-title"><div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer<\/button><h2 id="weekly-report-title">Bilan de la semaine<\/h2><\/div><div class="weekly-report">/,
    )
    expect(html).toContain('Du 1er mai au 7 mai, an 1')
  })

  it("shows the app store's last month, titled « Bilan du mois », when it came last", () => {
    const state = juneFirst()
    expect(state).toMatchObject({ panel: 'report', reportShown: 'month' })
    gameStore.setState(state)
    const html = renderToStaticMarkup(<ReportPanel />)
    expect(html).toMatch(
      /^<dialog class="panel weekly-report-panel" aria-labelledby="weekly-report-title"><div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer<\/button><h2 id="weekly-report-title">Bilan du mois<\/h2><\/div><div class="weekly-report monthly-report">.*<\/div><\/div><\/dialog>$/,
    )
    expect(html).toContain('<p class="monthly-report__month">Mai, an 1</p>')
  })

  it('shows the last week once a week came after the month', () => {
    gameStore.setState({ ...juneFirst(), reportShown: 'week' })
    const html = renderToStaticMarkup(<ReportPanel />)
    expect(html).toContain(
      '<h2 id="weekly-report-title">Bilan de la semaine</h2></div><div class="weekly-report">',
    )
    expect(html).toContain('Du 22 mai au 28 mai, an 1')
  })
})
