import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cents, type Cents } from '../engine/money.ts'
import { loanSchedule, type LoanSchedule } from './loan.ts'

const MAX = Number.MAX_SAFE_INTEGER

// Each month's [interest, principal] of the Moyen startup loan (#44): 70 000 $
// at 8 % over 5 years. Worked out apart from loan.ts, with a spreadsheet's
// formulas in float arithmetic, and again with exact fractions; both give
// these 60 rows:
//   payment     =ROUND(PMT(8%/12; 60; -70000); 2)        1 419,35 $
//   interest    =ROUND(balance * 8%/12; 2)
//   principal   =payment - interest, the balance in the last month
//   balance     =previous balance - principal
const STARTUP_LOAN: [number, number][] = [
  [46_667, 95_268],
  [46_032, 95_903],
  [45_392, 96_543],
  [44_749, 97_186],
  [44_101, 97_834],
  [43_448, 98_487],
  [42_792, 99_143],
  [42_131, 99_804],
  [41_466, 100_469],
  [40_796, 101_139],
  [40_121, 101_814],
  [39_443, 102_492],
  [38_759, 103_176],
  [38_072, 103_863],
  [37_379, 104_556],
  [36_682, 105_253],
  [35_980, 105_955],
  [35_274, 106_661],
  [34_563, 107_372],
  [33_847, 108_088],
  [33_127, 108_808],
  [32_401, 109_534],
  [31_671, 110_264],
  [30_936, 110_999],
  [30_196, 111_739],
  [29_451, 112_484],
  [28_701, 113_234],
  [27_946, 113_989],
  [27_186, 114_749],
  [26_421, 115_514],
  [25_651, 116_284],
  [24_876, 117_059],
  [24_096, 117_839],
  [23_310, 118_625],
  [22_519, 119_416],
  [21_723, 120_212],
  [20_922, 121_013],
  [20_115, 121_820],
  [19_303, 122_632],
  [18_485, 123_450],
  [17_662, 124_273],
  [16_834, 125_101],
  [16_000, 125_935],
  [15_160, 126_775],
  [14_315, 127_620],
  [13_464, 128_471],
  [12_608, 129_327],
  [11_746, 130_189],
  [10_878, 131_057],
  [10_004, 131_931],
  [9_124, 132_811],
  [8_239, 133_696],
  [7_348, 134_587],
  [6_450, 135_485],
  [5_547, 136_388],
  [4_638, 137_297],
  [3_723, 138_212],
  [2_801, 139_134],
  [1_874, 140_061],
  [940, 140_980],
]

// 10 000 $ at 12 % over a year, worked out the same way: payment 888,49 $.
const YEAR_LOAN: [number, number][] = [
  [10_000, 78_849],
  [9_212, 79_637],
  [8_415, 80_434],
  [7_611, 81_238],
  [6_798, 82_051],
  [5_978, 82_871],
  [5_149, 83_700],
  [4_312, 84_537],
  [3_467, 85_382],
  [2_613, 86_236],
  [1_751, 87_098],
  [880, 87_967],
]

/** Each month's [interest, principal]. */
function pairs({ payments }: LoanSchedule): [number, number][] {
  return payments.map(({ interest, principal }) => [interest, principal])
}

/** Each month's [payment, interest, principal, balance]. */
function rows({ payments }: LoanSchedule): number[][] {
  return payments.map(({ payment, interest, principal, balance }) => [
    payment,
    interest,
    principal,
    balance,
  ])
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeepFrozen(child)
}

