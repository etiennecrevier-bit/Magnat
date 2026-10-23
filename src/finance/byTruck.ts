import { add, cents, sub, type Cents } from '../engine/money.ts'
import type { Day, TruckId } from '../engine/types.ts'
import type { AccountCode } from './accounts.ts'
import { entriesSince, type Journal } from './journal.ts'

// Sales and margin by truck (#259): one journal, one set of statements, and
// each truck's sales and cost of goods tagged on their lines, so a truck's
// share of the état des résultats can be read for any period. The key null
// holds what no truck sold: the grocers' contracts and the events' sales,
// so the map adds up to the statement's line.

const SALES: AccountCode = '4000'
const COST_OF_GOODS_SOLD: AccountCode = '5000'

const ZERO = cents(0)

/** The days a reading covers, both included; from the first entry by default. */
export interface Period {
  readonly fromDay?: Day
  readonly toDay: Day
}

/**
 * Ventes (4000) from `fromDay` to `toDay`, both included, by the truck their
 * lines name, null for those that name none: credits less debits, as the
 * état des résultats nets them. A truck with no line in the period is
 * absent. Throws a RangeError unless both days are safe integers, and a
 * TypeError unless `emptyJournal()` or `postEntry()` made `journal`.
 */
export function salesByTruck(
  journal: Journal,
  period: Period,
): Map<TruckId | null, Cents> {
  return netByTruck(journal, period, SALES, 'credit')
}

/**
 * The margin from `fromDay` to `toDay`, both included, by truck: Ventes
 * (4000) less Coût des marchandises vendues (5000), each by the truck its
 * lines name, null for those that name none (see `salesByTruck`). So the
 * margins add up to the état des résultats' sales less its cost of goods.
 */
export function marginByTruck(
  journal: Journal,
  period: Period,
): Map<TruckId | null, Cents> {
  const margins = salesByTruck(journal, period)
  const costs = netByTruck(journal, period, COST_OF_GOODS_SOLD, 'debit')
  for (const [truck, cost] of costs) {
    margins.set(truck, sub(margins.get(truck) ?? ZERO, cost))
  }
  return margins
}

/** `account`'s net on its `side` over the period, by the lines' truck. */
function netByTruck(
  journal: Journal,
  { fromDay = 0, toDay }: Period,
  account: AccountCode,
  side: 'debit' | 'credit',
): Map<TruckId | null, Cents> {
  if (!Number.isSafeInteger(toDay)) {
    throw new RangeError(`Invalid game day: ${toDay}`)
  }
  const nets = new Map<TruckId | null, Cents>()
  for (const { day, lines } of entriesSince(journal, fromDay)) {
    // Days never go down, so no later entry is in the period either.
    if (day > toDay) break
    for (const line of lines) {
      if (line.account !== account) continue
      const net =
        side === 'credit'
          ? sub(line.credit, line.debit)
          : sub(line.debit, line.credit)
      const truck = line.truck ?? null
      nets.set(truck, add(nets.get(truck) ?? ZERO, net))
    }
  }
  return nets
}
