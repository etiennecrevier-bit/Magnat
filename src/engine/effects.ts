import type {
  EventEffect,
  FoodTruckContent,
  TimedEventEffect,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  postEntry,
  type Journal,
  type JournalEntry,
} from '../finance/journal.ts'
import {
  badDebt,
  collection,
  creditSale,
  otherCharge,
} from '../finance/receivables.ts'
import { toCalendar } from './calendar.ts'
import { clampEnergy } from './energy.ts'
import { takeFifo } from './inventory.ts'
import { cents, mulInt, type Cents } from './money.ts'
import { addMovement } from './personal.ts'
import { next } from './rng.ts'
import type { Day, GameState, Receivable, StreetModifier } from './types.ts'

// What the choices of the event cards do to the game, now or at the start
// of a later day. Every money effect goes through the books, never straight
// into the cash.

const CASH: AccountCode = '1000'
const INVENTORY: AccountCode = '1200'
const SALES: AccountCode = '4000'
const COST_OF_GOODS_SOLD: AccountCode = '5000'
const MARKETING: AccountCode = '6300'
const OTHER_CHARGES: AccountCode = '6900'

// A calendar fact, not a tunable.
const DAYS_PER_WEEK = 7

// Memos the player reads in the journal.
const MEMO = {
  purchases: 'Achat de marchandises',
  costOfSales: 'Coût des marchandises vendues',
  giveaway: 'Marchandises offertes',
} as const

const ZERO = cents(0)

/**
 * The day an effect of a choice made on `day` runs: `day` itself, or
 * `inDays` days later, or the first day after `day` that falls on the ISO
 * weekday `onNextWeekday`, so a week later when `day` is that weekday.
 */
export function whenDue(
  { inDays, onNextWeekday }: Pick<TimedEventEffect, 'inDays' | 'onNextWeekday'>,
  day: Day,
): Day {
  if (inDays !== undefined) return day + inDays
  if (onNextWeekday === undefined) return day
  const ahead =
    (onNextWeekday - toCalendar(day).weekday + DAYS_PER_WEEK) % DAYS_PER_WEEK
  return day + (ahead === 0 ? DAYS_PER_WEEK : ahead)
}

/** The effect without its timing, as it runs and as a save keeps it. */
export function untimed(effect: TimedEventEffect): EventEffect {
  const copy = { ...effect }
  delete copy.inDays
  delete copy.onNextWeekday
  return copy
}

/**
 * Applies `effect`, from a choice of the event `event`, on day `state.day`,
 * with `content`'s unit costs, and returns the new state; never mutates
 * `state`. Every entry is dated `state.day`, and one of 0 is not posted.
 * - `charge`: Dr its account, 6900 Autres charges by default / Cr 1000
 *   Encaisse, with its description as the memo.
 * - `cashSale`: Dr 1000 / Cr 4000 Ventes, with its description as the memo.
 * - `creditSale`: « Vente à crédit », Dr 1100 Comptes clients / Cr 4000, and
 *   a receivable from the client, due `dueInDays` later.
 * - `collectReceivable` and `writeOff`: each receivable of the client, in
 *   order, collected (« Encaissement », Dr 1000 / Cr 1100) or written off
 *   (« Mauvaise créance », Dr 6950 Créances irrécouvrables / Cr 1100), one
 *   entry each. A client who owes nothing changes nothing.
 * - `delayReceivable`: each receivable of the client comes due `days` later.
 * - `buyStock`: a new lot after the others, at the product's unit cost:
 *   « Achat de marchandises », Dr 1200 Stocks / Cr 1000.
 * - `useStock`: up to `units` taken out of the stock, oldest lot first, at
 *   what they cost: « Coût des marchandises vendues », Dr 5000 / Cr 1200,
 *   for an order, or « Marchandises offertes », Dr 6300 Marketing / Cr 1200,
 *   for a giveaway.
 * - `energy`: the owner's energy moves by `amount`, held between 0 and 100.
 * - `personal`: a movement of the owner's own account, with no entry.
 * - `followUp`: the event comes back `days` later, if one draw comes in
 *   below its `chance`; a chance of 1 draws nothing.
 * - `headline`: the headline is queued.
 * - `walkIns`, `appeal`, `willingness`, `unavailable` and `closed`: a change
 *   to the street, kept in `events.modifiers` after the others, with
 *   `event`, in effect from `state.day` for `days` days, that day included.
 *   No draw.
 */
