import {
  loadDistrictContent,
  type DayType,
  type DifficultyContent,
  type DifficultyId,
  type DistrictContent,
  type DistrictId,
  type FoodTruckContent,
  type DistrictWalkIns,
  type WinterStorage,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import type { JournalEntry } from '../finance/journal.ts'
import { onDates, toCalendar } from './calendar.ts'
import type { CrowdChanges } from './customers.ts'
import { add, cents, type Cents } from './money.ts'
import { credit, debit } from './posting.ts'
import type { Day, Truck } from './types.ts'

// The districts a truck works in (#260): each its own crowd, its seasons,
// its permit and, in Vieux-Montréal, a rival. And « Remiser pour l'hiver »,
// the dates a truck is stored each year, when it sells nothing but its
// charges keep running.

/** The shipped districts, validated once when the engine loads. */
export const DISTRICTS: DistrictContent = loadDistrictContent()

const CASH: AccountCode = '1000'
const RENT_AND_PERMIT: AccountCode = '6100'
const INSURANCE: AccountCode = '6150'

// Memos the player reads in the journal.
const MEMO = {
  permit: 'Permis, stationnement et cuisine',
  yearlyPermit: 'Permis annuel',
  insurance: 'Assurances',
} as const

const ZERO = cents(0)

/**
 * The walk-ins of a truck in `district` in `month` (1 = January): the noise
 * and opening hours every truck shares, in `hours`, and the district's
 * crowd, each day type's customers × the month's factor. At a factor of
 * exactly 1, the crowd as the content has it.
 */
export function districtWalkIns(
  district: DistrictId,
  month: number,
  hours: FoodTruckContent['walkIns'],
  districts: DistrictContent = DISTRICTS,
): DistrictWalkIns {
  const { dayTypes, monthlyWalkIns } = districts.districts[district]
  const factor = monthlyWalkIns[month - 1]
  if (factor === undefined) throw new RangeError(`Invalid month: ${month}`)
  if (factor === 1) return { ...hours, dayTypes }
  const scaled = (crowd: DayType): DayType => ({
    ...crowd,
    customers: crowd.customers * factor,
  })
  return {
    ...hours,
    dayTypes: {
      semaine: scaled(dayTypes.semaine),
      finDeSemaine: scaled(dayTypes.finDeSemaine),
    },
  }
}

/**
 * `changes` as the district's rival, if any, leaves them in `month` (1 =
 * January): in its months, its segment's walk-ins × its `walkInsFactor`.
 * `changes` itself otherwise.
 */
export function withRival<Changes extends CrowdChanges>(
  changes: Changes,
  district: DistrictId,
  month: number,
  districts: DistrictContent = DISTRICTS,
): Changes {
  const { rival } = districts.districts[district]
  if (rival === undefined || !rival.months.includes(month)) return changes
  const { segment, walkInsFactor } = rival
  return {
    ...changes,
    walkIns: {
      ...changes.walkIns,
      [segment]: changes.walkIns[segment] * walkInsFactor,
    },
  }
}

/**
 * What the permit of `district` takes on `day` at `difficulty`: a monthly
 * one on each 1st, a yearly one on the 1st of its month, its amount that
 * of `difficulties`; zero on any other day.
 */
export function permitOn(
  district: DistrictId,
  day: Day,
  difficulty: DifficultyId,
  difficulties: DifficultyContent,
  districts: DistrictContent = DISTRICTS,
): Cents {
  const { month, dayOfMonth } = toCalendar(day)
  if (dayOfMonth !== 1) return ZERO
  const { permit } = districts.districts[district]
  if (permit.kind === 'monthly') return permit.monthlyCents
  if (permit.month !== month) return ZERO
  return difficulties.districtPermits[difficulty][district] ?? ZERO
}

/**
 * The memo of the permit of `district`: « Permis, stationnement et cuisine
 * » for a monthly one, « Permis annuel · {district} » for a yearly one.
 */
export function permitMemo(
  district: DistrictId,
  districts: DistrictContent = DISTRICTS,
): string {
  const { permit, name } = districts.districts[district]
  return permit.kind === 'monthly'
    ? MEMO.permit
    : `${MEMO.yearlyPermit} · ${name}`
}

/**
 * The entries the 1st of the month `day` owes for each of `trucks`, the
 * trucks after the first, in their order, those on hand that day only
 * (bought on `day` or before), stored or not: its district's permit due
 * that day (see `permitOn`), Dr 6100 Loyer et permis / Cr 1000 Encaisse,
 * then its insurance, `foodTruck`'s, « Assurances », Dr 6150 Assurances /
 * Cr 1000, each naming the truck on its line of the état des résultats.
 * None on another day, and none of 0.
 */
export function truckChargesOn(
  trucks: readonly Pick<Truck, 'id' | 'district' | 'boughtOnDay'>[],
  day: Day,
  difficulty: DifficultyId,
  foodTruck: FoodTruckContent,
  difficulties: DifficultyContent,
  districts: DistrictContent = DISTRICTS,
): JournalEntry[] {
  if (toCalendar(day).dayOfMonth !== 1) return []
  return trucks.flatMap(({ id, district, boughtOnDay }) => {
    if (boughtOnDay > day) return []
    const paid = (memo: string, account: AccountCode, amount: Cents) =>
      amount === 0
        ? []
        : [
            {
              day,
              memo,
              lines: [debit(account, amount, id), credit(CASH, amount)],
            },
          ]
    return [
      ...paid(
        permitMemo(district, districts),
        RENT_AND_PERMIT,
        permitOn(district, day, difficulty, difficulties, districts),
      ),
      ...paid(MEMO.insurance, INSURANCE, foodTruck.monthlyCostsCents.insurance),
    ]
  })
}

/** What `entries` take out of Encaisse. */
export function cashOut(entries: readonly JournalEntry[]): Cents {
  return entries.reduce(
    (total, { lines }) =>
      lines.reduce(
        (sum, line) => (line.account === CASH ? add(sum, line.credit) : sum),
        total,
      ),
    ZERO,
  )
}

/** The dates « Remiser pour l'hiver » starts from, a copy of `districts`'. */
export function defaultWinterStorage(
  districts: DistrictContent = DISTRICTS,
): WinterStorage {
  const { from, to } = districts.winterStorage
  return { from: { ...from }, to: { ...to } }
}

/**
 * Whether a truck stored by `storage` is stored on `day`: from its `from`
 * to its `to`, both days included, over the year's end when `to` comes
 * before `from`. Never when there is no storage.
 */
export function isStored(
  storage: WinterStorage | undefined,
  day: Day,
): boolean {
  return storage !== undefined && onDates(day, storage)
}
