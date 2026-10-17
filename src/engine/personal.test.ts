import { describe, expect, it } from 'vitest'
import { loadPersonalContent, type PersonalContent } from '../content/schema.ts'
import { toCalendar } from './calendar.ts'
import { cents, type Cents } from './money.ts'
import {
  LABELS,
  inDebt,
  isKept,
  livePersonalDay,
  openingAccount,
} from './personal.ts'
import type { Day, PersonalAccount, PersonalMovement } from './types.ts'

const FRIDAY = 5
const PAY = cents(70_000)
const COSTS = loadPersonalContent({
  rentCents: 130_000,
  weeklyExpensesCents: 25_000,
})

// Day 0 is Monday, May 1st, year 1. Day 4 is the first Friday, day 31 is
// June 1st, a Thursday, and day 123 is September 1st, a Friday. Day 365 is
// May 1st, year 2.
const FIRST_FRIDAY = 4
const JUNE_1 = 31
const FRIDAY_SEPTEMBER_1 = 123
const MAY_1_YEAR_2 = 365

/** The account after living days `from` to `to`, both included. */
function lived(
  account: PersonalAccount,
  from: Day,
  to: Day,
  pay: Cents = PAY,
  content: PersonalContent = COSTS,
): PersonalAccount {
  let state = account
  for (let day = from; day <= to; day += 1) {
    state = livePersonalDay(state, day, pay, FRIDAY, content)
  }
  return state
}

function costs(rentCents: number, weeklyExpensesCents: number) {
  return loadPersonalContent({ rentCents, weeklyExpensesCents })
}

