import type { Cents } from '../engine/money.ts'
import { add, sub } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, entriesSince, type Journal } from '../finance/journal.ts'

const CASH = '1000' satisfies AccountCode

/**
 * The encaisse at the close of each of the last `count` days played, oldest
 * first, up to `lastPlayed` and from `firstDay` on, the day the game began:
 * what the cash chip's sparkline draws. One balance, then a walk through
 * the days' entries, so it costs the same late in a long game. Empty before
 * the first day is played.
 */
export function cashAtCloses(
  journal: Journal,
  firstDay: Day,
  lastPlayed: Day | null,
  count: number,
): Cents[] {
  if (lastPlayed === null || count <= 0 || lastPlayed < firstDay) return []
  const from = Math.max(firstDay, lastPlayed - count + 1)
  let cash = balance(journal, CASH, { toDay: from - 1 })
  const entries = entriesSince(journal, from)
  const closes: Cents[] = []
  let at = 0
  for (let day = from; day <= lastPlayed; day += 1) {
    for (
      let entry = entries[at];
      entry !== undefined && entry.day <= day;
      entry = entries[(at += 1)]
    ) {
      for (const { account, debit, credit } of entry.lines) {
        if (account === CASH) cash = add(cash, sub(debit, credit))
      }
    }
    closes.push(cash)
  }
  return closes
}
