import { z } from 'zod'
import {
  avatarSchema,
  difficultyIdSchema,
  eventEffectSchema,
  productIdSchema,
  segmentIdSchema,
  streetChangeSchema,
  type DifficultyContent,
  type DifficultyId,
  type EventContent,
  type FoodTruckContent,
} from '../content/schema.ts'
import { isAccountCode, type AccountCode } from '../finance/accounts.ts'
import {
  balance,
  emptyJournal,
  entriesOf,
  postEntry,
  trialBalance,
  type Journal,
  type JournalEntry,
} from '../finance/journal.ts'
import { DIFFICULTIES, EVENTS, FOOD_TRUCK, openingJournal } from './day.ts'
import { validateDecisions } from './decisions.ts'
import { FULL_ENERGY } from './energy.ts'
import { noEvents } from './events.ts'
import { PRODUCTS, inventoryValue } from './inventory.ts'
import { cents, sum } from './money.ts'
import { LABELS, isKept } from './personal.ts'
import { validateProfile } from './profile.ts'
import { isRngState } from './rng.ts'
import type { Decisions, GameState, VisitOutcome } from './types.ts'

// A game saved as JSON and loaded back. A save is untrusted text: loading it
// checks every field against a strict schema, then rebuilds the books by
// posting each saved entry again, so no saved journal object ever reaches
// the game and the books hold only entries `postEntry()` accepts.

/**
 * The format `serialize()` writes. Bump it when a save written before a
 * change can no longer load (rule 8 in CLAUDE.md). Version 9 adds the
 * changes to the street: a version 8 game still loads, as a game with none.
 * Version 8 adds the event cards and the receivables: a version 7 game
 * still loads, as a game with no event yet and nobody owing anything.
 * Version 7 adds the
 * owner's energy and botched units: a version 6 game has neither. Version 6
 * adds the owner's personal account: a version 5 game has none. Version 5
 * spends the marketing budget: a version 4 game has no marketing history.
 * Version 4 adds the line at the counter: a version 3 `lastDay` has no
 * visits served or left and no waits. Version 3 opened the books by
 * difficulty and charged the real costs. A version 2 game's books hold no
 * truck and no loan, so it would repay a loan it never took and depreciate
 * a truck it never bought.
 */
export const SAVE_VERSION = 9

/** The older formats `deserialize()` still loads: see `SAVE_VERSION`. */
const STREETLESS_VERSION = 8
const EVENTLESS_VERSION = 7

const RECEIVABLES: AccountCode = '1100'
const STOCKS: AccountCode = '1200'

// A calendar fact, not a tunable: arrivals are minutes of one day.
const MINUTES_PER_DAY = 1440

// Every object is strict, so a key the game does not know fails the load
// instead of being dropped.

/** Whole, non-negative cents, typed as the engine's `Cents`. */
const money = z
  .int()
  .nonnegative()
  .transform((n) => cents(n))

/** Whole cents of either sign, typed as the engine's `Cents`. */
const signedMoney = z.int().transform((n) => cents(n))

const count = z.int().nonnegative()

const text = z.string().refine((t) => t.trim() !== '', 'expected some text')

const gameDay = z.int().nonnegative()

const energyLevel = z.number().min(0).max(FULL_ENERGY)

const generatorState = z
  .int()
  .refine(isRngState, 'expected an integer in [0, 2^32)')

const unitsPerProduct = z.record(productIdSchema, count)

const accountCode = z.custom<AccountCode>(
  (value) => typeof value === 'string' && isAccountCode(value),
  'unknown account',
)

// `postEntry()` checks the rest: one side per line, balance, day order.
const entrySchema = z.strictObject({
  day: gameDay,
  memo: z.string(),
  lines: z
    .array(
      z.strictObject({ account: accountCode, debit: money, credit: money }),
    )
    .min(1),
})

const lotSchema = z.strictObject({
  product: productIdSchema,
  quantity: z.int().positive(),
  unitCost: money,
  boughtOnDay: gameDay,
})

// Keyed by every VisitOutcome, so a new one fails the type check until a
// save can hold it.
const visitOutcome = z.enum({
  bought: 'bought',
  tooExpensive: 'tooExpensive',
  soldOut: 'soldOut',
  leftLine: 'leftLine',
  browsed: 'browsed',
} satisfies Record<VisitOutcome, VisitOutcome>)

const minuteOfDay = z.int().min(0).max(MINUTES_PER_DAY)

