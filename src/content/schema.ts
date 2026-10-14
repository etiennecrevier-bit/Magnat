import { z } from 'zod'
import { cents } from '../engine/money.ts'
import foodTruckJson from './foodtruck.json'
import segmentsJson from './segments.json'

// Every object is strict, so a mistyped key while tuning fails loudly instead
// of being silently dropped.

/** Whole, non-negative cents, typed as the engine's `Cents`. */
const money = z
  .int()
  .nonnegative()
  .transform((n) => cents(n))

const count = z.int().nonnegative()

/** A share of a whole, such as a probability. */
const share = z.number().min(0).max(1)

// A calendar fact, not a tunable: opening hours are minutes of one day.
const MINUTES_PER_DAY = 1440

/** A minute of the day, counted from midnight: 450 is 7 h 30. */
const minuteOfDay = z.int().min(0).max(MINUTES_PER_DAY)

// Shares that sum to 1 within this tolerance are taken as a whole.
const SHARE_SUM_TOLERANCE = 1e-9

export const productIdSchema = z.enum(['cafe', 'chocolat', 'croissant'])

export type ProductId = z.infer<typeof productIdSchema>

export const segmentIdSchema = z.enum(['aubaine', 'habitue', 'chic'])

export type SegmentId = z.infer<typeof segmentIdSchema>

export const dayTypeIdSchema = z.enum(['semaine', 'finDeSemaine'])

export type DayTypeId = z.infer<typeof dayTypeIdSchema>

const productSchema = z.strictObject({
  name: z.string().min(1),
  unitCostCents: money,
  basePriceCents: money,
  shelfLifeDays: z.int().positive(),
})

// Placeholder until the player controls restocking in phase 2.
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

/** The crowd one type of day brings to the truck. */
const dayTypeSchema = z
  .strictObject({
    name: z.string().min(1),
    /** Walk-in traffic before the day's noise. */
    customers: count,
    segmentShares: z.record(segmentIdSchema, share),
    /** Multiplies each segment's purchase probability for the product. */
    productAppeal: z.record(productIdSchema, z.number().nonnegative()),
    /** How long this crowd waits in line, relative to the usual. */
    patienceMultiplier: z.number().positive(),
    /** Relative arrivals in each slot of the opening hours, in order. */
    arrivalWeights: z.array(z.number().nonnegative()).min(1),
  })
  .refine(
    ({ segmentShares }) =>
      Math.abs(sumOf(Object.values(segmentShares)) - 1) <= SHARE_SUM_TOLERANCE,
    { message: 'segment shares must sum to 1', path: ['segmentShares'] },
  )
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

// A record keyed by the enum needs every product and rejects any other key.
export const foodTruckSchema = z.strictObject({
  _note: z.string().optional(),
  startingCapitalCents: money,
  products: z.record(productIdSchema, productSchema),
  dailyFixedCostsCents: z.strictObject({
    rentAndPermit: money,
    fuelAndMaintenance: money,
  }),
  walkIns: walkInsSchema,
  restockPolicy: z.record(productIdSchema, restockRuleSchema),
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
