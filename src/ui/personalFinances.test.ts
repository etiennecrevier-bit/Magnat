import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { LABELS } from '../engine/personal.ts'
import type { GameState, PersonalAccount } from '../engine/types.ts'
import { monthMovements } from './personalFinances.ts'

// Day 0 is Monday, May 1st; day 30 is May 31st and day 31 June 1st.
const ACCOUNT: PersonalAccount = {
  cash: cents(-12_000),
  movements: [
    { day: 0, label: LABELS.rent, amount: cents(-90_000) },
    { day: 6, label: LABELS.salary, amount: cents(40_000) },
    { day: 6, label: LABELS.weeklyExpenses, amount: cents(-15_000) },
    { day: 31, label: LABELS.rent, amount: cents(-90_000) },
    { day: 34, label: LABELS.salary, amount: cents(40_000) },
    { day: 34, label: LABELS.weeklyExpenses, amount: cents(-15_000) },
  ],
  unpaidRents: [31],
}

describe('monthMovements', () => {
  it('lists the movements of the month of the last day played, newest first', () => {
    expect(monthMovements(ACCOUNT, 40)).toEqual([
      {
        day: 34,
        label: 'Dépenses de la semaine',
        amount: -15_000,
        unpaid: false,
      },
      { day: 34, label: 'Salaire', amount: 40_000, unpaid: false },
      { day: 31, label: 'Loyer', amount: -90_000, unpaid: true },
    ])
  })

  it('still lists the month just ended on the morning of the 1st', () => {
    // On the morning of June 1st, May 31st is the last day played.
    expect(monthMovements(ACCOUNT, 30).map(({ day }) => day)).toEqual([6, 6, 0])
    // Once June 1st is played, its rent shows, and May is gone.
    const june1st: PersonalAccount = {
      ...ACCOUNT,
      movements: ACCOUNT.movements.filter(({ day }) => day <= 31),
    }
    expect(monthMovements(june1st, 31)).toEqual([
      { day: 31, label: 'Loyer', amount: -90_000, unpaid: true },
    ])
  })

  it('flags only a Loyer on a day the rent went unpaid', () => {
    const account: PersonalAccount = {
      ...ACCOUNT,
      movements: [
        { day: 31, label: LABELS.salary, amount: cents(40_000) },
        { day: 31, label: LABELS.rent, amount: cents(-90_000) },
      ],
    }
    expect(monthMovements(account, 31).map(({ unpaid }) => unpaid)).toEqual([
      true,
      false,
    ])
    const paid = monthMovements({ ...account, unpaidRents: [] }, 31)
    expect(paid.map(({ unpaid }) => unpaid)).toEqual([false, false])
  })

  it('lists nothing before any day is played', () => {
    const { personal } = createInitialState(42)
    expect(personal.movements).toEqual([])
    expect(monthMovements(personal, null)).toEqual([])
    expect(monthMovements(ACCOUNT, null)).toEqual([])
  })

  it('reads a real game: the rent goes unpaid once the owner pays themself too little', () => {
    let game: GameState = applyDecision(createInitialState(42), {
      kind: 'ownerWeeklyPay',
      pay: cents(40_000),
    })
    // Until the 1st of a month whose rent the account cannot cover.
    while (game.personal.unpaidRents.length === 0 && game.day < 400) {
      game = tick(game)
    }
    const lastPlayed = game.lastDay!.day
    expect(game.personal.unpaidRents).toEqual([lastPlayed])
    const listed = monthMovements(game.personal, lastPlayed)
    expect(listed.some((m) => m.label === 'Loyer' && m.unpaid)).toBe(true)
    expect(listed.every((m) => m.day <= lastPlayed)).toBe(true)
  })
})