// `checkEvents()` checks the days, their order and the event ids.
const modifierSchema = z.strictObject({
  event: z.string(),
  change: streetChangeSchema,
  fromDay: gameDay,
  lastDay: gameDay,
})

const daySummarySchema = z.strictObject({
  day: gameDay,
  sold: unitsPerProduct,
  revenue: money,
  lostSales: unitsPerProduct,
  spoiled: unitsPerProduct,
  segments: z.record(
    segmentIdSchema,
    z.strictObject({
      visits: count,
      buyers: count,
      tooExpensive: count,
      soldOut: count,
    }),
  ),
  visits: z.array(
    z.strictObject({
      arrivalMinute: minuteOfDay,
      segment: segmentIdSchema,
      bought: unitsPerProduct,
      outcome: visitOutcome,
      // Service may run past closing time, even past midnight.
      servedMinute: count.nullable(),
      leftMinute: minuteOfDay.nullable(),
      botched: count,
    }),
  ),
  leftLine: count,
  averageWaitSeconds: count,
  longestWaitSeconds: count,
  energy: energyLevel,
  botched: count,
  modifiers: z.array(modifierSchema),
})

// `validateDecisions()` checks the limits and the days open.
const decisionsSchema = z.strictObject({
  prices: z.record(productIdSchema, money),
  restock: z.record(
    productIdSchema,
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('buyDaily'), quantity: count }),
      z.strictObject({
        kind: z.literal('topUp'),
        whenBelow: count,
        upTo: count,
      }),
    ]),
  ),
  daysOpen: z.array(z.int()),
  ownerWeeklyPay: money,
  marketingDaily: money,
})

// `validateProfile()` checks the business name.
const profileSchema = z.strictObject({
  businessName: z.string(),
  avatar: avatarSchema,
  difficulty: difficultyIdSchema,
})

// `checkPersonal()` checks the labels, the days, their order and each
// amount's sign.
const personalSchema = z.strictObject({
  cash: signedMoney,
  movements: z.array(
    z.strictObject({ day: gameDay, label: z.string(), amount: signedMoney }),
  ),
  unpaidRents: z.array(gameDay),
})

// `checkEvents()` checks the days, their order and the ids against the
// event content. The effects still to come have no timing left.
const eventsSchema = z.strictObject({
  pending: z
    .strictObject({ event: z.string(), followUp: z.boolean() })
    .nullable(),
  delayed: z.array(
    z.strictObject({
      day: gameDay,
      event: z.string(),
      effect: eventEffectSchema,
    }),
  ),
  followUps: z.array(z.strictObject({ day: gameDay, event: z.string() })),
  history: z.array(
    z.strictObject({
      day: gameDay,
      event: z.string(),
      followUp: z.boolean(),
      choice: z.string(),
      outcome: count,
    }),
  ),
  lastDrawnDay: gameDay.nullable(),
  headlines: z.array(z.strictObject({ day: gameDay, id: z.string() })),
  modifiers: z.array(modifierSchema),
})

// `checkReceivables()` checks the days, their order and the total.
const receivableSchema = z.strictObject({
  client: text,
  amount: z
    .int()
    .positive()
    .transform((n) => cents(n)),
  soldOnDay: gameDay,
  dueDay: gameDay,
})

const saveSchema = z.strictObject({
  saveVersion: z.literal(SAVE_VERSION),
  day: gameDay,
  seed: generatorState,
  rngState: generatorState,
  journal: z.array(entrySchema),
  inventory: z.array(lotSchema),
  lastDay: daySummarySchema.nullable(),
  marketingHistory: z.array(money),
  decisions: decisionsSchema,
  pendingDecisions: decisionsSchema.nullable(),
  profile: profileSchema,
  personal: personalSchema,
  energy: energyLevel,
  events: eventsSchema,
  receivables: z.array(receivableSchema),
})

type Save = z.output<typeof saveSchema>

/** A version 8 save: no change to the street. */
const streetlessSchema = saveSchema.extend({
  saveVersion: z.literal(STREETLESS_VERSION),
  lastDay: daySummarySchema.omit({ modifiers: true }).nullable(),
  events: eventsSchema.omit({ modifiers: true }),
})

/** A version 7 save: no event and no receivable either. */
const eventlessSchema = streetlessSchema
  .omit({ events: true, receivables: true })
  .extend({ saveVersion: z.literal(EVENTLESS_VERSION) })

