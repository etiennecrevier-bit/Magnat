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
import { cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import { formatMoney } from './formatMoney.ts'
import { formatWeekOf, monthFactLines } from './monthlyReport.ts'
import { createGameStore, gameStore, type GameStoreState } from './store.ts'
import { factLines } from './weeklyReport.ts'
import WeekSlideIn, { WeekSlideInView } from './WeekSlideIn.tsx'

// A static render reads a Zustand store's initial state, so the connected
// card reads the app store's current state through this stand-in.
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

/** A seed-1 game played with no event card to the morning of day 7. */
function firstMonday(): GameState {
  let game = createInitialState(1)
  while (game.day < 7) {
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

const GAME = firstMonday()
const WEEK = GAME.lastWeek!

const EMPTY = '<div class="week-slide-in" role="status"></div>'

describe('WeekSlideInView', () => {
  it('shows ventes, bénéfice, encaisse and the first fact, with « Voir le bilan »', () => {
    const report = {
      ...WEEK,
      sales: cents(345_600),
      netIncome: cents(-12_345),
      cashAtStart: cents(1_000_000),
      cashAtEnd: cents(950_000),
    }
    const html = renderToStaticMarkup(
      <WeekSlideInView
        report={report}
        topFact="Le loyer du 2 mai n'a pas été payé."
        onOpen={() => {}}
      />,
    )
    expect(html).toMatch(
      /^<section class="week-slide-in__card" aria-label="Bilan de la semaine"><p class="week-slide-in__title">Bilan de la semaine<\/p><dl class="week-slide-in__figures">/,
    )
    expect(html).toContain(
      `<dt>Ventes</dt><dd><span class="amount">${formatMoney(cents(345_600))}</span></dd>`,
    )
    expect(html).toContain(
      `<dt>Bénéfice</dt><dd><span class="amount amount--negative">${formatMoney(cents(-12_345))}</span></dd>`,
    )
    expect(html).toContain(`${formatMoney(cents(950_000))}</span></span></dd>`)
    expect(html).toContain(
      '<p class="week-slide-in__fact">Le loyer du 2 mai n&#x27;a pas été payé.</p>' +
        '<button type="button" class="button button--primary" aria-haspopup="dialog">Voir le bilan</button></section>',
    )
  })

  it('marks « Voir le bilan » as opening a dialog, so Space opens the report rather than pausing', () => {
    const html = renderToStaticMarkup(
      <WeekSlideInView report={WEEK} topFact={null} onOpen={() => {}} />,
    )
    expect(html).toContain(
      '<button type="button" class="button button--primary" aria-haspopup="dialog">Voir le bilan</button>',
    )
  })

  it('titles a month « Bilan du mois », with the encaisse at its end alone when its start is not known', () => {
    const html = renderToStaticMarkup(
      <WeekSlideInView
        report={{
          sales: cents(1_234_500),
          netIncome: cents(98_700),
          cashAtStart: null,
          cashAtEnd: cents(950_000),
        }}
        title="Bilan du mois"
        topFact={null}
        onOpen={() => {}}
      />,
    )
    expect(html).toMatch(
      /^<section class="week-slide-in__card" aria-label="Bilan du mois"><p class="week-slide-in__title">Bilan du mois<\/p><dl class="week-slide-in__figures">/,
    )
    expect(html).toContain(
      `<dt>Encaisse</dt><dd><span class="amount">${formatMoney(cents(950_000))}</span></dd>`,
    )
  })

  it('leaves the fact out of a week with none', () => {
    const html = renderToStaticMarkup(
      <WeekSlideInView report={WEEK} topFact={null} onOpen={() => {}} />,
    )
    expect(html).not.toContain('week-slide-in__fact')
    expect(html).toContain('Voir le bilan')
  })
})

describe('WeekSlideIn', () => {
  it("shows the app store's week while it slides in, with its first fact", () => {
    gameStore.setState({ game: GAME, slideIn: 0 })
    const html = renderToStaticMarkup(<WeekSlideIn />)
    const [fact] = factLines(WEEK)
    expect(fact).toBeDefined()
    expect(html).toMatch(
      /^<div class="week-slide-in" role="status"><section class="week-slide-in__card"/,
    )
    expect(html).toContain(
      `<p class="week-slide-in__fact">${fact!.replaceAll("'", '&#x27;')}</p>`,
    )
  })

  it("shows the app store's month while it slides in, its first fact after its week", () => {
    const store = createGameStore(GAME, NO_EVENTS, {
      everyWeek: () => false,
      cadence: () => 'month',
    })
    // The first weeks' reports open in full: close each to go on.
    while (store.getState().game.day < 31) {
      store.getState().advance(31 - store.getState().game.day)
      if (store.getState().panel === 'report') store.getState().closePanel()
    }
    const { game, monthReport, slideIn, reportShown } = store.getState()
    expect(game.day).toBe(31)
    gameStore.setState({ game, monthReport, slideIn, reportShown })
    const html = renderToStaticMarkup(<WeekSlideIn />)
    const [fact] = monthFactLines(monthReport!)
    expect(fact).toBeDefined()
    expect(html).toMatch(
      /^<div class="week-slide-in" role="status"><section class="week-slide-in__card" aria-label="Bilan du mois"><p class="week-slide-in__title">Bilan du mois<\/p>/,
    )
    expect(html).toContain(
      `<p class="week-slide-in__fact">${formatWeekOf(fact!.week)} — ${fact!.text.replaceAll("'", '&#x27;')}</p>`,
    )
  })

  it('keeps its region empty while no card slides in, or a panel is open', () => {
    gameStore.setState({ game: GAME })
    expect(renderToStaticMarkup(<WeekSlideIn />)).toBe(EMPTY)
    gameStore.setState({ slideIn: 0, panel: 'staff' })
    expect(renderToStaticMarkup(<WeekSlideIn />)).toBe(EMPTY)
  })
})