function movement(day: Day, label: string, amount: number): PersonalMovement {
  return { day, label, amount: cents(amount) }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

describe('openingAccount', () => {
  it('holds the savings and nothing moved yet', () => {
    expect(openingAccount(cents(250_000))).toEqual({
      cash: 250_000,
      movements: [],
      unpaidRents: [],
    })
  })
})

describe('livePersonalDay', () => {
  it('brings the pay in on payday only', () => {
    const account = lived(openingAccount(cents(0)), 1, 13, PAY, costs(0, 0))
    expect(account.movements).toEqual([
      movement(FIRST_FRIDAY, LABELS.salary, 70_000),
      movement(FIRST_FRIDAY + 7, LABELS.salary, 70_000),
    ])
    expect(account.cash).toBe(140_000)
  })

  it('takes the rent out on the 1st of each month, day 0 included', () => {
    const account = lived(openingAccount(cents(0)), 0, 364, cents(0))
    const firsts = Array.from({ length: 365 }, (_, day) => day).filter(
      (day) => toCalendar(day).dayOfMonth === 1,
    )
    expect(firsts).toHaveLength(12)
    expect(firsts.slice(0, 2)).toEqual([0, JUNE_1])
    expect(
      account.movements.filter(({ label }) => label === LABELS.rent),
    ).toEqual(firsts.map((day) => movement(day, LABELS.rent, -130_000)))
  })

  it("takes the week's expenses out on payday, after the pay", () => {
    const account = lived(openingAccount(cents(0)), 1, 7, PAY, costs(0, 25_000))
    expect(account.movements).toEqual([
      movement(FIRST_FRIDAY, LABELS.salary, 70_000),
      movement(FIRST_FRIDAY, LABELS.weeklyExpenses, -25_000),
    ])
    expect(account.cash).toBe(45_000)
  })

  it('pays, then charges the rent, then the week, on a Friday the 1st', () => {
    expect(toCalendar(FRIDAY_SEPTEMBER_1)).toMatchObject({
      month: 9,
      dayOfMonth: 1,
      weekday: FRIDAY,
    })
    const account = livePersonalDay(
      openingAccount(cents(100_000)),
      FRIDAY_SEPTEMBER_1,
      PAY,
      FRIDAY,
      COSTS,
    )
    expect(account).toEqual({
      cash: 100_000 + 70_000 - 130_000 - 25_000,
      movements: [
        movement(FRIDAY_SEPTEMBER_1, LABELS.salary, 70_000),
        movement(FRIDAY_SEPTEMBER_1, LABELS.rent, -130_000),
        movement(FRIDAY_SEPTEMBER_1, LABELS.weeklyExpenses, -25_000),
      ],
      unpaidRents: [],
    })
  })

  it('counts the pay of a Friday the 1st toward its rent', () => {
    // 60 000 + 70 000 covers the rent of 130 000 exactly; the week's
    // expenses come after it.
    const account = livePersonalDay(
      openingAccount(cents(60_000)),
      FRIDAY_SEPTEMBER_1,
      PAY,
      FRIDAY,
      COSTS,
    )
    expect(account.unpaidRents).toEqual([])
    expect(account.cash).toBe(-25_000)
  })

  it('records nothing for an amount of 0, and leaves the cash as it is', () => {
    const start = openingAccount(cents(-5_000))
    const account = lived(start, 0, 40, cents(0), costs(0, 0))
    expect(account).toEqual(start)
    expect(account.unpaidRents).toEqual([])
  })

  it('pays a rent that leaves exactly 0, and leaves unpaid one that leaves less', () => {
    const paid = livePersonalDay(
      openingAccount(cents(130_000)),
      JUNE_1,
      PAY,
      FRIDAY,
      COSTS,
    )
    expect(paid).toMatchObject({ cash: 0, unpaidRents: [] })
    const unpaid = livePersonalDay(
      openingAccount(cents(129_999)),
      JUNE_1,
      PAY,
      FRIDAY,
      COSTS,
    )
    expect(unpaid).toMatchObject({ cash: -1, unpaidRents: [JUNE_1] })
    expect(unpaid.movements).toEqual([movement(JUNE_1, LABELS.rent, -130_000)])
  })

  it('leaves the rent unpaid again each month the cash stays below zero', () => {
    // No pay: from 200 000, May's rent is paid and June's leaves 60 000 too
    // little, so June, July and August go unpaid.
    const account = lived(
      openingAccount(cents(200_000)),
      0,
      92,
      cents(0),
      costs(130_000, 0),
    )
    expect(account.unpaidRents).toEqual([JUNE_1, 61, 92])
    expect(account.cash).toBe(200_000 - 4 * 130_000)
  })

  it('keeps this calendar month and the 11 before, movements and unpaid rents alike', () => {
    // Rent only and no pay, so the rent is the one movement of each month,
    // and it goes unpaid.
    const empty = openingAccount(cents(0))
    const noPay = cents(0)
    const rentOnly = costs(130_000, 0)
    const lastApril = lived(empty, 0, MAY_1_YEAR_2 - 1, noPay, rentOnly)
    expect(lastApril.movements).toHaveLength(12)
    expect(lastApril.movements[0]?.day).toBe(0)
    expect(lastApril.unpaidRents).toHaveLength(12)
    expect(lastApril.unpaidRents[0]).toBe(0)

    // May 1st, year 2: the first May falls out as the new May comes in.
    const nextMay = livePersonalDay(
      lastApril,
      MAY_1_YEAR_2,
      noPay,
      FRIDAY,
      rentOnly,
    )
    expect(nextMay.movements).toHaveLength(12)
    expect(nextMay.movements[0]?.day).toBe(JUNE_1)
    expect(nextMay.movements.at(-1)?.day).toBe(MAY_1_YEAR_2)
    expect(nextMay.unpaidRents[0]).toBe(JUNE_1)
    expect(nextMay.unpaidRents.at(-1)).toBe(MAY_1_YEAR_2)
    expect(nextMay.cash).toBe(-13 * 130_000)
  })

  it('keeps exactly what isKept() keeps, every day for three years', () => {
    // Beside the account, every movement and unpaid rent ever, none dropped.
    // At 400 $ a week and from nothing, every rent goes unpaid.
    let account = openingAccount(cents(0))
    const all: PersonalMovement[] = []
    const allUnpaid: Day[] = []
    for (let day = 0; day < 3 * 365; day += 1) {
      account = livePersonalDay(account, day, cents(40_000), FRIDAY, COSTS)
      all.push(...account.movements.filter((moved) => moved.day === day))
      allUnpaid.push(...account.unpaidRents.filter((rent) => rent === day))
      expect(account.movements).toEqual(
        all.filter((moved) => isKept(moved.day, day)),
      )
      expect(account.unpaidRents).toEqual(
        allUnpaid.filter((rent) => isKept(rent, day)),
      )
    }
    expect(allUnpaid).toHaveLength(36)
    expect(account.unpaidRents).toHaveLength(12)
    expect(account.cash).toBe(
      all.reduce((cash, { amount }) => cash + amount, 0),
    )
  })

  it('returns a new account and never mutates its input', () => {
    const account = deepFreeze(lived(openingAccount(cents(0)), 0, 40))
    const copy = structuredClone(account)
    const next = lived(account, 41, 400)
    expect(account).toEqual(copy)
    expect(next).not.toBe(account)
  })
})

describe('livePersonalDay with a home', () => {
  const HOME = { label: 'Hypothèque du condo', amount: cents(110_000) }

  it('takes the home’s payment on the 1st in place of the rent', () => {
    const account = livePersonalDay(
      openingAccount(cents(500_000)),
      JUNE_1,
      PAY,
      FRIDAY,
      COSTS,
      HOME,
    )
    expect(account.movements).toEqual([
      movement(JUNE_1, 'Hypothèque du condo', -110_000),
    ])
    expect(account.cash).toBe(500_000 - 110_000)
  })

  it('records it unpaid, as the rent, when it leaves the cash below zero', () => {
    const account = livePersonalDay(
      openingAccount(cents(100_000)),
      JUNE_1,
      PAY,
      FRIDAY,
      COSTS,
      HOME,
    )
    expect(account.unpaidRents).toEqual([JUNE_1])
  })
})

describe('isKept', () => {
  it.each([
    [0, 0, true],
    [0, MAY_1_YEAR_2 - 1, true],
    [0, MAY_1_YEAR_2, false],
    [JUNE_1 - 1, MAY_1_YEAR_2, false],
    [JUNE_1, MAY_1_YEAR_2, true],
    [JUNE_1, MAY_1_YEAR_2 + JUNE_1 - 1, true],
    [JUNE_1, MAY_1_YEAR_2 + JUNE_1, false],
  ])('keeps day %i on day %i: %s', (day, today, kept) => {
    expect(isKept(day, today)).toBe(kept)
  })
})

describe('inDebt', () => {
  it.each([
    [-1, true],
    [0, false],
    [1, false],
  ])('is %s below zero', (cash, debt) => {
    expect(inDebt(openingAccount(cents(cash)))).toBe(debt)
  })
})
