import {
  loadFinancingContent,
  type EventContent,
  type EventEffect,
  type FinancingContent,
  type FoodTruckContent,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  balance,
  entriesOf,
  postEntry,
  type Journal,
  type JournalEntry,
} from '../finance/journal.ts'
import { loanSchedule } from '../finance/loan.ts'
import { incomeStatement } from '../finance/statements.ts'
import {
  gameYearOf,
  monthsSinceStart,
  startOfQuarter,
  toCalendar,
} from './calendar.ts'
import { BAKERY } from './bakery.ts'
import { DIFFICULTIES } from './day.ts'
import { truckReplacedOn } from './dream.ts'
import { monthlyFixedCosts } from './fixedCosts.ts'
import { add, cents, mulRatio, sub, type Cents } from './money.ts'
import { credit, debit } from './posting.ts'
import type {
  Day,
  EmergencyLoan,
  FinancingState,
  GameState,
  ShareSale,
} from './types.ts'

// The two expensive ways out of a negative encaisse (#159). The morning
// after a close below zero, the engine brings Mme Prudhomme's emergency
// loan, once a game year, or Max Duvent's offer for shares when she
// refuses; Max also comes back some days after her loan if the encaisse is
// still below zero. Both are event cards the player may refuse. A loan is
// paid back each 1st, as the startup loan is; shares sold pay the investor
// their share of each quarter's profit, for good. Nothing here draws from
// the generator.

/**
 * The shipped rules of the emergency loan and the share sale, validated
 * once against the shipped event cards when the engine loads.
 */
export const FINANCING: FinancingContent = loadFinancingContent()

const CASH: AccountCode = '1000'
const BANK_LOANS: AccountCode = '2500'
const SHARE_CAPITAL: AccountCode = '3000'
const RETAINED_EARNINGS: AccountCode = '3100'
const BANK_FEES: AccountCode = '6500'
const INTEREST: AccountCode = '7000'

// A calendar fact, not a tunable: the months that start a quarter, whose
// 1st pays the quarter before its dividends.
const QUARTER_MONTHS: readonly number[] = [1, 4, 7, 10]

const ZERO = cents(0)

/**
 * The memos of the financing's entries, as the player reads them, each
 * followed by the lender's or the investor's name (see `financingMemo`).
 */
export const FINANCING_MEMO = {
  loan: "Emprunt d'urgence",
  fee: 'Frais de dossier',
  interest: 'Intérêts',
  principal: 'Remboursement',
  shares: "Émission d'actions",
  dividend: 'Dividende',
} as const

/**
 * The memo of `what` for the lender or investor `name`: « Dividende ·
 * Duvent Capital ».
 */
export function financingMemo(what: string, name: string): string {
  return `${what} · ${name}`
}

/** The financing of a game that has taken none, nor closed a day. */
export function noFinancing(): FinancingState {
  return {
    loans: [],
    shareSales: [],
    belowZeroSince: null,
    lastLoanRequestDay: null,
  }
}

type LoanEffect = Extract<EventEffect, { kind: 'emergencyLoan' }>
type ShareEffect = Extract<EventEffect, { kind: 'shareSale' }>

/**
 * The morning of `state.day` with the card the financing brings waiting,
 * as if drawn that morning; `state` itself when it brings none. Only after
 * a close below zero (see `belowZeroSince`), while no event waits nor was
 * chosen that morning, and only cards `events` holds:
 * - The lender of `rules.loanEvent` comes on the first such morning of a
 *   game year (see `gameYearOf`), which becomes `lastLoanRequestDay`. She
 *   offers her loan if she may (see `mayLend`); otherwise the investor of
 *   `investorEvent` comes in her place, while rounds are left (see
 *   `maxShareRounds`).
 * - Otherwise the investor comes `investorDaysAfterLoan` days after the
 *   last emergency loan, while rounds are left.
 * Returns a new state; never mutates `state`.
 */