/**
 * Writes the game as the JSON `deserialize()` loads. Throws a TypeError
 * unless `emptyJournal()` or `postEntry()` made the state's journal.
 */
export function serialize(state: GameState): string {
  return JSON.stringify({
    saveVersion: SAVE_VERSION,
    day: state.day,
    seed: state.seed,
    rngState: state.rngState,
    journal: entriesOf(state.journal),
    inventory: state.inventory,
    lastDay: state.lastDay,
    marketingHistory: state.marketingHistory,
    decisions: state.decisions,
    pendingDecisions: state.pendingDecisions,
    profile: state.profile,
    personal: state.personal,
    energy: state.energy,
    events: state.events,
    receivables: state.receivables,
  } satisfies Record<keyof Save, unknown>)
}

/**
 * Loads a game `serialize()` wrote. The journal is rebuilt from
 * `emptyJournal()` by posting every saved entry again.
 *
 * Throws an Error that starts with "Invalid save:" and names the problem
 * unless: the text is JSON of the current `SAVE_VERSION`, or of version 8,
 * which loads with no change to the street, or of version 7, which also
 * loads with no event and no receivable; every field has
 * the right type and no other key appears; every entry posts again through
 * `postEntry()` and none is dated after the save's day; the books add up
 * within the safe integer range; the lots are oldest first, none bought
 * after the save's day, and they cost what the Stocks account carries;
 * `lastDay` is the save's day or the day before, and null only on day 0,
 * with its `botched` the sum of its visits'; the owner's energy is full
 * before day 0 is played, `lastDay`'s energy on its own day, and no lower
 * than it the morning after, since a night only gives energy back, unless
 * an event's choice was made that morning, day 0 included; the marketing
 * history holds one day for each day played up to the content's
 * `awarenessDays`, none above the most the budget may be; the decisions,
 * and those pending if any, keep within the content's limits and each
 * product's kind of restock rule; the profile passes `validateProfile()`;
 * the personal account holds nothing before day 0 is played but what a
 * choice made that morning moved, and otherwise only movements and unpaid
 * rents up to `lastDay`'s day, in its months kept and in order, each
 * « Salaire » above zero and every other movement of `LABELS` below, and a
 * « Loyer » on each day the rent went unpaid, besides the movements of the
 * events' `personal` effects, of any amount but 0, up to the save's day,
 * whose labels may be those of `LABELS` too; the receivables are
 * by due day, each sold no later than the save's day and due after the
 * sale and after `lastDay`'s day, and they add up to Comptes clients; the
 * events pass `checkEvents()`; and the journal opens with the books of the
 * profile's difficulty (see `checkDifficulty`).
 *
 * The products, limits, restock kinds, `awarenessDays` and the truck's
 * price are those of `content` as it is now, the events, choices, outcomes
 * and personal labels those of `events`, and the starting cash and the
 * trucks' terms those of `difficulties`, so tuning that changes the days,
 * narrows the others, drops an event or changes how a game opens can stop
 * older saves from loading.
 */
export function deserialize(
  text: string,
  content: FoodTruckContent = FOOD_TRUCK,
  events: EventContent = EVENTS,
  difficulties: DifficultyContent = DIFFICULTIES,
): GameState {
  const save = parsed(text)
  const journal = rebuilt(save.journal)
  checkBooks(save, journal)
  checkInventory(save, journal)
  checkReceivables(save, journal)
  checkLastDay(save)
  checkEvents(save, events)
  checkEnergy(save)
  checkMarketingHistory(save, content)
  checkDecisions('decisions', save.decisions, content)
  if (save.pendingDecisions !== null) {
    checkDecisions('pendingDecisions', save.pendingDecisions, content)
  }
  attempt('profile', () => validateProfile(save.profile))
  checkDifficulty(save, journal, content, difficulties)
  checkPersonal(save, events)
  // Field by field, so a GameState field the save lacks fails the type check.
  return {
    day: save.day,
    seed: save.seed,
    rngState: save.rngState,
    journal,
    inventory: save.inventory,
    lastDay: save.lastDay,
    marketingHistory: save.marketingHistory,
    decisions: save.decisions,
    pendingDecisions: save.pendingDecisions,
    profile: save.profile,
    personal: save.personal,
    energy: save.energy,
    events: save.events,
    receivables: save.receivables,
  }
}

