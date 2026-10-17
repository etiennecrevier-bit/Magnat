import { describe, expect, it } from 'vitest'
import { endOfMonth } from '../engine/calendar.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { EVENTS } from '../engine/day.ts'
import { cents, mulRatio, type Cents } from '../engine/money.ts'
import type { Day, GameState } from '../engine/types.ts'
import { loanSchedule } from '../finance/loan.ts'
import { balance, entriesSince, postEntry } from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import { financingSummary } from './financingSummary.ts'
import { createGameStore } from './store.ts'

const LENDER = 'Caisse populaire Saint-Prudent'
const INVESTOR = 'Duvent Capital'

/**
 * `game` with `amount` moved into Encaisse, or out of it when negative, as
 * a fixture: against Capital-actions, or Ventes when `asSales`.
 */
function adjusted(game: GameState, amount: number, asSales = false): GameState {
  const other = asSales ? '4000' : '3000'
  const size = cents(Math.abs(amount))
  const zero = cents(0)
  return {
    ...game,
    journal: postEntry(game.journal, {
      day: game.day,
      memo: 'Ajustement',
      lines:
        amount > 0
          ? [
              { account: '1000', debit: size, credit: zero },
              { account: other, debit: zero, credit: size },
            ]
          : [
              { account: other, debit: size, credit: zero },
              { account: '1000', debit: zero, credit: size },
            ],
    }),
  }
}

/** `game` with the card `event` waiting, in a store with the event cards. */
function storeOn(game: GameState, event: string) {
  return createGameStore(
    {
      ...game,
      events: { ...game.events, pending: { event, followUp: false } },
    },
    EVENTS,
  )
}

/** What the entries of `game` dated `day` with `memo` take out of Encaisse. */
function paidOn(game: GameState, day: Day, memo: string): Cents {
  let total = cents(0)
  for (const entry of entriesSince(game.journal, day)) {
    if (entry.day !== day || entry.memo !== memo) continue
    for (const line of entry.lines) {
      if (line.account === '1000') total = cents(total + line.credit)
    }
  }
  return total
}

/** The game in `store` played to the morning of `day`, no card stopping it. */
function advanceTo(store: ReturnType<typeof storeOn>, day: Day): GameState {
  while (store.getState().game.day < day) {
    const { game } = store.getState()
    store.setState({ game: tick(game) })
  }
  return store.getState().game
}

