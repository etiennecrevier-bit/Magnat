import { add, cents, sub, type Cents } from '../engine/money.ts'
import type { Day, TruckId } from '../engine/types.ts'
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
  /**
   * The truck whose sale or charge the line is (#259), so its sales and
   * margin can be read from the books; absent on a line of the company as
   * a whole. A tag, not an account: no balance reads it.
   */
  readonly truck?: TruckId
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
 * `entries` is built the first time it is read, so posting an entry does
 * not copy the ones before it.
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

type Nets = ReadonlyMap<AccountCode, Cents>

/** What this module keeps of a journal it made. */
interface Books {
  /**
   * The journal's entries, then those of the journals posted from it one
   * after the other, which share the array: a post adds after the others,
   * so the journal's own `count` entries never change.
   */
  readonly posted: JournalEntry[]
  readonly count: number
  /**
   * Each account's net debits after every entry, so a balance at the
   * journal's last day does not sum the entries again; null once a running
   * balance has left the safe integer range, so reading one throws as
   * summing the entries does.
   */
  readonly nets: Nets | null
  /** The journal's entries as one frozen array, once read. */
  entries?: readonly JournalEntry[]
}

const ZERO = cents(0)

/** Every journal `emptyJournal()` and `postEntry()` made, and its books. */
const BOOKS = new WeakMap<Journal, Books>()

/** `entries`, read through `entriesOf()` like every other read. */
const ENTRIES = {
  enumerable: true,
  get(this: Journal) {
    return entriesOf(this)
  },
} satisfies PropertyDescriptor

const EMPTY = makeJournal({ posted: [], count: 0, nets: new Map() })

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
 * whole, non-negative amount on exactly one side, with a truck, if any,
 * named by a non-empty string, and the debits add up to the credits.
 */
export function postEntry(journal: Journal, entry: JournalEntry): Journal {
  const { posted, count, nets } = booksOf(journal)
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
  const last = posted[count - 1]
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
    const { account, debit, credit, truck } = line
    if (!isAccountCode(account)) fail(`${where}: unknown account ${account}`)
    if (truck !== undefined && (typeof truck !== 'string' || truck === '')) {
      fail(`${where}: not a truck: ${String(truck)}`)
    }
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
    // The truck last, and only when there is one, so a line without one
    // keeps the shape it always had.
    stored.push(
      Object.freeze({
        account,
        debit: cents(debit),
        credit: cents(credit),
        ...(truck === undefined ? {} : { truck }),
      }),
    )
  }

  if (totalDebit !== totalCredit) {
    fail(`debits of ${totalDebit} do not equal credits of ${totalCredit}`)
  }

  // The entry goes at the end of the array the journal shares, so a post
  // costs the same in the tenth year as on the first day. Once the journal
  // has been posted to, the entries after its own belong to that later
  // journal, so another post to it copies its own into a new array. So does
  // a post to the empty journal, which every game starts from, so that no
  // game keeps the entries of another alive.
  const shared =
    count > 0 && posted.length === count ? posted : posted.slice(0, count)
  shared.push(Object.freeze({ day, memo, lines: Object.freeze(stored) }))
  return makeJournal({
    posted: shared,
    count: count + 1,
    nets: netsAfter(nets, stored),
  })
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
  const net = netDebits(journal, { toDay }).get(account) ?? ZERO
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
  const nets = netDebits(journal, { toDay })
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
 * Each account's debits minus its credits, over the entries from `fromDay`
 * (or the first entry) to `toDay`, both included, in a new map that leaves
 * out the accounts whose net is zero. Throws a RangeError unless both days
 * are safe integers, or if a balance leaves the safe integer range, and a
 * TypeError unless `emptyJournal()` or `postEntry()` made `journal`.
 */