export function financingOffer(
  state: GameState,
  events: EventContent,
  rules: FinancingContent = FINANCING,
): GameState {
  const { day, financing } = state
  if (
    financing.belowZeroSince === null ||
    state.events.pending !== null ||
    state.events.history.at(-1)?.day === day
  ) {
    return state
  }
  const holds = (id: string) => events.events.some((card) => card.id === id)
  const investorComes =
    financing.shareSales.length < rules.maxShareRounds &&
    holds(rules.investorEvent)
  const { lastLoanRequestDay } = financing
  if (
    holds(rules.loanEvent) &&
    (lastLoanRequestDay === null ||
      gameYearOf(lastLoanRequestDay) < gameYearOf(day))
  ) {
    const visited: GameState = {
      ...state,
      financing: { ...financing, lastLoanRequestDay: day },
    }
    if (mayLend(state, rules)) return withOffer(visited, rules.loanEvent)
    return investorComes ? withOffer(visited, rules.investorEvent) : visited
  }
  const last = financing.loans.at(-1)
  if (
    investorComes &&
    last !== undefined &&
    day === last.day + rules.investorDaysAfterLoan
  ) {
    return withOffer(state, rules.investorEvent)
  }
  return state
}

/**
 * Whether the lender of the emergency loan lends on the morning of
 * `state.day`: no emergency loan is still open (see `isLoanOpen`), and the
 * game's difficulty is not one of `rules.noSecondLoanAt` once she lent.
 */
export function mayLend(
  { day, financing, profile }: Pick<GameState, 'day' | 'financing' | 'profile'>,
  rules: FinancingContent = FINANCING,
): boolean {
  const { loans } = financing
  if (loans.some((loan) => isLoanOpen(loan, day))) return false
  return (
    loans.length === 0 || !rules.noSecondLoanAt.includes(profile.difficulty)
  )
}

/**
 * Whether `loan` is still open on the morning of `day`: up to the morning
 * of its last payment, that one included.
 */
export function isLoanOpen(
  { day: taken, termMonths }: Pick<EmergencyLoan, 'day' | 'termMonths'>,
  day: Day,
): boolean {
  const months = monthsSinceStart(day) - monthsSinceStart(taken)
  return (
    months < termMonths ||
    (months === termMonths && toCalendar(day).dayOfMonth === 1)
  )
}

/**
 * Takes the emergency loan `effect` offers on the morning of `state.day`,
 * if its lender may lend (see `mayLend`, with `rules`): enough to bring
 * Encaisse to `monthsOfFixedCosts` months of the fixed costs the next 1st
 * takes (see `monthlyFixedCosts`, with `content`, the game's bakery and
 * its truck, which a rung of « Le rêve » may have replaced),
 * `maxCents` at most, with `feeShare` of it as its fee. Its entries post
 * (see `loanEntries`) and it joins `financing.loans` with its terms.
 * Nothing when Encaisse already holds that much. Returns a new state;
 * never mutates `state`.
 */
export function takeEmergencyLoan(
  state: GameState,
  effect: LoanEffect,
  content: FoodTruckContent,
  rules: FinancingContent = FINANCING,
): GameState {
  if (!mayLend(state, rules)) return state
  const { day, journal, financing } = state
  const { lender, maxCents, annualRateBasisPoints, termMonths } = effect
  const fixedCosts = monthlyFixedCosts(
    day,
    state.profile.difficulty,
    state.challenge?.startDay ?? 0,
    content,
    DIFFICULTIES,
    state.bakery,
    BAKERY,
    truckReplacedOn(state.dream),
  )
  const wanted = sub(
    mulRatio(fixedCosts, effect.monthsOfFixedCosts),
    balance(journal, CASH, { toDay: day }),
  )
  const principal = wanted < maxCents ? wanted : maxCents
  if (principal <= 0) return state
  const loan: EmergencyLoan = {
    day,
    lender,
    principal,
    annualRateBasisPoints,
    termMonths,
    fee: mulRatio(principal, effect.feeShare),
  }
  return {
    ...state,
    journal: postAll(journal, loanEntries(loan)),
    financing: { ...financing, loans: [...financing.loans, loan] },
  }
}

/**
 * Sells the shares `effect` offers on the morning of `state.day`, while
 * fewer than `rules.maxShareRounds` rounds were sold: its entry posts (see
 * `saleEntries`) and the sale joins `financing.shareSales` with its terms.
 * Returns a new state; never mutates `state`.
 */
