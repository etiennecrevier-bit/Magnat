import type { FoodTruckContent } from '../content/schema.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { add, cents, mulInt, sub, type Cents } from '../engine/money.ts'
import type { Day, DelayedEffect, GameState } from '../engine/types.ts'
import { getAccount, type AccountCode } from '../finance/accounts.ts'
import { entriesOf } from '../finance/journal.ts'
import { formatDayAndMonth, formatWeekdayName } from './formatGameDate.ts'
import { formatSignedMoney } from './formatMoney.ts'

// What an event's choice did, as the plain lines its card shows once the
// player has chosen. They are read off the game before and after the
// choice, and nothing is played again here:
// - What changed at once is a fact: how much each balance sheet account
//   moved in the entries the choice posted, then the owner's energy and
//   their own cash.
// - What comes later is one line for each effect the choice queued, never
//   added to another, since what else happens by then is not known yet. An
//   amount shows only when the effect fixes it: a payment, a sale, a
//   purchase's cash or the owner's own. What is collected, written off or
//   moved later shows without one, and the stock taken later, at a cost
//   only known on its day, shows nothing, nor does the stock it buys.
// - A sale on credit shows the day it is collected, unless an effect still
//   to come, queued by this choice or an earlier one, collects, writes off
//   or delays what that client owes between the sale and that day.
// Follow-ups, headlines and the changes to the street never show: the
// first two would give away what the player is not meant to know, and the
// tags already say the last.

const CASH: AccountCode = '1000'
const RECEIVABLES: AccountCode = '1100'
const INVENTORY: AccountCode = '1200'
/** The accounts the lines show, in this order. */
const SHOWN: readonly AccountCode[] = [CASH, RECEIVABLES, INVENTORY]

const ENERGY = 'Énergie'
const PERSONAL = 'Vos finances'

// The minus sign (U+2212), as the event cards' tags write a loss.
const MINUS_SIGN = '−'
// A calendar fact, not a tunable: a weekday's name says which day it is
// within a week.
const DAYS_PER_WEEK = 7

/** A change of money, or of the owner's energy in points. */
export type ChangeAmount =
  { readonly money: Cents } | { readonly energy: number }

/** One line of what a choice did. */
export interface ChangeLine {
  /**
   * What changes, in French: an account, « Énergie », « Vos finances », or
   * what is done later, such as « Encaissement de Gilles Lacasse ».
   */
  readonly label: string
  /** By how much; null for what is done later at an amount known then. */
  readonly amount: ChangeAmount | null
  /** The day it happens: the day of the choice for what changed at once. */
  readonly day: Day
  /**
   * For what is sold on credit, the days it is collected, when nothing
   * still to come changes them; empty otherwise.
   */
  readonly collectedOn: readonly Day[]
}

/**
 * What the choice made between `before` and `after`, the game just before
 * it and just after, did: what changed at once, then what comes later, by
 * day and in the order queued. Lines that change nothing are left out.
 * `foodTruck` gives the unit cost of what is bought later.
 */
export function choiceChanges(
  before: GameState,
  after: GameState,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
): ChangeLine[] {
  const queued = after.events.delayed.filter(
    (delayed) => !before.events.delayed.includes(delayed),
  )
  // Earlier choices' effects can settle this choice's sales too.
  const settlements = after.events.delayed.flatMap(settlement)
  return [
    ...nowLines(before, after, settlements),
    ...queued.flatMap((delayed) => laterLine(delayed, settlements, foodTruck)),
  ]
}

/**
 * `line` as the card writes it, the choice being made on `today`: «
 * Encaisse −220 $ jeudi », « Comptes clients +750 $ (8 août) », « Énergie
 * −15 », « Encaissement de Gilles Lacasse, jeudi ».
 */
export function formatChangeLine(line: ChangeLine, today: Day): string {
  const { label, amount, day, collectedOn } = line
  const when = whenText(day, today)
  const collected =
    collectedOn.length === 0
      ? ''
      : ` (${collectedOn.map(formatDayAndMonth).join(', ')})`
  if (amount === null) {
    return `${when === '' ? label : `${label}, ${when}`}${collected}`
  }
  const size =
    'money' in amount
      ? formatSignedMoney(amount.money)
      : `${amount.energy < 0 ? MINUS_SIGN : '+'}${Math.abs(amount.energy)}`
  return `${[label, size, when].filter((part) => part !== '').join(' ')}${collected}`
}

/** When `day` is, seen from `today`: nothing for today itself. */
function whenText(day: Day, today: Day): string {
  const ahead = day - today
  if (ahead <= 0) return ''
  if (ahead === 1) return 'demain'
  if (ahead < DAYS_PER_WEEK) return formatWeekdayName(day)
  return `le ${formatDayAndMonth(day)}`
}