export function netDebits(
  journal: Journal,
  { fromDay, toDay }: { fromDay?: Day; toDay: Day },
): Map<AccountCode, Cents> {
  for (const day of [fromDay ?? 0, toDay]) {
    if (!Number.isSafeInteger(day)) {
      throw new RangeError(`Invalid game day: ${day}`)
    }
  }
  const books = booksOf(journal)
  const { posted, count, nets } = books
  const first = fromDay === undefined ? 0 : countBefore(books, fromDay)
  const last = countBefore(books, toDay + 1)
  let summed: Map<AccountCode, Cents>
  // From the first entry, take the journal's own nets less the entries after
  // `toDay` when those are the fewer, so a balance late in a long game costs
  // what it does early on. Taking them away from the last line of the last
  // entry back goes through the running balances that summing reaches, in
  // reverse, all in range while `nets` is set, so both ways give the same
  // nets. In any other order a balance on the way may leave the range.
  if (first === 0 && nets !== null && count - last < last) {
    summed = new Map(nets)
    for (const { lines } of posted.slice(last, count).reverse()) {
      for (const { account, debit, credit } of lines.toReversed()) {
        summed.set(
          account,
          sub(summed.get(account) ?? ZERO, sub(debit, credit)),
        )
      }
    }
  } else {
    summed = new Map()
    for (const { lines } of posted.slice(first, last)) {
      for (const { account, debit, credit } of lines) {
        // A line has one side only, so this overflows only when the running
        // balance itself leaves the safe integer range.
        summed.set(
          account,
          add(summed.get(account) ?? ZERO, sub(debit, credit)),
        )
      }
    }
  }
  for (const [account, net] of summed) if (net === 0) summed.delete(account)
  return summed
}

/**
 * The journal's entries, which balance, use known accounts and come in day
 * order: the same frozen array every time. Throws a TypeError unless
 * `emptyJournal()` or `postEntry()` made `journal`: a copy, a spread or
 * untyped data may break any of these rules, or hold an array its maker can
 * still change.
 */
export function entriesOf(journal: Journal): readonly JournalEntry[] {
  const books = booksOf(journal)
  books.entries ??= Object.freeze(books.posted.slice(0, books.count))
  return books.entries
}

/**
 * The journal's entries dated `fromDay` or later, in posting order, in a
 * frozen array, without reading or copying the ones before: what reads the
 * last days of a long game costs the same in its tenth year as in its
 * first. Throws a RangeError unless `fromDay` is a safe integer, and a
 * TypeError unless `emptyJournal()` or `postEntry()` made `journal`.
 */
export function entriesSince(
  journal: Journal,
  fromDay: Day,
): readonly JournalEntry[] {
  if (!Number.isSafeInteger(fromDay)) {
    throw new RangeError(`Invalid game day: ${fromDay}`)
  }
  const books = booksOf(journal)
  return Object.freeze(
    books.posted.slice(countBefore(books, fromDay), books.count),
  )
}

/** How many of the journal's entries are dated before `day`. */
function countBefore({ posted, count }: Books, day: Day): number {
  // Days never go down, so those entries all come first: halve the range
  // until it holds the first entry that is not one of them.
  let low = 0
  let high = count
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const entry = posted[middle]
    if (entry !== undefined && entry.day < day) low = middle + 1
    else high = middle
  }
  return low
}

function booksOf(journal: Journal): Books {
  const books = BOOKS.get(journal)
  if (books === undefined) {
    throw new TypeError('Not a journal from emptyJournal() or postEntry()')
  }
  return books
}

function makeJournal(books: Books): Journal {
  const journal = Object.freeze(
    Object.defineProperty({}, 'entries', ENTRIES),
  ) as Journal
  BOOKS.set(journal, books)
  return journal
}

/**
 * `nets` with the lines added, or null if a balance leaves the safe integer
 * range or already had.
 */
function netsAfter(
  nets: Nets | null,
  lines: readonly JournalLine[],
): Nets | null {
  if (nets === null) return null
  const after = new Map(nets)
  for (const { account, debit, credit } of lines) {
    const net = (after.get(account) ?? ZERO) + debit - credit
    if (!Number.isSafeInteger(net)) return null
    after.set(account, cents(net))
  }
  return after
}
