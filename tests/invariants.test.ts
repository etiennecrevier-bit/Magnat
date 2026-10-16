import { beforeAll, describe, expect, it } from 'vitest'
import type {
  DifficultyId,
  EventContent,
  StreetModifierKind,
} from '../src/content/schema.ts'
import { createInitialState, tick, toCalendar } from '../src/engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../src/engine/day.ts'
import { resolveEvent } from '../src/engine/events.ts'
import { inventoryValue } from '../src/engine/inventory.ts'
import { add, cents, sub, type Cents } from '../src/engine/money.ts'
import { defaultProfile } from '../src/engine/profile.ts'
import { MODIFIER_KINDS } from '../src/engine/street.ts'
import type { Day, GameState } from '../src/engine/types.ts'
import type { AccountCode } from '../src/finance/accounts.ts'
import {
  balance,
  entriesSince,
  trialBalance,
  type Journal,
} from '../src/finance/journal.ts'
import { balanceSheet, cashFlowStatement } from '../src/finance/statements.ts'
import {
  eventChooser,
  journalHash,
  simulate,
  type YearSummary,
} from '../tools/sim/simulate.ts'

// The safety net of issue #18: ten years of play for each seed, each at one
// of the three difficulties, with the books checked against the game at the
// close of every day, and the same game played twice to prove the engine
// deterministic. The event cards come up as in a real game, answered at
// random as `npm run sim -- --events random` does. The whole file must stay
// under BUDGET_MS in CI; if it gets slower, make the slow part faster rather
// than checking fewer days or seeds.

const GAMES: readonly { seed: number; difficulty: DifficultyId }[] = [
  { seed: 1, difficulty: 'facile' },
  { seed: 42, difficulty: 'moyen' },
  { seed: 2026, difficulty: 'difficile' },
]
const DAYS = 3650
const BUDGET_MS = 60_000
/**
 * How many times longer a day of the last year may take than a day of the
 * first, to play and to check. Unlike the budget, this does not depend on
 * the runner's speed: it catches a cost that grows with the game, such as
 * reading or copying the whole journal every day, which makes ten years cost
 * far more than ten times one (issue #176).
 */
const MAX_SLOWDOWN = 3
const YEAR = 365
/** Failures kept per invariant, so a broken rule does not flood the report. */
const MAX_FAILURES = 10

const CASH: AccountCode = '1000'
const RECEIVABLES: AccountCode = '1100'
const STOCKS: AccountCode = '1200'
const ZERO = cents(0)

/**
 * The shipped events with the essai card in play: it never comes up in a
 * real game, and it tries every effect.
 */
const EVENTS_IN_PLAY: EventContent = {
  ...EVENTS,
  events: EVENTS.events.map((event) =>
    event.id === 'essai' ? { ...event, weight: 1 } : event,
  ),
}
/** Fewer events than this over ten years would leave them untested. */
const MIN_EVENTS = 100
/**
 * Fewer days than this of any kind of change to the street over ten years
 * would leave it untested.
 */
const MIN_MODIFIER_DAYS = 20

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
    receivables: string[]
    pacing: string[]
    street: string[]
  }
  /** Events that came up, follow-ups included, and those drawn. */
  events: number
  drawn: number
  /** The days each kind of change to the street was in effect. */
  modifierDays: Record<StreetModifierKind, number>
  /** Milliseconds each day took to play, then to check, in day order. */
  playMs: number[]
  checkMs: number[]
  checkedHash: string
  replayHash: string
  replayYears: readonly YearSummary[]
}

/**
 * How many times longer the median day of the last year took than the median
 * day of the first: the median, so a garbage collection or a busy runner on
 * a few days does not count.
 */
