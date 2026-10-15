import { beforeAll, describe, expect, it } from 'vitest'
import type { DifficultyId } from '../src/content/schema.ts'
import { createInitialState, tick, toCalendar } from '../src/engine/clock.ts'
import { FOOD_TRUCK } from '../src/engine/day.ts'
import { inventoryValue } from '../src/engine/inventory.ts'
import { add, cents, sub, type Cents } from '../src/engine/money.ts'
import { defaultProfile } from '../src/engine/profile.ts'
import type { Day, GameState } from '../src/engine/types.ts'
import type { AccountCode } from '../src/finance/accounts.ts'
import {
  balance,
  entriesOf,
  trialBalance,
  type Journal,
} from '../src/finance/journal.ts'
import { balanceSheet, cashFlowStatement } from '../src/finance/statements.ts'
import {
  journalHash,
  simulate,
  type YearSummary,
} from '../tools/sim/simulate.ts'

// The safety net of issue #18: ten years of play for each seed, each at one
// of the three difficulties, with the books checked against the game at the
// close of every day, and the same game played twice to prove the engine
// deterministic. The whole file must stay under BUDGET_MS in CI; if it gets
// slower, make the slow part faster rather than checking fewer days or
// seeds.

const GAMES: readonly { seed: number; difficulty: DifficultyId }[] = [
  { seed: 1, difficulty: 'facile' },
  { seed: 42, difficulty: 'moyen' },
  { seed: 2026, difficulty: 'difficile' },
]
const DAYS = 3650
const BUDGET_MS = 60_000
/** Failures kept per invariant, so a broken rule does not flood the report. */
const MAX_FAILURES = 10

const CASH: AccountCode = '1000'
const STOCKS: AccountCode = '1200'
const ZERO = cents(0)

const started = performance.now()

interface Checked {
  /** Days and calendar months whose close was checked. */
  days: number
  months: number
  failures: {
    trialBalance: string[]
    tally: string[]
    balanceSheet: string[]
    cashFlow: string[]
    stocks: string[]
  }
  checkedHash: string
  replayHash: string
  replayYears: readonly YearSummary[]
}

/**
 * Each account's net debits, brought up to date with the entries posted
 * since the last `count()` rather than summed again from the first entry:
 * the trial balance of every day without reading the whole journal every
 * day. Each entry counts once, in safe cents arithmetic.
 */
class Tally {
  private readonly nets = new Map<AccountCode, Cents>()
  private counted = 0

  count(journal: Journal): void {
    const entries = entriesOf(journal)
    for (const { lines } of entries.slice(this.counted)) {
      for (const { account, debit, credit } of lines) {
        this.nets.set(account, add(this.net(account), sub(debit, credit)))
      }
    }
    this.counted = entries.length
  }

  net(account: AccountCode): Cents {
    return this.nets.get(account) ?? ZERO
  }

  /** The trial balance's two columns. */
  totals(): { debit: Cents; credit: Cents } {
    let debit = ZERO
    let credit = ZERO
    for (const net of this.nets.values()) {
      if (net >= 0) debit = add(debit, net)
      else credit = sub(credit, net)
    }
    return { debit, credit }
  }
}

/**
 * Plays `DAYS` days from `seed` at `difficulty`, checking each close against
 * the state just played, then plays the same game again with the headless
 * runner.
 */
function check(seed: number, difficulty: DifficultyId): Checked {
  const checked: Checked = {
    days: 0,
    months: 0,
    failures: {
      trialBalance: [],
      tally: [],
      balanceSheet: [],
      cashFlow: [],
      stocks: [],
    },
    checkedHash: '',
    replayHash: '',
    replayYears: [],
  }
  function fail(rule: keyof Checked['failures'], message: string) {
    const list = checked.failures[rule]
    if (list.length < MAX_FAILURES) list.push(message)
  }

  let state: GameState = createInitialState(seed, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
  const tally = new Tally()
  tally.count(state.journal)
  let monthStart: Day = 0
  while (state.day < DAYS) {
    const day = state.day
    state = tick(state)
    const { journal } = state
    tally.count(journal)
    checked.days += 1

    const totals = tally.totals()
    if (totals.debit !== totals.credit) {
      fail(
        'trialBalance',
        `day ${day}: debits ${totals.debit}, credits ${totals.credit}`,
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

    // The ledger's own Stocks balance, read from the tally rather than from
    // the bilan, which is built from the same sums.
    const stocks = tally.net(STOCKS)
    const lots = inventoryValue(state.inventory)
    if (stocks !== lots)
      fail('stocks', `day ${day}: Stocks ${stocks}, lots ${lots}`)

    const isMonthEnd =
      day === DAYS - 1 || toCalendar(day + 1).month !== toCalendar(day).month
    if (isMonthEnd) {
      checked.months += 1
      // The finance module's own trial balance, account by account, so a
      // mistake in the tally cannot hide one in the books.
      const trial = trialBalance(journal, day)
      if (trial.totalDebit !== trial.totalCredit) {
        fail(
          'trialBalance',
          `day ${day}: trialBalance() debits ${trial.totalDebit}, credits ${trial.totalCredit}`,
        )
      }
      for (const { account, debit, credit } of trial.lines) {
        const net = tally.net(account)
        if (debit - credit !== net) {
          fail(
            'tally',
            `day ${day}: ${account} is ${debit - credit} in trialBalance(), ${net} in the tally`,
          )
        }
      }

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
  const replay = simulate(seed, DAYS, difficulty)
  checked.replayHash = replay.journalHash
  checked.replayYears = replay.years
  return checked
}

describe.each(GAMES)(
  `seed $seed at $difficulty over ${DAYS} days`,
  ({ seed, difficulty }) => {
    let checked: Checked
    // Both runs of the game happen here, so the timeout covers the whole
    // workload; the test at the end of the file holds every game to the budget.
    beforeAll(() => {
      checked = check(seed, difficulty)
    }, BUDGET_MS)

    it('checks the close of every day and every calendar month', () => {
      expect(checked.days).toBe(DAYS)
      // Day 0 is May 1st, so ten years are exactly 120 calendar months.
      expect(checked.months).toBe(120)
    })

    it('keeps the trial balance at zero every day', () => {
      expect(checked.failures.trialBalance).toEqual([])
    })

    it("agrees with trialBalance() on every account at each month's end", () => {
      expect(checked.failures.tally).toEqual([])
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

    it('posts the same journal when the game is played again', () => {
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
  },
)

it(`checks every game within ${BUDGET_MS / 1000} s`, () => {
  const elapsed = Math.round(performance.now() - started)
  console.info(
    `Invariants: ${GAMES.length} games × ${DAYS} days in ${elapsed} ms`,
  )
  expect(elapsed).toBeLessThan(BUDGET_MS)
})