describe('financingSummary', () => {
  it('shows nothing before a loan or a share sale', () => {
    expect(financingSummary(createInitialState(42))).toBeNull()
  })

  it('shows an emergency loan accepted through the store, then what is left of it after each payment', () => {
    // Day 5, Encaisse 5 000 $ below zero, as a fixture.
    let start = createInitialState(42)
    while (start.day < 5) start = tick(start)
    start = adjusted(
      start,
      -balance(start.journal, '1000', { toDay: start.day }) - 500_000,
    )
    const store = storeOn(start, 'pretUrgence')
    store.getState().chooseEvent('accepter')
    store.getState().closePanel()
    const [loan] = store.getState().game.financing.loans
    if (loan === undefined) throw new Error('No loan taken')
    expect(loan).toMatchObject({ day: 5, lender: LENDER, termMonths: 12 })
    const { payments } = loanSchedule(
      loan.principal,
      loan.annualRateBasisPoints,
      loan.termMonths,
    )
    const june = endOfMonth(5) + 1

    expect(financingSummary(store.getState().game)).toEqual({
      hadLoans: true,
      loans: [
        {
          lender: LENDER,
          owed: loan.principal,
          next: { amount: payments[0]?.payment, day: june },
        },
      ],
      shares: [],
      dividend: null,
    })

    // The morning of June 1st, the payment is today's.
    const first = advanceTo(store, june)
    expect(financingSummary(first)?.loans[0]?.next).toEqual({
      amount: payments[0]?.payment,
      day: june,
    })
    const after = tick(first)
    expect(
      paidOn(after, june, `Intérêts · ${LENDER}`) +
        paidOn(after, june, `Remboursement · ${LENDER}`),
    ).toBe(payments[0]?.payment)
    expect(financingSummary(after)?.loans[0]).toEqual({
      lender: LENDER,
      owed: loan.principal - (payments[0]?.principal ?? 0),
      next: { amount: payments[1]?.payment, day: endOfMonth(june) + 1 },
    })
  })

  it('shows the first payment of a loan accepted on a 1st on the next 1st, as the engine pays it', () => {
    // The morning of June 1st, Encaisse 5 000 $ below zero, as a fixture.
    const june = endOfMonth(0) + 1
    let start = createInitialState(42)
    while (start.day < june) start = tick(start)
    start = adjusted(
      start,
      -balance(start.journal, '1000', { toDay: start.day }) - 500_000,
    )
    const store = storeOn(start, 'pretUrgence')
    store.getState().chooseEvent('accepter')
    store.getState().closePanel()
    const [loan] = store.getState().game.financing.loans
    if (loan === undefined) throw new Error('No loan taken')
    expect(loan).toMatchObject({ day: june, lender: LENDER })
    const [first] = loanSchedule(
      loan.principal,
      loan.annualRateBasisPoints,
      loan.termMonths,
    ).payments
    const july = endOfMonth(june) + 1
    const next = { amount: first?.payment, day: july }

    expect(financingSummary(store.getState().game)?.loans).toEqual([
      { lender: LENDER, owed: loan.principal, next },
    ])

    // June 1st pays nothing of it; July 1st pays what the summary said.
    const played = advanceTo(store, june + 1)
    expect(paidOn(played, june, `Intérêts · ${LENDER}`)).toBe(0)
    expect(paidOn(played, june, `Remboursement · ${LENDER}`)).toBe(0)
    expect(financingSummary(played)?.loans[0]?.next).toEqual(next)
    const morning = advanceTo(store, july)
    expect(financingSummary(morning)?.loans[0]?.next).toEqual(next)
    const after = tick(morning)
    expect(
      paidOn(after, july, `Intérêts · ${LENDER}`) +
        paidOn(after, july, `Remboursement · ${LENDER}`),
    ).toBe(first?.payment)
  })

  it('says no loan is open once the last one is paid back', () => {
    const game = createInitialState(42)
    const paidBack = {
      ...game,
      day: 400,
      financing: {
        ...game.financing,
        loans: [
          {
            day: 5,
            lender: LENDER,
            principal: cents(100_000),
            annualRateBasisPoints: 1800,
            termMonths: 12,
            fee: cents(2000),
          },
        ],
      },
    }
    expect(financingSummary(paidBack)).toEqual({
      hadLoans: true,
      loans: [],
      shares: [],
      dividend: null,
    })
  })

  it("shows Duvent's share and the next dividend so far, then exactly what the 1st of the quarter pays", () => {
    const store = storeOn(createInitialState(42), 'offreDuvent')
    store.getState().chooseEvent('accepter')
    store.getState().closePanel()
    expect(store.getState().game.financing.shareSales).toHaveLength(1)
    const july = endOfMonth(endOfMonth(0) + 1) + 1
    expect(financingSummary(store.getState().game)).toEqual({
      hadLoans: false,
      loans: [],
      shares: [{ investor: INVESTOR, tenths: 300 }],
      dividend: { day: july, amount: 0, final: false },
    })

    // A sale of 30 000 $ on day 20, as a fixture, so the quarter makes a
    // profit.
    advanceTo(store, 20)
    store.setState({
      game: adjusted(store.getState().game, 3_000_000, true),
    })
    const mid = advanceTo(store, 40)
    const soFar = incomeStatement(mid.journal, 0, july - 1).netIncome.amount
    expect(soFar).toBeGreaterThan(0)
    expect(financingSummary(mid)?.dividend).toEqual({
      day: july,
      amount: mulRatio(soFar, 0.3),
      final: false,
    })

    const morning = advanceTo(store, july)
    const dividend = financingSummary(morning)?.dividend
    expect(dividend).toMatchObject({ day: july, final: true })
    expect(dividend?.amount).toBeGreaterThan(0)
    expect(paidOn(tick(morning), july, `Dividende · ${INVESTOR}`)).toBe(
      dividend?.amount,
    )
  })

  it('adds up the rounds of one investor', () => {
    const game = createInitialState(42)
    const twice = {
      ...game,
      financing: {
        ...game.financing,
        shareSales: [
          { day: 0, investor: INVESTOR, amount: cents(2_000_000), share: 0.2 },
          { day: 0, investor: INVESTOR, amount: cents(2_000_000), share: 0.2 },
        ],
      },
    }
    expect(financingSummary(twice)?.shares).toEqual([
      { investor: INVESTOR, tenths: 400 },
    ])
  })
})
