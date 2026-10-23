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
import { titleOf } from '../engine/dream.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { cents } from '../engine/money.ts'
import { percentileOf } from '../engine/percentiles.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState, WeekReport } from '../engine/types.ts'
import { incomeStatement } from '../finance/statements.ts'
import { formatBriefMoney, formatMoney } from './formatMoney.ts'
import { gameStore, type GameStoreState } from './store.ts'
import { LastWeekReport, WeeklyReportView } from './WeeklyReport.tsx'
import { BANKER, portraitUrl } from './portraits.ts'
import { factLines, reportAdvice, reportHeadline } from './weeklyReport.ts'

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

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

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

function render(report: WeekReport = WEEK) {
  return renderToStaticMarkup(<WeeklyReportView report={report} />)
}

/** The markup of one day of the chart. */
function chartDay(html: string, day: number): string {
  return (
    new RegExp(`<g class="week-chart__day" data-day="${day}">.*?</g>`).exec(
      html,
    )?.[0] ?? ''
  )
}

describe('WeeklyReportView', () => {
  it("shows the week's dates, then its ventes, bénéfice and encaisse from start to end", () => {
    const html = render({
      ...WEEK,
      sales: cents(345_678),
      netIncome: cents(45_600),
      cashAtStart: cents(1_000_000),
      cashAtEnd: cents(987_650),
    })
    expect(html).toMatch(
      /^<div class="weekly-report"><p class="weekly-report__dates">Du 1er mai au 7 mai, an 1<\/p>/,
    )
    expect(html).toContain(
      `<dl class="weekly-report__figures"><div><dt>Ventes</dt><dd>${amount(345_678)}</dd></div>` +
        `<div><dt>Bénéfice</dt><dd>${amount(45_600)}</dd></div>` +
        `<div><dt>Encaisse</dt><dd><span class="weekly-report__from">${amount(1_000_000)}</span> ` +
        `<span class="weekly-report__to"><span aria-hidden="true">→</span><span class="visually-hidden"> à </span> ${amount(987_650)}</span></dd></div></dl>`,
    )
    expect(amount(345_678)).toContain(`3${S}456,78${S}$`)
  })

  it('shows a loss and a negative encaisse in red, with a minus sign', () => {
    const html = render({
      ...WEEK,
      netIncome: cents(-12_345),
      cashAtEnd: cents(-500),
    })
    expect(html).toContain(
      `<dt>Bénéfice</dt><dd><span class="amount amount--negative">-123,45${S}$</span></dd>`,
    )
    expect(html).toContain(
      `<span class="amount amount--negative">-5,00${S}$</span></span></dd>`,
    )
    expect(html).not.toContain('(')
  })

  it("lists the week's facts, the first first", () => {
    const report = { ...WEEK, unpaidRents: [2] }
    const facts = factLines(report)
    expect(facts.length).toBeGreaterThan(1)
    expect(render(report)).toContain(
      `<ul class="weekly-report__facts">${facts
        .map((fact) => `<li>${escaped(fact)}</li>`)
        .join('')}</ul>`,
    )
    expect(render({ ...WEEK, spoiledCost: cents(0) })).not.toContain(
      'weekly-report__facts',
    )
  })

  it("gives « Le conseil de Mme Prudhomme » on the week's first fact, under the facts", () => {
    const report = { ...WEEK, unpaidRents: [2] }
    const html = render(report)
    expect(html).toMatch(
      /<\/ul><section class="prudhomme-advice" aria-label="Le conseil de Mme Prudhomme">.*?<\/section><p class="weekly-report__headline">/,
    )
    expect(html).toContain(
      `<p class="prudhomme-advice__text">«${S}${escaped(reportAdvice(report))}${S}»</p>`,
    )
    expect(html).toContain(
      `<img class="prudhomme-advice__portrait" src="${portraitUrl(BANKER)}"`,
    )
  })

  it('gives quiet advice to a week with no fact', () => {
    const quiet = { ...WEEK, spoiledCost: cents(0) }
    const html = render(quiet)
    expect(html).not.toContain('weekly-report__facts')
    expect(html).toContain(
      `<p class="prudhomme-advice__text">«${S}${escaped(reportAdvice(quiet))}${S}»</p>`,
    )
  })

  it("prints La Presse-Citron's headline on the week", () => {
    expect(render()).toContain(
      `<p class="weekly-report__headline"><span class="weekly-report__paper">La Presse-Citron</span> ${escaped(reportHeadline(WEEK))}</p>`,
    )
  })

  it('shows the Défi under way after the figures: its days and where it stands', () => {
    const { challenge } = startChallenge('travauxSaintDenis', 7)
    const html = renderToStaticMarkup(
      <WeeklyReportView
        report={WEEK}
        challenge={{
          ...challenge!,
          progress: {
            ...challenge!.progress,
            daysPlayed: 7,
            lowestCash: cents(187_000),
          },
        }}
      />,
    )
    expect(html).toContain(
      `</dl><section class="weekly-report__defi" aria-label="Défi en cours"><p class="weekly-report__defi-title">Défi en cours${S}: Les travaux de la rue Saint-Denis</p><p class="weekly-report__defi-days">7 jours joués sur 21</p><ul class="defi-progress"><li>Encaisse la plus basse${S}: 1${S}870${S}$</li></ul></section><figure`,
    )
  })

  it('shows no Défi outside one, nor once it is over', () => {
    expect(render()).not.toContain('Défi')
    const { challenge } = startChallenge('travauxSaintDenis', 7)
    const html = renderToStaticMarkup(
      <WeeklyReportView
        report={WEEK}
        challenge={{ ...challenge!, status: 'reussi', medal: 'or' }}
      />,
    )
    expect(html).not.toContain('Défi')
  })

  it('ends on the headline, the switch that opens it every week being in « Réglages »', () => {
    const html = render()
    expect(html).toMatch(/<p class="weekly-report__headline">.*<\/p><\/div>$/)
    expect(html).not.toContain('role="switch"')
  })
})

