import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, startChallenge, tick } from '../engine/clock.ts'
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
import {
  monthAdvice,
  monthFactLines,
  type MonthReport,
} from './monthlyReport.ts'
import { LastMonthReport, MonthlyReportView } from './MonthlyReport.tsx'
import { BANKER, portraitUrl } from './portraits.ts'
import { createGameStore, gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// report reads the app store's current state through this stand-in.
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

// Every space in an amount, and before a colon, is a no-break space
// (U+00A0).
const S = ' '

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

/**
 * The store of a seed-1 game with the monthly report, on the morning of
 * July 1st, year 1, with June's report.
 */
function onJulyFirst() {
  const store = createGameStore(playedTo(29), NO_EVENTS, {
    everyWeek: () => false,
    cadence: () => 'month',
  })
  store.getState().advance(10)
  store.getState().advance(40)
  return store.getState()
}

const JULY_FIRST = onJulyFirst()
const JUNE = JULY_FIRST.monthReport!

/** `text` as React writes it in markup. */
function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;')
}

/** An amount as the report writes it, in red below zero. */
function amount(value: number): string {
  const kind = value < 0 ? 'amount amount--negative' : 'amount'
  return `<span class="${kind}">${formatMoney(cents(value))}</span>`
}

function render(report: MonthReport = JUNE) {
  return renderToStaticMarkup(<MonthlyReportView report={report} />)
}

