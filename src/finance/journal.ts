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

declare const brand: unique symbol

/**
 * The books. Only `emptyJournal()` and `postEntry()` make one, so every entry
 * in it balances, uses known accounts and comes no earlier than the one
 * before it. A journal and everything in it is frozen.
 */
export interface Journal {
  readonly [brand]: true
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

const EMPTY = freezeJournal([])

export function emptyJournal(): Journal {
  return EMPTY
}

/**
 * Returns a new journal with `entry` added after the others; never mutates
 * `journal` or `entry`, and later changes to `entry` do not reach the journal.
 * Throws unless the day is a game day no earlier than the last entry's, the
 * entry has at least one line, every line is present (no hole, null or
 * undefined), uses a known account and has a whole, non-negative amount on
 * exactly one side, and the debits add up to the credits.
 */
export function postEntry(journal: Journal, entry: JournalEntry): Journal {
  const { day, memo, lines } = entry
  function fail(reason: string): never {
    throw new Error(`Cannot post "${memo}" on day ${day}: ${reason}`)
  }

  if (!Number.isSafeInteger(day) || day < 0) fail('not a game day')
  const last = journal.entries.at(-1)
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
  return freezeJournal([...journal.entries, posted])
}

/**
 * The account's balance after every entry up to and including `toDay`, on
 * its normal side: positive when debits exceed credits for a debit account,
 * or credits exceed debits for a credit account. Any day before the first
 * entry, negative days included, gives zero. Throws a RangeError unless
 * `toDay` is a safe integer, or if a balance leaves the safe integer range.
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
 * integer, or if a balance or a total leaves the safe integer range.
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
  for (const entry of journal.entries) {
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

function freezeJournal(entries: readonly JournalEntry[]): Journal {
  return Object.freeze({ entries: Object.freeze(entries) }) as Journal
}
