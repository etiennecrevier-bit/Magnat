import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { cents, sub, type Cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import { balance } from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import FinancialStatement, { StatementView } from './FinancialStatements.tsx'
import { formatStatementAmount } from './formatMoney.ts'
import {
  computeStatements,
  periodFor,
  type PeriodKey,
  type StatementTab,
  type Statements,
} from './statementPeriods.ts'
import { gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// statement reads the app store's current state through this stand-in.
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

/** The id of the accordion's title, which names the table. */
const TITLE = 'statement-title'

function render(
  tab: StatementTab,
  statements: Statements | null,
  periodKey: PeriodKey = 'thisMonth',
) {
  return renderToStaticMarkup(
    <StatementView
      statement={tab}
      periodKey={periodKey}
      statements={statements}
      labelledBy={TITLE}
      onPeriodChange={() => {}}
    />,
  )
}

function unescape(text: string): string {
  return text.replaceAll('&#x27;', "'").replaceAll('&amp;', '&')
}

/**
 * Each row with an amount, label to amount, as the screen shows them; a
 * label with a tooltip is read from its anchor.
 */
function amounts(html: string): Map<string, string> {
  const rows = new Map<string, string>()
  const pattern =
    /<th scope="row"[^>]*>(?:<span class="statement__tip"[^>]*>)?([^<]*)(?:<\/span>.*?)?<\/th><td class="number">([^<]*)<\/td>/g
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

describe('StatementView', () => {
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
    'presses the $periodKey button only, with no choice of statement',
    ({ tab, periodKey }) => {
      const html = render(tab, statementsFor(game, periodKey), periodKey)
      expect(toggles(html)).toEqual([
        { label: 'Ce mois-ci', pressed: String(periodKey === 'thisMonth') },
        { label: 'Mois dernier', pressed: String(periodKey === 'lastMonth') },
        {
          label: "Depuis le début de l'année",
          pressed: String(periodKey === 'yearToDate'),
        },
      ])
      expect(html).not.toContain('aria-label="État financier"')
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
    expect(html).toContain('<p>Aucune donnée pour cette période.</p>')
    expect(html).not.toContain('<table')
  })

  it('labels each table with the title it is given, and has no heading of its own nor tooltips', () => {
    for (const tab of [
      'balanceSheet',
      'incomeStatement',
      'cashFlow',
    ] as const) {
      const html = render(tab, statements)
      expect(html).toContain(
        `<table class="data-table statement" aria-labelledby="${TITLE}">`,
      )
      expect(html).not.toMatch(/<h\d/)
      expect(html).not.toContain('title=')
    }
  })
})

describe('FinancialStatement', () => {
  it('shows the bilan for this month, from the app store', () => {
    const html = renderToStaticMarkup(
      <FinancialStatement statement="balanceSheet" labelledBy={TITLE} />,
    )
    expect(toggles(html)[0]).toEqual({ label: 'Ce mois-ci', pressed: 'true' })
    expect(html).toContain('<p class="statements__dates">Au 1er mai, an 1</p>')
    const rows = amounts(html)
    // A Moyen game: 10 000 $ in the bank and the 85 000 $ truck.
    expect(rows.get('Encaisse')).toBe(`10${S}000,00${S}$`)
    expect(rows.get('Total des actifs')).toBe(`95${S}000,00${S}$`)
    expect(rows.get('Total des passifs et des capitaux propres')).toBe(
      `95${S}000,00${S}$`,
    )
  })

  it('tells what the bilan’s « Équipement » holds, adding up to the line', () => {
    const html = renderToStaticMarkup(
      <FinancialStatement statement="balanceSheet" labelledBy={TITLE} />,
    )
    expect(amounts(html).get('Équipement')).toBe(`85${S}000,00${S}$`)
    expect(html).toMatch(
      /<span class="statement__tip" tabindex="0" aria-describedby="[^"]+">Équipement<\/span><div [^>]*role="tooltip"[^>]*><div class="tip__body" tabindex="-1"><p class="tip__title">Équipement<\/p><dl class="tip__rows"><div class="tip__row"><dt>Camion<\/dt><dd>85\u00a0000,00\u00a0\$<\/dd><\/div><div class="tip__row tip__row--divider"><dt>Total<\/dt><dd>85\u00a0000,00\u00a0\$<\/dd><\/div><\/dl>/,
    )
    // Only the one line tells what it holds.
    expect(html.match(/statement__tip/g)).toHaveLength(1)
  })

  it('tells what the investing « Équipement » holds over the period', () => {
    gameStore.getState().decide({ kind: 'buy', rung: 'espresso' })
    const html = renderToStaticMarkup(
      <FinancialStatement statement="cashFlow" labelledBy={TITLE} />,
    )
    // Moyen buys its truck on day 0, this month too.
    expect(amounts(html).get('Équipement')).toBe(`(91${S}000,00${S}$)`)
    expect(html).toContain(
      `<dt>Camion</dt><dd>(85${S}000,00${S}$)</dd></div><div class="tip__row"><dt>Machine à espresso pro</dt><dd>(6${S}000,00${S}$)</dd>`,
    )
  })

  it('tells whose wages « Salaires » holds over the period (#283)', () => {
    gameStore.getState().advance(10)
    const html = renderToStaticMarkup(
      <FinancialStatement statement="incomeStatement" labelledBy={TITLE} />,
    )
    const wages = amounts(html).get('Salaires')
    expect(wages).toBeDefined()
    expect(html).toContain(
      `<span class="statement__tip" tabindex="0" aria-describedby=`,
    )
    expect(html).toMatch(
      new RegExp(
        `<dt>Vous</dt><dd>[^<]+</dd></div><div class="tip__row tip__row--divider"><dt>Total</dt><dd>${wages?.replace('$', '\\$')}</dd>`,
      ),
    )
  })
})
