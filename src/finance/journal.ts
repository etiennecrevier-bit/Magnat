import { add, cents, sub, type Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import {
  ACCOUNTS,
  getAccount,
  isAccountCode,
  type AccountCode,
} from './accounts.ts'

/** One side of an entry: exactly one of `debit` and `credit` is above zero. */
export interface JournalLine {
  readonly account: AccountCode
  readonly debit: Cents
  readonly credit: Cents
}

export interface JournalEntry {
  readonly day: Day
  readonly memo: string
  readonly lines: readonly JournalLine[]
}

// Type only, no such class exists. A private member is nominal and a spread
// drops it, so no object literal, a spread of a journal included,
// type-checks as a Journal.
declare class Brand {
  private readonly journal: true
}

/**
 * The books. Only `emptyJournal()` and `postEntry()` make one, so every entry
 * in it balances, uses known accounts and comes no earlier than the one
 * before it. A journal and everything in it is frozen. `postEntry()` and
 * everything that reads the entries through `entriesOf()` reject any other
 * object, so a cast or untyped data cannot get one past the type check.
 */
export interface Journal extends Brand {
  /** Entries in the order they were posted, so their days never go down. */
  readonly entries: readonly JournalEntry[]
}

/** An account's net balance, in the debit or the credit column. */
export interface TrialBalanceLine {
  readonly account: AccountCode
  readonly debit: Cents
  readonly credit: Cents
}

export interface TrialBalance {
  /** Every account in chart order, including those with a zero balance. */
  readonly lines: readonly TrialBalanceLine[]
  readonly totalDebit: Cents
  readonly totalCredit: Cents
}

const ZERO = cents(0)

/** Every journal `emptyJournal()` and `postEntry()` made. */
const MADE = new WeakSet<Journal>()

const EMPTY = freezeJournal([])

export function emptyJournal(): Journal {
  return EMPTY
}

/**
 * Returns a new journal with `entry` added after the others; never mutates
 * `journal` or `entry`, and later changes to `entry` do not reach the journal.
 * Throws a TypeError unless `emptyJournal()` or `postEntry()` made `journal`.
 * Throws an Error unless the memo is a string, the day is a game day no
 * earlier than the last entry's, the entry has at least one line, every line
 * is present (no hole, null or undefined), uses a known account and has a
 * whole, non-negative amount on exactly one side, and the debits add up to
 * the credits.
 */
export function postEntry(journal: Journal, entry: JournalEntry): Journal {
  const entries = entriesOf(journal)
  const { day, memo, lines } = entry
  // First of the entry's checks, since the others quote the memo. An object
  // memo would be stored by reference, so later changes would reach the
  // journal.
  if (typeof memo !== 'string') {
    throw new Error(
      `Cannot post an entry on day ${day}: memo is not a string (${typeof memo})`,
    )
  }
  function fail(reason: string): never {
    throw new Error(`Cannot post "${memo}" on day ${day}: ${reason}`)
  }

  if (!Number.isSafeInteger(day) || day < 0) fail('not a game day')
  const last = entries.at(-1)
  if (last !== undefined && day < last.day) {
    fail(`the last entry is on day ${last.day}`)
  }
  if (lines.length === 0) fail('it has no lines')

  let totalDebit = ZERO
  let totalCredit = ZERO
  const stored: JournalLine[] = []
  // An index loop, not map: map skips holes, which would then be stored and
  // break every balance read after this entry.
  for (let index = 0; index < lines.length; index++) {
    const where = `line ${index + 1}`
    const line = lines[index]
    if (typeof line !== 'object' || line === null) fail(`${where}: missing`)
    const { account, debit, credit } = line
    if (!isAccountCode(account)) fail(`${where}: unknown account ${account}`)
    for (const amount of [debit, credit]) {
      if (!Number.isSafeInteger(amount)) {
        fail(`${where}: not a whole number of cents: ${amount}`)
      }
      if (amount < 0) fail(`${where}: negative amount ${amount}`)
    }
    if (debit > 0 && credit > 0) fail(`${where}: both a debit and a credit`)
    if (debit === 0 && credit === 0) fail(`${where}: no amount`)

    try {
      totalDebit = add(totalDebit, debit)
      totalCredit = add(totalCredit, credit)
    } catch {
      fail('its total is out of range')
    }
    stored.push(
      Object.freeze({
        account,
        debit: cents(debit),
        credit: cents(credit),
      }),
    )
  }

  if (totalDebit !== totalCredit) {
    fail(`debits of ${totalDebit} do not equal credits of ${totalCredit}`)
  }

  const posted: JournalEntry = Object.freeze({
    day,
    memo,
    lines: Object.freeze(stored),
  })
  return freezeJournal([...entries, posted])
}

/**
 * The account's balance after every entry up to and including `toDay`, on
 * its normal side: positive when debits exceed credits for a debit account,
 * or credits exceed debits for a credit account. Any day before the first
 * entry, negative days included, gives zero. Throws a RangeError unless
 * `toDay` is a safe integer, or if a balance leaves the safe integer range,
 * and a TypeError unless `emptyJournal()` or `postEntry()` made `journal`.
 */
export function balance(
  journal: Journal,
  account: AccountCode,
  { toDay }: { toDay: Day },
): Cents {
  const { normalBalance } = getAccount(account)
  const net = netDebits(journal, toDay).get(account) ?? ZERO
  return normalBalance === 'debit' ? net : sub(ZERO, net)
}

/**
 * Lists every account's balance after every entry up to and including
 * `toDay`: in the debit column when its debits are at least its credits, in
 * the credit column otherwise. Throws a RangeError unless `toDay` is a safe
 * integer, or if a balance or a total leaves the safe integer range, and a
 * TypeError unless `emptyJournal()` or `postEntry()` made `journal`.
 */
export function trialBalance(journal: Journal, toDay: Day): TrialBalance {
  const nets = netDebits(journal, toDay)
  let totalDebit = ZERO
  let totalCredit = ZERO
  const lines = ACCOUNTS.map(({ code }): TrialBalanceLine => {
    const net = nets.get(code) ?? ZERO
    const debit = net >= 0 ? net : ZERO
    const credit = net >= 0 ? ZERO : sub(ZERO, net)
    totalDebit = add(totalDebit, debit)
    totalCredit = add(totalCredit, credit)
    return Object.freeze({ account: code, debit, credit })
  })
  return Object.freeze({
    lines: Object.freeze(lines),
    totalDebit,
    totalCredit,
  })
}

/**
 * Each account's debits minus its credits, over the entries up to and
 * including `toDay`. Accounts without lines are missing from the map.
 */
function netDebits(journal: Journal, toDay: Day): Map<AccountCode, Cents> {
  if (!Number.isSafeInteger(toDay)) {
    throw new RangeError(`Invalid game day: ${toDay}`)
  }
  const nets = new Map<AccountCode, Cents>()
  for (const entry of entriesOf(journal)) {
    // Days never go down, so no later entry can be in range either.
    if (entry.day > toDay) break
    for (const { account, debit, credit } of entry.lines) {
      // A line has one side only, so this overflows only when the running
      // balance itself leaves the safe integer range.
      nets.set(account, add(nets.get(account) ?? ZERO, sub(debit, credit)))
    }
  }
  return nets
}

/**
 * The journal's entries, which balance, use known accounts and come in day
 * order. Throws a TypeError unless `emptyJournal()` or `postEntry()` made
 * `journal`: a copy, a spread or untyped data may break any of these rules,
 * or hold an array its maker can still change.
 */
export function entriesOf(journal: Journal): readonly JournalEntry[] {
  if (!MADE.has(journal)) {
    throw new TypeError('Not a journal from emptyJournal() or postEntry()')
  }
  return journal.entries
}

function freezeJournal(entries: readonly JournalEntry[]): Journal {
  const journal = Object.freeze({ entries: Object.freeze(entries) }) as Journal
  MADE.add(journal)
  return journal
}