describe('MonthlyReportView', () => {
  it('names the month, then the weeks its figures cover, then their ventes, bénéfice and encaisse', () => {
    expect(JULY_FIRST.game.day).toBe(61)
    const html = render({
      ...JUNE,
      sales: cents(1_234_567),
      netIncome: cents(-4_500),
      cashAtStart: cents(1_000_000),
      cashAtEnd: cents(987_650),
    })
    expect(html).toMatch(
      /^<div class="weekly-report monthly-report"><p class="monthly-report__month">Juin, an 1<\/p><p class="weekly-report__dates">4 semaines, du 29 mai au 25 juin, an 1<\/p>/,
    )
    expect(html).toContain(
      `<dl class="weekly-report__figures"><div><dt>Ventes</dt><dd>${amount(1_234_567)}</dd></div>` +
        `<div><dt>Bénéfice</dt><dd>${amount(-4_500)}</dd></div>` +
        `<div><dt>Encaisse</dt><dd><span class="weekly-report__from">${amount(1_000_000)}</span> ` +
        `<span class="weekly-report__to"><span aria-hidden="true">→</span><span class="visually-hidden"> à </span> ${amount(987_650)}</span></dd></div></dl>`,
    )
  })

  it('shows the encaisse at the end alone when the start is not known', () => {
    const html = render({ ...JUNE, cashAtStart: null, cashAtEnd: cents(5_000) })
    expect(html).toContain(
      `<dt>Encaisse</dt><dd>${amount(5_000)}</dd></div></dl>`,
    )
    expect(html).not.toContain('weekly-report__from')
  })

  it('shows the lowest encaisse when it is known, and leaves it out otherwise', () => {
    expect(JUNE.lowestCash).not.toBeNull()
    expect(render({ ...JUNE, lowestCash: cents(-2_500) })).toContain(
      `</dl><p class="monthly-report__lowest">Encaisse la plus basse${S}: ${amount(-2_500)}</p>`,
    )
    expect(render({ ...JUNE, lowestCash: null })).not.toContain(
      'Encaisse la plus basse',
    )
  })

  it('charts every day of the calendar month, labelling its Mondays', () => {
    const html = render()
    expect(html).toContain(
      '<p class="monthly-report__days">Jour par jour, du 1er juin au 30 juin, an 1</p><figure class="week-chart">',
    )
    expect(html.match(/<g class="week-chart__day"/g)).toHaveLength(30)
    expect(html).toContain('<g class="week-chart__day" data-day="31">')
    expect(html).toContain('<g class="week-chart__day" data-day="60">')
    expect(html).not.toContain('data-day="30"')
    expect(html).not.toContain('data-day="61"')
    expect(
      [...html.matchAll(/<text class="week-chart__label"[^>]*>([^<]*)</g)].map(
        ([, label]) => label,
      ),
    ).toEqual(['5', '12', '19', '26'])
    expect(html).not.toContain('week-chart__notes')
  })

  it('draws thinner bars that keep inside their day', () => {
    const html = render()
    const widths = [
      ...html.matchAll(
        /<path class="week-chart__bar--sales" d="M([\d.]+),\d+V[\d.]+A[\d.]+,[\d.]+ 0 0 1 [\d.]+,[\d.]+H[\d.]+A[\d.]+,[\d.]+ 0 0 1 ([\d.]+),/g,
      ),
    ].map(([, left, right]) => Number(right) - Number(left))
    expect(widths.length).toBeGreaterThan(20)
    // 488 units for 30 days: bands of about 16, bars of about 5.
    for (const width of widths) {
      expect(width).toBeGreaterThan(4)
      expect(width).toBeLessThan(6)
    }
  })

  it('lists the facts its weeks told, each after its week', () => {
    const lines = monthFactLines(JUNE)
    expect(lines.length).toBeGreaterThan(0)
    expect(render()).toContain(
      `<ul class="weekly-report__facts">${lines
        .map(
          ({ week, text }) =>
            `<li><span class="monthly-report__fact-week">${
              {
                28: 'Semaine du 29 mai',
                35: 'Semaine du 5 juin',
                42: 'Semaine du 12 juin',
                49: 'Semaine du 19 juin',
              }[week]
            }</span> — ${escaped(text)}</li>`,
        )
        .join('')}</ul>`,
    )
  })

  it('gives « Le conseil de Mme Prudhomme » on the first fact, saying which week it is on, and ends there', () => {
    const advice = monthAdvice(JUNE)
    expect(advice.week).toBe(monthFactLines(JUNE)[0]!.week)
    const html = render()
    expect(html).toMatch(
      /<\/ul><section class="prudhomme-advice" aria-label="Le conseil de Mme Prudhomme">.*<\/section><\/div>$/,
    )
    expect(html).toContain(
      `<img class="prudhomme-advice__portrait" src="${portraitUrl(BANKER)}"`,
    )
    expect(html).toContain(
      `<p class="prudhomme-advice__about">Sur la semaine du 19 juin</p>` +
        `<p class="prudhomme-advice__text">«${S}${escaped(advice.text)}${S}»</p>`,
    )
    expect(html).not.toContain('weekly-report__headline')
    expect(html).not.toContain('weekly-report__percentile')
  })

  it('gives a quiet line to a month with no fact, on its last week', () => {
    const quiet = {
      ...JUNE,
      reports: JUNE.reports.map((week) => ({
        ...week,
        spoiledCost: cents(0),
        lostToLine: 0,
        previousBest: null,
      })),
    }
    expect(monthFactLines(quiet)).toEqual([])
    const html = render(quiet)
    expect(html).not.toContain('weekly-report__facts')
    expect(html).toContain(
      `<p class="prudhomme-advice__about">Sur la semaine du 19 juin</p>` +
        `<p class="prudhomme-advice__text">«${S}${escaped(monthAdvice(quiet).text)}${S}»</p>`,
    )
    const none = render({ ...JUNE, reports: [] })
    expect(none).not.toContain('prudhomme-advice__about')
    expect(none).toContain(
      `<p class="prudhomme-advice__text">«${S}${escaped(monthAdvice({ ...JUNE, reports: [] }).text)}${S}»</p>`,
    )
  })

  it('shows the Défi under way after the figures', () => {
    const { challenge } = startChallenge('travauxSaintDenis', 7)
    const html = renderToStaticMarkup(
      <MonthlyReportView report={JUNE} challenge={challenge} />,
    )
    const defi = html.indexOf(
      `<section class="weekly-report__defi" aria-label="Défi en cours"><p class="weekly-report__defi-title">Défi en cours${S}: Les travaux de la rue Saint-Denis</p>`,
    )
    expect(defi).toBeGreaterThan(html.indexOf('monthly-report__lowest'))
    expect(defi).toBeLessThan(html.indexOf('monthly-report__days'))
    expect(render()).not.toContain('Défi')
  })
})

describe('LastMonthReport', () => {
  it("shows the app store's last month, and nothing before one came", () => {
    expect(renderToStaticMarkup(<LastMonthReport />)).toBe('')
    gameStore.setState({ game: JULY_FIRST.game, monthReport: JUNE })
    expect(renderToStaticMarkup(<LastMonthReport />)).toBe(render())
  })
})
