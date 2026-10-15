import type { PersonalContent } from '../content/schema.ts'
import { monthsSinceStart, toCalendar } from './calendar.ts'
import { add, cents, sub, type Cents } from './money.ts'
import type { Day, PersonalAccount, PersonalMovement } from './types.ts'

// The owner is not the company. Their pay goes into their own pocket, and
// their own life costs money. The account lives outside the books: nothing
// here posts a journal entry or draws from the generator.

/** The movement labels the player reads. */
export const LABELS = {
  salary: 'Salaire',
  rent: 'Loyer',
  weeklyExpenses: 'Dépenses de la semaine',
} as const

// A record length, not a tunable: the account keeps this calendar month and
// the 11 before, so the month under way is always whole.
const MONTHS_KEPT = 12

const ZERO = cents(0)

/** The account a game opens with: `savings` and nothing moved yet. */
export function openingAccount(savings: Cents): PersonalAccount {
  return { cash: savings, movements: [], unpaidRents: [] }
}

/**
 * Whether the account still keeps what happened on `day` as of `today`:
 * `day` falls in the calendar month of `today` or the 11 before.
 */
export function isKept(day: Day, today: Day): boolean {
  return monthsSinceStart(today) - monthsSinceStart(day) < MONTHS_KEPT
}

/**
 * The owner's day `day`, after the business's. On payday, `payWeekday`,
 * « Salaire » brings `pay` in. On the 1st of the month, day 0 included,
 * « Loyer » takes the rent out; it goes unpaid when it leaves the cash below
 * zero. On payday again, « Dépenses de la semaine » takes the week's
 * expenses out. A day that is both does them in that order, and an amount
 * of 0 records nothing. Then whatever falls out of the months kept is
 * dropped. Returns a new account; never mutates `account`.
 */
export function livePersonalDay(
  account: PersonalAccount,
  day: Day,
  pay: Cents,
  payWeekday: number,
  content: PersonalContent,
): PersonalAccount {
  const { dayOfMonth, weekday } = toCalendar(day)
  const { rentCents, weeklyExpensesCents } = content
  const payday = weekday === payWeekday
  let cash = account.cash
  const moved: PersonalMovement[] = []
  const move = (label: string, amount: Cents) => {
    if (amount === 0) return
    cash = add(cash, amount)
    moved.push({ day, label, amount })
  }

  if (payday) move(LABELS.salary, pay)
  let unpaid = false
  if (dayOfMonth === 1) {
    move(LABELS.rent, sub(ZERO, rentCents))
    unpaid = rentCents > 0 && cash < 0
  }
  if (payday) move(LABELS.weeklyExpenses, sub(ZERO, weeklyExpensesCents))

  return {
    cash,
    movements: keptOn(
      moved.length === 0 ? account.movements : [...account.movements, ...moved],
      (movement) => movement.day,
      day,
    ),
    unpaidRents: keptOn(
      unpaid ? [...account.unpaidRents, day] : account.unpaidRents,
      (rentDay) => rentDay,
      day,
    ),
  }
}

/**
 * Adds the movement `label` of `amount` on `day`, such as an event's, after
 * the others. An amount of 0 records nothing. Older movements are dropped by
 * the next `livePersonalDay()`. Returns a new account; never mutates
 * `account`.
 */
export function addMovement(
  account: PersonalAccount,
  day: Day,
  label: string,
  amount: Cents,
): PersonalAccount {
  if (amount === 0) return account
  return {
    ...account,
    cash: add(account.cash, amount),
    movements: [...account.movements, { day, label, amount }],
  }
}

/**
 * Whether the owner is in debt: their cash is below zero. Each payday it is,
 * after the week's expenses, the stress drains the owner's energy (P2-16).
 */
export function inDebt(account: PersonalAccount): boolean {
  return account.cash < 0
}

/**
 * `items`, oldest first, without those `isKept()` no longer keeps on
 * `today`. Only the oldest can fall out, so this stops at the first one
 * kept, and gives `items` back as is when none falls out.
 */
function keptOn<T>(
  items: readonly T[],
  dayOf: (item: T) => Day,
  today: Day,
): readonly T[] {
  const first = items.findIndex((item) => isKept(dayOf(item), today))
  const dropped = first === -1 ? items.length : first
  return dropped === 0 ? items : items.slice(dropped)
}
