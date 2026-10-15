import type { FoodTruckContent, ProductId } from '../../src/content/schema.ts'
import { FOOD_TRUCK } from '../../src/engine/day.ts'
import type { DecisionChange } from '../../src/engine/decisions.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { cents, mulRatio, type Cents } from '../../src/engine/money.ts'

// The scripted strategies the balance bot plays: every combination of the
// values below, which are the test grid of #57, not tunables of the game.

/** How far every price sits from the content's starting price, in %. */
export const PRICE_CHANGES = [-20, 0, 20, 40] as const
/** Croissants bought each morning the truck opens. */
export const CROISSANTS_PER_DAY = [40, 70, 110] as const
/** The marketing budget, each day: $0, $30 and $80. */
export const MARKETING_DAILY = [cents(0), cents(3000), cents(8000)] as const
/** Days the truck opens each week. */
export const DAYS_OPEN = [6, 7] as const

/** ISO weekdays: 6 days closes on Monday, the quietest weekday. */
const WEEKDAYS: Record<DaysOpen, readonly number[]> = {
  6: [2, 3, 4, 5, 6, 7],
  7: [1, 2, 3, 4, 5, 6, 7],
}

export type PriceChange = (typeof PRICE_CHANGES)[number]
export type DaysOpen = (typeof DAYS_OPEN)[number]

/** One way to run the truck for the whole game. */
export interface Strategy {
  readonly priceChange: PriceChange
  readonly croissantsPerDay: number
  readonly marketingDaily: Cents
  readonly daysOpen: DaysOpen
}

/** What a strategy sets, each with the values the grid tries. */
export type Axis = keyof Strategy

/** Every combination of the grid, prices first and days open last. */
export const STRATEGIES: readonly Strategy[] = PRICE_CHANGES.flatMap(
  (priceChange) =>
    CROISSANTS_PER_DAY.flatMap((croissantsPerDay) =>
      MARKETING_DAILY.flatMap((marketingDaily) =>
        DAYS_OPEN.map((daysOpen) => ({
          priceChange,
          croissantsPerDay,
          marketingDaily,
          daysOpen,
        })),
      ),
    ),
)

/**
 * The decision changes that put `strategy` in place: every product's price,
 * the croissants bought each day, the marketing budget and the days open.
 * Café and chocolat restock and the owner's pay keep their starting values.
 */
export function strategyChanges(
  strategy: Strategy,
  content: FoodTruckContent = FOOD_TRUCK,
): DecisionChange[] {
  return [
    ...PRODUCTS.map((product): DecisionChange => ({
      kind: 'price',
      product,
      price: changedPrice(strategy.priceChange, product, content),
    })),
    {
      kind: 'restock',
      product: 'croissant',
      rule: { kind: 'buyDaily', quantity: strategy.croissantsPerDay },
    },
    { kind: 'marketingDaily', budget: strategy.marketingDaily },
    { kind: 'daysOpen', weekdays: WEEKDAYS[strategy.daysOpen] },
  ]
}

/**
 * The starting price of `product` moved by `priceChange` %, rounded half up
 * to a whole step of the content's price limits.
 */
export function changedPrice(
  priceChange: number,
  product: ProductId,
  content: FoodTruckContent = FOOD_TRUCK,
): Cents {
  const start = content.startingDecisions.pricesCents[product]
  const { step } = content.decisionLimits.priceCents
  const moved = mulRatio(start, (100 + priceChange) / 100)
  const remainder = moved % step
  return cents(moved - remainder + (2 * remainder >= step ? step : 0))
}
