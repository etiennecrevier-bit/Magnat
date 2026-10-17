import { describe, expect, it } from 'vitest'
import {
  loadCustomerContent,
  loadDifficultyContent,
  loadFoodTruckContent,
  type CustomerContent,
  type DayType,
  type DifficultyContent,
  type DifficultyId,
  type FinancingContent,
  type FoodTruckContent,
  type ProductId,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, type JournalEntry } from '../finance/journal.ts'
import { loanSchedule } from '../finance/loan.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  type BalanceSheet,
} from '../finance/statements.ts'
import { monthsSinceStart, toCalendar } from './calendar.ts'
import { BAKERY } from './bakery.ts'
import { createInitialState, tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
import { perSegment } from './customers.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
  openingJournal,
} from './day.ts'
import { applyDecision } from './decisions.ts'
import { NO_EVENTS } from './events.ts'
import { FINANCING } from './financing.ts'
import { PRODUCTS } from './inventory.ts'
import { cents, mulRatio } from './money.ts'
import { PERCENTILES } from './percentiles.ts'
import { defaultProfile } from './profile.ts'
import { STAFF } from './staff.ts'
import type { Day, GameState } from './types.ts'

// The real costs of #44, charge by charge and difficulty by difficulty: the
// day each is charged, the accounts it goes to and its amount. Most amounts
// come from the content, which P2-16 tunes; the cases worked out by hand say
// so.

const LEVELS = [
  'facile',
  'moyen',
  'difficile',
] as const satisfies readonly DifficultyId[]

const CASH: AccountCode = '1000'
const EQUIPMENT: AccountCode = '1500'
const ACCUMULATED_DEPRECIATION: AccountCode = '1510'
const BANK_LOANS: AccountCode = '2500'
const SHARE_CAPITAL: AccountCode = '3000'

const MEMO = {
  capital: 'Mise de fonds',
  truckContributed: 'Camion apporté par le propriétaire',
  loan: 'Emprunt de démarrage',
  truckBought: 'Achat du camion',
  permit: 'Permis, stationnement et cuisine',
  insurance: 'Assurances',
  interest: "Intérêts sur l'emprunt",
  principal: "Remboursement de l'emprunt",
  depreciation: 'Amortissement du camion',
  lease: 'Location du camion',
  packaging: 'Emballages',
  cardFees: 'Frais de cartes',
  fuel: 'Carburant et entretien',
  ownerPay: 'Paie du propriétaire',
} as const

/** The memo of the daily fixed costs these charges replaced. */
const OLD_FIXED_COSTS = 'Loyer, permis, carburant et entretien'

const TEN_YEARS = 3650
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]
/** Monday closed, as the shipped game starts. */
const CLOSED_MONDAYS = [2, 3, 4, 5, 6, 7]

/** What a game is played with. */
interface Setup {
  truck: FoodTruckContent
  customers: CustomerContent
  difficulties: DifficultyContent
}

const SHIPPED: Setup = {
  truck: FOOD_TRUCK,
  customers: CUSTOMERS,
  difficulties: DIFFICULTIES,
}

function byProduct<T>(value: (product: ProductId) => T): Record<ProductId, T> {
  return Object.fromEntries(
    PRODUCTS.map((product) => [product, value(product)]),
  ) as Record<ProductId, T>
}

/** The shipped truck's starting decisions, with `change` made. */
function deciding(
  change: Partial<Record<keyof FoodTruckContent['startingDecisions'], unknown>>,
  truck: FoodTruckContent = FOOD_TRUCK,
): FoodTruckContent {
  return loadFoodTruckContent({
    ...truck,
    startingDecisions: { ...truck.startingDecisions, ...change },
  })
}

/** Every type of day brings `customers` walk-ins, with no noise. */
function crowd(
  customers: number,
  change: Partial<DayType> = {},
): FoodTruckContent['walkIns'] {
  const { walkIns } = FOOD_TRUCK
  return {
    ...walkIns,
    noiseStdDevRatio: 0,
    dayTypes: {
      semaine: { ...walkIns.dayTypes.semaine, customers, ...change },
      finDeSemaine: { ...walkIns.dayTypes.finDeSemaine, customers, ...change },
    },
  }
}

