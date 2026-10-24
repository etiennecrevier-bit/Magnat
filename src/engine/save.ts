import { z } from 'zod'
import {
  avatarSchema,
  candidateIdSchema,
  croissantSourceSchema,
  difficultyIdSchema,
  districtIdSchema,
  eventEffectSchema,
  grocerIdSchema,
  medalSchema,
  ovenTermsSchema,
  placeIdSchema,
  postcardIdSchema,
  productIdSchema,
  rungIdSchema,
  segmentIdSchema,
  staffRoleIdSchema,
  streetChangeSchema,
  truckIdSchema,
  winterStorageSchema,
  type BakeryContent,
  type Defi,
  type DefiContent,
  type DifficultyContent,
  type DifficultyId,
  type DreamContent,
  type EventContent,
  type FinancingContent,
  type FoodTruckContent,
  type GrocerContent,
  type PlacesContent,
  type StaffContent,
  type TutorialContent,
} from '../content/schema.ts'
import {
  getAccount,
  isAccountCode,
  type AccountCode,
} from '../finance/accounts.ts'
import {
  balance,
  emptyJournal,
  entriesOf,
  postEntry,
  trialBalance,
  type Journal,
  type JournalEntry,
} from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import {
  BAKERY,
  BAKERY_MEMO,
  closedBakery,
  holdsPremises,
  morningBakery,
} from './bakery.ts'
import { endAtClose, monthsBelowZero } from './bankruptcy.ts'
import { endOfMonth, mondayOf, sundayOf, toCalendar } from './calendar.ts'
import {
  challengeDifficulties,
  forcedEventOn,
  lowestCashSince,
  sameLocked,
  setupDecisions,
  startDayOf,
  startingEnergy,
  verdict,
} from './challenge.ts'
import { GROCERS } from './contracts.ts'
import {
  DEFIS,
  DIFFICULTIES,
  EVENTS,
  FOOD_TRUCK,
  COST_OF_SALES_MEMO,
  FIRST_TRUCK_MEMOS,
  SALES_MEMO,
  TRUCK_MEMO,
  openingJournal,
  truckOnBooks,
} from './day.ts'
import {
  startingDecisions,
  validateDecisions,
  validateStaff,
  validateTrucks,
} from './decisions.ts'
import {
  DREAM,
  DREAM_MEMO,
  dreamBonuses,
  dreamDepreciation,
  dreamLabel,
  dreamLimits,
  housingLabels,
  isCompany,
  isPersonal,
  noDream,
  prerequisitesMet,
  purchaseCost,
  purchaseEntries,
  purchaseMovements,
  rungOf,
  truckOfRung,
  truckReplacedOn,
} from './dream.ts'
import { FULL_ENERGY } from './energy.ts'
import { noEvents } from './events.ts'
import {
  FINANCING,
  belowZeroSinceOf,
  chargesOn,
  isFinancingMemo,
  isLoanOpen,
  loanEntries,
  noFinancing,
  saleEntries,
} from './financing.ts'
import { PRODUCTS, inventoryValue } from './inventory.ts'
import { MARKETING_DAYS_KEPT } from './marketing.ts'
import { cents, sub, sum } from './money.ts'
import { netWorth } from './netWorth.ts'
import { LABELS, isKept } from './personal.ts'
import { PLACES, noTrips, takesTheDay } from './places.ts'
import { validateProfile } from './profile.ts'
import { isRngState } from './rng.ts'
import { STAFF, askingWage, isAbsent, quitsOnDay } from './staff.ts'
import { FIRST_TRUCK, newTruck, truckIds } from './trucks.ts'
import { TUTORIAL, isProtected, tutorialDay, tutorialStep } from './tutorial.ts'
import type {
  BakeryPlan,
  BakeryState,
  ChallengeStatus,
  Day,
  Decisions,
  DreamState,
  FinancingState,
  GameState,
  Hire,
  PersonalMovement,
  TownState,
  VisitOutcome,
  WeekDay,
  WeekRecord,
  WeekReport,
  WeekSoFar,
} from './types.ts'
import { WEEKS_KEPT, openingWeek } from './week.ts'
import { WORK_DAYS_KEPT } from './work.ts'

// A game saved as JSON and loaded back. A save is untrusted text: loading it
// checks every field against a strict schema, then rebuilds the books by
// posting each saved entry again, so no saved journal object ever reaches
// the game and the books hold only entries `postEntry()` accepts.

/**
 * The format `serialize()` writes. Bump it when a save written before a
 * change can no longer load (rule 8 in CLAUDE.md). Version 21 adds the
 * districts (#260): the
 * tourists, a segment of their own, and the dates each truck is stored for
 * the winter: a version 20 game still loads, with no tourist on its last
 * days and no truck stored. Version 20 adds the
 * trucks after the first (#259), the truck the owner and each employee «
 * Au camion » work at, and the truck a journal line is: a version 19 game
 * still loads, as one Plateau truck, with its truck's sales and charges
 * named on their lines as the game names them now (see `firstTruckTags`).
 * Version 19 adds the
 * owner's trips in town: a version 18 game still loads, with no trip and no
 * discount waiting. Version 18 adds « Le
 * rêve »: a version 17 game still loads, with nothing bought and no «
 * Magnat » yet. Version 17 adds the
 * owner's net worth at the close of each week's Sunday: a version 16 game
 * still loads, with none for the weeks it reported. Version 16 adds the end
 * of a game, by bankruptcy: a version 15 game still loads, as a game that
 * goes on. Version 15 adds the
 * emergency loans and the share sales: a version 14 game still loads, with
 * none, nobody come to lend yet and the closes below zero read from its
 * books. Version 14 adds the
 * employees, the owner's absence and the missed deliveries: a version 13 game
 * still loads, with nobody on staff or wanted, the owner at work, no strike
 * and nothing missed. Version 13 adds the
 * grocers' contracts: a version 12 game still loads, with no contract and no
 * delivery. Version 12 adds the bakery: a version 11 game still loads, with
 * none planned, none running, no oven and the croissants bought. Version 11
 * adds the Défis: a version 10 game still loads, as a game that is not a
 * Défi.
 * Version 10 adds the week in numbers: a version 9 game still loads, with no week reported yet and
 * the week under way counted from its last close. Version 9 adds the
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
export const SAVE_VERSION = 21

/** The older formats `deserialize()` still loads: see `SAVE_VERSION`. */
const TOURISTLESS_VERSION = 20
const TRUCKLESS_VERSION = 19
const TOWNLESS_VERSION = 18
const DREAMLESS_VERSION = 17
const NETWORTHLESS_VERSION = 16
const ENDLESS_VERSION = 15
const FINANCINGLESS_VERSION = 14
const STAFFLESS_VERSION = 13
const CONTRACTLESS_VERSION = 12
const BAKERYLESS_VERSION = 11
const CHALLENGELESS_VERSION = 10
const WEEKLESS_VERSION = 9
const STREETLESS_VERSION = 8
const EVENTLESS_VERSION = 7

const CASH: AccountCode = '1000'
const RECEIVABLES: AccountCode = '1100'
const STOCKS: AccountCode = '1200'
const EQUIPMENT: AccountCode = '1500'

// Calendar facts, not tunables: arrivals are minutes of one day, and the
// weeks of the history start 7 days apart.
const MINUTES_PER_DAY = 1440
const DAYS_PER_WEEK = 7

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

/**
 * A record holding a `value` for each product. A save from before the
 * lemonade (#261) has none, so it gets `lemonade`; every other product
 * stays required, and a lemonade the save has must be valid.
 */
function perProductOf<Value extends z.ZodType>(
  value: Value,
  lemonade: () => z.util.NoUndefined<z.output<Value>>,
) {
  return z.strictObject({
    cafe: value,
    chocolat: value,
    croissant: value,
    limonade: value.default(lemonade),
  })
}

const unitsPerProduct = perProductOf(count, () => 0)

const accountCode = z.custom<AccountCode>(
  (value) => typeof value === 'string' && isAccountCode(value),
  'unknown account',
)

// `postEntry()` checks the rest: one side per line, balance, day order;
// `checkTrucks()` the trucks the lines name.
const entrySchema = z.strictObject({
  day: gameDay,
  memo: z.string(),
  lines: z
    .array(
      z.strictObject({
        account: accountCode,
        debit: money,
        credit: money,
        truck: truckIdSchema.optional(),
      }),
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

// `checkContracts()` checks the days, their order and the croissants made.
const deliverySchema = z.strictObject({
  day: gameDay,
  grocer: grocerIdSchema,
  units: z.int().positive(),
  baked: count,
  amount: z
    .int()
    .positive()
    .transform((n) => cents(n)),
  dueDay: gameDay,
})

// `checkContracts()` checks the days, their order and the strikes.
const missedSchema = z.strictObject({ day: gameDay, grocer: grocerIdSchema })

// `checkEvents()` checks the days, their order and the event ids.
const modifierSchema = z.strictObject({
  event: z.string(),
  change: streetChangeSchema,
  fromDay: gameDay,
  lastDay: gameDay,
  // A save from before #262 has none: the first truck's.
  district: districtIdSchema.optional(),
})

const workerSchema = z.union([z.literal('owner'), candidateIdSchema])

const personDaySchema = z.strictObject({
  who: workerSchema,
  customers: count,
  sales: money,
  deliveries: count,
  invoiced: money,
  baked: count,
  bakedCost: money,
  boughtCost: money,
})

/** The segments of a save from before the tourists (#260). */
const touristlessSegmentSchema = segmentIdSchema.exclude(['touriste'])

/** Each segment's visits, of the segments of `segments`, by how they ended. */
function segmentTallies<Segments extends z.ZodEnum>(segments: Segments) {
  return z.record(
    segments,
    z.strictObject({
      visits: count,
      buyers: count,
      tooExpensive: count,
      soldOut: count,
    }),
  )
}

/** A day's visits, of customers of the segments of `segments`. */
function visitsOf<Segments extends z.ZodEnum>(segments: Segments) {
  return z.array(
    z.strictObject({
      arrivalMinute: minuteOfDay,
      segment: segments,
      bought: unitsPerProduct,
      outcome: visitOutcome,
      // Service may run past closing time, even past midnight.
      servedMinute: count.nullable(),
      leftMinute: minuteOfDay.nullable(),
      botched: count,
      // A save from before #283 and #284 has neither.
      servedBy: workerSchema.optional(),
      fromMarketing: z.literal(true).optional(),
    }),
  )
}

/** The segments and visits of a day with the tourists (#260). */
const withTouristsShape = {
  segments: segmentTallies(segmentIdSchema),
  visits: visitsOf(segmentIdSchema),
}

/**
 * The last day of a version 13 save, before the missed deliveries, and
 * before the tourists.
 */
const stafflessDaySummarySchema = z.strictObject({
  day: gameDay,
  sold: unitsPerProduct,
  revenue: money,
  lostSales: unitsPerProduct,
  // A save from before the « trop cher » by product (#236) has none.
  pricedOut: unitsPerProduct.default(() => ({
    cafe: 0,
    chocolat: 0,
    croissant: 0,
    limonade: 0,
  })),
  spoiled: unitsPerProduct,
  segments: segmentTallies(touristlessSegmentSchema),
  visits: visitsOf(touristlessSegmentSchema),
  leftLine: count,
  averageWaitSeconds: count,
  longestWaitSeconds: count,
  energy: energyLevel,
  botched: count,
  modifiers: z.array(modifierSchema),
  deliveries: z.array(deliverySchema),
  // A save from before #283 has neither.
  work: z.array(personDaySchema).optional(),
  ownerAway: z.literal(true).optional(),
})

/** A truck's last day in a version 20 save, before the tourists. */
const touristlessTruckDaySchema = stafflessDaySummarySchema
  .pick({
    day: true,
    sold: true,
    revenue: true,
    lostSales: true,
    pricedOut: true,
    spoiled: true,
    segments: true,
    visits: true,
    leftLine: true,
    averageWaitSeconds: true,
    longestWaitSeconds: true,
    botched: true,
  })
  .extend({ open: z.boolean() })

// `checkTrucks()` checks the day and the botched units.
const truckDaySchema = touristlessTruckDaySchema.extend(withTouristsShape)

/** The last day of a version 14 to 20 save, before the tourists. */
const touristlessDaySummarySchema = stafflessDaySummarySchema.extend({
  missed: z.array(missedSchema),
  // A save from before the employees' traits (#255) has neither.
  absent: z.array(candidateIdSchema).min(1).optional(),
  quits: z.array(candidateIdSchema).min(1).optional(),
})

type TouristlessDay = z.output<typeof touristlessDaySummarySchema>

// `checkStaff()` checks the absent and those who quit against the staff.
const daySummarySchema = touristlessDaySummarySchema.extend(withTouristsShape)

// `checkWorkDays()` checks the days and their order.
const workDaySchema = z.strictObject({
  day: gameDay,
  people: z.array(personDaySchema),
  ownerAway: z.boolean(),
  absent: z.array(candidateIdSchema),
})

// `checkMarketingDays()` checks the days, their order and the spend.
const marketingDaySchema = z.strictObject({
  day: gameDay,
  spent: money,
  customers: count,
  sales: money,
})

const restockRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('buyDaily'), quantity: count }),
  z.strictObject({
    kind: z.literal('topUp'),
    whenBelow: count,
    upTo: count,
  }),
])

/** A new game's lemonade decisions, for a save from before it (#261). */
const { pricesCents: STARTING_PRICES, restock: STARTING_RESTOCK } =
  FOOD_TRUCK.startingDecisions

/** The decisions of a version 11 save, before the bakery. */
const bakerylessDecisionsSchema = z.strictObject({
  prices: perProductOf(money, () => STARTING_PRICES.limonade),
  restock: perProductOf(restockRuleSchema, () => ({
    ...STARTING_RESTOCK.limonade,
  })),
  daysOpen: z.array(z.int()),
  ownerWeeklyPay: money,
  marketingDaily: money,
})

