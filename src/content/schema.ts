import { z } from 'zod'
import { cents } from '../engine/money.ts'
import foodTruckJson from './foodtruck.json'

// Every object is strict, so a mistyped key while tuning fails loudly instead
// of being silently dropped.

/** Whole, non-negative cents, typed as the engine's `Cents`. */
const money = z
  .int()
  .nonnegative()
  .transform((n) => cents(n))

const count = z.int().nonnegative()

export const productIdSchema = z.enum(['cafe', 'croissant'])

export type ProductId = z.infer<typeof productIdSchema>

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

// A record keyed by the enum needs every product and rejects any other key.
export const foodTruckSchema = z.strictObject({
  _note: z.string().optional(),
  startingCapitalCents: money,
  products: z.record(productIdSchema, productSchema),
  dailyFixedCostsCents: z.strictObject({
    rentAndPermit: money,
    fuelAndMaintenance: money,
  }),
  walkIns: z.strictObject({
    weekdayCustomers: count,
    weekendCustomers: count,
    noiseStdDevRatio: z.number().nonnegative(),
  }),
  purchaseProbability: z.record(productIdSchema, z.number().min(0).max(1)),
  restockPolicy: z.record(productIdSchema, restockRuleSchema),
})

export type FoodTruckContent = z.output<typeof foodTruckSchema>

/**
 * Validates the food truck's content and returns it typed, with money as
 * `Cents`. Throws an Error naming every invalid field. Pass `raw` only to
 * check other data; by default it reads `foodtruck.json`.
 */
export function loadFoodTruckContent(
  raw: unknown = foodTruckJson,
): FoodTruckContent {
  const result = foodTruckSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `foodtruck.json is invalid:\n${z.prettifyError(result.error)}`,
    )
  }
  return result.data
}
