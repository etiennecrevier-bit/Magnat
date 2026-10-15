import { z } from 'zod'
import { cents } from '../engine/money.ts'
import difficultyJson from './difficulty.json'
import foodTruckJson from './foodtruck.json'
import profileJson from './profile.json'
import segmentsJson from './segments.json'

// Every object is strict, so a mistyped key while tuning fails loudly instead
// of being silently dropped.

/** Whole, non-negative cents, typed as the engine's `Cents`. */
const money = z
  .int()
  .nonnegative()
  .transform((n) => cents(n))

/** Whole cents above zero, typed as the engine's `Cents`. */
const positiveMoney = z
  .int()
  .positive()
  .transform((n) => cents(n))

const count = z.int().nonnegative()

/** A share of a whole, such as a probability. */
const share = z.number().min(0).max(1)

// A calendar fact, not a tunable: opening hours are minutes of one day.
const MINUTES_PER_DAY = 1440

/** A minute of the day, counted from midnight: 450 is 7 h 30. */
const minuteOfDay = z.int().min(0).max(MINUTES_PER_DAY)

// A calendar fact, not a tunable: ISO 8601 weekdays run from 1 = Monday to
// 7 = Sunday.
const DAYS_PER_WEEK = 7

/** An ISO 8601 weekday: 1 = Monday to 7 = Sunday. */
const weekday = z.int().min(1).max(DAYS_PER_WEEK)

// Shares that sum to 1 within this tolerance are taken as a whole.
const SHARE_SUM_TOLERANCE = 1e-9

export const productIdSchema = z.enum(['cafe', 'chocolat', 'croissant'])

export type ProductId = z.infer<typeof productIdSchema>

export const segmentIdSchema = z.enum(['aubaine', 'habitue', 'chic'])

export type SegmentId = z.infer<typeof segmentIdSchema>

export const dayTypeIdSchema = z.enum(['semaine', 'finDeSemaine'])

export type DayTypeId = z.infer<typeof dayTypeIdSchema>

export const difficultyIdSchema = z.enum(['facile', 'moyen', 'difficile'])

export type DifficultyId = z.infer<typeof difficultyIdSchema>

export const avatarSchema = z.enum(['femme', 'homme'])

export type Avatar = z.infer<typeof avatarSchema>

const productSchema = z.strictObject({
  name: z.string().min(1),
  unitCostCents: money,
  /** The cup, lid or bag that goes with each unit sold. */
  packagingCents: money,
  shelfLifeDays: z.int().positive(),
})

/** The truck the business runs, whoever paid for it. */
const truckSchema = z.strictObject({
  /**
   * What the truck is worth when a game starts. The books carry it unless
   * it is leased.
   */
  priceCents: money,
  /** Months the truck is depreciated over, straight line. */
  usefulLifeMonths: z.int().positive(),
})

/** What every truck pays on the 1st of each month. */
const monthlyCostsSchema = z.strictObject({
  permitParkingAndCommissary: money,
  insurance: money,
})

/** How customers pay: the share of sales paid by card and its fee. */
const cardPaymentsSchema = z.strictObject({
  share,
  /** The bank's fee, as a share of the card sales. */
  feeRate: share,
})

/**
 * How a product is restocked each morning the truck opens: `buyDaily` buys
 * `quantity` units; `topUp` buys back up to `upTo` units on hand once they
 * fall below `whenBelow`.
 */
const restockRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('buyDaily'), quantity: count }),
  z
    .strictObject({ kind: z.literal('topUp'), whenBelow: count, upTo: count })
    .refine((rule) => rule.whenBelow <= rule.upTo, {
      message: 'whenBelow must not exceed upTo',
      path: ['whenBelow'],
    }),
])

export type RestockRule = z.output<typeof restockRuleSchema>

/** Each segment's share of a crowd: every segment, summing to 1. */
const segmentSharesSchema = z
  .record(segmentIdSchema, share)
  .refine(
    (shares) =>
      Math.abs(sumOf(Object.values(shares)) - 1) <= SHARE_SUM_TOLERANCE,
    'segment shares must sum to 1',
  )

/** The crowd one type of day brings to the truck. */
const dayTypeSchema = z
  .strictObject({
    name: z.string().min(1),
    /** Walk-in traffic before the day's noise. */
    customers: count,
    segmentShares: segmentSharesSchema,
    /** Multiplies each segment's purchase probability for the product. */
    productAppeal: z.record(productIdSchema, z.number().nonnegative()),
    /** How long this crowd waits in line, relative to the usual. */
    patienceMultiplier: z.number().positive(),
    /** Relative arrivals in each slot of the opening hours, in order. */
    arrivalWeights: z.array(z.number().nonnegative()).min(1),
  })
  .refine(({ arrivalWeights }) => sumOf(arrivalWeights) > 0, {
    message: 'at least one arrival weight must be above 0',
    path: ['arrivalWeights'],
  })

