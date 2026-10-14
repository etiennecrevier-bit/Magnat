import { z } from 'zod'
import {
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
import { PRODUCTS, inventoryValue } from './inventory.ts'
import { cents } from './money.ts'
import { isRngState } from './rng.ts'
import type { Decisions, GameState, VisitOutcome } from './types.ts'

// A game saved as JSON and loaded back. A save is untrusted text: loading it
// checks every field against a strict schema, then rebuilds the books by
// posting each saved entry again, so no saved journal object ever reaches
// the game and the books hold only entries `postEntry()` accepts.

/**
 * The format `serialize()` writes. Bump it when a save written before a
 * change can no longer load (rule 8 in CLAUDE.md).
 */
export const SAVE_VERSION = 1

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

const count = z.int().nonnegative()

const gameDay = z.int().nonnegative()

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
  browsed: 'browsed',
} satisfies Record<VisitOutcome, VisitOutcome>)

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
      arrivalMinute: z.int().min(0).max(MINUTES_PER_DAY),
      segment: segmentIdSchema,
      bought: unitsPerProduct,
      outcome: visitOutcome,
    }),
  ),
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

const saveSchema = z.strictObject({
  saveVersion: z.literal(SAVE_VERSION),
  day: gameDay,
  seed: generatorState,
  rngState: generatorState,
  journal: z.array(entrySchema),
  inventory: z.array(lotSchema),
  lastDay: daySummarySchema.nullable(),
  decisions: decisionsSchema,
  pendingDecisions: decisionsSchema.nullable(),
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
    decisions: state.decisions,
    pendingDecisions: state.pendingDecisions,
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
 * `lastDay` is the save's day or the day before, and null only on day 0;
 * and the decisions, and those pending if any, keep within the content's
 * limits and each product's kind of restock rule.
 *
 * The products, limits and restock kinds are those of `content` as it is
 * now, so tuning that narrows them can stop older saves from loading.
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
  checkDecisions('decisions', save.decisions, content)
  if (save.pendingDecisions !== null) {
    checkDecisions('pendingDecisions', save.pendingDecisions, content)
  }
  // Field by field, so a GameState field the save lacks fails the type check.
  return {
    day: save.day,
    seed: save.seed,
    rngState: save.rngState,
    journal,
    inventory: save.inventory,
    lastDay: save.lastDay,
    decisions: save.decisions,
    pendingDecisions: save.pendingDecisions,
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
  } else if (lastDay.day !== day && lastDay.day !== day - 1) {
    invalid(`lastDay is day ${lastDay.day} on day ${day}`)
  }
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