/**
 * The shipped truck where nobody comes and nothing is bought, closed on
 * Mondays: a day posts only its charges, so ten years play fast.
 */
const QUIET: Setup = {
  ...SHIPPED,
  truck: deciding(
    {
      restock: byProduct(() => ({ kind: 'buyDaily', quantity: 0 })),
      daysOpen: CLOSED_MONDAYS,
    },
    loadFoodTruckContent({ ...FOOD_TRUCK, walkIns: crowd(0) }),
  ),
}

/**
 * A truck open every day where each of `customers` walk-ins buys one café
 * at 3,25 $ and one chocolat chaud at 3,50 $ and nobody wants a croissant.
 * Packaging is 20 ¢ a café, 15 ¢ a chocolat chaud and 5 ¢ a croissant; 85 %
 * of sales are paid by card, at 2,5 %.
 */
function selling(customers: number): Setup {
  const prices = { cafe: 325, chocolat: 350, croissant: 375 }
  const wants = { cafe: 1, chocolat: 1, croissant: 0 }
  const packaging = { cafe: 20, chocolat: 15, croissant: 5 }
  const truck = loadFoodTruckContent({
    ...FOOD_TRUCK,
    products: byProduct((product) => ({
      ...FOOD_TRUCK.products[product],
      packagingCents: packaging[product],
    })),
    cardPayments: { share: 0.85, feeRate: 0.025 },
    walkIns: crowd(customers, { productAppeal: byProduct(() => 1) }),
    // Served the moment they arrive, so no one leaves the line.
    service: { ...FOOD_TRUCK.service, baseSeconds: 0, perItemSeconds: 0 },
  })
  return {
    ...SHIPPED,
    truck: deciding(
      {
        pricesCents: prices,
        restock: byProduct(() => ({ kind: 'buyDaily', quantity: 50 })),
        daysOpen: EVERY_DAY,
      },
      truck,
    ),
    // Each segment finds the price fair, so it buys with exactly the chance
    // it wants the product: always or never.
    customers: loadCustomerContent({
      segments: perSegment((id) => ({
        name: CUSTOMERS.segments[id].name,
        patienceMinutes: CUSTOMERS.segments[id].patienceMinutes,
        products: byProduct((product) => ({
          referencePriceCents: prices[product],
          purchaseProbability: wants[product],
          sensitivity: 4,
        })),
      })),
    }),
  }
}

function start(setup: Setup, level: DifficultyId, seed = 42): GameState {
  return createInitialState(
    seed,
    setup.truck,
    { ...defaultProfile(), difficulty: level },
    setup.difficulties,
  )
}

/**
 * The shipped financing with no bankruptcy (#160): a quiet game runs far
 * below zero for years, and its charges still post.
 */
const NO_BANKRUPTCY: FinancingContent = {
  ...FINANCING,
  bankruptcy: { ...FINANCING.bankruptcy, months: Number.MAX_SAFE_INTEGER },
}

/** The state after each of `days` ticks, in order. */
function play(setup: Setup, days: number, from: GameState): GameState[] {
  const states: GameState[] = []
  let state = from
  for (let i = 0; i < days; i += 1) {
    state = tick(
      state,
      setup.truck,
      setup.customers,
      setup.difficulties,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
      DEFIS,
      PERCENTILES,
      BAKERY,
      GROCERS,
      STAFF,
      NO_BANKRUPTCY,
    )
    states.push(state)
  }
  return states
}

/** The state after `days` ticks. */
function after(setup: Setup, days: number, from: GameState): GameState {
  const state = play(setup, days, from).at(-1)
  if (state === undefined) throw new Error('no day played')
  return state
}

const decades = new Map<DifficultyId, GameState>()