export type DayType = z.output<typeof dayTypeSchema>

const walkInsSchema = z
  .strictObject({
    noiseStdDevRatio: z.number().nonnegative(),
    opensAtMinute: minuteOfDay,
    closesAtMinute: minuteOfDay,
    arrivalSlotMinutes: z.int().positive(),
    dayTypes: z.record(dayTypeIdSchema, dayTypeSchema),
  })
  .superRefine((walkIns, ctx) => {
    const { opensAtMinute, closesAtMinute, arrivalSlotMinutes } = walkIns
    const open = closesAtMinute - opensAtMinute
    if (open <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'closesAtMinute must be after opensAtMinute',
        path: ['closesAtMinute'],
      })
      return
    }
    if (open % arrivalSlotMinutes !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'the opening hours must hold a whole number of arrival slots',
        path: ['arrivalSlotMinutes'],
      })
      return
    }
    const slots = open / arrivalSlotMinutes
    for (const id of dayTypeIdSchema.options) {
      if (walkIns.dayTypes[id].arrivalWeights.length !== slots) {
        ctx.addIssue({
          code: 'custom',
          message: `expected one arrival weight per slot: ${slots}`,
          path: ['dayTypes', id, 'arrivalWeights'],
        })
      }
    }
  })

export type WalkIns = z.output<typeof walkInsSchema>

/**
 * How long serving a customer takes at the counter, and how long a line
 * customers will still join. A server at speed 1 takes exactly these times.
 */
const serviceSchema = z.strictObject({
  /** Seconds every customer takes, whatever they order. */
  baseSeconds: count,
  /** Seconds each unit ordered adds, sold out or not. */
  perItemSeconds: count,
  /** The most customers a newcomer finds still waiting and joins anyway. */
  maxAheadInLine: count,
})

export type Service = z.output<typeof serviceSchema>

/**
 * What the daily marketing budget brings. Awareness is the average spend of
 * the last `awarenessDays` business days, today not included, so spending
 * pays off from the next day. Each open day brings k × √awareness extra
 * walk-ins, with awareness in cents, before the day's noise.
 */
const marketingSchema = z.strictObject({
  /** The business days awareness averages, a closed day counting as 0. */
  awarenessDays: z.int().positive(),
  /** k: the extra walk-ins per square root of a cent of awareness. */
  extraCustomersPerSqrtCent: z.number().nonnegative(),
  /** Who the extra walk-ins are. */
  segmentShares: segmentSharesSchema,
})

export type Marketing = z.output<typeof marketingSchema>

/**
 * How the truck runs when a game starts, until the player changes it. Each
 * product keeps the kind of restock rule it starts with.
 */
const startingDecisionsSchema = z.strictObject({
  pricesCents: z.record(productIdSchema, money),
  restock: z.record(productIdSchema, restockRuleSchema),
  /** The weekdays the truck opens. */
  daysOpen: z.array(weekday),
  ownerWeeklyPayCents: money,
  marketingDailyCents: money,
})

// A range of values the player may pick, both ends allowed.
const orderedRange = {
  check: ({ min, max }: { min: number; max: number }) => min <= max,
  params: { message: 'min must not exceed max', path: ['min'] },
}

const moneyRange = z
  .strictObject({ min: money, max: money })
  .refine(orderedRange.check, orderedRange.params)

/** What the player may decide; the engine rejects anything outside it. */
const decisionLimitsSchema = z.strictObject({
  /** Prices are whole multiples of `step`. */
  priceCents: z
    .strictObject({ min: money, max: money, step: z.int().positive() })
    .refine(orderedRange.check, orderedRange.params),
  /** The units a restock rule may name. */
  units: z
    .strictObject({ min: count, max: count })
    .refine(orderedRange.check, orderedRange.params),
  ownerWeeklyPayCents: moneyRange,
  marketingDailyCents: moneyRange,
  minDaysOpen: z.int().min(1).max(DAYS_PER_WEEK),
})

export type DecisionLimits = z.output<typeof decisionLimitsSchema>

// A record keyed by the enum needs every product and rejects any other key.
export const foodTruckSchema = z.strictObject({
  _note: z.string().optional(),
  products: z.record(productIdSchema, productSchema),
  truck: truckSchema,
  monthlyCostsCents: monthlyCostsSchema,
  fuelAndMaintenancePerOpenDayCents: money,
  cardPayments: cardPaymentsSchema,
  /** The weekday the owner is paid, whether the truck opens or not. */
  ownerPayWeekday: weekday,
  walkIns: walkInsSchema,
  service: serviceSchema,
  marketing: marketingSchema,
  startingDecisions: startingDecisionsSchema,
  decisionLimits: decisionLimitsSchema,
})

