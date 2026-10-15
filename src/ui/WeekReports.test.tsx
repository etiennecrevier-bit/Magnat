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
import type { GameState, WeekRecord } from '../engine/types.ts'
import { formatShortGameDate } from './formatGameDate.ts'
import { formatMoney } from './formatMoney.ts'
import { gameStore, type GameStoreState } from './store.ts'
import WeekReports, { WeekReportsView } from './WeekReports.tsx'

// A static render reads a Zustand store's initial state, so the connected
// screen reads the app store's current state through this stand-in.
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

/** A seed-1 game played with no event card to the morning of day 14. */
function secondMonday(): GameState {
  let game = createInitialState(1)
  while (game.day < 14) {
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

/** Week `index` of a game, with a loss on the odd ones. */
function record(index: number): WeekRecord {
  return {
    firstDay: index * 7,
    sales: cents(100_000 + index * 1_000),
    netIncome: cents(index % 2 === 0 ? 20_000 : -3_456),
    cashAtEnd: cents(500_000 - index * 10_000),
  }
}

/** The rows of the table: the week's date, then its amounts' markup. */
function rows(html: string): string[][] {
  const body = /<tbody>(.*)<\/tbody>/.exec(html)?.[1] ?? ''
  return [...body.matchAll(/<tr>(.*?)<\/tr>/g)].map(([, row]) =>
    [...row!.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map(([, cell]) => cell!),
  )
}

describe('WeekReportsView', () => {
  it('says there is no report before the first week closes', () => {
    expect(renderToStaticMarkup(<WeekReportsView history={[]} />)).toBe(
      '<section class="week-reports"><h1>Bilans</h1><p>Aucun bilan pour l&#x27;instant.</p></section>',
    )
  })

  it('lists the last 12 weeks, newest first, a loss in red', () => {
    const history = Array.from({ length: 15 }, (_, index) => record(index))
    const html = renderToStaticMarkup(<WeekReportsView history={history} />)
    expect(html).toContain(
      '<thead><tr><th scope="col">Semaine du</th><th scope="col" class="number">Ventes</th>' +
        '<th scope="col" class="number">Bénéfice</th><th scope="col" class="number">Encaisse</th></tr></thead>',
    )
    const table = rows(html)
    expect(table).toHaveLength(12)
    expect(table.map(([date]) => date)).toEqual(
      Array.from({ length: 12 }, (_, index) =>
        formatShortGameDate((14 - index) * 7),
      ),
    )
    const newest = record(14)
    expect(table[0]).toEqual([
      formatShortGameDate(newest.firstDay),
      `<span class="amount">${formatMoney(newest.sales)}</span>`,
      `<span class="amount">${formatMoney(newest.netIncome)}</span>`,
      `<span class="amount">${formatMoney(newest.cashAtEnd)}</span>`,
    ])
    expect(table[1]![2]).toBe(
      `<span class="amount amount--negative">${formatMoney(cents(-3_456))}</span>`,
    )
  })
})

describe('WeekReports', () => {
  it("shows the app store's weeks, then the latest week's full report", () => {
    const game = secondMonday()
    gameStore.setState({ game })
    const html = renderToStaticMarkup(<WeekReports />)
    expect(rows(html).map(([date]) => date)).toEqual([
      formatShortGameDate(7),
      formatShortGameDate(0),
    ])
    expect(html).toContain(
      '<section class="week-reports__latest" aria-labelledby="week-reports-latest"><h2 id="week-reports-latest">Bilan de la semaine</h2><div class="weekly-report"><p class="weekly-report__dates">Du 8 mai au 14 mai, an 1</p>',
    )
  })
})