/** Ten quiet years at `level`, played once. */
function tenYears(level: DifficultyId): GameState {
  let state = decades.get(level)
  if (state === undefined) {
    state = after(QUIET, TEN_YEARS, start(QUIET, level))
    decades.set(level, state)
  }
  return state
}

function withMemo(state: GameState, memo: string): JournalEntry[] {
  return state.journal.entries.filter((entry) => entry.memo === memo)
}

function memosOn(state: GameState, day: Day): string[] {
  return state.journal.entries
    .filter((entry) => entry.day === day)
    .map(({ memo }) => memo)
}

/** The days in [0, `days`) that `keep` keeps. */
function daysWhere(keep: (day: Day) => boolean, days = TEN_YEARS): Day[] {
  return Array.from({ length: days }, (_, day) => day).filter(keep)
}

/** The days in [0, `days`) that are the 1st of a month. */
function firstsOfMonth(days = TEN_YEARS): Day[] {
  return daysWhere((day) => toCalendar(day).dayOfMonth === 1, days)
}

/** A two-line entry moving `amount` from `credited` to `debited`. */
function transfer(
  day: Day,
  memo: string,
  debited: AccountCode,
  credited: AccountCode,
  amount: number,
): JournalEntry {
  return {
    day,
    memo,
    lines: [
      { account: debited, debit: cents(amount), credit: cents(0) },
      { account: credited, debit: cents(0), credit: cents(amount) },
    ],
  }
}

/** A difficulty's loan; fails for one that takes none. */
function loanOf(level: DifficultyId, difficulties = DIFFICULTIES) {
  const { truck } = difficulties.difficulties[level]
  if (truck.kind !== 'loan') throw new Error(`${level} takes no loan`)
  return truck
}

/** The shipped difficulties with Moyen's loan changed. */
function moyenLoan(
  change: Partial<
    Record<'loanCents' | 'annualRateBasisPoints' | 'termMonths', number>
  >,
): DifficultyContent {
  const { moyen } = DIFFICULTIES.difficulties
  return loadDifficultyContent({
    ...DIFFICULTIES,
    difficulties: {
      ...DIFFICULTIES.difficulties,
      moyen: { ...moyen, truck: { ...moyen.truck, ...change } },
    },
  })
}

/** The bilan's row for `account`, 0 when it shows none. */
function bilanRow(sheet: BalanceSheet, account: AccountCode): number {
  const lines = [
    ...sheet.assets.current.lines,
    ...sheet.assets.longTerm.lines,
    ...sheet.liabilities.lines,
    ...sheet.equity.lines,
  ]
  return lines.find((line) => line.account === account)?.amount ?? 0
}

