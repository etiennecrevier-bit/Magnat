import { beforeAll, describe, expect, it } from 'vitest'
import {
  isNoticeCard,
  type CandidateId,
  type StaffRoleId,
  type DifficultyId,
  type EventContent,
  type StreetModifierKind,
} from '../src/content/schema.ts'
import { tick, toCalendar } from '../src/engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../src/engine/day.ts'
import { GROCERS } from '../src/engine/contracts.ts'
import type { DecisionChange } from '../src/engine/decisions.ts'
import { resolveEvent } from '../src/engine/events.ts'
import { FINANCING, isLoanOpen } from '../src/engine/financing.ts'
import { inventoryValue } from '../src/engine/inventory.ts'
import { add, cents, sub, type Cents } from '../src/engine/money.ts'
import { STAFF_MEMO, askingWage } from '../src/engine/staff.ts'
import { MODIFIER_KINDS } from '../src/engine/street.ts'
import { TUTORIAL, isProtected, tutorialDay } from '../src/engine/tutorial.ts'
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
  contractChooser,
  doTutorialSteps,
  eventChooser,
  financingChooser,
  isFinancingCard,
  isTutorialCard,
  journalHash,
  simulate,
  startGame,
  tutorialChooser,
  type YearSummary,
} from '../tools/sim/simulate.ts'

// The safety net of issue #18: ten years of play for each seed, each at one
// of the three difficulties, with the books checked against the game at the
// close of every day, and the same game played twice to prove the engine
// deterministic. The event cards come up as in a real game: the grocers'
// offers and renewals all accepted (#156), so the contracts deliver and the
// grocers pay through the ten years, the emergency loan and the shares the
// engine offers when the encaisse closes below zero accepted too (#159), and
// every other card at random. Two games hire on day 0 (#158), at the wage
// each employee asks (#255), so their training and their wages post
// through the ten years and nobody quits: the first opens a bakery with an
// employee at the truck, a deliverer and a baker, so absences and the
// bakery's waste come up in every role; the second an employee at the
// truck, and it runs short of cash and borrows, long enough for Mme
// Prudhomme's letters before a bankruptcy (#160), though none of the games
// ends. The essai card sells shares too, so the investor's
// dividends post in every game. The last game starts as the tutorial (#236)
// on its own seed, its steps done each morning and Coralie's story taken,
// then goes on unprotected from day 8.
// The whole file must stay under BUDGET_MS in CI; if it gets slower, make
// the slow part faster rather than checking fewer days or seeds.

/** `candidate` hired as `role` on day 0, at the wage they ask (#255). */
function hiring(role: StaffRoleId, candidate: CandidateId): DecisionChange {
  return {
    kind: 'hire',
    role,
    candidate,
    hourlyWage: askingWage(candidate, role),
  }
}

/**
 * A bakery making the croissants, and three employees: one at the truck, a
 * deliverer and a baker. Three are more than seed 42 at Moyen can pay.
 */
const STAFFED: readonly DecisionChange[] = [
  { kind: 'openBakery', oven: 'louer' },
  { kind: 'croissantSource', source: 'fabriquer' },
  hiring('camion', 'amelie'),
  hiring('livreur', 'kevin'),
  hiring('boulanger', 'sophie'),
]

/** An employee at the truck, the game that borrows. */
const AT_TRUCK: readonly DecisionChange[] = [hiring('camion', 'mathieu')]

