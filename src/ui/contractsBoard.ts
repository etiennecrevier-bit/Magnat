import type { GrocerContent, GrocerId } from '../content/schema.ts'
import { mondayOf } from '../engine/calendar.ts'
import { GROCERS } from '../engine/contracts.ts'
import { sum, type Cents } from '../engine/money.ts'
import type { Contract, Day, GameState } from '../engine/types.ts'
import { formatDayAndMonth, formatWeekdayName } from './formatGameDate.ts'
import { formatCount, formatMoney } from './formatMoney.ts'
import type { StatusLine } from './productFacts.ts'
import type { TipContent, TipRow } from './tooltip.ts'

// What the « Contrats » screen shows of the grocers' contracts (#163): the
// engine keeps them (src/engine/contracts.ts); this only reads them.

// Days per game week, a calendar fact.
const DAYS_PER_WEEK = 7

/** This week's delivery to a grocer, as of the morning of the game's day. */
export type WeekDelivery =
  /** Made on `day`: `units` croissants for `amount`. */
  | {
      readonly kind: 'delivered'
      readonly day: Day
      readonly units: number
      readonly amount: Cents
    }
  /** Nobody could make it on `day`. */
  | { readonly kind: 'missed'; readonly day: Day }
  /** Due on `day`, this morning or later this week. */
  | { readonly kind: 'due'; readonly day: Day }
  /** None this week: the contract was signed too late; the first is `day`. */
  | { readonly kind: 'first'; readonly day: Day }

/** A grocer's contract as it runs. */
export interface ContractLine {
  readonly unitsPerWeek: number
  /** What the grocer pays for each croissant, as agreed. */
  readonly unitPrice: Cents
  /** What they pay more for each croissant the bakery made; 0 for none. */
  readonly premium: Cents
  /** The deliveries left, the next one included. */
  readonly weeksLeft: number
  /** The deliveries it missed. */
  readonly strikes: number
  /** The missed deliveries that end it. */
  readonly maxStrikes: number
  readonly week: WeekDelivery
}

/** What a grocer still owes for one delivery. */
export interface Owed {
  readonly amount: Cents
  /** The day they pay it, at the start of the day. */
  readonly dueDay: Day
}

/** A grocer with a contract that runs, or who still owes the business. */
export interface GrocerLine {
  readonly grocer: GrocerId
  /** The business, as the journal names it. */
  readonly name: string
  /** Who runs it. */
  readonly owner: string
  /** Their contract; null once it has ended. */
  readonly contract: ContractLine | null
  /** What they owe, by due day. */
  readonly owed: readonly Owed[]
  /** What they owe in all. */
  readonly owedTotal: Cents
}

/** The « Contrats » screen. */
export interface ContractsBoard {
  /** In the content's order. */
  readonly grocers: readonly GrocerLine[]
  /** What the grocers owe in all. */
  readonly owedTotal: Cents
}

/**
 * The grocers of `game` with a contract that runs or money owed, in the
 * order of `grocers`, each with this week's delivery, as of the morning of
 * `game.day`, and what they owe, matched to them by name as the journal
 * names them.
 */
export function contractsBoard(
  game: Pick<GameState, 'day' | 'contracts' | 'receivables'>,
  grocers: GrocerContent = GROCERS,
): ContractsBoard {
  const lines: GrocerLine[] = []
  for (const [id, grocer] of Object.entries(grocers.grocers)) {
    const key = id as GrocerId
    const owed = game.receivables
      .filter(({ client }) => client === grocer.name)
      .map(({ amount, dueDay }) => ({ amount, dueDay }))
    const contract = game.contracts.running.find(
      (running) => running.grocer === key,
    )
    if (contract === undefined && owed.length === 0) continue
    lines.push({
      grocer: key,
      name: grocer.name,
      owner: grocer.owner,
      contract:
        contract === undefined
          ? null
          : {
              unitsPerWeek: grocer.unitsPerWeek,
              unitPrice: contract.unitPrice,
              premium: grocer.artisanalPremiumCents,
              weeksLeft: contract.weeksLeft,
              strikes: contract.strikes,
              maxStrikes: grocers.maxStrikes,
              week: weekDelivery(game, contract, grocers),
            },
      owed,
      owedTotal: sum(owed.map(({ amount }) => amount)),
    })
  }
  return {
    grocers: lines,
    owedTotal: sum(lines.map(({ owedTotal }) => owedTotal)),
  }
}

