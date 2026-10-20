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
import { createGameStore, gameStore, type GameStoreState } from './store.ts'
import { monthKey, weekKey } from './journalRows.ts'
import WeekReports, { WeekReportsView } from './WeekReports.tsx'
import { recentWeeks } from './weeklyReport.ts'

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

/** Week `index` of a game, with a loss on the odd ones. */
function record(index: number): WeekRecord {
  return {
    firstDay: index * 7,
    sales: cents(100_000 + index * 1_000),
    netIncome: cents(index % 2 === 0 ? 20_000 : -3_456),
    cashAtEnd: cents(500_000 - index * 10_000),
    netWorth: cents(2_000_000 + index * 5_000),
  }
}

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

/** The rows' lines: each row's title, then its bénéfice's markup. */
function lines(html: string): string[][] {
  return [
    ...html.matchAll(
      /<span class="journal-row__line"><span class="journal-row__title">(.*?)<\/span>.*?<span class="journal-row__end">.*?<\/span> (<span class="amount[^"]*">.*?<\/span>)<\/span><\/span>/g,
    ),
  ].map(([, title, amount]) => [title!, amount!])
}

/** What the row `id` opens to, or null while it is closed. */
function body(html: string, id: string): string | null {
  const region = new RegExp(
    `<div id="${id}-region" class="journal-row__body" role="region" aria-labelledby="${id}-button"( hidden="")?>(.*?)</div></li>`,
  ).exec(html)
  if (region === null) throw new Error(`no row ${id}`)
  return region[1] === undefined ? region[2]! : null
}

describe('WeekReportsView', () => {
  it('says there is no report before the first week closes', () => {
    expect(renderToStaticMarkup(<WeekReportsView history={[]} />)).toBe(
      '<section class="week-reports"><p>Aucun bilan pour l&#x27;instant.</p></section>',
    )
  })

  it('lists the last 12 weeks, newest first, closed, each with its bénéfice, a loss in red', () => {
    const history = Array.from({ length: 15 }, (_, index) => record(index))
    const html = renderToStaticMarkup(<WeekReportsView history={history} />)
    const listed = lines(html)
    expect(listed).toHaveLength(12)
    expect(listed.map(([title]) => title)).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => `Semaine du ${formatShortGameDate((14 - index) * 7)}`,
      ),
    )
    expect(listed[0]![1]).toBe(
      `<span class="amount">${formatMoney(record(14).netIncome)}</span>`,
    )
    expect(listed[1]![1]).toBe(
      `<span class="amount amount--negative">${formatMoney(cents(-3_456))}</span>`,
    )
    expect(html).toContain(
      '<span class="journal-row__end"><span class="journal-row__muted">Bénéfice :</span> ',
    )
    expect(html).not.toContain('aria-expanded="true"')
  })

  it('opens the latest week to its full report, an older one kept in full to its report, any other to its figures', () => {
    const history = [0, 1, 2].map(record)
    const kept = playedTo(14).lastWeek!
    expect(kept.firstDay).toBe(7)
    const html = renderToStaticMarkup(
      <WeekReportsView
        history={history}
        latest={{ firstDay: 14, report: <p>Le dernier</p> }}
        reports={[kept]}
        openKeys={new Set([weekKey(0), weekKey(7), weekKey(14)])}
      />,
    )
    expect(body(html, 'week-reports-14')).toBe('<p>Le dernier</p>')
    const older = body(html, 'week-reports-7')!
    expect(older).toMatch(
      /^<div class="weekly-report"><p class="weekly-report__dates">Du 8 mai au 14 mai, an 1<\/p>/,
    )
    expect(older).not.toContain('weekly-report__percentile')
    expect(older).not.toContain('weekly-report__title')
    const figures = body(html, 'week-reports-0')!
    expect(figures).toBe(
      '<div class="weekly-report"><dl class="weekly-report__figures">' +
        `<div><dt>Ventes</dt><dd><span class="amount">${formatMoney(record(0).sales)}</span></dd></div>` +
        `<div><dt>Bénéfice</dt><dd><span class="amount">${formatMoney(record(0).netIncome)}</span></dd></div>` +
        `<div><dt>Encaisse</dt><dd><span class="amount">${formatMoney(record(0).cashAtEnd)}</span></dd></div>` +
        '</dl></div>',
    )
  })
})

/** The app store's game and reports on the 1st of June, after its « Bilan du mois ». */
function firstOfJune() {
  const store = createGameStore(playedTo(14), NO_EVENTS, {
    everyWeek: () => false,
    cadence: () => 'month',
  })
  // The first weeks' reports open in full: close each to go on.
  while (store.getState().game.day < 31) {
    store.getState().advance(31 - store.getState().game.day)
    if (store.getState().panel === 'report') store.getState().closePanel()
  }
  return store.getState()
}

describe('WeekReports', () => {
  it("lists the app store's weeks, closed, and no « Bilan du mois » before one came", () => {
    gameStore.setState({ game: playedTo(14) })
    const html = renderToStaticMarkup(<WeekReports />)
    expect(lines(html).map(([title]) => title)).toEqual([
      `Semaine du ${formatShortGameDate(7)}`,
      `Semaine du ${formatShortGameDate(0)}`,
    ])
    expect(body(html, 'week-reports-7')).toBeNull()
    expect(html).not.toContain('Bilan du mois')
  })

  it('lists the last « Bilan du mois » first, once one came, closed', () => {
    const { game, monthReport, weekReports } = firstOfJune()
    expect(game.day).toBe(31)
    gameStore.setState({ game, monthReport, weekReports, slideIn: null })
    const html = renderToStaticMarkup(<WeekReports />)
    const listed = lines(html)
    expect(listed[0]).toEqual([
      'Bilan du mois',
      expect.stringContaining(formatMoney(monthReport!.netIncome)),
    ])
    expect(html).toContain(
      '<span class="journal-row__title">Bilan du mois</span> <span class="journal-row__muted">Mai, an 1</span>',
    )
    expect(listed.slice(1).map(([title]) => title)).toEqual(
      recentWeeks(game.weekHistory).map(
        ({ firstDay }) => `Semaine du ${formatShortGameDate(firstDay)}`,
      ),
    )
    expect(body(html, 'week-reports-month')).toBeNull()
  })

  it('opens the « Bilan du mois » to its full report', () => {
    const { monthReport, game } = firstOfJune()
    const html = renderToStaticMarkup(
      <WeekReportsView
        history={game.weekHistory}
        monthReport={monthReport}
        openKeys={new Set([monthKey(monthReport!)])}
      />,
    )
    expect(body(html, 'week-reports-month')).toMatch(
      /^<div class="weekly-report monthly-report"><p class="monthly-report__month">Mai, an 1<\/p>/,
    )
  })
})
