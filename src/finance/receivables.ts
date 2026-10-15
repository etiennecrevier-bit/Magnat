// The entries of a sale a customer pays later: the sale on credit, the cash
// collected and the debt written off, plus a charge paid in cash that has no
// account of its own, such as a fine or a fee. Each function builds one
// balanced entry and leaves posting it to the caller. The memos are part of
// the structure of the books, like the labels of the statements, not
// tunables, so they stay here.
//
// No function here sees the journal, so none can tell what a customer owes:
// the caller keeps track of it, or reads `balance(journal, '1100', …)`, and
// never collects or writes off more than that.

import { cents, type Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from './accounts.ts'
import type { JournalEntry, JournalLine } from './journal.ts'

const MEMO = {
  creditSale: 'Vente à crédit',
  collection: 'Encaissement',
  badDebt: 'Mauvaise créance',
} as const

const ZERO = cents(0)

/**
 * A sale `client` pays later: Dr 1100 Comptes clients / Cr 4000 Ventes. It is
 * revenue on `day` and moves no cash. Throws a RangeError unless `amount` is
 * a positive safe integer, and an Error if `client` is blank.
 */
export function creditSale(
  day: Day,
  client: string,
  amount: Cents,
): JournalEntry {
  return entry(day, memoFor(MEMO.creditSale, client), '1100', '4000', amount)
}

/**
 * Cash `client` pays on what they owe: Dr 1000 Encaisse / Cr 1100 Comptes
 * clients. Throws a RangeError unless `amount` is a positive safe integer,
 * and an Error if `client` is blank.
 */
export function collection(
  day: Day,
  client: string,
  amount: Cents,
): JournalEntry {
  return entry(day, memoFor(MEMO.collection, client), '1000', '1100', amount)
}

/**
 * What `client` owes and will never pay, written off: Dr 6950 Créances
 * irrécouvrables / Cr 1100 Comptes clients. It lowers the bénéfice and moves
 * no cash. Throws a RangeError unless `amount` is a positive safe integer,
 * and an Error if `client` is blank.
 */
export function badDebt(day: Day, client: string, amount: Cents): JournalEntry {
  return entry(day, memoFor(MEMO.badDebt, client), '6950', '1100', amount)
}

/**
 * A charge paid in cash that has no account of its own, such as a fine or a
 * fee: Dr 6900 Autres charges / Cr 1000 Encaisse. `description` is the
 * memo, in French, as the player sees it. Throws a RangeError unless
 * `amount` is a positive safe integer, and an Error if `description` is
 * blank.
 */
export function otherCharge(
  day: Day,
  description: string,
  amount: Cents,
): JournalEntry {
  return entry(day, checkText(description), '6900', '1000', amount)
}

function memoFor(what: string, client: string): string {
  return `${what} · ${checkText(client)}`
}

/** Throws an Error unless `text` is a string with more than white space. */
function checkText(text: string): string {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`Not a name or a description: ${JSON.stringify(text)}`)
  }
  return text
}

function entry(
  day: Day,
  memo: string,
  debit: AccountCode,
  credit: AccountCode,
  amount: Cents,
): JournalEntry {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(`Not an amount to post: ${amount}`)
  }
  const lines: JournalLine[] = [
    Object.freeze({ account: debit, debit: amount, credit: ZERO }),
    Object.freeze({ account: credit, debit: ZERO, credit: amount }),
  ]
  return Object.freeze({ day, memo, lines: Object.freeze(lines) })
}