describe('the opening books', () => {
  const { priceCents } = FOOD_TRUCK.truck

  it("let Facile's owner pay in the cash and bring the truck", () => {
    const { startingCashCents } = DIFFICULTIES.difficulties.facile
    expect(openingJournal('facile').entries).toEqual([
      transfer(0, MEMO.capital, CASH, SHARE_CAPITAL, startingCashCents),
      transfer(0, MEMO.truckContributed, EQUIPMENT, SHARE_CAPITAL, priceCents),
    ])
  })

  it("let Moyen's owner pay in what the loan leaves of the truck, on top of the cash", () => {
    const { startingCashCents } = DIFFICULTIES.difficulties.moyen
    const { loanCents } = loanOf('moyen')
    expect(openingJournal('moyen').entries).toEqual([
      transfer(
        0,
        MEMO.capital,
        CASH,
        SHARE_CAPITAL,
        startingCashCents + priceCents - loanCents,
      ),
      transfer(0, MEMO.loan, CASH, BANK_LOANS, loanCents),
      transfer(0, MEMO.truckBought, EQUIPMENT, CASH, priceCents),
    ])
  })

  it("leave Difficile's leased truck off the books", () => {
    const { startingCashCents } = DIFFICULTIES.difficulties.difficile
    expect(openingJournal('difficile').entries).toEqual([
      transfer(0, MEMO.capital, CASH, SHARE_CAPITAL, startingCashCents),
    ])
  })

  // By hand, from the decisions of #44.
  it.each([
    {
      level: 'facile',
      cash: 1_500_000,
      truck: 8_500_000,
      loan: 0,
      capital: 10_000_000,
    },
    {
      level: 'moyen',
      cash: 1_000_000,
      truck: 8_500_000,
      loan: 7_000_000,
      capital: 2_500_000,
    },
    { level: 'difficile', cash: 500_000, truck: 0, loan: 0, capital: 500_000 },
  ] as const)(
    'open the bilan of a $level game as #44 has it',
    ({ level, cash, truck, loan, capital }) => {
      const sheet = balanceSheet(start(SHIPPED, level).journal, 0)
      expect(bilanRow(sheet, CASH)).toBe(cash)
      expect(bilanRow(sheet, EQUIPMENT)).toBe(truck)
      expect(bilanRow(sheet, BANK_LOANS)).toBe(loan)
      expect(bilanRow(sheet, SHARE_CAPITAL)).toBe(capital)
      expect(sheet.assets.total.amount).toBe(
        sheet.totalLiabilitiesAndEquity.amount,
      )
    },
  )

  it('take no Mise de fonds when the loan pays for everything, and reject a bigger loan', () => {
    const { startingCashCents } = DIFFICULTIES.difficulties.moyen
    const everything = startingCashCents + priceCents
    const books = openingJournal(
      'moyen',
      FOOD_TRUCK,
      moyenLoan({ loanCents: everything }),
    )
    expect(books.entries.map(({ memo }) => memo)).toEqual([
      MEMO.loan,
      MEMO.truckBought,
    ])
    expect(() =>
      openingJournal(
        'moyen',
        FOOD_TRUCK,
        moyenLoan({ loanCents: everything + 1 }),
      ),
    ).toThrow(RangeError)
  })
})

