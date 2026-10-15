import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { cents, sub, type Cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import { balance } from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import FinancialStatements, {
  FinancialStatementsView,
  type StatementTab,
} from './FinancialStatements.tsx'
import { formatStatementAmount } from './formatMoney.ts'
import {
  computeStatements,
  periodFor,
  type PeriodKey,
  type Statements,
} from './statementPeriods.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

/** Plays `days` days of a seeded game, keeping each day's revenue. */
function play(days: number) {
  let game: GameState = createInitialState(42)
  const revenueByDay: Cents[] = []
  for (let i = 0; i < days; i += 1) {
    game = tick(game)
    if (game.lastDay !== null) revenueByDay.push(game.lastDay.revenue)
  }
  return { game, revenueByDay }
}

function statementsFor(game: GameState, key: PeriodKey): Statements {
  const period = periodFor(key, game.day)
  if (period === null) throw new Error(`${key} has no days on ${game.day}`)
  return computeStatements(game.journal, period)
}

function render(
  tab: StatementTab,
  statements: Statements | null,
  periodKey: PeriodKey = 'thisMonth',
) {
  return renderToStaticMarkup(
    <FinancialStatementsView
      tab={tab}
      periodKey={periodKey}
      statements={statements}
      onTabChange={() => {}}
      onPeriodChange={() => {}}
    />,
  )
}

function unescape(text: string): string {
  return text.replaceAll('&#x27;', "'").replaceAll('&amp;', '&')
}

/** Each row with an amount, label to amount, as the screen shows them. */
function amounts(html: string): Map<string, string> {
  const rows = new Map<string, string>()
  const pattern =
    /<th scope="row"[^>]*>([^<]*)<\/th><td class="number">([^<]*)<\/td>/g
  for (const [, label = '', amount = ''] of html.matchAll(pattern)) {
    rows.set(unescape(label), amount)
  }
  return rows
}

/** Each toggle button's text and pressed state, in order. */
function toggles(html: string) {
  return [
    ...html.matchAll(
      /<button type="button" class="toggle" aria-pressed="(true|false)">([^<]*)<\/button>/g,
    ),
  ].map(([, pressed, label = '']) => ({ label: unescape(label), pressed }))
}

const cashAt = (game: GameState, toDay: number) =>
  balance(game.journal, '1000', { toDay })

describe('FinancialStatementsView', () => {
  // Day 45 is June 15th, year 1: this month runs from day 31 to day 45.
  const { game, revenueByDay } = play(45)
  const statements = statementsFor(game, 'thisMonth')

  it('shows a bilan that balances, with the cash the gauge shows', () => {
    const html = render('balanceSheet', statements)
    const rows = amounts(html)
    const totalAssets = rows.get('Total des actifs')
    expect(totalAssets).toBe(
      formatStatementAmount(statements.balanceSheet.assets.total.amount),
    )
    expect(rows.get('Total des passifs et des capitaux propres')).toBe(
      totalAssets,
    )
    expect(rows.get('Encaisse')).toBe(
      formatStatementAmount(cashAt(game, game.day)),
    )
    // Moyen's Mise de fonds: 10 000 $ in the bank and the 15 000 $ down on
    // the truck.
    expect(rows.get('Capital-actions')).toBe(`25${S}000,00${S}$`)
    expect(html).toContain('<h2 id="')
    expect(html).toContain('>Bilan</h2>')
    expect(html).toContain('<p class="statements__dates">Au 15 juin, an 1</p>')
  })

  it('shows sales that add up the revenue of each day of the period', () => {
    const html = render('incomeStatement', statements)
    const rows = amounts(html)
    // Days 31 to 44 have been played; day 45 is today.
    const sales = revenueByDay.slice(31, 45).reduce((a, b) => a + b, 0)
    expect(sales).toBeGreaterThan(0)
    expect(rows.get('Ventes')).toBe(formatStatementAmount(cents(sales)))

    const expected = incomeStatement(game.journal, 31, 45)
    expect(rows.get('Marge brute')).toBe(
      formatStatementAmount(expected.grossMargin.amount),
    )
    expect(rows.get('Total des charges')).toBe(
      formatStatementAmount(expected.expenses.total.amount),
    )
    expect(rows.get(expected.netIncome.label)).toBe(
      formatStatementAmount(expected.netIncome.amount),
    )
    expect(html).toContain(
      '<p class="statements__dates">Du 1er juin au 15 juin, an 1</p>',
    )
  })

  it('shows a cash flow from the opening cash to the gauge cash', () => {
    const html = render('cashFlow', statements)
    const rows = amounts(html)
    const opening = cashAt(game, 30)
    const closing = cashAt(game, game.day)
    expect(rows.get('Encaisse au début de la période')).toBe(
      formatStatementAmount(opening),
    )
    expect(rows.get('Encaisse à la fin de la période')).toBe(
      formatStatementAmount(closing),
    )
    expect(rows.get(statements.cashFlow.netChange.label)).toBe(
      formatStatementAmount(sub(closing, opening)),
    )
    // Paying suppliers is an outflow, so it shows in parentheses.
    expect(rows.get('Paiements aux fournisseurs')).toMatch(
      new RegExp(`^\\(\\d[\\d${S}]*,\\d\\d${S}\\$\\)$`),
    )
    expect(html).toContain('>État des flux de trésorerie</h2>')
  })

  it.each([
    { tab: 'balanceSheet', own: 'Total des actifs' },
    { tab: 'incomeStatement', own: 'Marge brute' },
    { tab: 'cashFlow', own: 'Encaisse à la fin de la période' },
  ] as const)('shows only the $tab table', ({ tab, own }) => {
    const html = render(tab, statements)
    expect(html.match(/<table/g)).toHaveLength(1)
    const rows = amounts(html)
    for (const label of [
      'Total des actifs',
      'Marge brute',
      'Encaisse à la fin de la période',
    ]) {
      expect(rows.has(label)).toBe(label === own)
    }
  })

  it('shows every line of a statement, zeros included', () => {
    const rows = amounts(render('balanceSheet', statements))
    expect(rows.get('Comptes clients')).toBe(`0,00${S}$`)
    expect(rows.get('Comptes fournisseurs')).toBe(`0,00${S}$`)
  })

  it.each([
    { tab: 'balanceSheet', periodKey: 'thisMonth' },
    { tab: 'incomeStatement', periodKey: 'lastMonth' },
    { tab: 'cashFlow', periodKey: 'yearToDate' },
  ] as const)(
    'presses the $tab and $periodKey buttons only',
    ({ tab, periodKey }) => {
      const html = render(tab, statementsFor(game, periodKey), periodKey)
      expect(toggles(html)).toEqual([
        { label: 'Bilan', pressed: String(tab === 'balanceSheet') },
        {
          label: 'État des résultats',
          pressed: String(tab === 'incomeStatement'),
        },
        { label: 'Flux de trésorerie', pressed: String(tab === 'cashFlow') },
        { label: 'Ce mois-ci', pressed: String(periodKey === 'thisMonth') },
        { label: 'Mois dernier', pressed: String(periodKey === 'lastMonth') },
        {
          label: "Depuis le début de l'année",
          pressed: String(periodKey === 'yearToDate'),
        },
      ])
      expect(html).toContain('role="group" aria-label="État financier"')
      expect(html).toContain('role="group" aria-label="Période"')
    },
  )

  it('dates last month as the whole month', () => {
    const html = render(
      'incomeStatement',
      statementsFor(game, 'lastMonth'),
      'lastMonth',
    )
    expect(html).toContain(
      '<p class="statements__dates">Du 1er mai au 31 mai, an 1</p>',
    )
  })

  it('says when a period has no data yet', () => {
    const html = render('incomeStatement', null, 'lastMonth')
    expect(html).toContain('>État des résultats</h2>')
    expect(html).toContain('<p>Aucune donnée pour cette période.</p>')
    expect(html).not.toContain('<table')
  })

  it('labels each table with its heading and has no tooltips', () => {
    for (const tab of [
      'balanceSheet',
      'incomeStatement',
      'cashFlow',
    ] as const) {
      const html = render(tab, statements)
      const id = /<h2 id="([^"]+)">/.exec(html)?.[1]
      expect(id).toBeDefined()
      expect(html).toContain(
        `<table class="data-table statement" aria-labelledby="${id}">`,
      )
      expect(html).not.toContain('title=')
    }
  })
})

describe('FinancialStatements', () => {
  it('opens on the bilan for this month, from the app store', () => {
    const html = renderToStaticMarkup(<FinancialStatements />)
    expect(html).toContain('<h1>États financiers</h1>')
    expect(html).toContain('>Bilan</h2>')
    expect(html).toContain('<p class="statements__dates">Au 1er mai, an 1</p>')
    const rows = amounts(html)
    // A Moyen game: 10 000 $ in the bank and the 85 000 $ truck.
    expect(rows.get('Encaisse')).toBe(`10${S}000,00${S}$`)
    expect(rows.get('Total des actifs')).toBe(`95${S}000,00${S}$`)
    expect(rows.get('Total des passifs et des capitaux propres')).toBe(
      `95${S}000,00${S}$`,
    )
  })
})