/**
 * This week's delivery of `contract`: made or missed on the delivery
 * weekday, as the engine recorded it; still due when that day is this
 * morning or later and the contract was signed before it; otherwise the
 * first one comes the week after, as a contract delivers only after the day
 * it was signed.
 */
function weekDelivery(
  { day, contracts }: Pick<GameState, 'day' | 'contracts'>,
  contract: Contract,
  grocers: GrocerContent,
): WeekDelivery {
  const deliveryDay = mondayOf(day) + grocers.deliveryWeekday - 1
  const isThis = (other: { day: Day; grocer: GrocerId }) =>
    other.day === deliveryDay && other.grocer === contract.grocer
  const made = contracts.deliveries.find(isThis)
  if (made !== undefined) {
    return {
      kind: 'delivered',
      day: deliveryDay,
      units: made.units,
      amount: made.amount,
    }
  }
  if (contracts.missed.some(isThis)) return { kind: 'missed', day: deliveryDay }
  if (deliveryDay >= day && contract.startDay < deliveryDay) {
    return { kind: 'due', day: deliveryDay }
  }
  return { kind: 'first', day: deliveryDay + DAYS_PER_WEEK }
}

/**
 * The grocers of `board`, with `grocer` among them, in the order of
 * `grocers`, as a click on their shop asks for their card: with no contract
 * and nothing owed when the board leaves them out.
 */
export function withGrocer(
  board: ContractsBoard,
  grocer: GrocerId | null,
  grocers: GrocerContent = GROCERS,
): readonly GrocerLine[] {
  if (grocer === null || board.grocers.some((line) => line.grocer === grocer)) {
    return board.grocers
  }
  const { name, owner } = grocers.grocers[grocer]
  const order = Object.keys(grocers.grocers)
  return [
    ...board.grocers,
    { grocer, name, owner, contract: null, owed: [], owedTotal: sum([]) },
  ].sort((a, b) => order.indexOf(a.grocer) - order.indexOf(b.grocer))
}

/** This week's delivery to `line`'s grocer, as the card's status line. */
export function grocerLine({ contract }: GrocerLine): StatusLine {
  if (contract === null) {
    return {
      fact: { tone: 'off', text: 'Aucun contrat en cours' },
      tomorrow: null,
    }
  }
  return { fact: weekFact(contract.week), tomorrow: null }
}

function weekFact(week: WeekDelivery): NonNullable<StatusLine['fact']> {
  const weekday = formatWeekdayName(week.day)
  switch (week.kind) {
    case 'delivered':
      return {
        tone: 'ok',
        text: `${formatCount(week.units)} croissants livrés ${weekday}, ${formatMoney(week.amount)}`,
      }
    case 'missed':
      return { tone: 'bad', text: `Livraison manquée ${weekday}` }
    case 'due':
      return { tone: 'warn', text: `Livraison ${weekday}` }
    case 'first':
      return {
        tone: 'off',
        text: `Première livraison le ${formatDayAndMonth(week.day)}`,
      }
  }
}

/**
 * What a grocer's tooltip says: who runs it, their contract as it runs and
 * what they owe, by due day.
 */
export function grocerTip({
  name,
  owner,
  contract,
  owed,
  owedTotal,
}: GrocerLine): TipContent {
  const rows: TipRow[] = []
  if (contract !== null) {
    const { unitsPerWeek, unitPrice, premium, weeksLeft, strikes, maxStrikes } =
      contract
    rows.push({
      label: 'Par semaine',
      value: `${formatCount(unitsPerWeek)} croissants à ${formatMoney(unitPrice)}`,
    })
    if (premium > 0) {
      rows.push({
        label: 'Prime du fournil',
        value: `+${formatMoney(premium)} par croissant`,
      })
    }
    rows.push(
      { label: 'Semaines restantes', value: String(weeksLeft) },
      {
        label: 'Livraisons manquées',
        value: `${strikes} sur ${maxStrikes}`,
        warn: strikes > 0,
      },
    )
  }
  if (owed.length > 0) {
    rows.push({
      label: 'À recevoir',
      value: formatMoney(owedTotal),
      divider: true,
    })
    for (const { amount, dueDay } of owed) {
      rows.push({
        label: `Le ${formatDayAndMonth(dueDay)}`,
        value: formatMoney(amount),
      })
    }
  }
  return { title: name, text: owner, rows }
}
