import {
  loadDreamContent,
  rungIdSchema,
  type CompanyRung,
  type DecisionLimits,
  type DreamContent,
  type DreamTitle,
  type EnergyContent,
  type Ladder,
  type PersonalRung,
  type Rung,
  type RungId,
  type SegmentId,
  type Service,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import type { Journal, JournalEntry, JournalLine } from '../finance/journal.ts'
import { monthsSinceStart, toCalendar } from './calendar.ts'
import { perSegment } from './customers.ts'
import { add, cents, sub, type Cents } from './money.ts'
import { credit, debit, depreciate } from './posting.ts'
import type { Street } from './street.ts'
import { FIRST_TRUCK } from './trucks.ts'
import type {
  BoughtRung,
  Day,
  DreamState,
  PersonalMovement,
  TruckId,
} from './types.ts'

// « Le rêve » (#162): two ladders the player climbs, each rung bought once
// and in order. The owner's own rungs are paid from their personal cash and
// count in their net worth at their price; the company's are paid from
// Encaisse, carried on the books and depreciated. Each rung bought gives its
// bonuses from then on, and the owner's net worth earns titles, the last one
// crowning the « Magnat ». A rung is bought on a morning, before the day is
// played, through `applyDecision()`. Nothing here draws from the generator,
// and with nothing bought every bonus leaves the game as it was.

/** The shipped « Le rêve », validated once when the engine loads. */
export const DREAM: DreamContent = loadDreamContent()

const CASH: AccountCode = '1000'
const EQUIPMENT: AccountCode = '1500'
const ACCUMULATED_DEPRECIATION: AccountCode = '1510'

/**
 * What the memos and the personal account's labels of a rung start with,
 * each followed by the rung's name (see `dreamLabel`): « Achat · Vélo
 * électrique ». The old truck's sale is a memo of its own.
 */
export const DREAM_MEMO = {
  bought: 'Achat',
  sold: 'Vente',
  depreciation: 'Amortissement',
  truckSold: "Vente de l'ancien camion",
} as const

/** The memo or label of `what` for the rung `name`: « Achat · Chalet ». */
export function dreamLabel(what: string, name: string): string {
  return `${what} · ${name}`
}

/** What a game starts with: nothing bought, no « Magnat » yet. */
export function noDream(): DreamState {
  return { bought: [], magnatOn: null }
}

/** The rungs of `ladder`, in the order they are climbed. */
export function rungsOf(
  ladder: Ladder,
  content: DreamContent = DREAM,
): readonly Rung[] {
  return ladder === 'personal' ? content.personal : content.company
}

/** Where a rung is: its ladder and its place in it, from 0. */
export interface RungPlace {
  readonly rung: Rung
  readonly ladder: Ladder
  readonly index: number
}

/**
 * The rung `id` of `content` and where it is. Throws a RangeError for an id
 * no rung has.
 */
export function rungOf(id: RungId, content: DreamContent = DREAM): RungPlace {
  for (const ladder of ['personal', 'company'] as const) {
    const index = rungsOf(ladder, content).findIndex((rung) => rung.id === id)
    const rung = rungsOf(ladder, content)[index]
    if (rung !== undefined) return { rung, ladder, index }
  }
  throw new RangeError(`Unknown rung: ${String(id)}`)
}

/** Whether `id` is a rung of the content's ids. */
export function isRungId(id: unknown): id is RungId {
  return rungIdSchema.safeParse(id).success
}

/** Whether a personal rung: paid from the owner's own cash. */
export function isPersonal(rung: Rung): rung is PersonalRung {
  return !('usefulLifeMonths' in rung)
}

/** Whether a company rung: paid from Encaisse, on the books. */
export function isCompany(rung: Rung): rung is CompanyRung {
  return 'usefulLifeMonths' in rung
}

/** The purchase of `id`, if it was bought. */
export function purchaseOf(
  dream: DreamState,
  id: RungId,
): BoughtRung | undefined {
  return dream.bought.find(({ rung }) => rung === id)
}

/** Whether `id` was bought. */
export function isBought(dream: DreamState, id: RungId): boolean {
  return purchaseOf(dream, id) !== undefined
}

/**
 * The first rung of `ladder` not bought yet, one coming soon included; null
 * once every rung is.
 */
export function nextRung(
  dream: DreamState,
  ladder: Ladder,
  content: DreamContent = DREAM,
): Rung | null {
  return (
    rungsOf(ladder, content).find((rung) => !isBought(dream, rung.id)) ?? null
  )
}

/** Whether every rung before `id` in its ladder was bought. */
export function prerequisitesMet(
  dream: DreamState,
  id: RungId,
  content: DreamContent = DREAM,
): boolean {
  const { ladder, index } = rungOf(id, content)
  return rungsOf(ladder, content)
    .slice(0, index)
    .every((rung) => isBought(dream, rung.id))
}

/**
 * The rung `rung` sells when it is bought, if any: an earlier personal rung
 * with housing.
 */
export function soldBy(rung: Rung, content: DreamContent = DREAM): Rung | null {
  return isPersonal(rung) && rung.sells !== undefined
    ? rungOf(rung.sells, content).rung
    : null
}

/**
 * The rungs owned at the close of `day`, or on its morning once its
 * purchases are made: those bought by then, in the order they were, less
 * those a later purchase by then sold. Every rung bought by default.
 */
export function ownedRungs(
  dream: DreamState,
  content: DreamContent = DREAM,
  day: Day = Number.MAX_SAFE_INTEGER,
): readonly Rung[] {
  const bought = dream.bought
    .filter((purchase) => purchase.day <= day)
    .map(({ rung }) => rungOf(rung, content).rung)
  const sold = new Set(
    bought.flatMap((rung) => soldBy(rung, content)?.id ?? []),
  )
  return bought.filter(({ id }) => !sold.has(id))
}

/** What the rungs owned give, folded together. */
export interface DreamBonuses {
  /** The best vehicle's trip time factor: the lowest, 1 with none. */
  readonly travelTime: number
  /** What multiplies the counter's service seconds. */
  readonly serviceTime: number
  /** What multiplies the most customers a newcomer finds waiting. */
  readonly line: number
  /** What multiplies the most units a restock rule may name. */
  readonly stock: number
  /** What multiplies each segment's walk-ins. */
  readonly walkIns: Readonly<Record<SegmentId, number>>
  /** Energy a closed day gives back on top of the content's. */
  readonly closedDayRecovery: number
}

/**
 * The bonuses of the rungs owned (see `ownedRungs`): the factors multiply,
 * but the trip time takes the lowest, since vehicles do not add up, and the
 * energy of a closed day adds. With nothing owned, every factor is exactly
 * 1 and the energy 0.
 */
export function dreamBonuses(
  dream: DreamState,
  content: DreamContent = DREAM,
): DreamBonuses {
  let travelTime = 1
  let serviceTime = 1
  let line = 1
  let stock = 1
  const walkIns = perSegment(() => 1)
  let closedDayRecovery = 0
  for (const { bonuses } of ownedRungs(dream, content)) {
    for (const bonus of bonuses) {
      switch (bonus.kind) {
        case 'travelTime':
          travelTime = Math.min(travelTime, bonus.factor)
          break
        case 'serviceTime':
          serviceTime *= bonus.factor
          break
        case 'line':
          line *= bonus.factor
          break
        case 'stock':
          stock *= bonus.factor
          break
        case 'walkIns':
          walkIns[bonus.segment] *= bonus.factor
          break
        case 'closedDayRecovery':
          closedDayRecovery += bonus.extra
          break
      }
    }
  }
  return { travelTime, serviceTime, line, stock, walkIns, closedDayRecovery }
}

/**
 * What multiplies a trip's time in town (#164): the best vehicle owned's
 * factor, 1 with none.
 */
export function travelTimeFactor(
  dream: DreamState,
  content: DreamContent = DREAM,
): number {
  return dreamBonuses(dream, content).travelTime
}

/** `street` with each segment's walk-ins × the bonuses'; itself with none. */
export function withDreamStreet(street: Street, bonuses: DreamBonuses): Street {
  if (Object.values(bonuses.walkIns).every((factor) => factor === 1)) {
    return street
  }
  return {
    ...street,
    walkIns: perSegment(
      (segment) => street.walkIns[segment] * bonuses.walkIns[segment],
    ),
  }
}

/**
 * `service` with its seconds × the bonuses' `serviceTime`, and the line a
 * newcomer still joins × `line`, rounded; itself with neither.
 */
export function dreamService(service: Service, bonuses: DreamBonuses): Service {
  if (bonuses.serviceTime === 1 && bonuses.line === 1) return service
  return {
    baseSeconds: service.baseSeconds * bonuses.serviceTime,
    perItemSeconds: service.perItemSeconds * bonuses.serviceTime,
    maxAheadInLine: Math.round(service.maxAheadInLine * bonuses.line),
  }
}

/**
 * `limits` with the most units a restock rule may name × the bonuses'
 * `stock`, rounded; itself with none.
 */
export function dreamLimits(
  limits: DecisionLimits,
  bonuses: DreamBonuses,
): DecisionLimits {
  if (bonuses.stock === 1) return limits
  return {
    ...limits,
    units: {
      ...limits.units,
      max: Math.round(limits.units.max * bonuses.stock),
    },
  }
}

/**
 * `energy` with a closed day giving the bonuses' `closedDayRecovery` back
 * on top; itself with none.
 */
export function dreamEnergy(
  energy: EnergyContent,
  bonuses: DreamBonuses,
): EnergyContent {
  if (bonuses.closedDayRecovery === 0) return energy
  return {
    ...energy,
    closedDayRecovery: energy.closedDayRecovery + bonuses.closedDayRecovery,
  }
}

/** The owner's home, when they own one: its monthly payment and label. */
export interface Housing {
  /** What the personal account shows in place of « Loyer ». */
  readonly label: string
  /** What it takes on the 1st of each month. */
  readonly amount: Cents
}

/**
 * The monthly payment that replaces the rent: the last rung owned with
 * housing, in the order bought; null while the owner rents.
 */
export function housingOf(
  dream: DreamState,
  content: DreamContent = DREAM,
): Housing | null {
  const home = ownedRungs(dream, content)
    .filter(isPersonal)
    .findLast(({ housing }) => housing !== undefined)?.housing
  return home === undefined
    ? null
    : { label: home.label, amount: home.monthlyCents }
}

/** Every label a home's payment may have in the personal account. */
export function housingLabels(content: DreamContent = DREAM): Set<string> {
  return new Set(
    content.personal.flatMap(({ housing }) =>
      housing === undefined ? [] : [housing.label],
    ),
  )
}

/**
 * What the owner owns of « Le rêve » at the close of `day`, at purchase
 * price: their own rungs bought by then and not sold back (see
 * `ownedRungs`).
 */
export function personalAssetsOn(
  dream: DreamState,
  day: Day,
  content: DreamContent = DREAM,
): Cents {
  return ownedRungs(dream, content, day)
    .filter(isPersonal)
    .reduce((total, { priceCents }) => add(total, priceCents), cents(0))
}

/**
 * The movements buying the personal rung `rung` on `day` makes: the rung it
 * sells, if any, coming in at its price, « Vente · {name} », then its own
 * price going out, « Achat · {name} ».
 */
export function purchaseMovements(
  rung: PersonalRung,
  day: Day,
  content: DreamContent = DREAM,
): PersonalMovement[] {
  const sold = soldBy(rung, content)
  return [
    ...(sold === null
      ? []
      : [
          {
            day,
            label: dreamLabel(DREAM_MEMO.sold, sold.name),
            amount: sold.priceCents,
          },
        ]),
    {
      day,
      label: dreamLabel(DREAM_MEMO.bought, rung.name),
      amount: sub(cents(0), rung.priceCents),
    },
  ]
}

/**
 * The cash `rung` needs on hand: its price, less what the rung it sells, if
 * any, brings back.
 */
export function cashNeeded(rung: Rung, content: DreamContent = DREAM): Cents {
  const sold = soldBy(rung, content)
  return sold === null ? rung.priceCents : sub(rung.priceCents, sold.priceCents)
}

/** The truck the books carry, before a rung replaces it. */
export interface TruckOnBooks {
  /** What it cost, on the books in Équipement (1500). */
  readonly priceCents: Cents
  /** Its price less its depreciation so far. */
  readonly bookValue: Cents
}

/**
 * What the company rung `rung` costs, bought with `truck` on the books: its
 * price, and the old truck's book value on top when it replaces the truck.
 */
export function purchaseCost(
  rung: CompanyRung,
  truck: TruckOnBooks | null,
): Cents {
  return rung.replacesTruck === true && truck !== null
    ? add(rung.priceCents, truck.bookValue)
    : rung.priceCents
}

/**
 * The entries buying the company rung `rung` on `day` posts, with `truck`
 * the truck on the books that morning, null when it is leased. A rung that
 * replaces the truck first sells the old one back at its book value, «
 * Vente de l'ancien camion »: Dr 1000 Encaisse for the book value, Dr 1510
 * for the depreciation so far, Cr 1500 Équipement for its price. Then «
 * Achat · {name} », Dr 1500 / Cr 1000, for what it costs (see
 * `purchaseCost`). So the company pays the price, and the book value comes
 * back on the new truck. A line of 0 is left out.
 */
export function purchaseEntries(
  rung: CompanyRung,
  day: Day,
  truck: TruckOnBooks | null,
): JournalEntry[] {
  const cost = purchaseCost(rung, truck)
  const sale: JournalEntry[] =
    rung.replacesTruck === true && truck !== null
      ? [
          entry(day, DREAM_MEMO.truckSold, [
            debit(CASH, truck.bookValue),
            debit(
              ACCUMULATED_DEPRECIATION,
              sub(truck.priceCents, truck.bookValue),
            ),
            credit(EQUIPMENT, truck.priceCents),
          ]),
        ]
      : []
  return [
    ...sale,
    entry(day, dreamLabel(DREAM_MEMO.bought, rung.name), [
      debit(EQUIPMENT, cost),
      credit(CASH, cost),
    ]),
  ]
}

/** An entry with the lines that move an amount. */
function entry(
  day: Day,
  memo: string,
  lines: readonly JournalLine[],
): JournalEntry {
  return {
    day,
    memo,
    lines: lines.filter((line) => line.debit > 0 || line.credit > 0),
  }
}

/**
 * The day the truck was replaced, when a rung that replaces it was bought;
 * null otherwise. From that morning on, the old truck takes no depreciation
 * nor lease.
 */
export function truckReplacedOn(
  dream: DreamState,
  content: DreamContent = DREAM,
): Day | null {
  const replacing = dream.bought.find(({ rung }) => {
    const found = rungOf(rung, content).rung
    return isCompany(found) && found.replacesTruck === true
  })
  return replacing?.day ?? null
}

/**
 * The truck whose own the company rung `rung` is (#259): the first truck
 * for the one that replaces it, the truck it adds for the one that adds
 * one; null for equipment of the company as a whole.
 */
export function truckOfRung(rung: CompanyRung): TruckId | null {
  if (rung.replacesTruck === true) return FIRST_TRUCK
  return rung.addsTruck?.id ?? null
}

/**
 * The depreciation the 1st of the month `day` owes the company rungs
 * bought before it, in the order bought: each over its `usefulLifeMonths`
 * of what it cost, from the 1st after its purchase, « Amortissement ·
 * {name} », Dr 6400 / Cr 1510 (see `depreciate`), the charge naming the
 * truck whose the rung is, if any (see `truckOfRung`). None on another day.
 */
export function dreamDepreciation(
  journal: Journal,
  day: Day,
  dream: DreamState,
  content: DreamContent = DREAM,
): Journal {
  if (toCalendar(day).dayOfMonth !== 1) return journal
  let books = journal
  for (const { rung: id, day: bought, cost } of dream.bought) {
    const { rung } = rungOf(id, content)
    if (!isCompany(rung) || bought >= day) continue
    const month = monthsSinceStart(day) - monthsSinceStart(bought) - 1
    books = depreciate(
      books,
      day,
      month,
      { priceCents: cost, usefulLifeMonths: rung.usefulLifeMonths },
      dreamLabel(DREAM_MEMO.depreciation, rung.name),
      truckOfRung(rung) ?? undefined,
    )
  }
  return books
}

/**
 * The highest title `netWorth` earns: the last whose `netWorthCents` it
 * reaches; null below the first.
 */
export function titleOf(
  netWorth: Cents,
  content: DreamContent = DREAM,
): DreamTitle | null {
  return (
    content.titles.findLast(({ netWorthCents }) => netWorth >= netWorthCents) ??
    null
  )
}

/** The first title `netWorth` does not reach yet; null past the last. */
export function nextTitle(
  netWorth: Cents,
  content: DreamContent = DREAM,
): DreamTitle | null {
  return (
    content.titles.find(({ netWorthCents }) => netWorth < netWorthCents) ?? null
  )
}

/** The last title, « Magnat », whose first close shows the celebration. */
export function magnatTitle(content: DreamContent = DREAM): DreamTitle {
  const last = content.titles.at(-1)
  if (last === undefined) throw new RangeError('The dream has no title')
  return last
}

/**
 * `dream` at the close of `day`, with the owner's net worth at `netWorth`:
 * `magnatOn` becomes `day` the first close it reaches the last title, and
 * never changes after. Returns `dream` itself when nothing changes.
 */
export function crowned(
  dream: DreamState,
  netWorth: Cents,
  day: Day,
  content: DreamContent = DREAM,
): DreamState {
  if (dream.magnatOn !== null) return dream
  if (netWorth < magnatTitle(content).netWorthCents) return dream
  return { ...dream, magnatOn: day }
}