export function sellShares(
  state: GameState,
  effect: ShareEffect,
  rules: FinancingContent = FINANCING,
): GameState {
  const { day, journal, financing } = state
  if (financing.shareSales.length >= rules.maxShareRounds) return state
  const { investor, amountCents: amount, share } = effect
  const sale: ShareSale = { day, investor, amount, share }
  return {
    ...state,
    journal: postAll(journal, saleEntries(sale)),
    financing: { ...financing, shareSales: [...financing.shareSales, sale] },
  }
}

/**
 * The entries of `loan` on the morning it was taken: « Emprunt d'urgence ·
 * {lender} », Dr 1000 Encaisse / Cr 2500 Emprunts bancaires, then « Frais
 * de dossier · {lender} », Dr 6500 Frais bancaires et de cartes / Cr 1000,
 * none for a fee of 0.
 */
export function loanEntries({
  day,
  lender,
  principal,
  fee,
}: EmergencyLoan): JournalEntry[] {
  return [
    ...transfer(day, FINANCING_MEMO.loan, lender, CASH, BANK_LOANS, principal),
    ...transfer(day, FINANCING_MEMO.fee, lender, BANK_FEES, CASH, fee),
  ]
}

/**
 * The entry of `sale` on the morning it was made: « Émission d'actions ·
 * {investor} », Dr 1000 Encaisse / Cr 3000 Capital-actions.
 */
export function saleEntries({
  day,
  investor,
  amount,
}: ShareSale): JournalEntry[] {
  return transfer(
    day,
    FINANCING_MEMO.shares,
    investor,
    CASH,
    SHARE_CAPITAL,
    amount,
  )
}

/**
 * Posts what the 1st of the month `day` owes the financing, open or
 * closed (see `chargesOn`); nothing on another day.
 */
export function financingCharges(
  journal: Journal,
  financing: FinancingState,
  day: Day,
): Journal {
  return postAll(journal, chargesOn(journal, financing, day))
}

/**
 * The entries the 1st of the month `day` owes the financing, read from
 * `journal` as it stands before them; none on another day. First each
 * emergency loan's payment number n, n months after the month of the loan,
 * of its `loanSchedule()`: its interest, « Intérêts · {lender} », Dr 7000
 * Intérêts / Cr 1000 Encaisse, then its principal, « Remboursement ·
 * {lender} », Dr 2500 Emprunts bancaires / Cr 1000, nothing before the
 * first or after the last. Then, on the 1st of a quarter, each investor's
 * dividend on the quarter before: the `share` of each round they bought
 * before `day`, of the Bénéfice net `dividendBase` reads, added up, «
 * Dividende · {investor} », Dr 3100 Bénéfices non répartis / Cr 1000, in
 * the order of their first sale. So two rounds take 40 % of the quarter,
 * however late in it the second came, and a quarter that lost money pays
 * nothing. Every entry is dated `day`, and none moves 0.
 */
export function chargesOn(
  journal: Journal,
  financing: FinancingState,
  day: Day,
): JournalEntry[] {
  const { month, dayOfMonth } = toCalendar(day)
  if (dayOfMonth !== 1) return []
  const due = financing.loans.flatMap((loan) => paymentOn(loan, day))
  if (!QUARTER_MONTHS.includes(month)) return due
  const base = dividendBase(journal, financing.shareSales, day)
  const owed = new Map<string, Cents>()
  for (const { day: sold, investor, share } of financing.shareSales) {
    if (sold >= day) continue
    const amount = mulRatio(base, share)
    owed.set(investor, add(owed.get(investor) ?? ZERO, amount))
  }
  for (const [investor, amount] of owed) {
    due.push(
      ...transfer(
        day,
        FINANCING_MEMO.dividend,
        investor,
        RETAINED_EARNINGS,
        CASH,
        amount,
      ),
    )
  }
  return due
}