describe('the 1st of the month', () => {
  const firsts = firstsOfMonth()

  it('falls on 120 days in ten years, from day 0', () => {
    expect(firsts.slice(0, 4)).toEqual([0, 31, 61, 92])
    expect(firsts).toHaveLength(120)
  })

  it.each(LEVELS)(
    'charges %s the permit, parking and commissary, then the insurance, open or closed',
    (level) => {
      const state = tenYears(level)
      const { permitParkingAndCommissary, insurance } =
        FOOD_TRUCK.monthlyCostsCents
      // Day 0 is a Monday, which the quiet truck closes.
      expect(CLOSED_MONDAYS).not.toContain(toCalendar(0).weekday)
      const opened = openingJournal(level).entries.length
      expect(memosOn(state, 0).slice(opened, opened + 2)).toEqual([
        MEMO.permit,
        MEMO.insurance,
      ])
      expect(withMemo(state, MEMO.permit)).toEqual(
        firsts.map((day) =>
          transfer(day, MEMO.permit, '6100', CASH, permitParkingAndCommissary),
        ),
      )
      expect(withMemo(state, MEMO.insurance)).toEqual(
        firsts.map((day) =>
          transfer(day, MEMO.insurance, '6150', CASH, insurance),
        ),
      )
    },
  )

  it("leases Difficile's truck every month from day 0", () => {
    const { truck } = DIFFICULTIES.difficulties.difficile
    if (truck.kind !== 'lease') throw new Error('Difficile leases')
    expect(withMemo(tenYears('difficile'), MEMO.lease)).toEqual(
      firsts.map((day) =>
        transfer(day, MEMO.lease, '6120', CASH, truck.monthlyLeaseCents),
      ),
    )
  })

  it.each(['facile', 'moyen'] as const)(
    'leases nothing for %s, which owns its truck',
    (level) => {
      expect(withMemo(tenYears(level), MEMO.lease)).toEqual([])
    },
  )

  it("pays Moyen's loan monthly from June 1st, year 1, to May 1st, year 6, as loanSchedule() has it", () => {
    const state = tenYears('moyen')
    const loan = loanOf('moyen')
    const { payments } = loanSchedule(
      loan.loanCents,
      loan.annualRateBasisPoints,
      loan.termMonths,
    )
    const paydays = firsts.filter((day) => {
      const month = monthsSinceStart(day)
      return month >= 1 && month <= loan.termMonths
    })
    // 60 monthly payments, the first a month after the loan.
    expect(paydays).toHaveLength(payments.length)
    expect(paydays[0]).toBe(31)
    expect(paydays.at(-1)).toBe(1825)

    const dayOf = (index: number) => paydays[index] ?? -1
    expect(withMemo(state, MEMO.interest)).toEqual(
      payments.map(({ interest }, index) =>
        transfer(dayOf(index), MEMO.interest, '7000', CASH, interest),
      ),
    )
    expect(withMemo(state, MEMO.principal)).toEqual(
      payments.map(({ principal }, index) =>
        transfer(dayOf(index), MEMO.principal, BANK_LOANS, CASH, principal),
      ),
    )
    const owed = (toDay: Day) => balance(state.journal, BANK_LOANS, { toDay })
    expect(owed(0)).toBe(loan.loanCents)
    expect(owed(1824)).toBe(payments.at(-1)?.principal)
    expect(owed(1825)).toBe(0)
    expect(owed(TEN_YEARS - 1)).toBe(0)
  })

  it('pays a loan without interest in principal only', () => {
    const difficulties = moyenLoan({
      loanCents: 300_000,
      annualRateBasisPoints: 0,
      termMonths: 3,
    })
    const setup = { ...QUIET, difficulties }
    const state = after(setup, 120, start(setup, 'moyen'))
    expect(withMemo(state, MEMO.interest)).toEqual([])
    expect(withMemo(state, MEMO.principal)).toEqual(
      [31, 61, 92].map((day) =>
        transfer(day, MEMO.principal, BANK_LOANS, CASH, 100_000),
      ),
    )
  })

  it.each(['facile', 'difficile'] as const)('charges %s no loan', (level) => {
    const state = tenYears(level)
    expect(withMemo(state, MEMO.interest)).toEqual([])
    expect(withMemo(state, MEMO.principal)).toEqual([])
    expect(balance(state.journal, BANK_LOANS, { toDay: TEN_YEARS - 1 })).toBe(0)
  })

  it.each(['facile', 'moyen'] as const)(
    "depreciates %s's truck straight line over its useful life, then stops",
    (level) => {
      const state = tenYears(level)
      const { priceCents, usefulLifeMonths } = FOOD_TRUCK.truck
      const months = firsts.filter(
        (day) => monthsSinceStart(day) < usefulLifeMonths,
      )
      expect(months).toHaveLength(usefulLifeMonths)
      const monthly = Math.floor(priceCents / usefulLifeMonths)
      const last = priceCents - monthly * (usefulLifeMonths - 1)
      expect(withMemo(state, MEMO.depreciation)).toEqual(
        months.map((day, index) =>
          transfer(
            day,
            MEMO.depreciation,
            '6400',
            ACCUMULATED_DEPRECIATION,
            index === usefulLifeMonths - 1 ? last : monthly,
          ),
        ),
      )
      expect(
        balance(state.journal, ACCUMULATED_DEPRECIATION, {
          toDay: TEN_YEARS - 1,
        }),
      ).toBe(priceCents)
    },
  )

  // By hand: 85 000 $ over 120 months is 708,33 $, and 119 of those leave
  // 708,73 $ for the last, on April 1st, year 11.
  it('depreciates the truck of #44 by 708,33 $ a month and 708,73 $ in its last', () => {
    const entries = withMemo(tenYears('moyen'), MEMO.depreciation)
    expect(entries).toHaveLength(120)
    expect(entries[0]).toEqual(
      transfer(0, MEMO.depreciation, '6400', ACCUMULATED_DEPRECIATION, 70_833),
    )
    expect(entries.at(-1)).toEqual(
      transfer(
        3620,
        MEMO.depreciation,
        '6400',
        ACCUMULATED_DEPRECIATION,
        70_873,
      ),
    )
  })

  it('depreciates a 10 $ truck over 3 months as 3,33 $, 3,33 $ and 3,34 $', () => {
    const truck = loadFoodTruckContent({
      ...QUIET.truck,
      truck: { priceCents: 1_000, usefulLifeMonths: 3 },
    })
    const setup = { ...QUIET, truck }
    const state = after(setup, 120, start(setup, 'facile'))
    expect(withMemo(state, MEMO.depreciation)).toEqual([
      transfer(0, MEMO.depreciation, '6400', ACCUMULATED_DEPRECIATION, 333),
      transfer(31, MEMO.depreciation, '6400', ACCUMULATED_DEPRECIATION, 333),
      transfer(61, MEMO.depreciation, '6400', ACCUMULATED_DEPRECIATION, 334),
    ])
  })

  it('depreciates nothing for Difficile, whose books never hold the truck', () => {
    const state = tenYears('difficile')
    expect(withMemo(state, MEMO.depreciation)).toEqual([])
    for (const account of [EQUIPMENT, ACCUMULATED_DEPRECIATION]) {
      expect(balance(state.journal, account, { toDay: TEN_YEARS - 1 })).toBe(0)
    }
  })
})