function nowLines(
  before: GameState,
  after: GameState,
  settlements: readonly Settlement[],
): ChangeLine[] {
  const { day } = before
  const moved = new Map<AccountCode, Cents>()
  const posted = entriesOf(after.journal).slice(
    entriesOf(before.journal).length,
  )
  for (const { lines } of posted) {
    for (const { account, debit, credit } of lines) {
      moved.set(
        account,
        add(moved.get(account) ?? cents(0), sub(debit, credit)),
      )
    }
  }

  const changes: ChangeLine[] = []
  for (const account of SHOWN) {
    const money = moved.get(account) ?? 0
    if (money === 0) continue
    changes.push({
      label: getAccount(account).name,
      amount: { money: cents(money) },
      day,
      collectedOn:
        account === RECEIVABLES && money > 0
          ? collectionDays(before, after, settlements)
          : [],
    })
  }
  const energy = Math.round(after.energy - before.energy)
  if (energy !== 0) {
    changes.push({ label: ENERGY, amount: { energy }, day, collectedOn: [] })
  }
  const personal = sub(after.personal.cash, before.personal.cash)
  if (personal !== 0) {
    changes.push({
      label: PERSONAL,
      amount: { money: personal },
      day,
      collectedOn: [],
    })
  }
  return changes
}

/**
 * The due days, ascending, of what was sold on credit at once and is still
 * owed; none at all if any of it may be collected another day.
 */
function collectionDays(
  before: GameState,
  after: GameState,
  settlements: readonly Settlement[],
): Day[] {
  const sold = after.receivables.filter(
    (receivable) =>
      receivable.soldOnDay === before.day &&
      !before.receivables.includes(receivable),
  )
  const asDue = sold.every(({ client, soldOnDay, dueDay }) =>
    collectedAsDue(client, soldOnDay, dueDay, settlements),
  )
  if (!asDue) return []
  return [...new Set(sold.map(({ dueDay }) => dueDay))].sort((a, b) => a - b)
}

/** An effect still to come that settles or moves a client's debts. */
interface Settlement {
  readonly client: string
  readonly day: Day
}

/** `delayed` as a settlement, if it collects, writes off or delays. */
function settlement({ day, effect }: DelayedEffect): Settlement[] {
  switch (effect.kind) {
    case 'collectReceivable':
    case 'writeOff':
    case 'delayReceivable':
      return [{ client: effect.client, day }]
    default:
      return []
  }
}

/**
 * Whether what `client` owes for a sale on `soldOn` is collected on
 * `dueDay`: no settlement of theirs falls between the two, both included,
 * since a day's effects come before what falls due that day. A debt that
 * nothing touches by then cannot move after.
 */
function collectedAsDue(
  client: string,
  soldOn: Day,
  dueDay: Day,
  settlements: readonly Settlement[],
): boolean {
  return !settlements.some(
    (settled) =>
      settled.client === client &&
      settled.day >= soldOn &&
      settled.day <= dueDay,
  )
}

/** The line of an effect queued for a later day, if it gets one. */
function laterLine(
  { day, effect }: DelayedEffect,
  settlements: readonly Settlement[],
  foodTruck: FoodTruckContent,
): ChangeLine[] {
  const money = (label: string, amount: Cents, collectedOn: Day[] = []) => [
    { label, amount: { money: amount }, day, collectedOn },
  ]
  const operation = (label: string) => [
    { label, amount: null, day, collectedOn: [] },
  ]
  const cash = getAccount(CASH).name
  switch (effect.kind) {
    case 'charge':
      return money(cash, cents(-effect.amountCents))
    case 'cashSale':
      return money(cash, effect.amountCents)
    case 'creditSale': {
      const { client, amountCents, dueInDays } = effect
      const dueDay = day + dueInDays
      return money(
        getAccount(RECEIVABLES).name,
        amountCents,
        collectedAsDue(client, day, dueDay, settlements) ? [dueDay] : [],
      )
    }
    case 'buyStock': {
      const { unitCostCents } = foodTruck.products[effect.product]
      return money(cash, cents(-mulInt(unitCostCents, effect.units)))
    }
    case 'personal':
      return money(PERSONAL, effect.amountCents)
    case 'energy': {
      const energy = Math.round(effect.amount)
      return energy === 0
        ? []
        : [{ label: ENERGY, amount: { energy }, day, collectedOn: [] }]
    }
    case 'collectReceivable':
      return operation(`Encaissement de ${effect.client}`)
    case 'writeOff':
      return operation(`Mauvaise créance de ${effect.client}`)
    case 'delayReceivable':
      return operation(
        `Paiement de ${effect.client} reporté de ${effect.days} ${
          effect.days === 1 ? 'jour' : 'jours'
        }`,
      )
    case 'useStock':
    case 'followUp':
    case 'headline':
    case 'walkIns':
    case 'appeal':
    case 'willingness':
    case 'unavailable':
    case 'closed':
      return []
  }
}