describe('loanSchedule', () => {
  it('matches a spreadsheet for the startup loan, cent for cent', () => {
    const schedule = loanSchedule(cents(7_000_000), 800, 60)
    expect(schedule.monthlyPayment).toBe(141_935)
    expect(pairs(schedule)).toEqual(STARTUP_LOAN)
    expect(schedule.payments.map(({ month }) => month)).toEqual(
      Array.from({ length: 60 }, (_, index) => index + 1),
    )
    expect(schedule.payments[0]).toEqual({
      month: 1,
      payment: 141_935,
      interest: 46_667,
      principal: 95_268,
      balance: 6_904_732,
    })
    expect(schedule.payments[11]?.balance).toBe(5_813_918)
    expect(schedule.payments.at(-1)).toEqual({
      month: 60,
      payment: 141_920,
      interest: 940,
      principal: 140_980,
      balance: 0,
    })
    const total = (key: 'interest' | 'principal') =>
      schedule.payments.reduce((sum, payment) => sum + payment[key], 0)
    expect(total('interest')).toBe(1_516_085)
    expect(total('principal')).toBe(7_000_000)
  })

  it('matches a spreadsheet at another rate and term', () => {
    const schedule = loanSchedule(cents(1_000_000), 1_200, 12)
    expect(schedule.monthlyPayment).toBe(88_849)
    expect(pairs(schedule)).toEqual(YEAR_LOAN)
    expect(schedule.payments.at(-1)?.payment).toBe(88_847)
  })

  it('splits a loan without interest into equal payments, the last taking the rest', () => {
    const schedule = loanSchedule(cents(1_000_000), 0, 12)
    expect(schedule.monthlyPayment).toBe(83_333)
    expect(schedule.payments.map(({ payment }) => payment)).toEqual([
      ...Array<number>(11).fill(83_333),
      83_337,
    ])
    expect(schedule.payments.every(({ interest }) => interest === 0)).toBe(true)
  })

  it('pays a one-month loan back with a month of interest', () => {
    expect(rows(loanSchedule(cents(1_000_000), 800, 1))).toEqual([
      [1_006_667, 6_667, 1_000_000, 0],
    ])
  })

  it('rounds half a cent of interest up', () => {
    // 75 × 8 % / 12 = 0,5 cent.
    const schedule = loanSchedule(cents(75), 800, 1)
    expect(schedule.monthlyPayment).toBe(76)
    expect(rows(schedule)).toEqual([[76, 1, 75, 0]])
  })

  it('pays off early, then pays zero, when the payment rounds up', () => {
    // Half a cent a month rounds up to a cent.
    const schedule = loanSchedule(cents(1), 0, 2)
    expect(schedule.monthlyPayment).toBe(1)
    expect(rows(schedule)).toEqual([
      [1, 0, 1, 0],
      [0, 0, 0, 0],
    ])
  })

  it('stays exact at the largest rate', () => {
    // The interest, 1 000 × MAX / 120 000 = 75 059 993 789 508,26, takes the
    // whole payment in the first month.
    const schedule = loanSchedule(cents(1_000), MAX, 2)
    expect(schedule.monthlyPayment).toBe(75_059_993_789_508)
    expect(rows(schedule)).toEqual([
      [75_059_993_789_508, 75_059_993_789_508, 0, 1_000],
      [75_059_993_790_508, 75_059_993_789_508, 1_000, 0],
    ])
  })

  it('gives the same frozen schedule for the same inputs', () => {
    const schedule = loanSchedule(cents(7_000_000), 800, 60)
    expect(loanSchedule(cents(7_000_000), 800, 60)).toEqual(schedule)
    expectDeepFrozen(schedule)
  })

  it.each([0, -1, 1.5, NaN, Infinity, MAX + 1])(
    'rejects a principal of %s',
    (principal) => {
      expect(() => loanSchedule(principal as Cents, 800, 60)).toThrow(
        RangeError,
      )
    },
  )

  it.each([-1, 1.5, NaN, Infinity, MAX + 1])('rejects a rate of %s', (rate) => {
    expect(() => loanSchedule(cents(7_000_000), rate, 60)).toThrow(RangeError)
  })

  it.each([0, -1, 1.5, NaN, Infinity, MAX + 1])(
    'rejects a term of %s months',
    (months) => {
      expect(() => loanSchedule(cents(7_000_000), 800, months)).toThrow(
        RangeError,
      )
    },
  )

  it('throws when the payment leaves the safe integer range', () => {
    // 100 % a month on the largest principal doubles it.
    expect(() => loanSchedule(cents(MAX), 120_000, 1)).toThrow(RangeError)
  })
})

// Bounds keep every run small: terms up to 30 years and rates up to 50 %,
// with small principals often enough to pay some loans off early.
const MAX_MONTHS = 360
const MAX_RATE = 5_000
const MAX_PRINCIPAL = 1_000_000_000
const NUM_RUNS = 200

const loans = fc.record({
  principal: fc.oneof(
    fc.integer({ min: 1, max: 100 }),
    fc.integer({ min: 1, max: MAX_PRINCIPAL }),
  ),
  rate: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: MAX_RATE })),
  months: fc.oneof(fc.constant(1), fc.integer({ min: 1, max: MAX_MONTHS })),
})

describe('loanSchedule properties', () => {
  it('pays back the principal, each payment being its interest and principal', () => {
    fc.assert(
      fc.property(loans, ({ principal, rate, months }) => {
        const { payments } = loanSchedule(cents(principal), rate, months)
        expect(payments).toHaveLength(months)
        let balance = principal
        for (const row of payments) {
          expect(row.payment).toBe(row.interest + row.principal)
          expect(row.interest).toBeGreaterThanOrEqual(0)
          expect(row.principal).toBeGreaterThanOrEqual(0)
          balance -= row.principal
          expect(row.balance).toBe(balance)
          expect(row.balance).toBeGreaterThanOrEqual(0)
        }
        expect(balance).toBe(0)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it("charges each month's interest on the balance before it, rounded half up", () => {
    fc.assert(
      fc.property(loans, ({ principal, rate, months }) => {
        let balance = BigInt(principal)
        for (const row of loanSchedule(cents(principal), rate, months)
          .payments) {
          // 12 months × 10 000 basis points.
          const exact = balance * BigInt(rate)
          const rounded = (2n * exact + 120_000n) / 240_000n
          expect(BigInt(row.interest)).toBe(rounded)
          balance = BigInt(row.balance)
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('pays the monthly payment every month but the last, until the loan is paid off', () => {
    fc.assert(
      fc.property(loans, ({ principal, rate, months }) => {
        const { monthlyPayment, payments } = loanSchedule(
          cents(principal),
          rate,
          months,
        )
        let before = principal
        for (const row of payments.slice(0, -1)) {
          if (row.payment !== monthlyPayment) {
            // Paid off: what was left, and nothing after.
            expect(row.principal).toBe(before)
            expect(row.balance).toBe(0)
          }
          before = row.balance
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })
})

// Keeps the generator honest: it must reach the cases the properties rely
// on, or a passing run proves less than it seems.
describe('loan property generator', () => {
  const samples = fc.sample(loans, { numRuns: 500, seed: 42 })

  it('draws loans without interest, one-month loans and loans paid off early', () => {
    expect(samples.some(({ rate }) => rate === 0)).toBe(true)
    expect(samples.some(({ months }) => months === 1)).toBe(true)
    expect(
      samples.some(({ principal, rate, months }) =>
        loanSchedule(cents(principal), rate, months)
          .payments.slice(0, -1)
          .some(({ balance }) => balance === 0),
      ),
    ).toBe(true)
  })
})