describe('each open day', () => {
  it.each(LEVELS)(
    'charges %s the fuel and maintenance, and only then',
    (level) => {
      const open = daysWhere((day) =>
        CLOSED_MONDAYS.includes(toCalendar(day).weekday),
      )
      expect(withMemo(tenYears(level), MEMO.fuel)).toEqual(
        open.map((day) =>
          transfer(
            day,
            MEMO.fuel,
            '6200',
            CASH,
            FOOD_TRUCK.fuelAndMaintenancePerOpenDayCents,
          ),
        ),
      )
    },
  )
})

describe('each sale', () => {
  // By hand: 10 cafés at 3,25 $ and 10 chocolats chauds at 3,50 $ make
  // 67,50 $ of sales. 85 % is 57,375 $, rounded to 57,38 $ paid by card;
  // 2,5 % of that is 1,4345 $, rounded to 1,43 $ of fees. The packaging is
  // 10 × 20 ¢ + 10 × 15 ¢ = 3,50 $.
  it.each(LEVELS)(
    'charges %s the packaging and the card fees of the day, paid the same day',
    (level) => {
      const setup = selling(10)
      for (const state of play(setup, 14, start(setup, level))) {
        const day = state.day - 1
        expect(state.lastDay?.revenue).toBe(6_750)
        const entries = state.journal.entries.filter((e) => e.day === day)
        expect(entries.filter(({ memo }) => memo === MEMO.packaging)).toEqual([
          transfer(day, MEMO.packaging, '5200', CASH, 350),
        ])
        expect(entries.filter(({ memo }) => memo === MEMO.cardFees)).toEqual([
          transfer(day, MEMO.cardFees, '6500', CASH, 143),
        ])
      }
    },
  )

  it.each(LEVELS)(
    'charges %s no packaging and no card fee on a day with no sale',
    (level) => {
      const setup = selling(0)
      const state = after(setup, 14, start(setup, level))
      expect(withMemo(state, MEMO.packaging)).toEqual([])
      expect(withMemo(state, MEMO.cardFees)).toEqual([])
    },
  )

  it.each(LEVELS)(
    'charges %s the packaging of the units sold and the fees on the card share, with the shipped customers',
    (level) => {
      const { share, feeRate } = FOOD_TRUCK.cardPayments
      let sold = 0
      for (const state of play(SHIPPED, 30, start(SHIPPED, level))) {
        const lastDay = state.lastDay
        if (lastDay === null) throw new Error('no day played')
        const amountOf = (memo: string) =>
          state.journal.entries
            .filter((entry) => entry.day === lastDay.day && entry.memo === memo)
            .reduce((total, { lines }) => total + (lines[0]?.debit ?? 0), 0)
        const packaging = PRODUCTS.reduce(
          (total, product) =>
            total +
            lastDay.sold[product] * FOOD_TRUCK.products[product].packagingCents,
          0,
        )
        expect(amountOf(MEMO.packaging)).toBe(packaging)
        expect(amountOf(MEMO.cardFees)).toBe(
          mulRatio(mulRatio(lastDay.revenue, share), feeRate),
        )
        sold += lastDay.revenue
      }
      expect(sold).toBeGreaterThan(0)
    },
  )
})