const GAMES: readonly {
  seed: number
  difficulty: DifficultyId
  changes: readonly DecisionChange[]
  tutorial: boolean
}[] = [
  { seed: 1, difficulty: 'facile', changes: STAFFED, tutorial: false },
  { seed: 42, difficulty: 'moyen', changes: AT_TRUCK, tutorial: false },
  // A run of months below zero, which brings Mme Prudhomme's letters: since
  // customers ask for lemonade in summer (#261), seed 2026 no longer has one.
  { seed: 2028, difficulty: 'difficile', changes: [], tutorial: false },
  { seed: TUTORIAL.seed, difficulty: 'moyen', changes: [], tutorial: true },
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
 * The essai card's weight in play: since events grew rarer and the cards
 * more numerous (#155), and the grocers' contracts came in (#156), enough
 * for every kind of change to the street and a follow-up to come up in ten
 * years.
 */
const ESSAI_WEIGHT = 8
/**
 * The shipped events with the essai card in play: it never comes up in a
 * real game, and it tries every effect.
 */
const EVENTS_IN_PLAY: EventContent = {
  ...EVENTS,
  events: EVENTS.events.map((event) =>
    event.id === 'essai' ? { ...event, weight: ESSAI_WEIGHT } : event,
  ),
}
/** Fewer events than this over ten years would leave them untested. */
const MIN_EVENTS = 100
/**
 * Fewer deliveries than this over ten years, and fewer payments from the
 * grocers, would leave the contracts untested: a year of one contract.
 */
const MIN_DELIVERIES = 50
/**
 * Fewer days than this of any kind of change to the street over ten years
 * would leave it untested. Willingness changes are the rarest: since P4-14
 * (#211), the loyalty cards bring theirs only when Gilles prints the right
 * name, and seed 42 plays 18 days of them.
 */
const MIN_MODIFIER_DAYS = 15
/**
 * Fewer weekly wages than this over ten years of a game with staff would
 * leave them untested: a year of two employees.
 */
const MIN_WAGES = 100
/**
 * Fewer dividends than this over ten years of the games would leave them
 * untested: a year of quarters.
 */
const MIN_DIVIDENDS = 4

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
    financing: string[]
    ended: string[]
    tutorial: string[]
    work: string[]
  }
  /** Events that came up, follow-ups included, and those drawn. */
  events: number
  drawn: number
  /** The days each kind of change to the street was in effect. */
  modifierDays: Record<StreetModifierKind, number>
  /** Deliveries made to the grocers, and their payments collected. */
  deliveries: number
  grocerPayments: number
  /** The employees' weekly wages paid. */
  wages: number
  /** Days an employee was absent from work, and employees who quit (#255). */
  absences: number
  quits: number
  /** The financing's cards that came up (#159). */
  financingCards: number
  /** Mme Prudhomme's letters before a bankruptcy that came up (#160). */
  notices: number
  /** The cards only the tutorial brings that came up (#236). */
  scripted: number
  /** Emergency loans taken, rounds of shares sold and dividends paid. */
  loans: number
  shareSales: number
  dividends: number
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
 * Plays `DAYS` days from `seed` at `difficulty`, the tutorial's game with
 * `tutorial`, checking each close against the state just played, then plays
 * the same game again with the headless runner.
 */
function check(
  seed: number,
  difficulty: DifficultyId,
  changes: readonly DecisionChange[],
  tutorial: boolean,
): Checked {
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
      financing: [],
      ended: [],
      tutorial: [],
      work: [],
    },
    events: 0,
    drawn: 0,
    modifierDays: Object.fromEntries(
      MODIFIER_KINDS.map((kind) => [kind, 0]),
    ) as Record<StreetModifierKind, number>,
    deliveries: 0,
    grocerPayments: 0,
    wages: 0,
    absences: 0,
    quits: 0,
    financingCards: 0,
    notices: 0,
    scripted: 0,
    loans: 0,
    shareSales: 0,
    dividends: 0,
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

  let state: GameState = startGame(
    seed,
    difficulty,
    changes,
    DIFFICULTIES,
    tutorial,
  )
  const tally = new Tally()
  tally.count(state.journal)
  const choose = tutorialChooser(
    financingChooser(
      'accept',
      contractChooser('all', eventChooser('random', seed)),
    ),
  )
  const grocerPayments = new Set(
    Object.values(GROCERS.grocers).map(({ name }) => `Encaissement · ${name}`),
  )
  const { firstDay, minDaysBetween } = EVENTS_IN_PLAY.pacing
  let lastDrawn: Day | null = null
  let monthStart: Day = 0
  while (state.day < DAYS) {
    const day = state.day
    const dayStarted = performance.now()
    const { pending } = state.events
    if (pending !== null) {
      checked.events += 1
      const card = EVENTS_IN_PLAY.events.find(({ id }) => id === pending.event)
      if (card === undefined) throw new Error(`Unknown event ${pending.event}`)
      if (isProtected(state) && !isTutorialCard(card)) {
        fail('tutorial', `day ${day}: ${card.id} during the tutorial`)
      }
      if (isTutorialCard(card)) {
        // The tutorial brings it on its day, as a draw that morning.
        checked.scripted += 1
        const scripted = TUTORIAL.scriptedEvents.find(
          ({ event }) => event === card.id,
        )
        if (!isProtected(state) || scripted?.day !== tutorialDay(state)) {
          fail('tutorial', `day ${day}: ${card.id} off its tutorial day`)
        }
        lastDrawn = day
      } else if (isFinancingCard(card) || isNoticeCard(card)) {
        // The engine brings it the morning after a close below zero,
        // whatever the first day and the gap, as a draw that morning: the
        // next card drawn keeps its gap from it.
        if (isNoticeCard(card)) checked.notices += 1
        else checked.financingCards += 1
        if (state.financing.belowZeroSince === null) {
          fail('financing', `day ${day}: ${card.id} after a close above zero`)
        }
        lastDrawn = day
      } else if (!pending.followUp) {
        checked.drawn += 1
        if (day < firstDay) {
          fail('pacing', `day ${day}: an event before day ${firstDay}`)
        }
        // An event dated that day comes whatever the gap (#155).
        const { date } = card.conditions ?? {}
        const { month, dayOfMonth } = toCalendar(day)
        const dated = date?.month === month && date.dayOfMonth === dayOfMonth
        if (!dated && lastDrawn !== null && day - lastDrawn < minDaysBetween) {
          fail(
            'pacing',
            `day ${day}: an event ${day - lastDrawn} days after the last`,
          )
        }
        lastDrawn = day
      }
      state = resolveEvent(state, choose(card), EVENTS_IN_PLAY)
    }
    state = doTutorialSteps(state)
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
    if (state.ended !== null) {
      fail('ended', `day ${day}: the game ended in ${state.ended.reason}`)
      break
    }
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

    const played = state.lastDay
    checked.deliveries += played?.deliveries.length ?? 0

    // What each person did (#283) adds up to the day's sales and
    // deliveries.
    if (played !== null) {
      const people = played.work ?? []
      const sales = people.reduce(
        (total, person) => add(total, person.sales),
        ZERO,
      )
      const invoiced = people.reduce(
        (total, person) => add(total, person.invoiced),
        ZERO,
      )
      const owed = played.deliveries.reduce(
        (total, { amount }) => add(total, amount),
        ZERO,
      )
      if (sales !== played.revenue || invoiced !== owed) {
        fail(
          'work',
          `day ${day}: people sold ${sales} of ${played.revenue}, invoiced ${invoiced} of ${owed}`,
        )
      }
    }
    const today = entriesSince(journal, day).filter(
      (entry) => entry.day === day,
    )
    checked.grocerPayments += today.filter(({ memo }) =>
      grocerPayments.has(memo),
    ).length
    checked.absences += state.lastDay?.absent?.length ?? 0
    checked.quits += state.lastDay?.quits?.length ?? 0
    checked.wages += today.filter(({ memo }) =>
      memo.startsWith(`${STAFF_MEMO.wage} · `),
    ).length
    checked.dividends += today.filter(({ memo }) =>
      memo.startsWith('Dividende · '),
    ).length

    // The financing within its limits: two rounds of shares at most, no
    // loan taken while another is open, and one loan a game at Difficile.
    const { loans, shareSales } = state.financing
    if (shareSales.length > FINANCING.maxShareRounds) {
      fail('financing', `day ${day}: ${shareSales.length} rounds of shares`)
    }
    const overlapping = loans.findIndex(
      (loan, index) =>
        index > 0 && isLoanOpen(loans[index - 1] ?? loan, loan.day),
    )
    if (overlapping !== -1) {
      fail('financing', `day ${day}: loan ${overlapping + 1} while one is open`)
    }
    if (FINANCING.noSecondLoanAt.includes(difficulty) && loans.length > 1) {
      fail('financing', `day ${day}: ${loans.length} loans at ${difficulty}`)
    }

    // The street as the changes in effect left it: a closed truck sells
    // nothing, and a product that cannot be sold is not.
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

  if (tutorial && state.tutorial?.done !== true) {
    fail('tutorial', 'the tutorial never ended')
  }
  checked.loans = state.financing.loans.length
  checked.shareSales = state.financing.shareSales.length
  checked.checkedHash = journalHash(state.journal)
  const replay = simulate(
    seed,
    DAYS,
    difficulty,
    changes,
    'random',
    EVENTS_IN_PLAY,
    DIFFICULTIES,
    'all',
    'accept',
    tutorial,
  )
  checked.replayHash = replay.journalHash
  checked.replayYears = replay.years
  return checked
}

/** Every game checked, for the tests over all of them at the end. */
const CHECKED: Checked[] = []

describe.each(GAMES)(
  `seed $seed at $difficulty, tutorial $tutorial, over ${DAYS} days`,
  ({ seed, difficulty, changes, tutorial }) => {
    let checked: Checked
    // Both runs of the game happen here, so the timeout covers the whole
    // workload; the test at the end of the file holds every game to the budget.
    beforeAll(() => {
      checked = check(seed, difficulty, changes, tutorial)
      CHECKED.push(checked)
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

    it('delivers to the grocers, who pay for what they got', () => {
      expect(checked.deliveries).toBeGreaterThanOrEqual(MIN_DELIVERIES)
      expect(checked.grocerPayments).toBeGreaterThanOrEqual(MIN_DELIVERIES)
    })

    it('pays the staff hired on day 0 each week, and no wage without', () => {
      const hired = changes.some(({ kind }) => kind === 'hire')
      expect(checked.wages).toBeGreaterThanOrEqual(hired ? MIN_WAGES : 0)
      expect(checked.wages).toBeLessThanOrEqual(
        hired ? Number.POSITIVE_INFINITY : 0,
      )
    })

    it('keeps the staff paid what they ask, so none quits, though some days one is absent', () => {
      const hired = changes.some(({ kind }) => kind === 'hire')
      expect(checked.quits).toBe(0)
      if (hired) expect(checked.absences).toBeGreaterThan(0)
      else expect(checked.absences).toBe(0)
    })

    it('keeps the financing within its limits, its cards and the letters only after a close below zero', () => {
      expect(checked.failures.financing).toEqual([])
    })

    it('protects the tutorial’s seven days, brings its card on its day only, and ends it', () => {
      expect(checked.failures.tutorial).toEqual([])
      expect(checked.scripted).toBe(tutorial ? 1 : 0)
    })

    it('splits each day’s sales and deliveries among the people who made them', () => {
      expect(checked.failures.work).toEqual([])
    })

    it('plays the ten years without going bankrupt', () => {
      expect(checked.failures.ended).toEqual([])
    })

    it(`draws events from day ${EVENTS_IN_PLAY.pacing.firstDay} on, at least ${EVENTS_IN_PLAY.pacing.minDaysBetween} days apart, follow-ups, dated events, the financing's and the letters aside`, () => {
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

it('brings the financing, takes an emergency loan, sells shares and pays dividends over the games', () => {
  expect(CHECKED).toHaveLength(GAMES.length)
  const total = (
    field: 'financingCards' | 'loans' | 'shareSales' | 'dividends',
  ) => CHECKED.reduce((sum, checked) => sum + checked[field], 0)
  expect(total('financingCards')).toBeGreaterThan(0)
  expect(total('loans')).toBeGreaterThan(0)
  expect(total('shareSales')).toBeGreaterThan(0)
  expect(total('dividends')).toBeGreaterThanOrEqual(MIN_DIVIDENDS)
})

it("brings Mme Prudhomme's letters over the games, which a run of months below zero earns", () => {
  expect(CHECKED).toHaveLength(GAMES.length)
  const notices = CHECKED.reduce((sum, checked) => sum + checked.notices, 0)
  expect(notices).toBeGreaterThan(0)
})

it(`checks every game within ${BUDGET_MS / 1000} s`, () => {
  const elapsed = Math.round(performance.now() - started)
  console.info(
    `Invariants: ${GAMES.length} games × ${DAYS} days in ${elapsed} ms`,
  )
  expect(elapsed).toBeLessThan(BUDGET_MS)
})