function parsed(text: string): Save {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    invalid('not JSON', error)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    invalid('not a saved game')
  }
  // Before the schema, so a save from another version says so plainly.
  const { saveVersion } = raw as { saveVersion?: unknown }
  if (saveVersion === SAVE_VERSION) return checked(saveSchema, raw)
  // An older version's own schema first, strict, so a key it did not know
  // still fails the load.
  if (saveVersion === EVENTLESS_VERSION) {
    checked(eventlessSchema, raw)
  } else if (saveVersion === STREETLESS_VERSION) {
    checked(streetlessSchema, raw)
  } else {
    invalid(`unsupported saveVersion ${JSON.stringify(saveVersion)}`)
  }
  // As that schema checked them: version 7 has no events or receivables.
  const old = raw as {
    lastDay: object | null
    events?: object
    receivables?: unknown
  }
  return checked(saveSchema, {
    ...raw,
    saveVersion: SAVE_VERSION,
    lastDay: old.lastDay === null ? null : { ...old.lastDay, modifiers: [] },
    events: { ...(old.events ?? noEvents()), modifiers: [] },
    receivables: old.receivables ?? [],
  })
}

function checked<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid save:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

function rebuilt(entries: readonly JournalEntry[]): Journal {
  return entries.reduce(
    (journal, entry, index) =>
      attempt(`journal entry ${index + 1}`, () => postEntry(journal, entry)),
    emptyJournal(),
  )
}

function checkBooks(save: Save, journal: Journal): void {
  // Days never go down in a journal, so the last entry is the latest.
  const last = save.journal.at(-1)
  if (last !== undefined && last.day > save.day) {
    invalid(
      `journal entry ${save.journal.length} is on day ${last.day}, after day ${save.day}`,
    )
  }
  // Every account and both columns, so books whose sums leave the safe
  // integer range fail here instead of in a statement later.
  attempt('the books', () => trialBalance(journal, save.day))
}

function checkInventory(save: Save, journal: Journal): void {
  save.inventory.forEach((lot, index) => {
    if (lot.boughtOnDay > save.day) {
      invalid(
        `lot ${index + 1} was bought on day ${lot.boughtOnDay}, after day ${save.day}`,
      )
    }
    const before = save.inventory[index - 1]
    if (before !== undefined && lot.boughtOnDay < before.boughtOnDay) {
      invalid(
        `lot ${index + 1} is older than the lot before it: day ${lot.boughtOnDay} < day ${before.boughtOnDay}`,
      )
    }
  })
  const cost = attempt('the lots', () => inventoryValue(save.inventory))
  // In range: checkBooks() already added up these same entries.
  const stocks = balance(journal, STOCKS, { toDay: save.day })
  if (stocks !== cost) {
    invalid(
      `the Stocks balance of ${stocks} does not equal the lots' cost of ${cost}`,
    )
  }
}

/**
 * What customers could owe at the save's day: sales up to that day, by due
 * day, each due after its sale and after `lastDay`'s day, since the start of
 * each day played collected what was due, and adding up to Comptes clients.
 */
function checkReceivables(save: Save, journal: Journal): void {
  const { day, lastDay, receivables } = save
  const played = lastDay?.day ?? -1
  receivables.forEach(({ soldOnDay, dueDay }, index) => {
    const what = `receivable ${index + 1}`
    if (soldOnDay > day) {
      invalid(`${what} was sold on day ${soldOnDay}, after day ${day}`)
    }
    if (dueDay <= soldOnDay) {
      invalid(`${what} is due on day ${dueDay}, not after its sale`)
    }
    if (dueDay <= played) {
      invalid(`${what} is due on day ${dueDay}, a day already played`)
    }
    const before = receivables[index - 1]
    if (before !== undefined && dueDay < before.dueDay) {
      invalid(
        `${what} is due before the one before it: day ${dueDay} < day ${before.dueDay}`,
      )
    }
  })
  const owed = attempt('the receivables', () =>
    sum(receivables.map(({ amount }) => amount)),
  )
  // In range: checkBooks() already added up these same entries.
  const books = balance(journal, RECEIVABLES, { toDay: day })
  if (books !== owed) {
    invalid(
      `the Comptes clients balance of ${books} does not equal the ${owed} the receivables add up to`,
    )
  }
}