describe('the week chart', () => {
  it('draws the 7 days, with the two series in the legend', () => {
    const html = render()
    expect(html.match(/<g class="week-chart__day"/g)).toHaveLength(7)
    for (let day = 0; day < 7; day += 1) {
      expect(chartDay(html, day), `day ${day}`).not.toBe('')
    }
    expect(html).toContain(
      '<ul class="week-chart__legend"><li><span class="week-chart__key week-chart__key--sales" aria-hidden="true"></span>Ventes</li>' +
        '<li><span class="week-chart__key week-chart__key--cash" aria-hidden="true"></span>Argent reçu</li></ul>',
    )
    expect(html).toMatch(
      /<svg viewBox="0 0 560 232" role="img" aria-labelledby="(.+)-title" aria-describedby="\1-desc"><title id="\1-title">Ventes et argent reçu, jour par jour<\/title>/,
    )
  })

  it('gives each day its bars, and its numbers when hovered', () => {
    const html = render()
    const tuesday = WEEK.days[1]!
    expect(tuesday.sales).toBeGreaterThan(0)
    const day = chartDay(html, 1)
    expect(day).toContain(
      `<title>mardi 2 mai${S}: ventes ${formatBriefMoney(tuesday.sales)}, ` +
        `argent reçu ${formatBriefMoney(tuesday.cashReceived)}</title>`,
    )
    expect(day).toContain('<path class="week-chart__bar--sales"')
    expect(day).toContain('<path class="week-chart__bar--cash"')
    expect(day).toContain('<text class="week-chart__label"')
    expect(day).toContain('>mar.</text>')
    // A game starts with the truck closed on Mondays: no bar.
    const monday = chartDay(html, 0)
    expect(monday).toContain(
      `<title>lundi 1er mai, fermé${S}: ventes 0${S}$, argent reçu 0${S}$</title>`,
    )
    expect(monday).not.toContain('<path')
  })

  it('leaves the days before a partial week empty', () => {
    const html = render({ ...WEEK, partial: true, days: WEEK.days.slice(2) })
    expect(html.match(/<g class="week-chart__day"/g)).toHaveLength(7)
    expect(chartDay(html, 1)).toContain(
      `<title>mardi 2 mai${S}: aucune donnée</title>`,
    )
    expect(chartDay(html, 1)).not.toContain('<path')
  })

  it('marks the day of a sale on credit, with its note under the chart', () => {
    const html = render({
      ...WEEK,
      receivables: [
        {
          client: 'Gilles Lacasse',
          amount: cents(75_000),
          soldOnDay: 3,
          dueDay: 94,
        },
      ],
    })
    expect(chartDay(html, 3)).toContain('<circle class="week-chart__marker"')
    for (const day of [0, 1, 2, 4, 5, 6]) {
      expect(chartDay(html, day)).not.toContain('week-chart__marker')
    }
    expect(html).toContain(
      `<ul class="week-chart__notes"><li><span class="week-chart__note-marker" aria-hidden="true"></span>` +
        `<span class="week-chart__note-day">jeu.</span> — 750${S}$ de Gilles Lacasse${S}: à recevoir le 3 août</li></ul>`,
    )
    expect(render()).not.toContain('week-chart__notes')
  })
})