/** The decisions of a version 13 save, before the staff. */
const stafflessDecisionsSchema = bakerylessDecisionsSchema.extend({
  bakery: z.strictObject({ oven: ovenTermsSchema }).nullable(),
  croissantSource: croissantSourceSchema,
  bake: restockRuleSchema,
})

// `validateDecisions()` checks the wages, the truck's role and that nobody
// is hired twice, `validateTrucks()` the truck.
const hireSchema = z.strictObject({
  candidate: candidateIdSchema,
  role: staffRoleIdSchema,
  hourlyWage: money,
  truck: truckIdSchema.optional(),
})

/** The decisions of a version 20 save, before the storage. */
const touristlessDecisionsSchema = stafflessDecisionsSchema.extend({
  staff: z.array(hireSchema),
  ownerAt: truckIdSchema.optional(),
  trucks: z
    .record(
      truckIdSchema,
      bakerylessDecisionsSchema.pick({
        prices: true,
        restock: true,
        daysOpen: true,
      }),
    )
    .optional(),
})

// `validateDecisions()` checks the limits, the days open and the storage,
// `checkBakery()` the bakery planned against the bakery, `checkStaff()` the
// staff against the staff on hand, and `validateTrucks()` the trucks
// against the trucks.
const decisionsSchema = touristlessDecisionsSchema.extend({
  trucks: z
    .record(
      truckIdSchema,
      bakerylessDecisionsSchema
        .pick({ prices: true, restock: true, daysOpen: true })
        .extend({ storage: winterStorageSchema.optional() }),
    )
    .optional(),
  storage: winterStorageSchema.optional(),
})

/** A truck of a version 20 save, before the tourists. */
const touristlessTruckSchema = z.strictObject({
  id: truckIdSchema,
  district: districtIdSchema,
  boughtOnDay: gameDay,
  rngState: generatorState,
  inventory: z.array(lotSchema),
  lastDay: touristlessTruckDaySchema.nullable(),
})

// `checkTrucks()` checks the trucks against the rungs bought, their lots
// and their days.
const truckSchema = touristlessTruckSchema.extend({
  lastDay: truckDaySchema.nullable(),
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

const eventRecordSchema = z.strictObject({
  day: gameDay,
  event: z.string(),
  followUp: z.boolean(),
  choice: z.string(),
  outcome: count,
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
      // A save from before #262 has none: the first truck's.
      district: districtIdSchema.optional(),
    }),
  ),
  followUps: z.array(z.strictObject({ day: gameDay, event: z.string() })),
  history: z.array(eventRecordSchema),
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

// `checkWeek()` checks the days, the cash, the ventes and the bénéfice
// against the books, and the events against the history and the content.
const weekDaySchema = z.strictObject({
  day: gameDay,
  open: z.boolean(),
  sales: signedMoney,
  cashReceived: money,
  cashAtClose: signedMoney,
  customersServed: count,
  spoiled: unitsPerProduct,
  spoiledCost: money,
  lostToLine: count,
  lostToPrices: count,
  lostToStockouts: count,
})

const weekSoFarSchema = z.strictObject({
  cashAtStart: signedMoney,
  partial: z.boolean(),
  days: z.array(weekDaySchema),
  modifiers: z.array(modifierSchema),
})

const weekReportSchema = z.strictObject({
  firstDay: gameDay,
  partial: z.boolean(),
  days: z.array(weekDaySchema).min(1),
  sales: signedMoney,
  netIncome: signedMoney,
  cashAtStart: signedMoney,
  cashAtEnd: signedMoney,
  lowestCash: signedMoney,
  spoiled: unitsPerProduct,
  spoiledCost: money,
  lostToLine: count,
  lostToPrices: count,
  lostToStockouts: count,
  energy: energyLevel,
  daysOpenInARow: count,
  receivables: z.array(receivableSchema),
  unpaidRents: z.array(gameDay),
  events: z.array(eventRecordSchema),
  modifiers: z.array(modifierSchema),
  previousBest: signedMoney.nullable(),
  // A save from before #284 has none.
  marketing: z
    .strictObject({ spent: money, customers: count, sales: money })
    .optional(),
})

const weekRecordSchema = z.strictObject({
  firstDay: gameDay,
  sales: signedMoney,
  netIncome: signedMoney,
  cashAtEnd: signedMoney,
  netWorth: signedMoney.nullable(),
})

// Keyed by every ChallengeStatus, so a new one fails the type check until a
// save can hold it.
const challengeStatus = z.enum({
  enCours: 'enCours',
  reussi: 'reussi',
  echoue: 'echoue',
} satisfies Record<ChallengeStatus, ChallengeStatus>)

// `checkChallenge()` checks the Défi, its days, its progress against the
// books, and its status and medal against its goal.
const challengeSchema = z.strictObject({
  id: z.string(),
  startDay: gameDay,
  progress: z.strictObject({
    daysPlayed: count,
    sales: signedMoney,
    netIncome: signedMoney,
    lowestCash: signedMoney,
    customersServed: count,
    unitsSold: count,
    unitsSpoiled: count,
    lowestEnergy: energyLevel,
  }),
  lowestEnergySinceClose: energyLevel,
  status: challengeStatus,
  medal: medalSchema.nullable(),
})

type SavedDecisions = z.output<typeof decisionsSchema>

type StafflessDecisions = z.output<typeof stafflessDecisionsSchema>

// `checkBakery()` checks the days, the oven and the books.
const bakerySchema = z.strictObject({
  openedOnDay: gameDay.nullable(),
  oven: ovenTermsSchema.nullable(),
  closesAfterDay: gameDay.nullable(),
  ovenBoughtOnDay: gameDay.nullable(),
})

/** A contract of a version 13 save, before the strikes. */
const stafflessContractSchema = z.strictObject({
  grocer: grocerIdSchema,
  startDay: gameDay,
  weeksLeft: z.int().positive(),
  unitPrice: z
    .int()
    .positive()
    .transform((n) => cents(n)),
})

/** The contracts of a version 13 save, with nothing missed. */
const stafflessContractsSchema = z.strictObject({
  running: z.array(stafflessContractSchema),
  deliveries: z.array(deliverySchema),
  away: z.partialRecord(grocerIdSchema, gameDay),
})

// `checkContracts()` checks the contracts, the deliveries, those missed and
// the strikes against the grocers. In the order of `ContractsState`, so a
// game loaded writes the same save as one played on.
const contractsSchema = z.strictObject({
  running: z.array(stafflessContractSchema.extend({ strikes: count })),
  deliveries: z.array(deliverySchema),
  missed: z.array(missedSchema),
  away: z.partialRecord(grocerIdSchema, gameDay),
})

// `checkStaff()` checks the wages, the days and the staff against the
// decisions.
const employeeSchema = hireSchema.extend({
  hiredOnDay: gameDay,
  // A save from before the employees' traits (#255) has none: the next
  // morning starts counting.
  underpaidSince: gameDay.optional(),
})

// `checkFinancing()` checks the days, the rounds, the closes below zero and
// the books.
const financingSchema = z.strictObject({
  loans: z.array(
    z.strictObject({
      day: gameDay,
      lender: text,
      principal: z
        .int()
        .positive()
        .transform((n) => cents(n)),
      annualRateBasisPoints: count,
      termMonths: z.int().positive(),
      fee: money,
    }),
  ),
  shareSales: z.array(
    z.strictObject({
      day: gameDay,
      investor: text,
      amount: z
        .int()
        .positive()
        .transform((n) => cents(n)),
      share: z.number().gt(0).lt(1),
    }),
  ),
  belowZeroSince: gameDay.nullable(),
  lastLoanRequestDay: gameDay.nullable(),
})

// `checkEnded()` checks the day and the months below zero.
const endedSchema = z.strictObject({
  reason: z.enum({ bankruptcy: 'bankruptcy' }),
  day: gameDay,
})

// `checkDream()` checks the rungs, their days, their costs and the books.
const dreamSchema = z.strictObject({
  bought: z.array(
    z.strictObject({
      rung: rungIdSchema,
      day: gameDay,
      cost: z
        .int()
        .positive()
        .transform((n) => cents(n)),
    }),
  ),
  magnatOn: gameDay.nullable(),
})

// `checkTown()` checks the trip against the day and the discount against
// the places.
const townSchema = z.strictObject({
  trip: placeIdSchema.nullable(),
  discount: z.number().min(0).lt(1),
})

// `checkTutorial()` checks the step and the days against the content.
const tutorialSchema = z.strictObject({
  step: z.string().nullable(),
  startedDay: gameDay,
  endsDay: gameDay,
  done: z.boolean(),
  skipped: z.boolean(),
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
  // A save from before #284, and #283, has none.
  marketingDays: z
    .array(marketingDaySchema)
    .max(MARKETING_DAYS_KEPT)
    .optional(),
  workDays: z.array(workDaySchema).max(WORK_DAYS_KEPT).optional(),
  decisions: decisionsSchema,
  pendingDecisions: decisionsSchema.nullable(),
  // Absent until a truck is bought after the first.
  trucks: z.array(truckSchema).min(1).optional(),
  profile: profileSchema,
  personal: personalSchema,
  energy: energyLevel,
  events: eventsSchema,
  receivables: z.array(receivableSchema),
  weekSoFar: weekSoFarSchema,
  lastWeek: weekReportSchema.nullable(),
  weekHistory: z.array(weekRecordSchema),
  challenge: challengeSchema.nullable(),
  bakery: bakerySchema,
  contracts: contractsSchema,
  staff: z.array(employeeSchema),
  ownerAway: z.boolean(),
  financing: financingSchema,
  ended: endedSchema.nullable(),
  dream: dreamSchema,
  town: townSchema,
  // Absent in a game without a tutorial, so a save from before one loads.
  tutorial: tutorialSchema.optional(),
  // Absent until Réal's first postcard; `checkPostcards()` checks them.
  postcardsShown: z.array(postcardIdSchema).optional(),
})

// The week under way, and an older save's financing, may come from the
// books rather than the save.
type Save = Omit<
  z.output<typeof saveSchema>,
  'weekSoFar' | 'financing' | 'dream'
> & {
  readonly weekSoFar: WeekSoFar
  readonly financing: FinancingState
  readonly dream: DreamState
}

/**
 * A save as parsed: an older one has no week under way, nor financing,
 * until the books it holds are rebuilt.
 */
type Parsed = Omit<Save, 'weekSoFar' | 'financing'> & {
  readonly weekSoFar: WeekSoFar | null
  readonly financing: FinancingState | null
}

/**
 * A save as parsed, as version 20 has it: no tourist on its last days, nor
 * a truck stored.
 */
type Touristless = Omit<Parsed, 'saveVersion' | 'lastDay' | 'trucks'> & {
  readonly saveVersion: typeof TOURISTLESS_VERSION
  readonly lastDay: TouristlessDay | null
  readonly trucks?: z.output<typeof touristlessTruckSchema>[]
}

/** A save as parsed, as version 19 has it: one truck, no line named. */
type Truckless = Omit<Touristless, 'saveVersion' | 'trucks'> & {
  readonly saveVersion: typeof TRUCKLESS_VERSION
}

/** A save as parsed, as version 18 has it: no trip in town either. */
type Townless = Omit<Truckless, 'saveVersion' | 'town'> & {
  readonly saveVersion: typeof TOWNLESS_VERSION
}

/** A save as parsed, as version 17 has it: nothing of « Le rêve » either. */
type Dreamless = Omit<Townless, 'saveVersion' | 'dream'> & {
  readonly saveVersion: typeof DREAMLESS_VERSION
}

/** A version 20 save: no tourist and no storage. */
const touristlessSchema = saveSchema.extend({
  saveVersion: z.literal(TOURISTLESS_VERSION),
  lastDay: touristlessDaySummarySchema.nullable(),
  decisions: touristlessDecisionsSchema,
  pendingDecisions: touristlessDecisionsSchema.nullable(),
  trucks: z.array(touristlessTruckSchema).min(1).optional(),
})

/** A version 19 save: one truck. */
const trucklessSchema = touristlessSchema
  .omit({ trucks: true })
  .extend({ saveVersion: z.literal(TRUCKLESS_VERSION) })

/** A version 18 save: no trip in town either. */
const townlessSchema = trucklessSchema
  .omit({ town: true, tutorial: true, postcardsShown: true })
  .extend({ saveVersion: z.literal(TOWNLESS_VERSION) })

/** A version 17 save: nothing of « Le rêve » either. */
const dreamlessSchema = townlessSchema
  .omit({ dream: true })
  .extend({ saveVersion: z.literal(DREAMLESS_VERSION) })

/** A version 16 save: no net worth for the weeks it reported either. */
const networthlessSchema = dreamlessSchema.extend({
  saveVersion: z.literal(NETWORTHLESS_VERSION),
  weekHistory: z.array(weekRecordSchema.omit({ netWorth: true })),
})

/** A version 15 save: a game that goes on too. */
const endlessSchema = networthlessSchema
  .omit({ ended: true })
  .extend({ saveVersion: z.literal(ENDLESS_VERSION) })

/** A version 14 save: no emergency loan and no share sale either. */
const financinglessSchema = endlessSchema
  .omit({ financing: true })
  .extend({ saveVersion: z.literal(FINANCINGLESS_VERSION) })

/**
 * A version 13 save: nobody on staff or wanted, the owner at work, and
 * contracts with no strike and nothing missed.
 */
const stafflessSchema = financinglessSchema
  .omit({ staff: true, ownerAway: true })
  .extend({
    saveVersion: z.literal(STAFFLESS_VERSION),
    lastDay: stafflessDaySummarySchema.nullable(),
    decisions: stafflessDecisionsSchema,
    pendingDecisions: stafflessDecisionsSchema.nullable(),
    contracts: stafflessContractsSchema,
  })

type Staffless = z.output<typeof stafflessSchema>

/** A version 12 save: no contract either, and no delivery on the last day. */
const contractlessSchema = stafflessSchema.omit({ contracts: true }).extend({
  saveVersion: z.literal(CONTRACTLESS_VERSION),
  lastDay: stafflessDaySummarySchema.omit({ deliveries: true }).nullable(),
})

/** A version 11 save: no bakery either, and decisions without one. */
const bakerylessSchema = contractlessSchema.omit({ bakery: true }).extend({
  saveVersion: z.literal(BAKERYLESS_VERSION),
  decisions: bakerylessDecisionsSchema,
  pendingDecisions: bakerylessDecisionsSchema.nullable(),
})

/** A version 10 save: no Défi either. */
const challengelessSchema = bakerylessSchema
  .omit({ challenge: true })
  .extend({ saveVersion: z.literal(CHALLENGELESS_VERSION) })

/** A version 9 save: no week reported either. */
const weeklessSchema = challengelessSchema
  .omit({ weekSoFar: true, lastWeek: true, weekHistory: true })
  .extend({ saveVersion: z.literal(WEEKLESS_VERSION) })

/** A version 8 save: no change to the street either. */
const streetlessSchema = weeklessSchema.extend({
  saveVersion: z.literal(STREETLESS_VERSION),
  lastDay: stafflessDaySummarySchema
    .omit({ modifiers: true, deliveries: true })
    .nullable(),
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
    // JSON.stringify leaves these out of a game loaded from an older save,
    // until its next day.
    marketingDays: state.marketingDays,
    workDays: state.workDays,
    decisions: state.decisions,
    pendingDecisions: state.pendingDecisions,
    // JSON.stringify leaves it out of a game with one truck.
    trucks: state.trucks,
    profile: state.profile,
    personal: state.personal,
    energy: state.energy,
    events: state.events,
    receivables: state.receivables,
    weekSoFar: state.weekSoFar,
    lastWeek: state.lastWeek,
    weekHistory: state.weekHistory,
    challenge: state.challenge,
    bakery: state.bakery,
    contracts: state.contracts,
    staff: state.staff,
    ownerAway: state.ownerAway,
    financing: state.financing,
    ended: state.ended,
    dream: state.dream,
    town: state.town,
    // JSON.stringify leaves it out of a game without a tutorial.
    tutorial: state.tutorial,
    // And this one out of a game Réal has sent no postcard yet.
    postcardsShown: state.postcardsShown,
  } satisfies Record<keyof Save, unknown>)
}