export function applyEffect(
  state: GameState,
  effect: EventEffect,
  content: FoodTruckContent,
  event: string,
): GameState {
  const { day } = state
  switch (effect.kind) {
    case 'charge': {
      const { account = OTHER_CHARGES, description, amountCents } = effect
      return withEntry(
        state,
        account === OTHER_CHARGES
          ? otherCharge(day, description, amountCents)
          : transfer(day, description, account, CASH, amountCents),
      )
    }
    case 'cashSale':
      return withEntry(
        state,
        transfer(day, effect.description, CASH, SALES, effect.amountCents),
      )
    case 'creditSale': {
      const { client, amountCents, dueInDays } = effect
      const receivable: Receivable = {
        client,
        amount: amountCents,
        soldOnDay: day,
        dueDay: day + dueInDays,
      }
      return {
        ...withEntry(state, creditSale(day, client, amountCents)),
        receivables: byDueDay([...state.receivables, receivable]),
      }
    }
    case 'collectReceivable':
      return settle(state, effect.client, collection)
    case 'writeOff':
      return settle(state, effect.client, badDebt)
    case 'delayReceivable':
      return {
        ...state,
        receivables: byDueDay(
          state.receivables.map((receivable) =>
            receivable.client === effect.client
              ? { ...receivable, dueDay: receivable.dueDay + effect.days }
              : receivable,
          ),
        ),
      }
    case 'buyStock': {
      const { product, units } = effect
      const unitCost = content.products[product].unitCostCents
      return {
        ...state,
        inventory: [
          ...state.inventory,
          { product, quantity: units, unitCost, boughtOnDay: day },
        ],
        journal: post(
          state.journal,
          transfer(
            day,
            MEMO.purchases,
            INVENTORY,
            CASH,
            mulInt(unitCost, units),
          ),
        ),
      }
    }
    case 'useStock': {
      const { lots, cost } = takeFifo(
        state.inventory,
        effect.product,
        effect.units,
      )
      const entry =
        effect.to === 'order'
          ? transfer(day, MEMO.costOfSales, COST_OF_GOODS_SOLD, INVENTORY, cost)
          : transfer(day, MEMO.giveaway, MARKETING, INVENTORY, cost)
      return { ...state, inventory: lots, journal: post(state.journal, entry) }
    }
    case 'energy':
      return { ...state, energy: clampEnergy(state.energy + effect.amount) }
    case 'personal':
      return {
        ...state,
        personal: addMovement(
          state.personal,
          day,
          effect.label,
          effect.amountCents,
        ),
      }
    case 'followUp': {
      let { rngState } = state
      if (effect.chance < 1) {
        const [value, after] = next(rngState)
        rngState = after
        if (value >= effect.chance) return { ...state, rngState }
      }
      const { events } = state
      return {
        ...state,
        rngState,
        events: {
          ...events,
          followUps: insertByDay(events.followUps, {
            day: day + effect.days,
            event: effect.event,
          }),
        },
      }
    }
    case 'headline':
      return {
        ...state,
        events: {
          ...state.events,
          headlines: [...state.events.headlines, { day, id: effect.id }],
        },
      }
    case 'walkIns':
    case 'appeal':
    case 'willingness':
    case 'unavailable':
    case 'closed': {
      const { days, ...change } = effect
      const modifier: StreetModifier = {
        event,
        change,
        fromDay: day,
        lastDay: day + days - 1,
      }
      return {
        ...state,
        events: {
          ...state.events,
          modifiers: [...state.events.modifiers, modifier],
        },
      }
    }
  }
}

/**
 * The start of business day `state.day`, before the restock: first the
 * delayed effects due that day, in order (see `applyEffect`), then each
 * receivable due, collected in full in its own « Encaissement » entry, Dr
 * 1000 Encaisse / Cr 1100 Comptes clients. Returns a new state; never
 * mutates `state`.
 */
export function startOfDay(
  state: GameState,
  content: FoodTruckContent,
): GameState {
  const { day } = state
  const { delayed } = state.events
  const due = countWhile(delayed, (effect) => effect.day <= day)
  let started = state
  if (due > 0) {
    started = {
      ...state,
      events: { ...state.events, delayed: delayed.slice(due) },
    }
    for (const { event, effect } of delayed.slice(0, due)) {
      started = applyEffect(started, effect, content, event)
    }
  }

  const { receivables } = started
  const collected = countWhile(receivables, ({ dueDay }) => dueDay <= day)
  if (collected === 0) return started
  let { journal } = started
  for (const { client, amount } of receivables.slice(0, collected)) {
    journal = postEntry(journal, collection(day, client, amount))
  }
  return { ...started, journal, receivables: receivables.slice(collected) }
}

/**
 * `list` with `item` after every item of its day or before, so a list kept
 * by day stays so, in the order the items came.
 */
export function insertByDay<T extends { readonly day: Day }>(
  list: readonly T[],
  item: T,
): T[] {
  const at = countWhile(list, ({ day }) => day <= item.day)
  return [...list.slice(0, at), item, ...list.slice(at)]
}

/** Settles every receivable of `client` with the entry `entryFor` makes. */
function settle(
  state: GameState,
  client: string,
  entryFor: (day: Day, client: string, amount: Cents) => JournalEntry,
): GameState {
  let { journal } = state
  const left: Receivable[] = []
  for (const receivable of state.receivables) {
    if (receivable.client === client) {
      journal = postEntry(
        journal,
        entryFor(state.day, client, receivable.amount),
      )
    } else {
      left.push(receivable)
    }
  }
  return left.length === state.receivables.length
    ? state
    : { ...state, journal, receivables: left }
}

/** Receivables by due day, those due the same day in the order they came. */
function byDueDay(receivables: readonly Receivable[]): Receivable[] {
  return [...receivables].sort((a, b) => a.dueDay - b.dueDay)
}

/** How many items, from the first, `test` holds for. */
function countWhile<T>(list: readonly T[], test: (item: T) => boolean): number {
  const at = list.findIndex((item) => !test(item))
  return at === -1 ? list.length : at
}

function withEntry(state: GameState, entry: JournalEntry): GameState {
  return { ...state, journal: postEntry(state.journal, entry) }
}

/** Posts `entry` unless it moves nothing. */
function post(journal: Journal, entry: JournalEntry): Journal {
  return entry.lines.every(({ debit }) => debit === 0)
    ? journal
    : postEntry(journal, entry)
}

/** `amount` from `credited` to `debited`, as one entry. */
function transfer(
  day: Day,
  memo: string,
  debited: AccountCode,
  credited: AccountCode,
  amount: Cents,
): JournalEntry {
  return {
    day,
    memo,
    lines: [
      { account: debited, debit: amount, credit: ZERO },
      { account: credited, debit: ZERO, credit: amount },
    ],
  }
}
