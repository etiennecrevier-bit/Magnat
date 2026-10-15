import { z } from 'zod'
import {
  avatarSchema,
  difficultyIdSchema,
  productIdSchema,
  segmentIdSchema,
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
import { FOOD_TRUCK } from './day.ts'
import { validateDecisions } from './decisions.ts'
import { FULL_ENERGY } from './energy.ts'
import { PRODUCTS, inventoryValue } from './inventory.ts'
import { cents } from './money.ts'
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
 * change can no longer load (rule 8 in CLAUDE.md). Version 7 adds the
 * owner's energy and botched units: a version 6 game has neither. Version 6
 * adds the owner's personal account: a version 5 game has none. Version 5
 * spends the marketing budget: a version 4 game has no marketing history.
 * Version 4 adds the line at the counter: a version 3 `lastDay` has no
 * visits served or left and no waits. Version 3 opened the books by
 * difficulty and charged the real costs. A version 2 game's books hold no
 * truck and no loan, so it would repay a loan it never took and depreciate
 * a truck it never bought.
 */
export const SAVE_VERSION = 7

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

// `checkPersonal()` checks the days, their order and each amount's sign.
const personalSchema = z.strictObject({
  cash: signedMoney,
  movements: z.array(
    z.strictObject({
      day: gameDay,
      label: z.enum([LABELS.salary, LABELS.rent, LABELS.weeklyExpenses]),
      amount: signedMoney,
    }),
  ),
  unpaidRents: z.array(gameDay),
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
})

type Save = z.output<typeof saveSchema>

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
  } satisfies Record<keyof Save, unknown>)
}

/**
 * Loads a game `serialize()` wrote. The journal is rebuilt from
 * `emptyJournal()` by posting every saved entry again.
 *
 * Throws an Error that starts with "Invalid save:" and names the problem
 * unless: the text is JSON of the current `SAVE_VERSION`; every field has
 * the right type and no other key appears; every entry posts again through
 * `postEntry()` and none is dated after the save's day; the books add up
 * within the safe integer range; the lots are oldest first, none bought
 * after the save's day, and they cost what the Stocks account carries;
 * `lastDay` is the save's day or the day before, and null only on day 0,
 * with its `botched` the sum of its visits'; the owner's energy is full
 * before day 0 is played, `lastDay`'s energy on its own day, and no lower
 * than it the morning after, since a night only gives energy back; the
 * marketing history holds one day for each day played up to the
 * content's `awarenessDays`, none above the most the budget may be; the
 * decisions, and those pending if any, keep within the content's limits
 * and each product's kind of restock rule; the profile passes
 * `validateProfile()`; and the personal account holds nothing before day 0
 * is played, and otherwise only movements and unpaid rents up to
 * `lastDay`'s day, in its months kept and in order, each « Salaire » above
 * zero and every other movement below, and a « Loyer » on each day the rent
 * went unpaid.
 *
 * The products, limits, restock kinds and `awarenessDays` are those of
 * `content` as it is now, so tuning that changes the days or narrows the
 * others can stop older saves from loading.
 */
export function deserialize(
  text: string,
  content: FoodTruckContent = FOOD_TRUCK,
): GameState {
  const save = parsed(text)
  const journal = rebuilt(save.journal)
  checkBooks(save, journal)
  checkInventory(save, journal)
  checkLastDay(save)
  checkEnergy(save)
  checkMarketingHistory(save, content)
  checkDecisions('decisions', save.decisions, content)
  if (save.pendingDecisions !== null) {
    checkDecisions('pendingDecisions', save.pendingDecisions, content)
  }
  attempt('profile', () => validateProfile(save.profile))
  checkPersonal(save)
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
  if (saveVersion !== SAVE_VERSION) {
    invalid(`unsupported saveVersion ${JSON.stringify(saveVersion)}`)
  }
  const result = saveSchema.safeParse(raw)
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
 * The owner's energy as the game could leave it: full until day 0 is
 * played, `lastDay`'s at its close, and the morning after no lower, since
 * a night only gives energy back.
 */
function checkEnergy({ day, lastDay, energy }: Save): void {
  if (lastDay === null) {
    if (energy !== FULL_ENERGY) {
      invalid(`energy is ${energy} before day 0 is played, not ${FULL_ENERGY}`)
    }
  } else if (lastDay.day === day) {
    if (energy !== lastDay.energy) {
      invalid(
        `energy is ${energy} at the close of day ${day}, not lastDay's ${lastDay.energy}`,
      )
    }
  } else if (energy < lastDay.energy) {
    invalid(
      `energy is ${energy} on the morning of day ${day}, below the ${lastDay.energy} of the close before`,
    )
  }
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
 * What the owner's account could hold at the close of `lastDay`'s day: what
 * happened on the days played, in the months `isKept()` keeps, in order,
 * each amount with the sign of its label, and each unpaid rent a day the
 * rent was charged.
 */
function checkPersonal({ lastDay, personal }: Save): void {
  const { movements, unpaidRents } = personal
  if (lastDay === null) {
    if (movements.length > 0 || unpaidRents.length > 0) {
      invalid('personal holds movements before day 0 is played')
    }
    return
  }
  const today = lastDay.day
  const checkDay = (what: string, day: number, before: number | undefined) => {
    if (day > today) invalid(`${what} is on day ${day}, after day ${today}`)
    if (!isKept(day, today)) {
      invalid(
        `${what} is on day ${day}, outside the months kept on day ${today}`,
      )
    }
    if (before !== undefined && day < before) {
      invalid(
        `${what} is older than the one before it: day ${day} < day ${before}`,
      )
    }
  }

  movements.forEach(({ day, label, amount }, index) => {
    const what = `personal movement ${index + 1}`
    checkDay(what, day, movements[index - 1]?.day)
    const comesIn = label === LABELS.salary
    if (comesIn ? amount <= 0 : amount >= 0) {
      invalid(
        `${what}, « ${label} », must be ${comesIn ? 'above' : 'below'} 0: ${amount}`,
      )
    }
  })
  unpaidRents.forEach((day, index) => {
    const what = `unpaid rent ${index + 1}`
    const before = unpaidRents[index - 1]
    checkDay(what, day, before)
    if (day === before) invalid(`${what} repeats day ${day}`)
    const charged = movements.some(
      (movement) => movement.day === day && movement.label === LABELS.rent,
    )
    if (!charged) {
      invalid(`${what} is on day ${day}, with no « Loyer » that day`)
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