export type FoodTruckContent = z.output<typeof foodTruckSchema>

/** How a segment's customers decide on one product. */
const segmentProductSchema = z.strictObject({
  /** The price they find fair; above it they buy less. */
  referencePriceCents: z
    .int()
    .positive()
    .transform((n) => cents(n)),
  /** The chance they buy one at the reference price, before appeal. */
  purchaseProbability: share,
  /** How steeply they buy less as the price rises above the reference. */
  sensitivity: z.number().nonnegative(),
})

/** Customers who distrust a price far below their reference. */
const tooCheapSchema = z.strictObject({
  /** The price ratio under which they mostly stop buying. */
  belowRatio: z.number().gt(0).lt(1),
  /** How sharply they stop buying around that ratio. */
  steepness: z.number().positive(),
})

const segmentSchema = z.strictObject({
  name: z.string().min(1),
  /**
   * The longest wait in line they accept, in minutes, before the day type's
   * `patienceMultiplier`.
   */
  patienceMinutes: z.number().positive(),
  products: z.record(productIdSchema, segmentProductSchema),
  tooCheap: tooCheapSchema.optional(),
})

export type Segment = z.output<typeof segmentSchema>

export const customerSchema = z.strictObject({
  _note: z.string().optional(),
  segments: z.record(segmentIdSchema, segmentSchema),
})

export type CustomerContent = z.output<typeof customerSchema>

/**
 * How the truck comes to the business: already the owner's (`owned`), bought
 * with a startup loan (`loan`) or leased by the month (`lease`).
 */
const startingTruckSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owned') }),
  z.strictObject({
    kind: z.literal('loan'),
    loanCents: positiveMoney,
    /** The yearly rate in basis points: 800 is 8 %. */
    annualRateBasisPoints: z.int().nonnegative(),
    /** Monthly payments, the first a month after the loan. */
    termMonths: z.int().positive(),
  }),
  z.strictObject({ kind: z.literal('lease'), monthlyLeaseCents: money }),
])

/** One way to start a game, as the new game screen shows it. */
const difficultySchema = z.strictObject({
  name: z.string().min(1),
  /** What the business has in the bank once the truck is settled. */
  startingCashCents: money,
  truck: startingTruckSchema,
})

export type Difficulty = z.output<typeof difficultySchema>

export const difficultyContentSchema = z.strictObject({
  _note: z.string().optional(),
  difficulties: z.record(difficultyIdSchema, difficultySchema),
})

export type DifficultyContent = z.output<typeof difficultyContentSchema>

export const profileContentSchema = z.strictObject({
  _note: z.string().optional(),
  /** The most characters a business name may hold. */
  businessNameMaxLength: z.int().positive(),
  /** What the new game screen offers until the player changes it. */
  defaultProfile: z.strictObject({
    businessName: z.string().min(1),
    avatar: avatarSchema,
    difficulty: difficultyIdSchema,
  }),
})

export type ProfileContent = z.output<typeof profileContentSchema>

/**
 * Validates the food truck's content and returns it typed, with money as
 * `Cents`. Throws an Error naming every invalid field. Pass `raw` only to
 * check other data; by default it reads `foodtruck.json`.
 */
export function loadFoodTruckContent(
  raw: unknown = foodTruckJson,
): FoodTruckContent {
  return parsed(foodTruckSchema, raw, 'foodtruck.json')
}

/**
 * Validates the customer segments and returns them typed, with money as
 * `Cents`. Throws an Error naming every invalid field. Pass `raw` only to
 * check other data; by default it reads `segments.json`.
 */
export function loadCustomerContent(
  raw: unknown = segmentsJson,
): CustomerContent {
  return parsed(customerSchema, raw, 'segments.json')
}

/**
 * Validates the difficulties and returns them typed, with money as `Cents`.
 * Throws an Error naming every invalid field. Pass `raw` only to check other
 * data; by default it reads `difficulty.json`.
 */
export function loadDifficultyContent(
  raw: unknown = difficultyJson,
): DifficultyContent {
  return parsed(difficultyContentSchema, raw, 'difficulty.json')
}

/**
 * Validates the player profile's defaults and limits and returns them typed.
 * Throws an Error naming every invalid field. Pass `raw` only to check other
 * data; by default it reads `profile.json`.
 */
export function loadProfileContent(raw: unknown = profileJson): ProfileContent {
  return parsed(profileContentSchema, raw, 'profile.json')
}

function parsed<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  file: string,
): z.output<T> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`${file} is invalid:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