function checkLastDay({ day, lastDay }: Save): void {
  if (lastDay === null) {
    if (day !== 0) invalid(`lastDay is null on day ${day}`)
    return
  }
  if (lastDay.day !== day && lastDay.day !== day - 1) {
    invalid(`lastDay is day ${lastDay.day} on day ${day}`)
  }
  const botched = lastDay.visits.reduce(
    (total, visit) => total + visit.botched,
    0,
  )
  if (lastDay.botched !== botched) {
    invalid(
      `lastDay.botched is ${lastDay.botched}, not the ${botched} its visits botched`,
    )
  }
}

/**
 * Whether an event's choice was made on the save's day, before it was
 * played. `checkEvents()` already held the history to days in order, none
 * after the save's.
 */
function chosenThatMorning({ day, events }: Save): boolean {
  return events.history.at(-1)?.day === day
}

/**
 * The owner's energy as the game could leave it: full until day 0 is
 * played, `lastDay`'s at its close, and the morning after no lower, since
 * a night only gives energy back, unless a choice made that morning took
 * some, day 0 included.
 */
function checkEnergy(save: Save): void {
  const { day, lastDay, energy } = save
  if (lastDay === null) {
    if (energy !== FULL_ENERGY && !chosenThatMorning(save)) {
      invalid(`energy is ${energy} before day 0 is played, not ${FULL_ENERGY}`)
    }
  } else if (lastDay.day === day) {
    if (energy !== lastDay.energy) {
      invalid(
        `energy is ${energy} at the close of day ${day}, not lastDay's ${lastDay.energy}`,
      )
    }
  } else if (energy < lastDay.energy && !chosenThatMorning(save)) {
    invalid(
      `energy is ${energy} on the morning of day ${day}, below the ${lastDay.energy} of the close before`,
    )
  }
}

/**
 * What the events of `content` could leave at the save's day:
 * - the event waiting, if any, waits on a morning, before the day is
 *   played and before any other was chosen that morning, and is in
 *   `content`; one drawn rather than brought back was drawn that day;
 * - the last day drawn is no later than the save's day;
 * - the effects still to come, by day, are due after `lastDay`'s day, each
 *   from an event in `content`, and a follow-up among them brings one;
 * - the follow-ups, by day, each bring an event in `content`;
 * - the history, oldest first, holds days no later than the save's, each an
 *   event in `content`, one of its choices and one of that choice's
 *   outcomes;
 * - the headlines, oldest first, are no later than the save's day;
 * - the changes to the street still in effect, by first day, each from an
 *   event in `content`, start no later than the save's day, end no earlier
 *   than they start, and end after `lastDay`'s day, since its close dropped
 *   those that ended;
 * - `lastDay`'s changes to the street, by first day, were each in effect on
 *   its day and each from an event in `content`.
 */