/**
 * Loads a game `serialize()` wrote. The journal is rebuilt from
 * `emptyJournal()` by posting every saved entry again.
 *
 * A game's first day is day 0, or its Défi's first day, before which
 * nothing was played: the books open on day 0 either way.
 *
 * Throws an Error that starts with "Invalid save:" and names the problem
 * unless: the text is JSON of the current `SAVE_VERSION`, or of version 20,
 * which loads with no tourist on its last days and no truck stored, or of
 * version 19, which also loads as one Plateau truck, or of version 18,
 * which loads with no trip in town, or of version 17, which also loads with
 * nothing of « Le rêve », or of version 16,
 * which also loads with no net worth for the weeks it reported, or of version 15,
 * which also loads as a game that goes on, or of version 14,
 * which also loads with no financing, its closes below zero read from its
 * books, or of version 13,
 * which also loads with nobody on staff, the owner at work and nothing missed,
 * or of version 12, which also loads with no contract, or of version 11,
 * which also loads with no
 * bakery, or of version 10, which also loads as a game that is not a Défi,
 * or of version 9, which also
 * loads with no week reported yet and the week under way counted from its
 * books (see `weekSince`), or of version 8, which also loads with no
 * change to the street, or of version 7, which also loads with no event
 * and no receivable; every field has
 * the right type and no other key appears; every entry posts again through
 * `postEntry()` and none is dated after the save's day; the books add up
 * within the safe integer range; the lots are oldest first, none bought
 * after the save's day, and they cost what the Stocks account carries;
 * `lastDay` is the save's day or the day before, no earlier than the first
 * day, and null only on the first day, with its `botched` the sum of its
 * visits'; the owner's energy is full, or what the Défi sets, before the
 * first day is played, `lastDay`'s energy on its own day, and no lower than
 * it the morning after, since a night only gives energy back, unless an
 * event's choice was made that morning, the first day's included; the
 * marketing history holds one day for each day played up to the content's
 * `awarenessDays`, none above the most the budget may be; the decisions,
 * and those pending if any, keep within the content's limits and each
 * product's kind of restock rule; the profile passes `validateProfile()`;
 * the personal account holds nothing before the first day is played but
 * what a choice made that morning moved, and otherwise only movements and unpaid
 * rents up to `lastDay`'s day, in its months kept and in order, each
 * « Salaire » above zero and every other movement of `LABELS` below, and a
 * « Loyer » on each day the rent went unpaid, besides the movements of the
 * events' `personal` effects, of any amount but 0, up to the save's day,
 * whose labels may be those of `LABELS` too; the receivables are
 * by due day, each sold no later than the save's day and due after the
 * sale and after `lastDay`'s day, and they add up to Comptes clients; the
 * events pass `checkEvents()`; the journal opens with the books of the
 * profile's difficulty (see `checkDifficulty`), with the Défi's cash in a
 * Défi; the week under way, the last week reported and the history pass
 * `checkWeek()`; the Défi, if any, is one of `defis` and passes
 * `checkChallenge()`; the contracts pass `checkContracts()` against
 * `grocers`; the staff passes `checkStaff()` against `staff`; the
 * financing passes `checkFinancing()` against `financing`; the last week's
 * net worth, if any, passes `checkNetWorth()`; the end of
 * the game, if it ended, passes `checkEnded()` against `financing`; the
 * trips in town pass `checkTown()` against `places`; and the tutorial, if
 * any, passes `checkTutorial()` against `tutorial`; and Réal's postcards,
 * if any, come once each and not in a Défi; and the marketing days and
 * work days kept, if any, pass `checkDayHistory()`. A save without a
 * tutorial loads as a game without one, and a last day without its «
 * trop cher » by product loads with none, and one without the marketing
 * days, the work days, who served each visit and which marketing brought
 * loads with none of them (#283, #284).
 *
 * The products, limits, restock kinds, `awarenessDays` and the truck's
 * price are those of `content` as it is now, the events, choices, outcomes
 * and personal labels those of `events`, the starting cash and the trucks'
 * terms those of `difficulties`, the Défis those of `defis` and the share
 * rounds, second loans and months to a bankruptcy those of `financing`, so
 * tuning that changes the days, narrows the others, drops an event, changes
 * how a game opens, changes a Défi, allows fewer rounds or loans or takes
 * more months to a bankruptcy can stop older saves from loading.
 */
export function deserialize(
  text: string,
  content: FoodTruckContent = FOOD_TRUCK,
  events: EventContent = EVENTS,
  difficulties: DifficultyContent = DIFFICULTIES,
  defis: DefiContent = DEFIS,
  bakery: BakeryContent = BAKERY,
  grocers: GrocerContent = GROCERS,
  staff: StaffContent = STAFF,
  financing: FinancingContent = FINANCING,
  dream: DreamContent = DREAM,
  places: PlacesContent = PLACES,
  tutorial: TutorialContent = TUTORIAL,
): GameState {
  const loaded = parsed(text, bakery, dream)
  const journal = rebuilt(loaded.journal)
  checkBooks(loaded, journal)
  const defi = defiOf(loaded, defis)
  const opening =
    defi === null ? difficulties : challengeDifficulties(defi, difficulties)
  const save: Save = {
    ...loaded,
    weekSoFar: loaded.weekSoFar ?? weekSince(loaded, journal, content, opening),
    financing: loaded.financing ?? {
      ...noFinancing(),
      belowZeroSince: belowZeroSinceOf(
        journal,
        firstDay(loaded),
        loaded.lastDay?.day ?? firstDay(loaded) - 1,
      ),
    },
  }
  checkInventory(save, journal)
  checkReceivables(save, journal)
  checkLastDay(save)
  checkEvents(save, events)
  checkEnergy(save, defi === null ? FULL_ENERGY : startingEnergy(defi))
  checkMarketingHistory(save, content)
  checkDayHistory('marketingDays', save.marketingDays, save)
  checkDayHistory('workDays', save.workDays, save)
  checkDream(save, journal, content, dream, opening)
  checkTrucks(save, dream)
  checkDecisions(
    'decisions',
    save.decisions,
    save,
    content,
    bakery,
    staff,
    dream,
  )
  if (save.pendingDecisions !== null) {
    checkDecisions(
      'pendingDecisions',
      save.pendingDecisions,
      save,
      content,
      bakery,
      staff,
      dream,
    )
  }
  checkBakery(save, journal, bakery)
  attempt('profile', () => validateProfile(save.profile))
  checkDifficulty(save, journal, content, opening)
  checkPersonal(save, events, dream)
  checkWeek(save, journal, content, events, opening)
  if (defi !== null) checkChallenge(save, journal, defi, content, opening)
  checkContracts(save, grocers)
  checkStaff(save, staff)
  checkFinancing(save, journal, financing)
  checkNetWorth(save, journal, dream)
  checkEnded(save, financing)
  checkTown(save, places)
  checkTutorial(save, tutorial)
  checkPostcards(save)
  // Field by field, so a GameState field the save lacks fails the type check.
  return {
    day: save.day,
    seed: save.seed,
    rngState: save.rngState,
    journal,
    inventory: save.inventory,
    lastDay: save.lastDay,
    marketingHistory: save.marketingHistory,
    ...(save.marketingDays === undefined
      ? {}
      : { marketingDays: save.marketingDays }),
    ...(save.workDays === undefined ? {} : { workDays: save.workDays }),
    decisions: save.decisions,
    pendingDecisions: save.pendingDecisions,
    ...(save.trucks === undefined ? {} : { trucks: save.trucks }),
    profile: save.profile,
    personal: save.personal,
    energy: save.energy,
    events: save.events,
    receivables: save.receivables,
    weekSoFar: save.weekSoFar,
    lastWeek: save.lastWeek,
    weekHistory: save.weekHistory,
    challenge: save.challenge,
    bakery: save.bakery,
    contracts: save.contracts,
    staff: save.staff,
    ownerAway: save.ownerAway,
    financing: save.financing,
    ended: save.ended,
    dream: save.dream,
    town: save.town,
    ...(save.tutorial === undefined ? {} : { tutorial: save.tutorial }),
    ...(save.postcardsShown === undefined
      ? {}
      : { postcardsShown: save.postcardsShown }),
  }
}

function parsed(
  text: string,
  bakery: BakeryContent,
  dream: DreamContent,
): Parsed {
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
  return withTourists(touristless(raw, saveVersion, bakery, dream))
}

/** An older save, up to version 20, as version 20. */
function touristless(
  raw: object,
  saveVersion: unknown,
  bakery: BakeryContent,
  dream: DreamContent,
): Touristless {
  if (saveVersion === TOURISTLESS_VERSION) {
    return checked(touristlessSchema, raw)
  }
  return withTruckTags(truckless(raw, saveVersion, bakery), dream)
}

/**
 * A save from before the tourists (#260) as the current version: none on
 * its last day, nor on each truck's, and no truck stored.
 */
function withTourists(save: Touristless): Parsed {
  const { trucks, ...rest } = save
  return {
    ...rest,
    saveVersion: SAVE_VERSION,
    lastDay: withNoTourist(save.lastDay),
    ...(trucks === undefined
      ? {}
      : {
          trucks: trucks.map((truck) => ({
            ...truck,
            lastDay: withNoTourist(truck.lastDay),
          })),
        }),
  }
}

/** `day` with no tourist among its segments; null for no day. */
function withNoTourist<Day extends { readonly segments: object }>(
  day: Day | null,
) {
  if (day === null) return null
  return {
    ...day,
    segments: {
      ...day.segments,
      touriste: { visits: 0, buyers: 0, tooExpensive: 0, soldOut: 0 },
    },
  }
}

/** An older save, up to version 19, as version 19. */
function truckless(
  raw: object,
  saveVersion: unknown,
  bakery: BakeryContent,
): Truckless {
  if (saveVersion === TRUCKLESS_VERSION) return checked(trucklessSchema, raw)
  return withTown(townless(raw, saveVersion, bakery))
}

/**
 * A save from before the trucks after the first as version 20: one Plateau
 * truck, its sales and charges naming it on their lines as the game names
 * them now (see `firstTruckTags`).
 */
function withTruckTags(save: Truckless, dream: DreamContent): Touristless {
  return {
    ...save,
    saveVersion: TOURISTLESS_VERSION,
    journal: firstTruckTags(save.journal, dream),
  }
}

/**
 * `entries` with the lines of the état des résultats of the first truck's
 * own entries naming it, and no other line naming a truck: the entries of
 * `FIRST_TRUCK_MEMOS`, the depreciation of the rung of `dream` that
 * replaces the truck (see `truckOfRung`), and a « Coût des marchandises
 * vendues » right after the truck's cash sales of the same day, as a day
 * posts it. A day posts no other entry between them, and the grocers' and
 * events' cost of their sales never comes right after the truck's sales.
 */
function firstTruckTags(
  entries: Parsed['journal'],
  dream: DreamContent,
): Parsed['journal'] {
  const memos = new Set(FIRST_TRUCK_MEMOS)
  for (const rung of dream.company) {
    if (truckOfRung(rung) === FIRST_TRUCK) {
      memos.add(dreamLabel(DREAM_MEMO.depreciation, rung.name))
    }
  }
  return entries.map((entry, index) => {
    const before = entries[index - 1]
    const truck =
      memos.has(entry.memo) ||
      (entry.memo === COST_OF_SALES_MEMO &&
        before?.day === entry.day &&
        before.memo === SALES_MEMO)
    return {
      ...entry,
      lines: entry.lines.map(({ account, debit, credit }) =>
        truck && isIncomeStatement(account)
          ? { account, debit, credit, truck: FIRST_TRUCK }
          : { account, debit, credit },
      ),
    }
  })
}