function slowdown(dayMs: readonly number[]): number {
  return median(dayMs.slice(-YEAR)) / median(dayMs.slice(0, YEAR))
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * Each account's net debits, brought up to date with the entries posted
 * since the last `count()` rather than summed again from the first entry:
 * the trial balance of every day without reading the whole journal every
 * day. Each entry counts once, in safe cents arithmetic.
 */
class Tally {
  private readonly nets = new Map<AccountCode, Cents>()
  /** The day of the last entry counted, and how many counted are on it. */
  private lastDay: Day = 0
  private onLastDay = 0

  count(journal: Journal): void {
    // Days never go down, so the entries posted since the last count come
    // after those counted on the last day counted: read from that day on
    // only, as `entriesOf()` would copy the whole journal every day.
    const posted = entriesSince(journal, this.lastDay).slice(this.onLastDay)
    for (const { day, lines } of posted) {
      for (const { account, debit, credit } of lines) {
        this.nets.set(account, add(this.net(account), sub(debit, credit)))
      }
      this.onLastDay = day === this.lastDay ? this.onLastDay + 1 : 1
      this.lastDay = day
    }
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
      receivables: [],
      pacing: [],
      street: [],
    },
    events: 0,
    drawn: 0,
    modifierDays: Object.fromEntries(
      MODIFIER_KINDS.map((kind) => [kind, 0]),
    ) as Record<StreetModifierKind, number>,
    playMs: [],
    checkMs: [],
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
  const choose = eventChooser('random', seed)
  const { firstDay, minDaysBetween } = EVENTS_IN_PLAY.pacing
  let lastDrawn: Day | null = null
  let monthStart: Day = 0
  while (state.day < DAYS) {
    const day = state.day
    const dayStarted = performance.now()
    const { pending } = state.events
    if (pending !== null) {
      checked.events += 1
      if (!pending.followUp) {
        checked.drawn += 1
        if (day < firstDay) {
          fail('pacing', `day ${day}: an event before day ${firstDay}`)
        }
        if (lastDrawn !== null && day - lastDrawn < minDaysBetween) {
          fail(
            'pacing',
            `day ${day}: an event ${day - lastDrawn} days after the last`,
          )
        }
        lastDrawn = day
      }
      const card = EVENTS_IN_PLAY.events.find(({ id }) => id === pending.event)
      if (card === undefined) throw new Error(`Unknown event ${pending.event}`)
      state = resolveEvent(state, choose(card), EVENTS_IN_PLAY)
    }
    state = tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      EVENTS_IN_PLAY,
    )
    const dayPlayed = performance.now()
    checked.playMs.push(dayPlayed - dayStarted)
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

    // Comptes clients, read from the tally, against what customers owe.
    const owed = tally.net(RECEIVABLES)
    const receivables = state.receivables.reduce(
      (total, { amount }) => add(total, amount),
      ZERO,
    )
    if (owed !== receivables) {
      fail(
        'receivables',
        `day ${day}: Comptes clients ${owed}, receivables ${receivables}`,
      )
    }

    // The street as the changes in effect left it: a closed truck sells
    // nothing, and a product that cannot be sold is not.
    const played = state.lastDay
    const kinds = new Set(played?.modifiers.map(({ change }) => change.kind))
    for (const kind of kinds) checked.modifierDays[kind] += 1
    for (const { change } of played?.modifiers ?? []) {
      if (change.kind === 'closed' && (played?.visits.length ?? 0) > 0) {
        fail(
          'street',
          `day ${day}: closed, with ${played?.visits.length} visits`,
        )
      }
      if (
        change.kind === 'unavailable' &&
        (played?.sold[change.product] ?? 0) > 0
      ) {
        fail('street', `day ${day}: ${change.product} sold while unavailable`)
      }
    }

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
    checked.checkMs.push(performance.now() - dayPlayed)
  }

  checked.checkedHash = journalHash(state.journal)
  const replay = simulate(seed, DAYS, difficulty, [], 'random', EVENTS_IN_PLAY)
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

    it('keeps Comptes clients equal to what customers owe every day', () => {
      expect(checked.failures.receivables).toEqual([])
    })

    it(`draws events from day ${EVENTS_IN_PLAY.pacing.firstDay} on, at least ${EVENTS_IN_PLAY.pacing.minDaysBetween} days apart, follow-ups aside`, () => {
      expect(checked.events).toBeGreaterThanOrEqual(MIN_EVENTS)
      expect(checked.events).toBeGreaterThan(checked.drawn)
      expect(checked.failures.pacing).toEqual([])
    })

    it('changes the street with every kind of change, closing and taking products off sale', () => {
      for (const kind of MODIFIER_KINDS) {
        expect(checked.modifierDays[kind], kind).toBeGreaterThanOrEqual(
          MIN_MODIFIER_DAYS,
        )
      }
      expect(checked.failures.street).toEqual([])
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

    it(`plays a day of the last year within ${MAX_SLOWDOWN} times a day of the first`, () => {
      expect(slowdown(checked.playMs)).toBeLessThan(MAX_SLOWDOWN)
    })

    it(`checks a day of the last year within ${MAX_SLOWDOWN} times a day of the first`, () => {
      expect(slowdown(checked.checkMs)).toBeLessThan(MAX_SLOWDOWN)
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