function checkEvents(
  { day, lastDay, events }: Save,
  content: EventContent,
): void {
  const known = new Map(content.events.map((event) => [event.id, event]))
  const checkEvent = (what: string, id: string) => {
    if (!known.has(id)) invalid(`${what} is an unknown event: ${id}`)
  }
  const checkOrder = (what: string, at: number, before: number | undefined) => {
    if (before !== undefined && at < before) {
      invalid(
        `${what} comes before the one before it: day ${at} < day ${before}`,
      )
    }
  }
  const played = lastDay?.day ?? -1
  const {
    pending,
    delayed,
    followUps,
    history,
    lastDrawnDay,
    headlines,
    modifiers,
  } = events

  if (pending !== null) {
    if (played !== day - 1) {
      invalid(`an event waits at the close of day ${day}`)
    }
    if (history.at(-1)?.day === day) {
      invalid(`an event waits on day ${day}, after one was chosen that morning`)
    }
    checkEvent('the event waiting', pending.event)
    if (!pending.followUp && lastDrawnDay !== day) {
      invalid(
        `the event waiting was drawn on day ${day}, but lastDrawnDay is ${lastDrawnDay}`,
      )
    }
  }
  if (lastDrawnDay !== null && lastDrawnDay > day) {
    invalid(`lastDrawnDay is day ${lastDrawnDay}, after day ${day}`)
  }
  delayed.forEach(({ day: due, event, effect }, index) => {
    const what = `delayed effect ${index + 1}`
    if (due <= played) {
      invalid(`${what} is due on day ${due}, a day already played`)
    }
    checkOrder(what, due, delayed[index - 1]?.day)
    checkEvent(what, event)
    if (effect.kind === 'followUp')
      checkEvent(`${what}'s follow-up`, effect.event)
  })
  followUps.forEach(({ day: due, event }, index) => {
    const what = `follow-up ${index + 1}`
    checkOrder(what, due, followUps[index - 1]?.day)
    checkEvent(what, event)
  })
  history.forEach((record, index) => {
    const what = `event record ${index + 1}`
    if (record.day > day) {
      invalid(`${what} is on day ${record.day}, after day ${day}`)
    }
    checkOrder(what, record.day, history[index - 1]?.day)
    checkEvent(what, record.event)
    const choice = known
      .get(record.event)
      ?.choices.find(({ id }) => id === record.choice)
    if (choice === undefined) {
      invalid(
        `${what} is an unknown choice of ${record.event}: ${record.choice}`,
      )
    }
    if (record.outcome >= choice.outcomes.length) {
      invalid(
        `${what} is outcome ${record.outcome} of ${record.event}'s ${record.choice}, which has ${choice.outcomes.length}`,
      )
    }
  })
  headlines.forEach((headline, index) => {
    const what = `headline ${index + 1}`
    if (headline.day > day) {
      invalid(`${what} is on day ${headline.day}, after day ${day}`)
    }
    checkOrder(what, headline.day, headlines[index - 1]?.day)
  })
  modifiers.forEach(({ event, fromDay, lastDay: last }, index) => {
    const what = `street modifier ${index + 1}`
    checkEvent(what, event)
    if (fromDay > day) {
      invalid(`${what} starts on day ${fromDay}, after day ${day}`)
    }
    if (last < fromDay) {
      invalid(`${what} ends on day ${last}, before it starts on day ${fromDay}`)
    }
    if (last <= played) {
      invalid(`${what} ends on day ${last}, a day already played`)
    }
    checkOrder(what, fromDay, modifiers[index - 1]?.fromDay)
  })
  lastDay?.modifiers.forEach(({ event, fromDay, lastDay: last }, index) => {
    const what = `lastDay's street modifier ${index + 1}`
    checkEvent(what, event)
    if (fromDay > played || last < played) {
      invalid(
        `${what} is in effect from day ${fromDay} to day ${last}, not on day ${played}`,
      )
    }
    checkOrder(what, fromDay, lastDay.modifiers[index - 1]?.fromDay)
  })
}

/**
 * One day of spend for each day played, so the close of `lastDay`'s day
 * counts, up to `awarenessDays`; each no more than the budget's limit, so
 * a save cannot bring a crowd the game could never have.
 */
function checkMarketingHistory(
  { lastDay, marketingHistory }: Save,
  { marketing, decisionLimits }: FoodTruckContent,
): void {
  const played = lastDay === null ? 0 : lastDay.day + 1
  const days = Math.min(played, marketing.awarenessDays)
  if (marketingHistory.length !== days) {
    invalid(
      `marketingHistory holds ${marketingHistory.length} days, not ${days}`,
    )
  }
  const { max } = decisionLimits.marketingDailyCents
  marketingHistory.forEach((spent, index) => {
    if (spent > max) {
      invalid(
        `marketingHistory day ${index + 1} spent ${spent}, more than the ${max} the budget may be`,
      )
    }
  })
}

function checkDecisions(
  field: string,
  decisions: Decisions,
  content: FoodTruckContent,
): void {
  attempt(field, () => validateDecisions(decisions, content.decisionLimits))
  for (const product of PRODUCTS) {
    const { kind } = content.startingDecisions.restock[product]
    const saved = decisions.restock[product].kind
    if (saved !== kind) {
      invalid(`${field}.restock.${product} must be a ${kind} rule: ${saved}`)
    }
  }
}

/**
 * The journal opens with the books of the profile's difficulty (see
 * `openingJournal`), since the 1st of each month charges the truck of that
 * difficulty: books that hold no loan must not repay one, nor lease a truck
 * they own. One difficulty's opening books may start another's, as a lone
 * Mise de fonds would with the same starting cash, so when the journal
 * opens with the books of several, the game's are those with the most
 * entries.
 */
function checkDifficulty(
  save: Save,
  journal: Journal,
  content: FoodTruckContent,
  difficulties: DifficultyContent,
): void {
  const entries = entriesOf(journal)
  let opened: { id: DifficultyId; length: number } | undefined
  for (const id of difficultyIdSchema.options) {
    const opening = entriesOf(openingJournal(id, content, difficulties))
    const opens = opening.every((entry, index) =>
      sameEntry(entry, entries[index]),
    )
    if (opens && opening.length > (opened?.length ?? 0)) {
      opened = { id, length: opening.length }
    }
  }
  const { difficulty } = save.profile
  if (opened?.id !== difficulty) {
    invalid(
      `the journal does not open with the books of the profile's difficulty ${difficulty}`,
    )
  }
}

