import { beforeAll, describe, expect, it } from 'vitest'
import { createInitialState, tick, toCalendar } from '../src/engine/clock.ts'
import { inventoryValue } from '../src/engine/inventory.ts'
import type { Day, GameState } from '../src/engine/types.ts'
import type { AccountCode } from '../src/finance/accounts.ts'
import { balance, trialBalance } from '../src/finance/journal.ts'
import { balanceSheet, cashFlowStatement } from '../src/finance/statements.ts'
import {
  journalHash,
  simulate,
  type YearSummary,
} from '../tools/sim/simulate.ts'

// The safety net of issue #18: ten years of play for each seed, with the
// books checked against the game at the close of every day, and the same
// seed played twice to prove the engine deterministic. The whole file must
// stay under BUDGET_MS in CI; if it gets slower, make the slow part faster
// rather than checking fewer days or seeds.

const SEEDS = [1, 42, 2026]
const DAYS = 3650
const BUDGET_MS = 60_000
/** Failures kept per invariant, so a broken rule does not flood the report. */
const MAX_FAILURES = 10

const CASH: AccountCode = '1000'
const STOCKS: AccountCode = '1200'

const started = performance.now()

interface Checked {
  /** Days and calendar months whose close was checked. */
  days: number
  months: number
  failures: {
    trialBalance: string[]
    balanceSheet: string[]
    cashFlow: string[]
    stocks: string[]
  }
  checkedHash: string
  replayHash: string
  replayYears: readonly YearSummary[]
}

/**
 * Plays `DAYS` days from `seed`, checking each close against the state just
 * played, then plays the same game again with the headless runner.
 */
function check(seed: number): Checked {
  const checked: Checked = {
    days: 0,
    months: 0,
    failures: { trialBalance: [], balanceSheet: [], cashFlow: [], stocks: [] },
    checkedHash: '',
    replayHash: '',
    replayYears: [],
  }
  function fail(rule: keyof Checked['failures'], message: string) {
    const list = checked.failures[rule]
    if (list.length < MAX_FAILURES) list.push(message)
  }

  let state: GameState = createInitialState(seed)
  let monthStart: Day = 0
  while (state.day < DAYS) {
    const day = state.day
    state = tick(state)
    const { journal } = state
    checked.days += 1

    const trial = trialBalance(journal, day)
    if (trial.totalDebit !== trial.totalCredit) {
      fail(
        'trialBalance',
        `day ${day}: debits ${trial.totalDebit}, credits ${trial.totalCredit}`,
      )
    }

    const sheet = balanceSheet(journal, day)
    const assets = sheet.assets.total.amount
    const liabilitiesAndEquity = sheet.totalLiabilitiesAndEquity.amount
    if (assets !== liabilitiesAndEquity) {
      fail(
        'balanceSheet',
        `day ${day}: actifs ${assets}, passifs et capitaux propres ${liabilitiesAndEquity}`,
      )
    }

    // The ledger's own Stocks balance, read from the trial balance rather
    // than from the bilan, which is built from the same sums.
    const stocksLine = trial.lines.find(({ account }) => account === STOCKS)
    const stocks = (stocksLine?.debit ?? 0) - (stocksLine?.credit ?? 0)
    const lots = inventoryValue(state.inventory)
    if (stocks !== lots)
      fail('stocks', `day ${day}: Stocks ${stocks}, lots ${lots}`)

    const isMonthEnd =
      day === DAYS - 1 || toCalendar(day + 1).month !== toCalendar(day).month
    if (isMonthEnd) {
      checked.months += 1
      const { netChange } = cashFlowStatement(journal, monthStart, day)
      const change =
        balance(journal, CASH, { toDay: day }) -
        balance(journal, CASH, { toDay: monthStart - 1 })
      if (netChange.amount !== change) {
        fail(
          'cashFlow',
          `days ${monthStart}-${day}: net change ${netChange.amount}, Encaisse moved ${change}`,
        )
      }
      monthStart = day + 1
    }
  }

  checked.checkedHash = journalHash(state.journal)
  const replay = simulate(seed, DAYS)
  checked.replayHash = replay.journalHash
  checked.replayYears = replay.years
  return checked
}

describe.each(SEEDS)(`seed %i over ${DAYS} days`, (seed) => {
  let checked: Checked
  // Both runs of the seed happen here, so the timeout covers the whole
  // workload; the test at the end of the file holds every seed to the budget.
  beforeAll(() => {
    checked = check(seed)
  }, BUDGET_MS)

  it('checks the close of every day and every calendar month', () => {
    expect(checked.days).toBe(DAYS)
    // Day 0 is May 1st, so ten years are exactly 120 calendar months.
    expect(checked.months).toBe(120)
  })

  it('keeps the trial balance at zero every day', () => {
    expect(checked.failures.trialBalance).toEqual([])
  })

  it('keeps Actifs = Passifs + Capitaux propres every day', () => {
    expect(checked.failures.balanceSheet).toEqual([])
  })

  it("matches each month's net cash flow to the change in Encaisse", () => {
    expect(checked.failures.cashFlow).toEqual([])
  })

  it('keeps Stocks equal to the cost of the lots on hand every day', () => {
    expect(checked.failures.stocks).toEqual([])
  })

  it('posts the same journal when the seed is played again', () => {
    expect(checked.replayHash).toMatch(/^[0-9a-f]{64}$/)
    expect(checked.replayHash).toBe(checked.checkedHash)
  })

  it('sums the run up as ten whole years', () => {
    expect(
      checked.replayYears.map(({ year, fromDay, toDay }) => ({
        year,
        fromDay,
        toDay,
      })),
    ).toEqual(
      Array.from({ length: 10 }, (_, index) => ({
        year: index + 1,
        fromDay: index * 365,
        toDay: index * 365 + 364,
      })),
    )
  })
})

it(`checks every seed within ${BUDGET_MS / 1000} s`, () => {
  const elapsed = Math.round(performance.now() - started)
  console.info(
    `Invariants: ${SEEDS.length} seeds × ${DAYS} days in ${elapsed} ms`,
  )
  expect(elapsed).toBeLessThan(BUDGET_MS)
})