/** Whether `account` is a line of the état des résultats. */
function isIncomeStatement(account: AccountCode): boolean {
  const { type } = getAccount(account)
  return type === 'produit' || type === 'charge'
}

/** An older save, up to version 18, as version 18. */
function townless(
  raw: object,
  saveVersion: unknown,
  bakery: BakeryContent,
): Townless {
  if (saveVersion === TOWNLESS_VERSION) return checked(townlessSchema, raw)
  return withDream(dreamless(raw, saveVersion, bakery))
}

/** An older save, up to version 17, as version 17. */
function dreamless(
  raw: object,
  saveVersion: unknown,
  bakery: BakeryContent,
): Dreamless {
  if (saveVersion === DREAMLESS_VERSION) return checked(dreamlessSchema, raw)
  if (saveVersion === NETWORTHLESS_VERSION) {
    return withNetWorths(checked(networthlessSchema, raw))
  }
  if (saveVersion === ENDLESS_VERSION) {
    return withNetWorths(withEnded(checked(endlessSchema, raw)))
  }
  if (saveVersion === FINANCINGLESS_VERSION) {
    return withNetWorths(
      withEnded(withFinancing(checked(financinglessSchema, raw))),
    )
  }
  if (saveVersion === STAFFLESS_VERSION) {
    return withNetWorths(
      withEnded(withFinancing(withStaff(checked(stafflessSchema, raw)))),
    )
  }
  if (saveVersion === CONTRACTLESS_VERSION) {
    return withNetWorths(
      withEnded(
        withFinancing(
          withStaff(withContracts(checked(contractlessSchema, raw))),
        ),
      ),
    )
  }
  if (saveVersion === BAKERYLESS_VERSION) {
    return withNetWorths(
      withEnded(
        withFinancing(
          withStaff(
            withContracts(withBakery(checked(bakerylessSchema, raw), bakery)),
          ),
        ),
      ),
    )
  }
  if (saveVersion === CHALLENGELESS_VERSION) {
    const save = checked(challengelessSchema, raw)
    return withNetWorths(
      withEnded(
        withFinancing(
          withStaff(
            withContracts(withBakery({ ...save, challenge: null }, bakery)),
          ),
        ),
      ),
    )
  }
  // An older version's own schema first, strict, so a key it did not know
  // still fails the load.
  if (saveVersion === EVENTLESS_VERSION) {
    checked(eventlessSchema, raw)
  } else if (saveVersion === STREETLESS_VERSION) {
    checked(streetlessSchema, raw)
  } else if (saveVersion === WEEKLESS_VERSION) {
    checked(weeklessSchema, raw)
  } else {
    invalid(`unsupported saveVersion ${JSON.stringify(saveVersion)}`)
  }
  // As that schema checked them: version 7 has no events or receivables,
  // and version 8 no change to the street.
  const old = raw as {
    lastDay: object | null
    events?: object
    receivables?: unknown
  }
  const save = checked(bakerylessSchema.omit({ weekSoFar: true }), {
    ...raw,
    saveVersion: BAKERYLESS_VERSION,
    lastDay: old.lastDay === null ? null : { modifiers: [], ...old.lastDay },
    events: { modifiers: [], ...(old.events ?? noEvents()) },
    receivables: old.receivables ?? [],
    lastWeek: null,
    weekHistory: [],
    challenge: null,
  })
  return withNetWorths(
    withEnded(
      withFinancing(
        withStaff(
          withContracts(withBakery({ ...save, weekSoFar: null }, bakery)),
        ),
      ),
    ),
  )
}

/**
 * A save from before the trips in town as version 19: no trip, no
 * discount waiting.
 */
function withTown<
  Old extends { readonly saveVersion: typeof TOWNLESS_VERSION },
>(
  save: Old,
): Omit<Old, 'saveVersion'> & {
  readonly saveVersion: typeof TRUCKLESS_VERSION
  readonly town: TownState
} {
  return { ...save, saveVersion: TRUCKLESS_VERSION, town: noTrips() }
}

/**
 * A save from before « Le rêve » as version 18: nothing bought, no «
 * Magnat » yet.
 */
function withDream<
  Old extends { readonly saveVersion: typeof DREAMLESS_VERSION },
>(
  save: Old,
): Omit<Old, 'saveVersion'> & {
  readonly saveVersion: typeof TOWNLESS_VERSION
  readonly dream: DreamState
} {
  return { ...save, saveVersion: TOWNLESS_VERSION, dream: noDream() }
}

/**
 * A save from before the net worth of each week as version 17: none for
 * the weeks it reported.
 */
function withNetWorths<
  Old extends {
    readonly saveVersion: typeof NETWORTHLESS_VERSION
    readonly weekHistory: readonly Omit<WeekRecord, 'netWorth'>[]
  },
>(
  save: Old,
): Omit<Old, 'saveVersion' | 'weekHistory'> & {
  readonly saveVersion: typeof DREAMLESS_VERSION
  readonly weekHistory: WeekRecord[]
} {
  return {
    ...save,
    saveVersion: DREAMLESS_VERSION,
    weekHistory: save.weekHistory.map((week) => ({ ...week, netWorth: null })),
  }
}

/** A save from before the end of a game as version 16: not ended. */
function withEnded<
  Old extends { readonly saveVersion: typeof ENDLESS_VERSION },
>(
  save: Old,
): Omit<Old, 'saveVersion'> & {
  readonly saveVersion: typeof NETWORTHLESS_VERSION
  readonly ended: null
} {
  return { ...save, saveVersion: NETWORTHLESS_VERSION, ended: null }
}

/**
 * A save from before the emergency loans and the share sales as version
 * 15, its financing to be read from its books once they are rebuilt.
 */
function withFinancing<
  Old extends { readonly saveVersion: typeof FINANCINGLESS_VERSION },
>(
  save: Old,
): Omit<Old, 'saveVersion'> & {
  readonly saveVersion: typeof ENDLESS_VERSION
  readonly financing: null
} {
  return { ...save, saveVersion: ENDLESS_VERSION, financing: null }
}

/**
 * A save from before the employees as version 14: with nobody on
 * staff, none wanted in the decisions and those pending, the owner at work,
 * no strike against a contract, nothing missed, and no delivery missed on
 * its last day.
 */
function withStaff<
  Old extends {
    readonly lastDay: Staffless['lastDay']
    readonly decisions: StafflessDecisions
    readonly pendingDecisions: StafflessDecisions | null
    readonly contracts: Staffless['contracts']
  },
>(
  save: Old,
): Omit<
  Old,
  'saveVersion' | 'lastDay' | 'decisions' | 'pendingDecisions' | 'contracts'
> & {
  readonly saveVersion: typeof FINANCINGLESS_VERSION
  readonly lastDay: TouristlessDay | null
  readonly decisions: SavedDecisions
  readonly pendingDecisions: SavedDecisions | null
  readonly contracts: Save['contracts']
  readonly staff: Save['staff']
  readonly ownerAway: boolean
} {
  const { contracts, pendingDecisions } = save
  return {
    ...save,
    saveVersion: FINANCINGLESS_VERSION,
    lastDay: save.lastDay === null ? null : { ...save.lastDay, missed: [] },
    decisions: { ...save.decisions, staff: [] },
    pendingDecisions:
      pendingDecisions === null ? null : { ...pendingDecisions, staff: [] },
    contracts: {
      running: contracts.running.map((contract) => ({
        ...contract,
        strikes: 0,
      })),
      deliveries: contracts.deliveries,
      missed: [],
      away: contracts.away,
    },
    staff: [],
    ownerAway: false,
  }
}

/**
 * A save from before the contracts as version 13: with no contract, and no
 * delivery on its last day.
 */
function withContracts<
  Old extends {
    readonly lastDay: z.output<typeof contractlessSchema>['lastDay']
  },
>(
  save: Old,
): Omit<Old, 'saveVersion' | 'lastDay'> & {
  readonly saveVersion: typeof STAFFLESS_VERSION
  readonly lastDay: Staffless['lastDay']
  readonly contracts: Staffless['contracts']
} {
  return {
    ...save,
    saveVersion: STAFFLESS_VERSION,
    lastDay: save.lastDay === null ? null : { ...save.lastDay, deliveries: [] },
    contracts: { running: [], deliveries: [], away: {} },
  }
}

/**
 * A save from before the bakery as version 12: with no bakery,
 * none planned and the croissants as `bakery` starts them, in the decisions
 * and those pending.
 */
function withBakery<
  Old extends {
    readonly decisions: z.output<typeof bakerylessDecisionsSchema>
    readonly pendingDecisions: z.output<typeof bakerylessDecisionsSchema> | null
  },