/**
 * The Bénéfice net that the dividends of `day`, the 1st of a quarter,
 * share out: that of the quarter before, from its first day or the day of
 * the first of `shareSales` made before `day`, if later, to the day before
 * `day`. Zero for a loss, or when no sale came before `day`: a sale made
 * that very morning waits for the next quarter.
 */
export function dividendBase(
  journal: Journal,
  shareSales: readonly Pick<ShareSale, 'day'>[],
  day: Day,
): Cents {
  const last = day - 1
  const sold = shareSales.map(({ day: on }) => on).filter((on) => on <= last)
  if (sold.length === 0) return ZERO
  const from = Math.max(startOfQuarter(last), Math.min(...sold))
  const { netIncome } = incomeStatement(journal, from, last)
  return netIncome.amount > 0 ? netIncome.amount : ZERO
}

/** Whether `memo` is one of the financing's (see `financingMemo`). */
export function isFinancingMemo(memo: string): boolean {
  return Object.values(FINANCING_MEMO).some((what) =>
    memo.startsWith(financingMemo(what, '')),
  )
}

/** `financing` at the close of `day`, with Encaisse at `cash`. */
export function closingFinancing(
  financing: FinancingState,
  day: Day,
  cash: Cents,
): FinancingState {
  const belowZeroSince = cash < 0 ? (financing.belowZeroSince ?? day) : null
  return belowZeroSince === financing.belowZeroSince
    ? financing
    : { ...financing, belowZeroSince }
}

/**
 * What `belowZeroSince` is at the close of `toDay` in a game whose closes
 * start on `fromDay`, read from `journal`: the first of the closes in a
 * row, `toDay`'s included, at which Encaisse was below zero; null when it
 * was not at `toDay`'s, or `toDay` is before `fromDay`. Reads the entries
 * up to `toDay` once.
 */
export function belowZeroSinceOf(
  journal: Journal,
  fromDay: Day,
  toDay: Day,
): Day | null {
  const entries = entriesOf(journal)
  let cash = ZERO
  let since: Day | null = null
  let next = 0
  for (let day = fromDay; day <= toDay; day += 1) {
    let entry = entries[next]
    while (entry !== undefined && entry.day <= day) {
      for (const { account, debit: inflow, credit: outflow } of entry.lines) {
        if (account === CASH) cash = add(cash, sub(inflow, outflow))
      }
      next += 1
      entry = entries[next]
    }
    since = cash < 0 ? (since ?? day) : null
  }
  return since
}

/** `state` with `event` waiting, as if drawn that morning. */
function withOffer(state: GameState, event: string): GameState {
  return {
    ...state,
    events: {
      ...state.events,
      pending: { event, followUp: false },
      lastDrawnDay: state.day,
    },
  }
}

/** `loan`'s payment due on `day`, a 1st, if any (see `chargesOn`). */
function paymentOn(loan: EmergencyLoan, day: Day): JournalEntry[] {
  const month = monthsSinceStart(day) - monthsSinceStart(loan.day)
  if (month < 1 || month > loan.termMonths) return []
  const { lender, principal, annualRateBasisPoints, termMonths } = loan
  const payment = loanSchedule(principal, annualRateBasisPoints, termMonths)
    .payments[month - 1]
  if (payment === undefined) return []
  return [
    ...transfer(
      day,
      FINANCING_MEMO.interest,
      lender,
      INTEREST,
      CASH,
      payment.interest,
    ),
    ...transfer(
      day,
      FINANCING_MEMO.principal,
      lender,
      BANK_LOANS,
      CASH,
      payment.principal,
    ),
  ]
}

/**
 * The entry « {what} · {name} » moving `amount` from `credited` to
 * `debited` on `day`; none for an amount of 0, which the journal refuses.
 */
function transfer(
  day: Day,
  what: string,
  name: string,
  debited: AccountCode,
  credited: AccountCode,
  amount: Cents,
): JournalEntry[] {
  if (amount === 0) return []
  return [
    {
      day,
      memo: financingMemo(what, name),
      lines: [debit(debited, amount), credit(credited, amount)],
    },
  ]
}

function postAll(journal: Journal, entries: readonly JournalEntry[]): Journal {
  return entries.reduce((books, entry) => postEntry(books, entry), journal)
}