describe('LastWeekReport', () => {
  it("shows the app store's Défi under way, in « Bilans » too", () => {
    // « Zéro gaspillage » runs two weeks from Monday, May 8 (day 7).
    let game = startChallenge('zeroGaspillage', 7)
    while (game.day < 14) game = tick(game)
    gameStore.setState({ game })
    expect(renderToStaticMarkup(<LastWeekReport />)).toContain(
      `Défi en cours${S}: Zéro gaspillage`,
    )
  })

  it('says how the owner compares, at their difficulty, from day 0 to the Sunday', () => {
    // Four weeks at Difficile, seed 1: the bénéfice net from day 0 reads
    // 87.5, so rounding down tells from rounding off, while the fourth
    // week's bénéfice alone would read 95.
    const difficulty = 'difficile'
    let game = createInitialState(1, FOOD_TRUCK, {
      ...defaultProfile(),
      difficulty,
    })
    while (game.day < 28) {
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
    gameStore.setState({ game })
    const { netIncome } = incomeStatement(game.journal, 0, 27)
    const percentile = Math.floor(percentileOf(difficulty, 4, netIncome.amount))
    expect(renderToStaticMarkup(<LastWeekReport />)).toContain(
      `Mieux que ${percentile}${S}% des propriétaires`,
    )
  })

  it('shows the title the net worth of its Sunday earned, outside a Défi', () => {
    // Facile's owner brings the truck, so they start with a title.
    let facile = createInitialState(1, FOOD_TRUCK, {
      ...defaultProfile(),
      difficulty: 'facile',
    })
    while (facile.day < 7) facile = tick(facile)
    gameStore.setState({ game: facile })
    const worth = facile.weekHistory.at(-1)?.netWorth ?? null
    expect(worth).not.toBeNull()
    const title = titleOf(cents(worth ?? 0))?.name
    expect(title).toBeDefined()
    expect(renderToStaticMarkup(<LastWeekReport />)).toContain(
      `<p class="weekly-report__title">Titre${S}: ${title}</p>`,
    )
    const unvalued = {
      ...facile,
      weekHistory: facile.weekHistory.map((week) => ({
        ...week,
        netWorth: null,
      })),
    }
    gameStore.setState({ game: unvalued })
    expect(renderToStaticMarkup(<LastWeekReport />)).not.toContain('Titre')
  })

  it('shows no title with none given', () => {
    expect(render()).not.toContain('weekly-report__title')
  })

  it('says there is no report before the first week closes', () => {
    expect(renderToStaticMarkup(<LastWeekReport />)).toBe(
      '<p>Aucun bilan pour l&#x27;instant.</p>',
    )
  })
})

describe('the marketing of the week (#284)', () => {
  it('tells what the budget spent and brought, only in a week it spent', () => {
    expect(WEEK.marketing).toBeUndefined()
    expect(render()).not.toContain('weekly-report__marketing')
    const html = render({
      ...WEEK,
      marketing: { spent: cents(21_000), customers: 41, sales: cents(31_840) },
    })
    expect(html).toContain(
      `<p class="weekly-report__marketing">Marketing${S}: 210${S}$ dépensés · 41 clients venus par la pub · 318${S}$ de ventes</p>`,
    )
  })
})