describe('payday', () => {
  const pay = FOOD_TRUCK.startingDecisions.ownerWeeklyPayCents

  it.each(LEVELS)('pays the %s owner every Friday', (level) => {
    const fridays = daysWhere(
      (day) => toCalendar(day).weekday === FOOD_TRUCK.ownerPayWeekday,
    )
    expect(fridays.slice(0, 2)).toEqual([4, 11])
    expect(withMemo(tenYears(level), MEMO.ownerPay)).toEqual(
      fridays.map((day) => transfer(day, MEMO.ownerPay, '6000', CASH, pay)),
    )
  })

  it.each(LEVELS)(
    'pays the %s owner on a Friday the truck is closed',
    (level) => {
      const setup = {
        ...QUIET,
        truck: deciding({ daysOpen: [1, 2, 3, 4, 6, 7] }, QUIET.truck),
      }
      const state = after(setup, 5, start(setup, level))
      expect(memosOn(state, 4)).toEqual([MEMO.ownerPay])
    },
  )

  it('pays a changed pay from the next morning, and nothing at all for a pay of 0', () => {
    const changed = (state: GameState, amount: number) =>
      applyDecision(state, { kind: 'ownerWeeklyPay', pay: cents(amount) })
    // Friday, day 4: decided that morning, so day 4 still pays the old pay.
    let state = after(QUIET, 4, start(QUIET, 'moyen'))
    state = after(QUIET, 8, changed(state, 50_000))
    // Saturday, day 12: nothing more from the next Friday on.
    state = after(QUIET, 14, changed(state, 0))
    expect(state.day).toBe(26)
    expect(withMemo(state, MEMO.ownerPay)).toEqual([
      transfer(4, MEMO.ownerPay, '6000', CASH, pay),
      transfer(11, MEMO.ownerPay, '6000', CASH, 50_000),
    ])
  })
})

describe('the old daily fixed costs', () => {
  it.each(LEVELS)('are gone from a %s game', (level) => {
    expect(withMemo(tenYears(level), OLD_FIXED_COSTS)).toEqual([])
    const shipped = after(SHIPPED, 30, start(SHIPPED, level))
    expect(withMemo(shipped, OLD_FIXED_COSTS)).toEqual([])
  })
})

describe('the first year', () => {
  const charges = {
    facile: ['6400'],
    moyen: ['6400', '7000'],
    difficile: ['6120'],
  } as const satisfies Record<DifficultyId, readonly AccountCode[]>
  const absent = {
    facile: ['6120', '7000'],
    moyen: ['6120'],
    difficile: ['6400', '7000'],
  } as const satisfies Record<DifficultyId, readonly AccountCode[]>

  it.each(LEVELS)(
    'of a %s game shows every charge in statements that agree',
    (level) => {
      const { journal } = after(SHIPPED, 365, start(SHIPPED, level))
      const sheet = balanceSheet(journal, 364)
      expect(sheet.assets.total.amount).toBe(
        sheet.totalLiabilitiesAndEquity.amount,
      )
      const flows = cashFlowStatement(journal, 0, 364)
      expect(flows.netChange.amount).toBe(
        balance(journal, CASH, { toDay: 364 }),
      )

      const charged = incomeStatement(journal, 0, 364)
        .expenses.lines.filter(({ amount }) => amount !== 0)
        .map(({ account }) => account)
      expect(charged).toEqual(
        expect.arrayContaining([
          '5200',
          '6000',
          '6100',
          '6150',
          '6200',
          '6500',
          ...charges[level],
        ]),
      )
      for (const account of absent[level]) {
        expect(charged).not.toContain(account)
      }
    },
  )
})