>(
  save: Old,
  bakery: BakeryContent,
): Omit<Old, 'saveVersion' | 'decisions' | 'pendingDecisions'> & {
  readonly saveVersion: typeof CONTRACTLESS_VERSION
  readonly decisions: StafflessDecisions
  readonly pendingDecisions: StafflessDecisions | null
  readonly bakery: BakeryState
} {
  const { croissantSource, bake } = bakery.startingDecisions
  const upgraded = (decisions: Old['decisions']): StafflessDecisions => ({
    ...decisions,
    bakery: null,
    croissantSource,
    bake: { ...bake },
  })
  return {
    ...save,
    saveVersion: CONTRACTLESS_VERSION,
    decisions: upgraded(save.decisions),
    pendingDecisions:
      save.pendingDecisions === null ? null : upgraded(save.pendingDecisions),
    bakery: closedBakery(),
  }
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

function checkBooks(
  save: Pick<Save, 'day' | 'journal'>,
  journal: Journal,
): void {
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

/**
 * Each truck's lots are oldest first, none bought after the save's day,
 * and every truck's lots together cost what the Stocks account carries.
 */
function checkInventory(save: Save, journal: Journal): void {
  const stocks = [
    { what: 'lot', lots: save.inventory },
    ...(save.trucks ?? []).map(({ id, inventory }) => ({
      what: `truck ${id}'s lot`,
      lots: inventory,
    })),
  ]
  for (const { what, lots } of stocks) {
    lots.forEach((lot, index) => {
      if (lot.boughtOnDay > save.day) {
        invalid(
          `${what} ${index + 1} was bought on day ${lot.boughtOnDay}, after day ${save.day}`,
        )
      }
      const before = lots[index - 1]
      if (before !== undefined && lot.boughtOnDay < before.boughtOnDay) {
        invalid(
          `${what} ${index + 1} is older than the lot before it: day ${lot.boughtOnDay} < day ${before.boughtOnDay}`,
        )
      }
    })
  }
  const cost = attempt('the lots', () =>
    inventoryValue(stocks.flatMap(({ lots }) => lots)),
  )
  // In range: checkBooks() already added up these same entries.
  const books = balance(journal, STOCKS, { toDay: save.day })
  if (books !== cost) {
    invalid(
      `the Stocks balance of ${books} does not equal the lots' cost of ${cost}`,
    )
  }
}

/**
 * The trucks after the first (#259) are those the rungs of `dream` bought
 * add, in the order bought, each with the id and district its rung gives,
 * bought on its rung's morning, its generator still where it started
 * before its first day (see `newTruck`) and its lots bought no earlier;
 * its last day, null before its first, is `lastDay`'s, its botched units
 * the sum of its visits'. Every journal line names the first truck or one
 * of these, if any, and one of these only from the morning it was bought.
 * The decisions, and those pending, run exactly these trucks, and name
 * no other (see `validateTrucks`).
 */
function checkTrucks(save: Save, dream: DreamContent): void {
  const trucks = save.trucks ?? []
  const added = save.dream.bought.flatMap(({ rung: id, day }) => {
    const { rung } = rungOf(id, dream)
    return isCompany(rung) && rung.addsTruck !== undefined
      ? [{ ...rung.addsTruck, day }]
      : []
  })
  if (trucks.length !== added.length) {
    invalid(
      `the game has ${trucks.length} truck(s) after the first, not the ${added.length} the rungs bought add`,
    )
  }
  const played = save.lastDay?.day
  trucks.forEach((truck, index) => {
    const what = `truck ${index + 1}, ${truck.id},`
    const rung = added[index]
    if (
      rung === undefined ||
      truck.id !== rung.id ||
      truck.district !== rung.district ||
      truck.boughtOnDay !== rung.day
    ) {
      invalid(`${what} is not the truck its rung adds`)
    }
    const { lastDay } = truck
    if (lastDay === null) {
      if (played !== undefined && played >= truck.boughtOnDay) {
        invalid(`${what} has no last day, though day ${played} was played`)
      }
      if (
        truck.rngState !==
        newTruck(save.seed, truck, truck.boughtOnDay).rngState
      ) {
        invalid(`${what} has drawn from its generator before its first day`)
      }
    } else {
      if (lastDay.day !== played || lastDay.day < truck.boughtOnDay) {
        invalid(
          `${what} last played day ${lastDay.day}, not the game's last day played, day ${String(played)}, from the day it was bought`,
        )
      }
      const botched = lastDay.visits.reduce(
        (total, visit) => total + visit.botched,
        0,
      )
      if (lastDay.botched !== botched) {
        invalid(
          `${what} last day botched ${lastDay.botched}, not the ${botched} its visits botched`,
        )
      }
    }
    const early = truck.inventory.find(
      ({ boughtOnDay }) => boughtOnDay < truck.boughtOnDay,
    )
    if (early !== undefined) {
      invalid(
        `${what} has a lot bought on day ${early.boughtOnDay}, before the truck`,
      )
    }
  })
  const since = new Map<string, Day>([[FIRST_TRUCK, 0]])
  for (const { id, boughtOnDay } of trucks) since.set(id, boughtOnDay)
  save.journal.forEach(({ day, lines }, index) => {
    for (const { truck } of lines) {
      if (truck === undefined) continue
      const from = since.get(truck)
      if (from === undefined) {
        invalid(
          `journal entry ${index + 1} names the truck ${truck}, which the game does not have`,
        )
      }
      if (day < from) {
        invalid(
          `journal entry ${index + 1} names the truck ${truck} on day ${day}, before it was bought`,
        )
      }
    }
  })
  attempt('decisions', () => validateTrucks(save.decisions, save))
  if (save.pendingDecisions !== null) {
    attempt('pendingDecisions', () =>
      validateTrucks(save.pendingDecisions ?? save.decisions, save),
    )
  }
  if (truckIds(save).length !== new Set(truckIds(save)).size) {
    invalid('two trucks have the same id')
  }
}

/**
 * What customers could owe at the save's day: sales up to that day, by due
 * day, each due after its sale and after `lastDay`'s day, since the start of
 * each day played collected what was due, and adding up to Comptes clients.
 */
function checkReceivables(save: Save, journal: Journal): void {
  const { day, lastDay, receivables } = save
  const played = lastDay?.day ?? firstDay(save) - 1
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

function checkLastDay(save: Save): void {
  const { day, lastDay } = save
  const first = firstDay(save)
  if (lastDay === null) {
    if (day !== first) invalid(`lastDay is null on day ${day}`)
    return
  }
  if (lastDay.day !== day && lastDay.day !== day - 1) {
    invalid(`lastDay is day ${lastDay.day} on day ${day}`)
  }
  if (lastDay.day < first) {
    invalid(
      `lastDay is day ${lastDay.day}, before the game's first day, day ${first}`,
    )
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
 * The owner's energy as the game could leave it: `start` until the first
 * day is played, `lastDay`'s at its close, and the morning after no lower,
 * since a night only gives energy back, unless a choice made that morning
 * took some, the first day's included.
 */
function checkEnergy(save: Save, start: number): void {
  const { day, lastDay, energy } = save
  if (lastDay === null) {
    if (energy !== start && !chosenThatMorning(save)) {
      invalid(`energy is ${energy} before day ${day} is played, not ${start}`)
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
 *   from an event in `content`, a follow-up among them brings one, and
 *   none signs a contract or sends a grocer away, which happen at once;
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
function checkEvents(save: Save, content: EventContent): void {
  const { day, lastDay, events } = save
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
  const played = lastDay?.day ?? firstDay(save) - 1
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
    if (
      effect.kind === 'contract' ||
      effect.kind === 'grocerAway' ||
      effect.kind === 'emergencyLoan' ||
      effect.kind === 'shareSale'
    ) {
      invalid(`${what} is a ${effect.kind}, which never waits`)
    }
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
  save: Save,
  { marketing, decisionLimits }: FoodTruckContent,
): void {
  const { lastDay, marketingHistory } = save
  const played = lastDay === null ? 0 : lastDay.day + 1 - firstDay(save)
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

/**
 * The days `field` keeps, when the save has them (#283, #284): in
 * ascending order, the last one `lastDay`'s, none before the game's first
 * day; none at all before the first day is played.
 */
function checkDayHistory(
  field: string,
  history: readonly { readonly day: Day }[] | undefined,
  save: Save,
): void {
  if (history === undefined) return
  const { lastDay } = save
  if (lastDay === null) {
    if (history.length > 0) invalid(`${field} holds days before any is played`)
    return
  }
  history.forEach(({ day }, index) => {
    const before = history[index - 1]
    if (before !== undefined && day <= before.day) {
      invalid(`${field} day ${day} comes after day ${before.day}`)
    }
    if (day < firstDay(save)) {
      invalid(`${field} day ${day} is before the game's first day`)
    }
  })
  const last = history.at(-1)
  if (last !== undefined && last.day !== lastDay.day) {
    invalid(`${field} ends on day ${last.day}, not on the last day played`)
  }
}

/**
 * The decisions keep within the content's limits, with the more units the
 * rungs of « Le rêve » bought allow a restock rule (see `dreamLimits`), and
 * each product's kind of restock rule.
 */
function checkDecisions(
  field: string,
  decisions: Decisions,
  save: Save,
  content: FoodTruckContent,
  bakery: BakeryContent,
  staff: StaffContent,
  dream: DreamContent,
): void {
  const limits = dreamLimits(
    content.decisionLimits,
    dreamBonuses(save.dream, dream),
  )
  attempt(field, () => validateDecisions(decisions, limits, bakery, staff))
  const trucks = [
    { what: field, restock: decisions.restock },
    ...Object.entries(decisions.trucks ?? {}).map(([id, { restock }]) => ({
      what: `${field}.trucks.${id}`,
      restock,
    })),
  ]
  for (const { what, restock } of trucks) {
    for (const product of PRODUCTS) {
      const { kind } = content.startingDecisions.restock[product]
      const saved = restock[product].kind
      if (saved !== kind) {
        invalid(`${what}.restock.${product} must be a ${kind} rule: ${saved}`)
      }
    }
  }
}

/**
 * What « Le rêve » could be at the save's day, with the books `journal`:
 * - nothing in a Défi;
 * - each rung bought is one of `dream`'s, bought once, for sale, on a
 *   morning from the game's first day to the save's day, the days going
 *   up, once every rung before it in its ladder was;
 * - each cost is the rung's price, with the old truck's book value that
 *   morning on top for the truck that replaces it (see `purchaseCost` and
 *   `truckOnBooks`);
 * - the journal holds the entries of each company rung's purchase (see
 *   `purchaseEntries`) and of its depreciation on each 1st played after it
 *   (see `dreamDepreciation`), and no other entry of their memos nor of the
 *   old truck's sale, in any order within a day; and no depreciation nor
 *   lease of the old truck from the morning it was replaced;
 * - the owner became « Magnat », if they did, at the close of a day played.
 *
 * The personal rungs' movements are `checkPersonal()`'s.
 */
function checkDream(
  save: Save,
  journal: Journal,
  content: FoodTruckContent,
  dream: DreamContent,
  difficulties: DifficultyContent,
): void {
  const { bought, magnatOn } = save.dream
  const first = firstDay(save)
  const played = save.lastDay?.day ?? first - 1
  if (save.challenge !== null && (bought.length > 0 || magnatOn !== null)) {
    invalid(`the Défi ${save.challenge.id} has a dream`)
  }
  bought.forEach(({ rung: id, day, cost }, index) => {
    const what = `dream rung ${index + 1}, ${id},`
    const { rung } = rungOf(id, dream)
    const before = bought.slice(0, index)
    if (before.some((purchase) => purchase.rung === id)) {
      invalid(`${what} is bought twice`)
    }
    if (rung.comingSoon === true) invalid(`${what} is not for sale`)
    if (day < first || day > save.day) {
      invalid(
        `${what} is bought on day ${day}, not a morning from day ${first} to day ${save.day}`,
      )
    }
    const last = before.at(-1)
    if (last !== undefined && day < last.day) {
      invalid(
        `${what} is bought before the rung before it: day ${day} < day ${last.day}`,
      )
    }
    if (!prerequisitesMet({ bought: before, magnatOn: null }, id, dream)) {
      invalid(`${what} is bought before a rung before it in its ladder`)
    }
    const expected = isCompany(rung)
      ? purchaseCost(rung, truckAt(day))
      : rung.priceCents
    if (cost !== expected) invalid(`${what} cost ${cost}, not ${expected}`)
  })

  function truckAt(day: Day) {
    return truckOnBooks(
      journal,
      day,
      save.profile.difficulty,
      content,
      difficulties,
    )
  }

  const memos = new Set<string>([DREAM_MEMO.truckSold])
  for (const { name } of dream.company) {
    memos.add(dreamLabel(DREAM_MEMO.bought, name))
    memos.add(dreamLabel(DREAM_MEMO.depreciation, name))
  }
  const expected = attempt('the dream', () => {
    const entries = bought.flatMap(({ rung: id, day }) => {
      const { rung } = rungOf(id, dream)
      return isCompany(rung) ? purchaseEntries(rung, day, truckAt(day)) : []
    })
    const since = Math.min(...bought.map(({ day }) => day))
    for (let on = since + 1; on <= played; on += 1) {
      entries.push(
        ...entriesOf(dreamDepreciation(emptyJournal(), on, save.dream, dream)),
      )
    }
    return entries
  })
  const key = ({ day: on, memo, lines }: JournalEntry) =>
    JSON.stringify([
      on,
      memo,
      lines.map(({ account, debit, credit, truck }) => [
        account,
        debit,
        credit,
        truck ?? null,
      ]),
    ])
  const owed = new Map<string, number>()
  for (const entry of expected) {
    owed.set(key(entry), (owed.get(key(entry)) ?? 0) + 1)
  }
  const replacedOn = truckReplacedOn(save.dream, dream)
  const oldTruck: readonly string[] = Object.values(TRUCK_MEMO)
  for (const entry of entriesOf(journal)) {
    if (
      replacedOn !== null &&
      entry.day >= replacedOn &&
      oldTruck.includes(entry.memo)
    ) {
      invalid(
        `the journal holds « ${entry.memo} » on day ${entry.day}, after the truck was replaced on day ${replacedOn}`,
      )
    }
    if (!memos.has(entry.memo)) continue
    const left = owed.get(key(entry)) ?? 0
    if (left === 0) {
      invalid(
        `the journal holds « ${entry.memo} » on day ${entry.day}, which no rung bought owes`,
      )
    }
    owed.set(key(entry), left - 1)
  }
  const missing = expected.find((entry) => (owed.get(key(entry)) ?? 0) > 0)
  if (missing !== undefined) {
    invalid(
      `the journal does not hold « ${missing.memo} » on day ${missing.day} as the rungs bought owe it`,
    )
  }
  if (magnatOn !== null && (magnatOn < first || magnatOn > played)) {
    invalid(
      `dream.magnatOn is day ${magnatOn}, not a day played from day ${first} to day ${played}`,
    )
  }
}

/**
 * What the bakery could be at the save's day, with the books `journal`:
 * - it runs exactly when it has oven terms, and only a bakery that runs is
 *   under notice;
 * - it opened, and its oven was bought, on a day played, no earlier than
 *   the game's first day, so before the first day is played it neither runs
 *   nor owns an oven;
 * - a notice ends on the last day of a month after the bakery opened, no
 *   earlier than the last day played, since the morning after its end
 *   closes the bakery, and no later than the end of the month
 *   `noticeMonths` after it;
 * - a bought oven runs a bakery only when the business owns one, and a
 *   leased one only when it owns none;
 * - the business owns an oven exactly when the books hold one « Achat du
 *   four », on the day it was bought, Dr 1500 Équipement / Cr 1000 for the
 *   oven's price;
 * - the bakery planned in the decisions leases no oven when the business
 *   owns one, and keeps the oven terms of a bakery that holds its premises
 *   on the save's day; at a close, the bakery runs with no notice exactly
 *   when one is planned;
 * - the bakery planned in those pending does the same on the next morning,
 *   with the bakery the decisions' plan leaves (see `morningBakery`): an
 *   oven bought, or a bakery opened, on the save's day already counts.
 */
function checkBakery(
  save: Save,
  journal: Journal,
  content: BakeryContent,
): void {
  const { day, lastDay, bakery, decisions, pendingDecisions } = save
  const { openedOnDay, oven, closesAfterDay, ovenBoughtOnDay } = bakery
  const first = firstDay(save)
  const played = lastDay?.day ?? first - 1
  if ((openedOnDay === null) !== (oven === null)) {
    invalid(
      `bakery.oven is ${oven} with bakery.openedOnDay ${openedOnDay}: both or neither`,
    )
  }
  for (const [field, at] of [
    ['openedOnDay', openedOnDay],
    ['ovenBoughtOnDay', ovenBoughtOnDay],
  ] as const) {
    if (at !== null && (at < first || at > played)) {
      invalid(
        `bakery.${field} is day ${at}, not a day played from day ${first} to day ${played}`,
      )
    }
  }
  if (closesAfterDay !== null) {
    if (openedOnDay === null) {
      invalid(`bakery.closesAfterDay is day ${closesAfterDay}, with no bakery`)
    }
    const latest = endOfMonth(played, content.noticeMonths)
    if (
      endOfMonth(closesAfterDay) !== closesAfterDay ||
      closesAfterDay <= openedOnDay ||
      closesAfterDay < played ||
      closesAfterDay > latest
    ) {
      invalid(
        `bakery.closesAfterDay is day ${closesAfterDay}, not the last day of a month from day ${Math.max(openedOnDay + 1, played)} to day ${latest}`,
      )
    }
  }
  if (oven === 'acheter' && ovenBoughtOnDay === null) {
    invalid('bakery.oven is acheter, but the business owns no oven')
  }
  if (oven === 'louer' && ovenBoughtOnDay !== null) {
    invalid(
      `bakery.oven is louer, but the business owns an oven since day ${ovenBoughtOnDay}`,
    )
  }

  const bought = entriesOf(journal).filter(
    ({ memo }) => memo === BAKERY_MEMO.ovenBought,
  )
  const purchase = bought[0]
  const { priceCents } = content.oven
  if (ovenBoughtOnDay === null) {
    if (purchase !== undefined) {
      invalid(
        `the journal holds « ${BAKERY_MEMO.ovenBought} » on day ${purchase.day}, but the business owns no oven`,
      )
    }
  } else if (
    bought.length !== 1 ||
    purchase === undefined ||
    !sameEntry(
      {
        day: ovenBoughtOnDay,
        memo: BAKERY_MEMO.ovenBought,
        lines: [
          { account: EQUIPMENT, debit: priceCents, credit: cents(0) },
          { account: CASH, debit: cents(0), credit: priceCents },
        ],
      },
      purchase,
    )
  ) {
    invalid(
      `the journal does not hold one « ${BAKERY_MEMO.ovenBought} » of ${priceCents} on day ${ovenBoughtOnDay}`,
    )
  }

  checkPlan('decisions', decisions.bakery, bakery, day)
  if (
    lastDay?.day === day &&
    (decisions.bakery !== null) !==
      (openedOnDay !== null && closesAfterDay === null)
  ) {
    invalid(
      `the bakery ${openedOnDay === null ? 'does not run' : closesAfterDay === null ? 'runs' : 'is under notice'} at the close of day ${day}, with ${decisions.bakery === null ? 'none' : 'one'} planned`,
    )
  }
  if (pendingDecisions !== null) {
    checkPlan(
      'pendingDecisions',
      pendingDecisions.bakery,
      morningBakery(bakery, decisions.bakery, day, content),
      day + 1,
    )
  }
}

/**
 * The bakery `plan` wants on the morning of `day`, which finds `bakery`:
 * it leases no oven when the business owns one, and keeps the oven terms
 * of a bakery that still holds its premises.
 */
function checkPlan(
  field: string,
  plan: BakeryPlan | null,
  bakery: BakeryState,
  day: Day,
): void {
  if (plan === null) return
  const { oven, ovenBoughtOnDay } = bakery
  if (plan.oven === 'louer' && ovenBoughtOnDay !== null) {
    invalid(
      `${field}.bakery leases an oven, but the business owns one since day ${ovenBoughtOnDay}`,
    )
  }
  if (holdsPremises(bakery, day) && plan.oven !== oven) {
    invalid(
      `${field}.bakery.oven is ${plan.oven} on day ${day}, but the bakery runs with ${oven}`,
    )
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
 * that morning may have dated the save's day. Before the first day is
 * played, it
 * holds only the movements of a choice made that morning.
 *
 * A movement does not say what made it, so one whose label an effect gives
 * is held to the effects' rule, even when `LABELS` holds it too: a choice
 * may refund the « Loyer » or dock the « Salaire ».
 *
 * The rungs of « Le rêve » of `dream` move it too: each personal rung bought
 * in the months kept, up to the save's day, with exactly the movements its
 * purchase makes on its morning (see `purchaseMovements`), and none other
 * of those labels; and a home's payment, below zero on a 1st, once its rung
 * was bought, which an unpaid rent may be.
 */
function checkPersonal(
  save: Save,
  content: EventContent,
  dream: DreamContent,
): void {
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
  const today = lastDay?.day ?? day
  const key = ({ day: at, label, amount }: PersonalMovement) =>
    JSON.stringify([at, label, amount])
  const purchases = new Map<string, number>()
  const purchaseLabels = new Set<string>()
  for (const { rung: id, day: at } of save.dream.bought) {
    const { rung } = rungOf(id, dream)
    if (!isPersonal(rung)) continue
    if (!isKept(at, today)) continue
    for (const movement of purchaseMovements(rung, at, dream)) {
      purchases.set(key(movement), (purchases.get(key(movement)) ?? 0) + 1)
    }
  }
  for (const rung of dream.personal) {
    for (const movement of purchaseMovements(rung, 0, dream)) {
      purchaseLabels.add(movement.label)
    }
  }
  const homes = housingLabels(dream)
  if (lastDay === null) {
    const byChoice = movements.every(
      ({ label }) =>
        purchaseLabels.has(label) ||
        (chosenThatMorning(save) && eventLabels.has(label)),
    )
    if (unpaidRents.length > 0 || !byChoice) {
      invalid(`personal holds movements before day ${day} is played`)
    }
  }
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
  movements.forEach((movement, index) => {
    const { day: at, label, amount } = movement
    const what = `personal movement ${index + 1}`
    const before = movements[index - 1]?.day
    if (eventLabels.has(label)) {
      checkDay(what, at, before, day)
      if (amount === 0) invalid(`${what}, « ${label} », must not be 0`)
    } else if (purchaseLabels.has(label)) {
      checkDay(what, at, before, day)
      const left = purchases.get(key(movement)) ?? 0
      if (left === 0) {
        invalid(
          `${what}, « ${label} » of ${amount} on day ${at}, is no purchase of a rung bought`,
        )
      }
      purchases.set(key(movement), left - 1)
    } else if (homes.has(label)) {
      checkDay(what, at, before, today)
      if (amount >= 0) invalid(`${what}, « ${label} », must be below 0`)
      if (toCalendar(at).dayOfMonth !== 1) {
        invalid(`${what}, « ${label} », is on day ${at}, not a 1st`)
      }
      const home = save.dream.bought.find(({ rung: id }) => {
        const { rung } = rungOf(id, dream)
        return isPersonal(rung) && rung.housing?.label === label
      })
      if (home === undefined || home.day > at) {
        invalid(
          `${what}, « ${label} », is on day ${at}, before its home was bought`,
        )
      }
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
  const missing = [...purchases].find(([, left]) => left > 0)
  if (missing !== undefined) {
    invalid(
      `personal does not hold the movement ${missing[0]} a rung bought made`,
    )
  }
  unpaidRents.forEach((at, index) => {
    const what = `unpaid rent ${index + 1}`
    const before = unpaidRents[index - 1]
    checkDay(what, at, before, today)
    if (at === before) invalid(`${what} repeats day ${at}`)
    const charged = movements.some(
      (movement) =>
        movement.day === at &&
        (movement.label === LABELS.rent || homes.has(movement.label)),
    )
    if (!charged) {
      invalid(`${what} is on day ${at}, with no « Loyer » that day`)
    }
  })
}

/**
 * The week under way of a save from before the week in numbers, from its
 * books: a game not yet played opens its first week as a new one does (see
 * `openingWeek`); one whose last day played was a Sunday starts the next
 * week from that close; any other starts a partial week from its last
 * close, so its report covers only the days played after it.
 */
function weekSince(
  { lastDay, profile }: Parsed,
  journal: Journal,
  content: FoodTruckContent,
  difficulties: DifficultyContent,
): WeekSoFar {
  if (lastDay === null) {
    return openingWeek(
      openingJournal(profile.difficulty, content, difficulties),
    )
  }
  return {
    cashAtStart: balance(journal, CASH, { toDay: lastDay.day }),
    partial: sundayOf(lastDay.day) !== lastDay.day,
    days: [],
    modifiers: [],
  }
}

/**
 * What the week in numbers could be at the save's day, with the books
 * `journal`:
 * - before the first day is played, the first week is partial, with no day,
 *   and no
 *   week was reported;
 * - the week under way holds the days played since its Monday, one after
 *   the other up to `lastDay`'s, and none once that day is a Sunday, whose
 *   close starts the next week; a partial week alone may start later;
 * - `lastWeek`, if any, is the week of the last Sunday played, with its
 *   days one after the other up to that Sunday, from its Monday unless it
 *   is partial; its ventes and bénéfice net are those of the état des
 *   résultats over its days, its events those of `events.history` on its
 *   days, and it holds the best ventes of an earlier week when the history
 *   holds an earlier week, never less than theirs;
 * - each week starts with the Encaisse of the bilan before its first day,
 *   or, on day 0, with the cash the books of the profile's difficulty open
 *   with (see `openingWeek`), and the Encaisse of each day's close is the
 *   bilan's, the end and the lowest of a week those of its days;
 * - the history holds at most `WEEKS_KEPT` weeks, each 7 days after the one
 *   before, the last `lastWeek`'s, and none without it;
 * - the weeks of the history with no net worth, those an older save
 *   reported, come before all the others (`checkNetWorth()` checks the
 *   last one's);
 * - the changes to the street of both weeks come from events in `events`.
 */
function checkWeek(
  save: Save,
  journal: Journal,
  content: FoodTruckContent,
  events: EventContent,
  difficulties: DifficultyContent,
): void {
  const { lastDay, weekSoFar, lastWeek, weekHistory } = save
  const played = lastDay?.day ?? firstDay(save) - 1
  const known = new Set(events.events.map(({ id }) => id))
  const cashOn = (day: Day) => balance(journal, CASH, { toDay: day })

  /**
   * Checks a week whose days end on `last`, and start on `monday` unless it
   * is partial; with none, it starts the day after `last`.
   */
  const checkDays = (
    what: string,
    week: WeekSoFar | WeekReport,
    monday: Day,
    last: Day,
  ) => {
    const first = week.days[0]?.day ?? last + 1
    if (first < monday) {
      invalid(
        `${what} starts on day ${first}, before its Monday, day ${monday}`,
      )
    }
    if (!week.partial && first !== monday) {
      invalid(
        `${what} starts on day ${first}, not on its Monday, day ${monday}, and is not partial`,
      )
    }
    week.days.forEach(({ day }: WeekDay, index) => {
      if (day !== first + index) {
        invalid(
          `${what} day ${index + 1} is day ${day}, not day ${first + index}`,
        )
      }
    })
    const end = week.days.at(-1)?.day ?? first - 1
    if (end !== last) invalid(`${what} ends on day ${end}, not day ${last}`)
    const start =
      first === 0
        ? openingWeek(
            openingJournal(save.profile.difficulty, content, difficulties),
          ).cashAtStart
        : cashOn(first - 1)
    if (week.cashAtStart !== start) {
      invalid(
        `${what}.cashAtStart is ${week.cashAtStart}, not the ${start} ${first === 0 ? 'the books open with' : `in Encaisse at the close of day ${first - 1}`}`,
      )
    }
    week.days.forEach(({ cashAtClose }, index) => {
      const cash = cashOn(first + index)
      if (cashAtClose !== cash) {
        invalid(
          `${what} day ${index + 1} closes with ${cashAtClose} in Encaisse, not the ${cash} of the bilan`,
        )
      }
    })
    week.modifiers.forEach(({ event }, index) => {
      if (!known.has(event)) {
        invalid(
          `${what}'s street modifier ${index + 1} is an unknown event: ${event}`,
        )
      }
    })
  }

  if (lastDay === null && !weekSoFar.partial) {
    invalid(`weekSoFar is not partial before day ${save.day} is played`)
  }
  const next = played + 1
  checkDays('weekSoFar', weekSoFar, mondayOf(next), played)

  const sunday =
    played >= 0 && sundayOf(played) === played ? played : mondayOf(next) - 1
  if (lastWeek !== null) {
    if (sunday < 0) invalid('lastWeek is reported before a Sunday is played')
    const monday = mondayOf(sunday)
    if (lastWeek.firstDay !== monday) {
      invalid(
        `lastWeek starts on day ${lastWeek.firstDay}, not on day ${monday}, the Monday of the last Sunday played`,
      )
    }
    checkDays('lastWeek', lastWeek, monday, sunday)
    const first = lastWeek.days[0]?.day ?? monday
    const closes = lastWeek.days.map(({ cashAtClose }) => cashAtClose)
    const lowest = Math.min(...closes)
    if (
      lastWeek.cashAtEnd !== closes.at(-1) ||
      lastWeek.lowestCash !== lowest
    ) {
      invalid(
        `lastWeek ends with ${lastWeek.cashAtEnd} and ${lastWeek.lowestCash} at its lowest, not as its days close`,
      )
    }
    const { sales, netIncome } = incomeStatement(journal, first, sunday)
    if (
      lastWeek.sales !== sales.amount ||
      lastWeek.netIncome !== netIncome.amount
    ) {
      invalid(
        `lastWeek has ${lastWeek.sales} of ventes and ${lastWeek.netIncome} of bénéfice net, not the ${sales.amount} and ${netIncome.amount} of the état des résultats`,
      )
    }
    // Both read with the same schema, so their keys come in the same order.
    const chosen = save.events.history.filter(
      ({ day }) => day >= first && day <= sunday,
    )
    if (JSON.stringify(lastWeek.events) !== JSON.stringify(chosen)) {
      invalid("lastWeek's events are not those of the history on its days")
    }
    const earlier = weekHistory.slice(0, -1)
    const { previousBest } = lastWeek
    if ((previousBest === null) !== (earlier.length === 0)) {
      invalid(
        `lastWeek.previousBest is ${previousBest} with ${earlier.length} earlier weeks in the history`,
      )
    }
    if (
      previousBest !== null &&
      earlier.some(({ sales: before }) => before > previousBest)
    ) {
      invalid(
        `lastWeek.previousBest is ${previousBest}, below an earlier week's ventes`,
      )
    }
  }

  if (weekHistory.length > WEEKS_KEPT) {
    invalid(
      `weekHistory holds ${weekHistory.length} weeks, more than ${WEEKS_KEPT}`,
    )
  }
  weekHistory.forEach(({ firstDay }, index) => {
    const before = weekHistory[index - 1]
    if (before !== undefined && firstDay !== before.firstDay + DAYS_PER_WEEK) {
      invalid(
        `week ${index + 1} of weekHistory starts on day ${firstDay}, not ${DAYS_PER_WEEK} days after the one before`,
      )
    }
  })
  const recorded = weekHistory.at(-1)
  if (
    lastWeek === null
      ? recorded !== undefined
      : recorded?.firstDay !== lastWeek.firstDay ||
        recorded.sales !== lastWeek.sales ||
        recorded.netIncome !== lastWeek.netIncome ||
        recorded.cashAtEnd !== lastWeek.cashAtEnd
  ) {
    invalid("the last week of weekHistory is not lastWeek's")
  }
  const valued = weekHistory.findIndex(({ netWorth: worth }) => worth !== null)
  const unvalued = weekHistory.findLastIndex(
    ({ netWorth: worth }) => worth === null,
  )
  if (valued !== -1 && unvalued > valued) {
    invalid(
      `week ${unvalued + 1} of weekHistory has no net worth, after week ${valued + 1}, which has one`,
    )
  }
}

/**
 * Checks, once the week, the personal account and the financing are, that
 * the last week of the history, if it has a net worth, has the owner's at
 * the close of its Sunday (see `netWorth`): with the books up to that
 * Sunday, the rounds of shares sold by then, the personal cash less what
 * moved it since, and the rungs of `dream` owned then.
 */
function checkNetWorth(
  save: Save,
  journal: Journal,
  dream: DreamContent,
): void {
  const recorded = save.weekHistory.at(-1)
  if (recorded === undefined || recorded.netWorth === null) return
  const sunday = sundayOf(recorded.firstDay)
  // Every change to the personal cash is a movement, and those since the
  // Sunday are all in the months the account keeps.
  const since = save.personal.movements.filter(({ day }) => day > sunday)
  const atClose = netWorth(
    {
      day: sunday,
      journal,
      financing: {
        ...save.financing,
        shareSales: save.financing.shareSales.filter(
          ({ day }) => day <= sunday,
        ),
      },
      personal: {
        ...save.personal,
        cash: sub(save.personal.cash, sum(since.map(({ amount }) => amount))),
      },
      dream: save.dream,
    },
    dream,
  )
  if (recorded.netWorth !== atClose) {
    invalid(
      `the last week of weekHistory has a net worth of ${recorded.netWorth}, not the ${atClose} the owner had at the close of day ${sunday}`,
    )
  }
}

/** The game's first day: day 0, or its Défi's first day. */
function firstDay({ challenge }: Pick<Parsed, 'challenge'>): Day {
  return challenge?.startDay ?? 0
}

/**
 * The Défi of `defis` the save plays; null in a game that is not one.
 * Checked before the rest, which reads the game's first day from it: the
 * Défi exists, starts on the save's `startDay` and is played at the
 * profile's difficulty.
 */
function defiOf(save: Parsed, defis: DefiContent): Defi | null {
  const { challenge, profile } = save
  if (challenge === null) return null
  const defi = defis.defis.find(({ id }) => id === challenge.id)
  if (defi === undefined)
    invalid(`challenge is an unknown Défi: ${challenge.id}`)
  const start = attempt('challenge', () => startDayOf(defi))
  if (challenge.startDay !== start) {
    invalid(
      `challenge starts on day ${challenge.startDay}, not on day ${start}, the first day of the Défi ${defi.id}`,
    )
  }
  if (defi.difficulty !== profile.difficulty) {
    invalid(
      `the Défi ${defi.id} is played at ${defi.difficulty}, not at the profile's difficulty ${profile.difficulty}`,
    )
  }
  return defi
}

/**
 * What the Défi `defi` could be at the save's day, with the books `journal`
 * opened as `difficulties` open them:
 * - nothing happened between the books' opening and its first day: no
 *   entry and no event is dated before it;
 * - it played the days from its first to `lastDay`'s, no more than its
 *   length;
 * - its ventes and bénéfice net are those of the état des résultats over
 *   those days, and its lowest Encaisse the lowest after any entry since
 *   the books opened, up to their close (see `lowestCashSince`), so not
 *   the entries of a choice made that morning;
 * - before its first day is played, nothing is counted and the owner's
 *   lowest energy is the Défi's starting energy; once it is, the lowest is
 *   no higher than that, nor than `lastDay`'s;
 * - the owner's lowest energy since the last close is that close's, or the
 *   starting energy before the first, unless a choice was made that
 *   morning, which can only have lowered it, and to no higher than the
 *   owner's energy now;
 * - it is under way before its first day is played, and otherwise as
 *   `verdict()` has it, with the medal it gives;
 * - once it is over, no event came after it or waits, and the Défi's
 *   minimum cash held up to the day before its last day played, or it
 *   would have ended then;
 * - the decisions it locks, and those pending if any, are its own;
 * - each event it forces came on its day once that day is played, or waits
 *   or was chosen that morning while it is under way, with a choice it
 *   allows, and no other event waits or was chosen on that day;
 * - without random events, every other event that came, or waits, is a
 *   follow-up.
 */
function checkChallenge(
  save: Save,
  journal: Journal,
  defi: Defi,
  content: FoodTruckContent,
  difficulties: DifficultyContent,
): void {
  const { challenge, day, lastDay, events } = save
  if (challenge === null) return
  const { startDay, progress, status, medal } = challenge
  const opening = entriesOf(
    openingJournal(defi.difficulty, content, difficulties),
  ).length
  // checkDifficulty() found the journal opens with these entries.
  const entries = entriesOf(journal)
  const early = entries.findIndex(
    (entry, index) => index >= opening && entry.day < startDay,
  )
  if (early !== -1) {
    invalid(
      `journal entry ${early + 1} is on day ${entries[early]?.day}, before the Défi's first day, day ${startDay}`,
    )
  }
  if (events.history.some((record) => record.day < startDay)) {
    invalid(`an event came before the Défi's first day, day ${startDay}`)
  }

  const played = lastDay === null ? 0 : lastDay.day - startDay + 1
  if (played > defi.lengthDays) {
    invalid(
      `challenge has played ${played} days of a Défi of ${defi.lengthDays}`,
    )
  }
  if (progress.daysPlayed !== played) {
    invalid(
      `challenge.progress.daysPlayed is ${progress.daysPlayed}, not the ${played} days played since day ${startDay}`,
    )
  }
  const last = startDay + played - 1
  const income = played === 0 ? null : incomeStatement(journal, startDay, last)
  const sales = income?.sales.amount ?? 0
  const netIncome = income?.netIncome.amount ?? 0
  if (progress.sales !== sales || progress.netIncome !== netIncome) {
    invalid(
      `challenge has ${progress.sales} of ventes and ${progress.netIncome} of bénéfice net, not the ${sales} and ${netIncome} of the état des résultats`,
    )
  }
  const lowestCash = lowestCashSince(journal, opening, last)
  if (progress.lowestCash !== lowestCash) {
    invalid(
      `challenge.progress.lowestCash is ${progress.lowestCash}, not the ${lowestCash} the books went down to`,
    )
  }
  const energy = startingEnergy(defi)
  if (lastDay === null) {
    const { customersServed, unitsSold, unitsSpoiled, lowestEnergy } = progress
    if (customersServed + unitsSold + unitsSpoiled > 0) {
      invalid(
        'challenge counts customers or units before its first day is played',
      )
    }
    if (lowestEnergy !== energy) {
      invalid(
        `challenge.progress.lowestEnergy is ${lowestEnergy} before its first day is played, not ${energy}`,
      )
    }
  } else if (
    progress.lowestEnergy > energy ||
    progress.lowestEnergy > lastDay.energy
  ) {
    invalid(
      `challenge.progress.lowestEnergy is ${progress.lowestEnergy}, above ${Math.min(energy, lastDay.energy)}`,
    )
  }
  const { lowestEnergySinceClose: sinceClose } = challenge
  const closed = lastDay?.energy ?? energy
  if (lastDay?.day === day || !chosenThatMorning(save)) {
    if (sinceClose !== closed) {
      invalid(
        `challenge.lowestEnergySinceClose is ${sinceClose}, not the ${closed} of ${lastDay === null ? 'its first morning' : 'the last close'}`,
      )
    }
  } else if (sinceClose > Math.min(closed, save.energy)) {
    invalid(
      `challenge.lowestEnergySinceClose is ${sinceClose}, above ${Math.min(closed, save.energy)}`,
    )
  }

  const expected =
    played === 0 ? { status: 'enCours', medal: null } : verdict(progress, defi)
  if (status !== expected.status || medal !== expected.medal) {
    invalid(
      `challenge is ${status} with the medal ${medal}, not ${expected.status} with ${expected.medal}`,
    )
  }
  if (
    status !== 'enCours' &&
    (events.pending !== null ||
      events.history.some((record) => record.day > last))
  ) {
    invalid(`an event came after the Défi ${defi.id} was over`)
  }
  for (const condition of defi.conditions) {
    if (
      condition.kind === 'minCash' &&
      played > 1 &&
      lowestCashSince(journal, opening, last - 1) < condition.amountCents
    ) {
      invalid(
        `the Défi ${defi.id} was lost before day ${last}, the last day played`,
      )
    }
  }

  const setup = setupDecisions(
    defi,
    attempt('the starting decisions', () => startingDecisions(content)),
  )
  for (const kind of defi.locked) {
    for (const [field, decisions] of [
      ['decisions', save.decisions],
      ['pendingDecisions', save.pendingDecisions],
    ] as const) {
      if (decisions !== null && !sameLocked(decisions, setup, kind)) {
        invalid(`${field} change ${kind}, which the Défi ${defi.id} locks`)
      }
    }
  }

  const { pending, history } = events
  const morning = lastDay?.day !== day
  for (let at = startDay; at <= last + 1 && at <= day; at += 1) {
    const forced = forcedEventOn(defi, startDay, at)
    const records = history.filter((record) => record.day === at)
    const waiting = at === day && morning ? pending : null
    if (forced === undefined) {
      if (defi.randomEvents) continue
      if (
        records.some(({ followUp }) => !followUp) ||
        waiting?.followUp === false
      ) {
        invalid(
          `an event was drawn on day ${at} of the Défi ${defi.id}, which has no random event`,
        )
      }
      continue
    }
    const what = `the event the Défi ${defi.id} forces on day ${at}`
    const record = records[0]
    if (
      records.length > 1 ||
      (record !== undefined &&
        (record.event !== forced.event ||
          record.followUp ||
          !forced.choices.includes(record.choice)))
    ) {
      invalid(
        `${what} is not the one chosen that morning, with a choice it allows`,
      )
    }
    if (
      waiting !== null &&
      (waiting.event !== forced.event || waiting.followUp)
    ) {
      invalid(`${what} is not the one waiting`)
    }
    const under = at <= last || status === 'enCours'
    if (under && record === undefined && waiting === null) {
      invalid(`${what} never came`)
    }
  }
}

/**
 * What the grocers' contracts could be at the save's day, against
 * `grocers`:
 * - at most `maxContracts` run, one per grocer at most, each signed no
 *   later than the save's day, with from 1 to the grocer's `weeks`
 *   deliveries left, as many deliveries to the grocer, made or missed,
 *   since the day it was signed as the weeks it ran, and as many strikes as
 *   those missed, fewer than `maxStrikes`;
 * - the deliveries, oldest first, are each on the `deliveryWeekday` of a day
 *   played, with no more croissants made than delivered, and due after
 *   their day;
 * - those missed, oldest first, are each on the `deliveryWeekday` of a day
 *   played;
 * - `lastDay`'s deliveries, and those it missed, are those of its day, in
 *   order.
 */
function checkContracts(save: Save, grocers: GrocerContent): void {
  const { day, lastDay, contracts } = save
  const { running, deliveries, missed } = contracts
  const played = lastDay?.day ?? firstDay(save) - 1
  const { maxContracts, deliveryWeekday, maxStrikes } = grocers
  if (running.length > maxContracts) {
    invalid(
      `${running.length} contracts run, more than the ${maxContracts} at once`,
    )
  }
  running.forEach(({ grocer, startDay, weeksLeft, strikes }, index) => {
    const what = `contract ${index + 1}`
    if (running.findIndex((other) => other.grocer === grocer) !== index) {
      invalid(`${what} is a second contract with ${grocer}`)
    }
    if (startDay > day) {
      invalid(`${what} was signed on day ${startDay}, after day ${day}`)
    }
    const { weeks } = grocers.grocers[grocer]
    if (weeksLeft > weeks) {
      invalid(
        `${what} has ${weeksLeft} deliveries left, more than the ${weeks} of a contract with ${grocer}`,
      )
    }
    const since = (delivery: { day: Day; grocer: string }) =>
      delivery.grocer === grocer && delivery.day > startDay
    const made = deliveries.filter(since).length
    const misses = missed.filter(since).length
    if (made + misses !== weeks - weeksLeft) {
      invalid(
        `${what} has ${weeksLeft} of its ${weeks} deliveries left, after ${made} made and ${misses} missed since day ${startDay}`,
      )
    }
    if (strikes !== misses || strikes >= maxStrikes) {
      invalid(
        `${what} has ${strikes} strikes, after ${misses} deliveries missed since day ${startDay}, and fewer than ${maxStrikes} keep it running`,
      )
    }
  })
  deliveries.forEach(({ day: on, units, baked, dueDay }, index) => {
    const what = `delivery ${index + 1}`
    if (on > played) invalid(`${what} is on day ${on}, a day not played`)
    if (toCalendar(on).weekday !== deliveryWeekday) {
      invalid(`${what} is on day ${on}, not a delivery day`)
    }
    const before = deliveries[index - 1]
    if (before !== undefined && on < before.day) {
      invalid(
        `${what} comes before the one before it: day ${on} < day ${before.day}`,
      )
    }
    if (baked > units) {
      invalid(`${what} has ${baked} croissants made, more than its ${units}`)
    }
    if (dueDay <= on) invalid(`${what} is due on day ${dueDay}, not after it`)
  })
  missed.forEach(({ day: on }, index) => {
    const what = `missed delivery ${index + 1}`
    if (on > played) invalid(`${what} is on day ${on}, a day not played`)
    if (toCalendar(on).weekday !== deliveryWeekday) {
      invalid(`${what} is on day ${on}, not a delivery day`)
    }
    const before = missed[index - 1]
    if (before !== undefined && on < before.day) {
      invalid(
        `${what} comes before the one before it: day ${on} < day ${before.day}`,
      )
    }
  })
  if (lastDay === null) return
  // Both read with the same schema, so their keys come in the same order.
  const that = deliveries.filter((delivery) => delivery.day === lastDay.day)
  if (JSON.stringify(lastDay.deliveries) !== JSON.stringify(that)) {
    invalid(`lastDay's deliveries are not those of day ${lastDay.day}`)
  }
  const thatMissed = missed.filter((miss) => miss.day === lastDay.day)
  if (JSON.stringify(lastDay.missed) !== JSON.stringify(thatMissed)) {
    invalid(`lastDay's missed deliveries are not those of day ${lastDay.day}`)
  }
}

/**
 * What the staff could be at the save's day, against `content`:
 * - at most `maxEmployees`, each a different candidate, at a wage within
 *   their role's range (see `validateDecisions`), hired on a day played, no
 *   earlier than the game's first day, so nobody is on staff before the
 *   first day is played;
 * - at a close, the staff is the one the decisions want, in order, since
 *   that morning hired and let go as they did;
 * - on a morning, the decisions keep each employee on staff in their role,
 *   and those pending keep each employee the decisions want in theirs.
 */
function checkStaff(save: Save, content: StaffContent): void {
  const { day, lastDay, staff, decisions, pendingDecisions } = save
  const first = firstDay(save)
  const played = lastDay?.day ?? first - 1
  const hires = staff.map(({ candidate, role, hourlyWage, truck }): Hire => ({
    candidate,
    role,
    hourlyWage,
    ...(truck === undefined ? {} : { truck }),
  }))
  attempt('staff', () => validateStaff(hires, content))
  staff.forEach((employee, index) => {
    const { candidate, role, hourlyWage, hiredOnDay, underpaidSince } = employee
    if (hiredOnDay < first || hiredOnDay > played) {
      invalid(
        `employee ${index + 1}, ${candidate}, was hired on day ${hiredOnDay}, not a day played from day ${first} to day ${played}`,
      )
    }
    if (underpaidSince === undefined) return
    if (underpaidSince < hiredOnDay || underpaidSince > played) {
      invalid(
        `employee ${index + 1}, ${candidate}, is underpaid since day ${underpaidSince}, not a day they worked from day ${hiredOnDay} to day ${played}`,
      )
    }
    if (hourlyWage >= askingWage(candidate, role, content)) {
      invalid(
        `employee ${index + 1}, ${candidate}, is underpaid since day ${underpaidSince}, but earns what they ask`,
      )
    }
    const quits = quitsOnDay(employee, content) ?? played
    if (quits <= played) {
      invalid(
        `employee ${index + 1}, ${candidate}, would have quit on day ${quits}, by day ${played}`,
      )
    }
  })
  checkAbsences(save, content)
  if (lastDay?.day === day) {
    if (!sameHires(hires, decisions.staff)) {
      invalid(
        `the staff at the close of day ${day} is not the one the decisions want`,
      )
    }
  } else {
    keepsRoles('decisions', decisions.staff, hires)
  }
  if (pendingDecisions !== null) {
    keepsRoles('pendingDecisions', pendingDecisions.staff, decisions.staff)
  }
}

/**
 * The last day's absent are distinct employees on staff, each drawn absent
 * that day (see `isAbsent`), and those who quit distinct ones no longer on
 * staff.
 */
function checkAbsences(save: Save, content: StaffContent): void {
  const { lastDay, staff, seed } = save
  if (lastDay === null) return
  const { day, absent = [], quits = [] } = lastDay
  if (new Set(absent).size !== absent.length) {
    invalid(`lastDay.absent names an employee twice`)
  }
  if (new Set(quits).size !== quits.length) {
    invalid(`lastDay.quits names an employee twice`)
  }
  for (const candidate of absent) {
    const employee = staff.find((on) => on.candidate === candidate)
    if (employee === undefined) {
      invalid(`lastDay.absent names ${candidate}, who is not on staff`)
    } else if (!isAbsent(seed, day, employee, content)) {
      invalid(`lastDay.absent names ${candidate}, who came on day ${day}`)
    }
  }
  for (const candidate of quits) {
    if (staff.some((on) => on.candidate === candidate)) {
      invalid(`lastDay.quits names ${candidate}, who is still on staff`)
    }
  }
}

/**
 * Whether `a` and `b` hire the same people, in the same roles and order, at
 * the same wages and trucks.
 */
function sameHires(a: readonly Hire[], b: readonly Hire[]): boolean {
  return (
    a.length === b.length &&
    a.every((hire, index) => {
      const other = b[index]
      return (
        other?.candidate === hire.candidate &&
        other.role === hire.role &&
        other.hourlyWage === hire.hourlyWage &&
        other.truck === hire.truck
      )
    })
  )
}

/**
 * The staff `plan` wants on the morning after `staff` worked keeps each of
 * them it still wants in the role they have (see `staffMorning`).
 */
function keepsRoles(
  field: string,
  plan: readonly Hire[],
  staff: readonly Hire[],
): void {
  for (const { candidate, role } of plan) {
    const on = staff.find((hire) => hire.candidate === candidate)
    if (on !== undefined && on.role !== role) {
      invalid(
        `${field}.staff gives ${candidate} the role ${role}, but they work as ${on.role}`,
      )
    }
  }
}

/**
 * What the financing could be at the save's day, against `rules`:
 * - each emergency loan taken on a morning from the game's first day to
 *   the save's day, in order, after the one before it closed (see
 *   `isLoanOpen`), and at most one at a difficulty of `noSecondLoanAt`;
 *   its fee no more than what it lent;
 * - each share sale made on such a morning, in order, `maxShareRounds` at
 *   most;
 * - `belowZeroSince` what the closes in the books give (see
 *   `belowZeroSinceOf`), and `lastLoanRequestDay` a morning from the first
 *   day to the save's day;
 * - the journal holds the entries of each loan and sale, and of each 1st
 *   played (see `chargesOn`), and no other entry of the financing's memos,
 *   in any order within a day.
 */
function checkFinancing(
  save: Save,
  journal: Journal,
  rules: FinancingContent,
): void {
  const { day, lastDay, financing, profile } = save
  const { loans, shareSales, belowZeroSince, lastLoanRequestDay } = financing
  const first = firstDay(save)
  const played = lastDay?.day ?? first - 1
  const onAMorning = (what: string, at: Day) => {
    if (at < first || at > day) {
      invalid(
        `${what} is on day ${at}, not a morning from day ${first} to day ${day}`,
      )
    }
  }
  loans.forEach((loan, index) => {
    const what = `emergency loan ${index + 1}`
    onAMorning(what, loan.day)
    const before = loans[index - 1]
    if (before !== undefined && isLoanOpen(before, loan.day)) {
      invalid(
        `${what} was taken on day ${loan.day}, while the one before it was still open`,
      )
    }
    if (index > 0 && rules.noSecondLoanAt.includes(profile.difficulty)) {
      invalid(`${what} is a second emergency loan at ${profile.difficulty}`)
    }
    if (loan.fee > loan.principal) {
      invalid(
        `${what} charged a fee of ${loan.fee}, more than the ${loan.principal} it lent`,
      )
    }
  })
  shareSales.forEach((sale, index) => {
    const what = `share sale ${index + 1}`
    onAMorning(what, sale.day)
    const before = shareSales[index - 1]
    if (before !== undefined && sale.day < before.day) {
      invalid(
        `${what} comes before the one before it: day ${sale.day} < day ${before.day}`,
      )
    }
  })
  if (shareSales.length > rules.maxShareRounds) {
    invalid(
      `${shareSales.length} rounds of shares were sold, more than the ${rules.maxShareRounds} a game may sell`,
    )
  }
  const fromBooks = belowZeroSinceOf(journal, first, played)
  if (belowZeroSince !== fromBooks) {
    invalid(
      `financing.belowZeroSince is ${belowZeroSince}, but the closes in the books give ${fromBooks}`,
    )
  }
  if (lastLoanRequestDay !== null) {
    onAMorning('financing.lastLoanRequestDay', lastLoanRequestDay)
  }

  const expected = attempt('the financing', () => {
    const entries = [
      ...loans.flatMap(loanEntries),
      ...shareSales.flatMap(saleEntries),
    ]
    const since = Math.min(
      ...loans.map((loan) => loan.day),
      ...shareSales.map((sale) => sale.day),
    )
    for (let on = since + 1; on <= played; on += 1) {
      entries.push(...chargesOn(journal, financing, on))
    }
    return entries
  })
  // Compared as a multiset: on a 1st, the journal holds the morning's loan
  // or sale before the payments and dividends, which this builds after.
  const key = ({ day: on, memo, lines }: JournalEntry) =>
    JSON.stringify([
      on,
      memo,
      lines.map(({ account, debit, credit }) => [account, debit, credit]),
    ])
  const owed = new Map<string, number>()
  for (const entry of expected) {
    owed.set(key(entry), (owed.get(key(entry)) ?? 0) + 1)
  }
  for (const entry of entriesOf(journal)) {
    if (!isFinancingMemo(entry.memo)) continue
    const left = owed.get(key(entry)) ?? 0
    if (left === 0) {
      invalid(
        `the journal holds « ${entry.memo} » on day ${entry.day}, which the financing does not owe`,
      )
    }
    owed.set(key(entry), left - 1)
  }
  const missing = expected.find((entry) => (owed.get(key(entry)) ?? 0) > 0)
  if (missing !== undefined) {
    invalid(
      `the journal does not hold « ${missing.memo} » on day ${missing.day} as the financing owes it`,
    )
  }
}

/**
 * What the trips in town could be at the save's day, against `places`: no
 * discount in a Défi, whose trips only a card's choice books; no trip on a
 * morning after the game ended;
 * the owner away all day on a trip that takes the whole day (see
 * `ownerAway`); and a discount of 0 or the share of a place of `places`
 * whose effect is a discount.
 */
function checkTown(save: Save, places: PlacesContent): void {
  const { day, lastDay, challenge, ended, ownerAway } = save
  const { trip, discount } = save.town
  if (challenge !== null && discount !== 0) {
    invalid(`the Défi ${challenge.id} has a discount waiting`)
  }
  if (ended !== null && lastDay?.day !== day && trip !== null) {
    invalid(`the game ended on day ${ended.day}, yet trip is ${trip}`)
  }
  if (trip !== null && takesTheDay(trip, places) && !ownerAway) {
    invalid(`the trip to ${trip} takes the whole day, yet the owner is in`)
  }
  const shares = places.places.flatMap(({ effect }) =>
    effect.kind === 'discount' ? [effect.share] : [],
  )
  if (discount !== 0 && !shares.includes(discount)) {
    invalid(`town.discount is ${discount}, no place's discount`)
  }
}

/**
 * How the game could have ended, if it did: not in a Défi, at the close of
 * `lastDay`'s day, the last of its month, after the whole months below
 * zero `rules` end a game in (see `endAtClose`), as `belowZeroSince`, which
 * `checkFinancing()` read from the books, counts them; and nothing came up
 * after, no event waiting nor chosen since.
 */
function checkEnded(save: Save, rules: FinancingContent): void {
  const { ended, challenge, lastDay, events, financing } = save
  if (ended === null) return
  if (challenge !== null) {
    invalid(`the Défi ${challenge.id} ended in ${ended.reason}`)
  }
  if (lastDay?.day !== ended.day) {
    invalid(
      `the game ended on day ${ended.day}, but the last day played is ${lastDay?.day ?? 'none'}`,
    )
  }
  if (events.pending !== null) {
    invalid(`an event waits after the game ended on day ${ended.day}`)
  }
  const after = events.history.at(-1)
  if (after !== undefined && after.day > ended.day) {
    invalid(
      `the event ${after.event} came up on day ${after.day}, after the game ended on day ${ended.day}`,
    )
  }
  if (endAtClose({ day: ended.day, challenge, financing }, rules) === null) {
    const months = monthsBelowZero(financing.belowZeroSince, ended.day)
    invalid(
      endOfMonth(ended.day) === ended.day
        ? `the game ended in ${ended.reason} on day ${ended.day} after ${months} whole months below zero, not ${rules.bankruptcy.months}`
        : `the game ended on day ${ended.day}, not the last day of a month`,
    )
  }
}

/**
 * The tutorial, if the game has one: never in a Défi; its step one of
 * `content`'s, or none; its days `content`'s days apart; done once its
 * protection ended, and with no step left; skipped only when done; and,
 * while it protects the game, the game not ended and its step not due
 * before the save's day, since `tick()` plays no day with a step left.
 */
function checkTutorial(save: Save, content: TutorialContent): void {
  const { tutorial, challenge, day, ended } = save
  if (tutorial === undefined) return
  const { step, startedDay, endsDay, done, skipped } = tutorial
  if (challenge !== null) {
    invalid(`the Défi ${challenge.id} has a tutorial`)
  }
  const due =
    step === null
      ? null
      : attempt('tutorial.step', () => tutorialStep(step, content))
  if (endsDay - startedDay !== content.days) {
    invalid(
      `the tutorial runs from day ${startedDay} to day ${endsDay}, not ${content.days} days`,
    )
  }
  if (!done && day >= endsDay) {
    invalid(`the tutorial ended on day ${endsDay}, yet it is not done`)
  }
  if (skipped && !done) invalid('the tutorial is skipped, yet not done')
  if (done && step !== null) {
    invalid(`the tutorial is done, yet its step is ${step}`)
  }
  if (!isProtected(save)) return
  if (ended !== null) {
    invalid(`the game ended on day ${ended.day} during the tutorial`)
  }
  const today = tutorialDay(save) ?? 0
  if (due !== null && due.day < today) {
    invalid(
      `the tutorial's step ${due.id} of day ${due.day} is not done on its day ${today}`,
    )
  }
}

/**
 * Réal's postcards (#239): each once a game, and none in a Défi, which gets
 * none.
 */
function checkPostcards({ postcardsShown, challenge }: Save): void {
  if (postcardsShown === undefined) return
  if (challenge !== null && postcardsShown.length > 0) {
    invalid(`the Défi ${challenge.id} has postcards`)
  }
  const seen = new Set<string>()
  for (const id of postcardsShown) {
    if (seen.has(id)) invalid(`the postcard ${id} came twice`)
    seen.add(id)
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
