import { describe, expect, it } from 'vitest'
import type { AccountCode } from '../finance/accounts.ts'
import { emptyJournal, postEntry, type Journal } from '../finance/journal.ts'
import { balanceSheet } from '../finance/statements.ts'
import { createInitialState } from './clock.ts'
import { sellShares } from './financing.ts'
import { cents } from './money.ts'
import { netWorth } from './netWorth.ts'
import type { GameState, ShareSale } from './types.ts'

// « Valeur nette » (#160, of #161's formula): the owner's share of the
// company's equity, plus their own cash, worked out by hand.

const CASH: AccountCode = '1000'
const SHARE_CAPITAL: AccountCode = '3000'
const SALES: AccountCode = '4000'
const OTHER_CHARGES: AccountCode = '6900'

/** `amount` from `credited` to `debited` on day 0. */
function post(
  journal: Journal,
  debited: AccountCode,
  credited: AccountCode,
  amount: number,
): Journal {
  return postEntry(journal, {
    day: 0,
    memo: 'Test',
    lines: [
      { account: debited, debit: cents(amount), credit: cents(0) },
      { account: credited, debit: cents(0), credit: cents(amount) },
    ],
  })
}

/**
 * Books whose Capitaux propres come to `equity`: a Mise de fonds of
 * 10 000 $, then 2 500 $ of sales, then what takes them to `equity`.
 */
function booksAt(equity: number): Journal {
  let journal = post(emptyJournal(), CASH, SHARE_CAPITAL, 1_000_000)
  journal = post(journal, CASH, SALES, 250_000)
  const charge = 1_250_000 - equity
  return post(journal, OTHER_CHARGES, CASH, charge)
}

function sale(share: number): ShareSale {
  return { day: 0, investor: 'Duvent Capital', amount: cents(1), share }
}

/** A game on day 0 with `journal`, `personal` cents of its own, `sales`. */
function game(
  journal: Journal,
  personal: number,
  sales: readonly ShareSale[] = [],
): GameState {
  const state = createInitialState(42)
  return {
    ...state,
    journal,
    personal: { ...state.personal, cash: cents(personal) },
    financing: { ...state.financing, shareSales: sales },
  }
}

describe('netWorth', () => {
  it('is the equity plus the personal cash, with no share sold', () => {
    const journal = booksAt(1_200_000)
    expect(balanceSheet(journal, 0).equity.total.amount).toBe(1_200_000)
    // 12 000 $ + 3 000 $
    expect(netWorth(game(journal, 300_000))).toBe(1_500_000)
  })

  it("takes each round's share of the equity out", () => {
    // 12 000 $ − 20 % × 12 000 $ + 3 000 $
    expect(netWorth(game(booksAt(1_200_000), 300_000, [sale(0.2)]))).toBe(
      1_260_000,
    )
  })

  it("rounds each round's share to the cent, half away from zero", () => {
    // 10 000,03 $ × 20 % = 2 000,006 $ → 2 000,01 $, and × 15 % = 1 500,0045 $
    // → 1 500,00 $: 10 000,03 $ − 3 500,01 $ + 0,50 $.
    expect(
      netWorth(game(booksAt(1_000_003), 50, [sale(0.2), sale(0.15)])),
    ).toBe(650_052)
  })

  it('counts negative equity and personal cash as they are, shares and all', () => {
    // −5 000 $ − 20 % × −5 000 $ − 200 $
    expect(netWorth(game(booksAt(-500_000), -20_000, [sale(0.2)]))).toBe(
      -420_000,
    )
  })

  it('moves by what a share sale brings, less the share of the equity it gives away', () => {
    const before = game(booksAt(1_200_000), 300_000)
    const after = sellShares(before, {
      kind: 'shareSale',
      investor: 'Duvent Capital',
      amountCents: cents(2_000_000),
      share: 0.2,
    })
    // 80 % × (12 000 $ + 20 000 $) + 3 000 $
    expect(netWorth(after)).toBe(2_860_000)
    // 20 000 $ in, 20 % × 32 000 $ of the equity out.
    expect(netWorth(after) - netWorth(before)).toBe(2_000_000 - 640_000)
  })

  it("reads a new game's opening books and savings", () => {
    const state = createInitialState(42)
    expect(netWorth(state)).toBe(
      balanceSheet(state.journal, 0).equity.total.amount + state.personal.cash,
    )
  })
})