/** Whether `b` is an entry of `a`'s day, memo and lines. */
function sameEntry(a: JournalEntry, b: JournalEntry | undefined): boolean {
  return (
    b?.day === a.day &&
    b.memo === a.memo &&
    b.lines.length === a.lines.length &&
    a.lines.every(({ account, debit, credit }, index) => {
      const line = b.lines[index]
      return (
        line?.account === account &&
        line.debit === debit &&
        line.credit === credit
      )
    })
  )
}

/**
 * What the owner's account could hold at the close of `lastDay`'s day, or
 * on the morning after: what happened on the days played, in the months
 * `isKept()` keeps, in order, each amount of `LABELS` with the sign of its
 * label, each unpaid rent a day the rent was charged, and the movements of
 * `content`'s `personal` effects, of any amount but 0, which a choice made
 * that morning may have dated the save's day. Before day 0 is played, it
 * holds only the movements of a choice made that morning.
 *
 * A movement does not say what made it, so one whose label an effect gives
 * is held to the effects' rule, even when `LABELS` holds it too: a choice
 * may refund the « Loyer » or dock the « Salaire ».
 */
function checkPersonal(save: Save, content: EventContent): void {
  const { day, lastDay, personal } = save
  const { movements, unpaidRents } = personal
  const eventLabels = new Set(
    content.events.flatMap(({ choices }) =>
      choices.flatMap(({ outcomes }) =>
        outcomes.flatMap(({ effects }) =>
          effects.flatMap((effect) =>
            effect.kind === 'personal' ? [effect.label] : [],
          ),
        ),
      ),
    ),
  )
  if (lastDay === null) {
    const byChoice =
      chosenThatMorning(save) &&
      movements.every(({ label }) => eventLabels.has(label))
    if (unpaidRents.length > 0 || (movements.length > 0 && !byChoice)) {
      invalid('personal holds movements before day 0 is played')
    }
  }
  const today = lastDay?.day ?? day
  const checkDay = (
    what: string,
    at: number,
    before: number | undefined,
    latest: number,
  ) => {
    if (at > latest) invalid(`${what} is on day ${at}, after day ${latest}`)
    if (!isKept(at, today)) {
      invalid(
        `${what} is on day ${at}, outside the months kept on day ${today}`,
      )
    }
    if (before !== undefined && at < before) {
      invalid(
        `${what} is older than the one before it: day ${at} < day ${before}`,
      )
    }
  }

  const ownLabels: readonly string[] = Object.values(LABELS)
  movements.forEach(({ day: at, label, amount }, index) => {
    const what = `personal movement ${index + 1}`
    const before = movements[index - 1]?.day
    if (eventLabels.has(label)) {
      checkDay(what, at, before, day)
      if (amount === 0) invalid(`${what}, « ${label} », must not be 0`)
    } else if (ownLabels.includes(label)) {
      checkDay(what, at, before, today)
      const comesIn = label === LABELS.salary
      if (comesIn ? amount <= 0 : amount >= 0) {
        invalid(
          `${what}, « ${label} », must be ${comesIn ? 'above' : 'below'} 0: ${amount}`,
        )
      }
    } else {
      invalid(`${what} has an unknown label: « ${label} »`)
    }
  })
  unpaidRents.forEach((at, index) => {
    const what = `unpaid rent ${index + 1}`
    const before = unpaidRents[index - 1]
    checkDay(what, at, before, today)
    if (at === before) invalid(`${what} repeats day ${at}`)
    const charged = movements.some(
      (movement) => movement.day === at && movement.label === LABELS.rent,
    )
    if (!charged) {
      invalid(`${what} is on day ${at}, with no « Loyer » that day`)
    }
  })
}

/** Runs `step`, turning what it throws into an invalid save about `what`. */
function attempt<T>(what: string, step: () => T): T {
  try {
    return step()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    invalid(`${what}: ${reason}`, error)
  }
}

function invalid(reason: string, cause?: unknown): never {
  throw new Error(`Invalid save: ${reason}`, { cause })
}
