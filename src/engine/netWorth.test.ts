import { describe, expect, it } from 'vitest'
import type { AccountCode } from '../finance/accounts.ts'
import { emptyJournal, postEntry, type Journal } from '../finance/journal.ts'
import { balanceSheet } from '../finance/statements.ts'
import { createInitialState, tick } from './clock.ts'
import { FOOD_TRUCK } from './day.ts'
import { applyEffect } from './effects.ts'
import { sellShares } from './financing.ts'
import { cents } from './money.ts'
import { netWorth, netWorthChange, netWorthParts } from './netWorth.ts'
import type { RungId } from '../content/schema.ts'
import type { GameState, ShareSale, WeekRecord } from './types.ts'

// « Valeur nette » (#161): the owner's share of the company's equity, plus
// their own cash, worked out by hand.

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

describe('netWorthParts', () => {
  it('gives the share of the company, the cash, no assets and no debts with nothing of the dream, and their total', () => {
    // 12 000 $ − 20 % × 12 000 $, then 3 000 $.
    expect(
      netWorthParts(game(booksAt(1_200_000), 300_000, [sale(0.2)])),
    ).toEqual({
      companyShare: 960_000,
      personalCash: 300_000,
      personalAssets: 0,
      personalDebts: 0,
      total: 1_260_000,
    })
  })

  it('takes a share sale out of the share of the company, and leaves the cash alone', () => {
    const before = netWorthParts(game(booksAt(1_200_000), 300_000))
    const after = netWorthParts(
      sellShares(game(booksAt(1_200_000), 300_000), {
        kind: 'shareSale',
        investor: 'Duvent Capital',
        amountCents: cents(2_000_000),
        share: 0.2,
      }),
    )
    // 12 000 $, then 80 % × (12 000 $ + 20 000 $).
    expect(before.companyShare).toBe(1_200_000)
    expect(after.companyShare).toBe(2_560_000)
    expect(after.personalCash).toBe(before.personalCash)
    expect(after.total - before.total).toBe(2_000_000 - 640_000)
  })
})

describe('the personal assets', () => {
  /** The owner's rungs: `rung` bought on `day`. */
  const bought = (...rungs: [RungId, number][]) => ({
    bought: rungs.map(([rung, day]) => ({ rung, day, cost: cents(1) })),
    magnatOn: null,
  })

  it('count the owner’s rungs of « Le rêve » owned at the close of the day, at their price', () => {
    const owner = {
      ...game(booksAt(1_200_000), 300_000),
      day: 10,
      dream: bought(['velo', 3], ['voitureOccasion', 10], ['condo', 11]),
    }
    // A company rung adds nothing here: the books carry it.
    expect(netWorthParts(owner)).toMatchObject({
      personalAssets: 150_000 + 800_000,
      total: 1_200_000 + 300_000 + 950_000,
    })
  })

  it('stop counting the condo once the house sold it back', () => {
    const owner = {
      ...game(booksAt(0), 0),
      day: 20,
      dream: bought(
        ['velo', 0],
        ['voitureOccasion', 0],
        ['condo', 0],
        ['voitureLuxe', 0],
        ['maison', 20],
        ['espresso', 0],
      ),
    }
    expect(netWorthParts(owner).personalAssets).toBe(
      150_000 + 800_000 + 4_500_000 + 15_000_000,
    )
    expect(netWorthParts({ ...owner, day: 19 }).personalAssets).toBe(
      150_000 + 800_000 + 4_000_000 + 4_500_000,
    )
  })
})

/** A week of the history whose Sunday closed with `worth`. */
function week(firstDay: number, worth: number | null): WeekRecord {
  return {
    firstDay,
    sales: cents(0),
    netIncome: cents(0),
    cashAtEnd: cents(0),
    netWorth: worth === null ? null : cents(worth),
  }
}

describe('netWorthChange', () => {
  // 12 000 $ + 3 000 $ now.
  const now = game(booksAt(1_200_000), 300_000)

  it('is null until a Sunday is played', () => {
    expect(netWorthChange({ ...now, weekHistory: [] })).toBeNull()
  })

  it('is null when the last week has no net worth, from an older save', () => {
    expect(
      netWorthChange({
        ...now,
        weekHistory: [week(0, 900_000), week(7, null)],
      }),
    ).toBeNull()
  })

  it.each([
    { sunday: 1_400_000, change: 100_000 },
    { sunday: 1_600_000, change: -100_000 },
    { sunday: 1_500_000, change: 0 },
  ])(
    'is $change from a Sunday that closed with $sunday',
    ({ sunday, change }) => {
      expect(
        netWorthChange({
          ...now,
          weekHistory: [week(0, 9_999_999), week(7, sunday)],
        }),
      ).toBe(change)
    },
  )

  it('starts again from 0 at the close of a Sunday, then moves with what the Monday morning brings', () => {
    let state = createInitialState(42)
    while (state.day < 7) state = tick(state)
    // Monday morning, day 7: the first Sunday, day 6, is closed and
    // nothing came up since.
    expect(state.weekHistory.at(-1)?.firstDay).toBe(0)
    expect(netWorthChange(state)).toBe(0)

    const sold = sellShares(state, {
      kind: 'shareSale',
      investor: 'Duvent Capital',
      amountCents: cents(2_000_000),
      share: 0.2,
    })
    const equity = balanceSheet(sold.journal, 7).equity.total.amount
    // 20 000 $ in, 20 % of the equity with them in it out.
    expect(netWorthChange(sold)).toBe(2_000_000 - Math.round(equity * 0.2))

    const gift = applyEffect(
      sold,
      { kind: 'personal', label: 'Cadeau', amountCents: cents(6_000) },
      FOOD_TRUCK,
      'test',
    )
    expect(gift.personal.cash - sold.personal.cash).toBe(6_000)
    expect(netWorthChange(gift)).toBe(
      2_000_000 - Math.round(equity * 0.2) + 6_000,
    )
  })
})
