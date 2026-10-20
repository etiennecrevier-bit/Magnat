import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../engine/money.ts'
import { LABELS } from '../engine/personal.ts'
import type { Day, PersonalAccount } from '../engine/types.ts'
import FinancesPanel, { FinancesPanelView } from './FinancesPanel.tsx'
import { formatMoney } from './formatMoney.ts'
import { gameStore, type GameStoreState } from './store.ts'

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

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

const ACCOUNT: PersonalAccount = {
  cash: cents(-123_456),
  movements: [
    { day: 31, label: LABELS.rent, amount: cents(-130_000) },
    { day: 34, label: LABELS.salary, amount: cents(70_000) },
    { day: 34, label: LABELS.weeklyExpenses, amount: cents(-25_000) },
  ],
  unpaidRents: [31],
}

function render(
  account: PersonalAccount = ACCOUNT,
  lastPlayed: Day | null = 40,
  day: Day = lastPlayed === null ? 0 : lastPlayed + 1,
) {
  return renderToStaticMarkup(
    <FinancesPanelView
      account={account}
      day={day}
      lastPlayed={lastPlayed}
      onClose={() => {}}
    />,
  )
}

/** Each row of the table, as the text of its cells. */
function rows(html: string): string[][] {
  const body = /<tbody>(.*)<\/tbody>/.exec(html)?.[1] ?? ''
  return [...body.matchAll(/<tr>(.*?)<\/tr>/g)].map(([, row]) =>
    [...(row ?? '').matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(([, cell]) =>
      (cell ?? '').replace(/<[^>]+>/g, ''),
    ),
  )
}

describe('FinancesPanelView', () => {
  it('opens on Fermer, then the title', () => {
    expect(render()).toMatch(
      /^<div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer<\/button><h2 id="finances-title">Vos finances<\/h2><\/div>/,
    )
  })

  it('shows the balance in fr-CA, in red when it is below zero', () => {
    expect(render()).toContain(
      `<p class="finances__balance"><span class="finances__label">Solde</span> <span class="finances__cash finances__cash--negative">-1${S}234,56${S}$</span></p>`,
    )
    expect(render({ ...ACCOUNT, cash: cents(250_000) })).toContain(
      `<span class="finances__cash">2${S}500,00${S}$</span>`,
    )
  })

  it("lists the month's movements, newest first, under the month's name", () => {
    const html = render()
    expect(html).toContain(
      '<section aria-labelledby="finances-month"><h3 id="finances-month">Juin, an 1</h3><table class="data-table">',
    )
    expect(html).toContain(
      '<th scope="col">Date</th><th scope="col">Mouvement</th><th scope="col" class="number">Montant</th>',
    )
    expect(rows(html)).toEqual([
      ['4 juin', 'Dépenses de la semaine', `-250,00${S}$`],
      ['4 juin', 'Salaire', `700,00${S}$`],
      ['1er juin', 'Loyer impayé', `-1${S}300,00${S}$`],
    ])
    expect(html).toContain('Loyer <span class="finances__unpaid">impayé</span>')
  })

  it("says so when the month has no movement, and shows the top bar's month before any day is played", () => {
    const empty: PersonalAccount = {
      cash: cents(250_000),
      movements: [],
      unpaidRents: [],
    }
    const html = render(empty, null, 0)
    expect(html).toContain(
      '<h3 id="finances-month">Mai, an 1</h3><p>Aucun mouvement ce mois-ci.</p>',
    )
    expect(html).not.toContain('<table')
  })

  it('shows the month just ended on the morning of the 1st', () => {
    const may: PersonalAccount = {
      ...ACCOUNT,
      movements: [
        { day: 0, label: LABELS.rent, amount: cents(-130_000) },
        ...ACCOUNT.movements,
      ],
    }
    // The top bar shows June 1st; May 31st was the last day played.
    const html = render(may, 30, 31)
    expect(html).toContain('<h3 id="finances-month">Mai, an 1</h3>')
    expect(rows(html)).toEqual([['1er mai', 'Loyer', `-1${S}300,00${S}$`]])
  })
})

describe('FinancesPanel', () => {
  it("shows the app store's personal account, as a tab of « Finances »", () => {
    const html = renderToStaticMarkup(<FinancesPanel />)
    expect(html).toMatch(
      /^<div class="finances"><div class="panel__content">.*<\/div><\/div>$/,
    )
    const { game } = gameStore.getState()
    expect(html).toContain(
      `<span class="finances__cash">${formatMoney(game.personal.cash)}</span>`,
    )
    expect(html).toContain('Aucun mouvement ce mois-ci.')
  })

  it('lists what the store has played', () => {
    gameStore.getState().advance(1)
    const html = renderToStaticMarkup(<FinancesPanel />)
    // Day 0, May 1st, takes the rent.
    expect(rows(html)).toEqual([
      ['1er mai', 'Loyer', expect.stringMatching(/^-1.300,00.\$$/)],
    ])
  })
})
