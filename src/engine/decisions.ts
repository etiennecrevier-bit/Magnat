import type {
  DecisionLimits,
  DefiContent,
  FoodTruckContent,
  ProductId,
  RestockRule,
} from '../content/schema.ts'
import { isLocked } from './challenge.ts'
import { DEFIS, FOOD_TRUCK } from './day.ts'
import { PRODUCTS } from './inventory.ts'
import type { Cents } from './money.ts'
import type { Decisions, GameState } from './types.ts'

// The player's decisions: how the truck runs, from its prices to the days it
// opens. A change waits in `pendingDecisions` until the next morning, so a
// day is always played with the decisions it began with.

// ISO 8601 weekdays run from 1 = Monday to 7 = Sunday; a calendar fact.
const MONDAY = 1
const SUNDAY = 7

/** One change the player makes to how the truck runs. */
export type DecisionChange =
  | {
      readonly kind: 'price'
      readonly product: ProductId
      readonly price: Cents
    }
  | {
      readonly kind: 'restock'
      readonly product: ProductId
      readonly rule: RestockRule
    }
  | {
      readonly kind: 'daysOpen'
      /** The ISO weekdays the truck opens, in any order. */
      readonly weekdays: readonly number[]
    }
  | { readonly kind: 'ownerWeeklyPay'; readonly pay: Cents }
  | { readonly kind: 'marketingDaily'; readonly budget: Cents }

/**
 * The decisions a game starts with, from the content. Throws a RangeError
 * if they break the content's own limits (see `validateDecisions`).
 */
export function startingDecisions(
  content: FoodTruckContent = FOOD_TRUCK,
): Decisions {
  const start = content.startingDecisions
  const decisions: Decisions = {
    prices: { ...start.pricesCents },
    restock: perProductRule((product) => start.restock[product]),
    daysOpen: ascending(start.daysOpen),
    ownerWeeklyPay: start.ownerWeeklyPayCents,
    marketingDaily: start.marketingDailyCents,
  }
  validateDecisions(decisions, content.decisionLimits)
  return decisions
}

/**
 * The decisions as the player last left them: those waiting for the next
 * morning, or else those of the day under way.
 */
export function latestDecisions(state: GameState): Decisions {
  return state.pendingDecisions ?? state.decisions
}

/**
 * Makes `change` on top of the latest decisions and leaves the result
 * waiting for the next morning, when `tick()` puts it in effect. The day
 * under way keeps its decisions. Returns a new state; never mutates `state`.
 *
 * Throws a RangeError, naming the field, if the change names an unknown
 * kind or product, gives a product another kind of restock rule than it has,
 * or leaves the decisions outside the content's limits (see
 * `validateDecisions`), and one naming the kind if the game's Défi, one of
 * `defis`, locks it.
 */
export function applyDecision(
  state: GameState,
  change: DecisionChange,
  content: FoodTruckContent = FOOD_TRUCK,
  defis: DefiContent = DEFIS,
): GameState {
  if (isLocked(state, change.kind, defis)) {
    throw new RangeError(
      `Invalid decision: the Défi ${state.challenge?.id} locks ${change.kind}`,
    )
  }
  const decisions = changed(latestDecisions(state), change)
  validateDecisions(decisions, content.decisionLimits)
  return { ...state, pendingDecisions: decisions }
}

/**
 * Throws a RangeError naming the first field outside `limits`. Prices must be
 * whole multiples of the step within their range. Restock rules must name
 * whole numbers of units within their range, with `whenBelow` no higher
 * than `upTo`. The owner's pay and the marketing budget must be whole cents
 * within their ranges. The days open must be ascending ISO weekdays with no
 * repeats, at least `minDaysOpen` of them. Every product needs a price and a
 * rule, and no other key may appear.
 */
export function validateDecisions(
  decisions: Decisions,
  limits: DecisionLimits,
): void {
  expectProducts('prices', decisions.prices)
  expectProducts('restock', decisions.restock)
  for (const product of PRODUCTS) {
    const price = decisions.prices[product]
    expectWithin(`prices.${product}`, price, limits.priceCents)
    if (price % limits.priceCents.step !== 0) {
      throw new RangeError(
        `Invalid decision: prices.${product} must be a multiple of ${limits.priceCents.step}: ${price}`,
      )
    }
    expectRule(`restock.${product}`, decisions.restock[product], limits)
  }
  expectWithin(
    'ownerWeeklyPay',
    decisions.ownerWeeklyPay,
    limits.ownerWeeklyPayCents,
  )
  expectWithin(
    'marketingDaily',
    decisions.marketingDaily,
    limits.marketingDailyCents,
  )
  expectDaysOpen(decisions.daysOpen, limits.minDaysOpen)
}

function changed(decisions: Decisions, change: DecisionChange): Decisions {
  switch (change.kind) {
    case 'price':
      return {
        ...decisions,
        prices: { ...decisions.prices, [known(change.product)]: change.price },
      }
    case 'restock': {
      const product = known(change.product)
      const { kind } = decisions.restock[product]
      if (change.rule.kind !== kind) {
        throw new RangeError(
          `Invalid decision: restock.${product} must stay a ${kind} rule: ${change.rule.kind}`,
        )
      }
      return {
        ...decisions,
        restock: { ...decisions.restock, [product]: copied(change.rule) },
      }
    }
    case 'daysOpen':
      return { ...decisions, daysOpen: ascending(change.weekdays) }
    case 'ownerWeeklyPay':
      return { ...decisions, ownerWeeklyPay: change.pay }
    case 'marketingDaily':
      return { ...decisions, marketingDaily: change.budget }
    default:
      throw new RangeError(
        `Unknown decision: ${String((change as { kind: unknown }).kind)}`,
      )
  }
}

function known(product: ProductId): ProductId {
  if (!PRODUCTS.includes(product)) {
    throw new RangeError(`Invalid decision: unknown product ${product}`)
  }
  return product
}

/** The rule's own fields only, so the state never shares the caller's object. */
function copied(rule: RestockRule): RestockRule {
  switch (rule.kind) {
    case 'buyDaily':
      return { kind: 'buyDaily', quantity: rule.quantity }
    case 'topUp':
      return { kind: 'topUp', whenBelow: rule.whenBelow, upTo: rule.upTo }
  }
}

function perProductRule(
  rule: (product: ProductId) => RestockRule,
): Record<ProductId, RestockRule> {
  return Object.fromEntries(
    PRODUCTS.map((product) => [product, copied(rule(product))]),
  ) as Record<ProductId, RestockRule>
}

function ascending(weekdays: readonly number[]): number[] {
  return [...weekdays].sort((a, b) => a - b)
}

function expectProducts(field: string, record: object): void {
  const keys = Object.keys(record).sort()
  if (keys.join() !== [...PRODUCTS].sort().join()) {
    throw new RangeError(
      `Invalid decision: ${field} must name exactly ${PRODUCTS.join(', ')}: ${keys.join(', ')}`,
    )
  }
}

function expectRule(
  field: string,
  rule: RestockRule,
  limits: DecisionLimits,
): void {
  switch (rule.kind) {
    case 'buyDaily':
      expectWithin(`${field}.quantity`, rule.quantity, limits.units)
      return
    case 'topUp':
      expectWithin(`${field}.whenBelow`, rule.whenBelow, limits.units)
      expectWithin(`${field}.upTo`, rule.upTo, limits.units)
      if (rule.whenBelow > rule.upTo) {
        throw new RangeError(
          `Invalid decision: ${field}.whenBelow must not exceed upTo: ${rule.whenBelow} > ${rule.upTo}`,
        )
      }
      return
    default:
      throw new RangeError(
        `Invalid decision: ${field} has an unknown kind: ${String((rule as { kind: unknown }).kind)}`,
      )
  }
}

function expectWithin(
  field: string,
  value: number,
  { min, max }: { min: number; max: number },
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(
      `Invalid decision: ${field} must be a whole number from ${min} to ${max}: ${value}`,
    )
  }
}

function expectDaysOpen(
  weekdays: readonly number[],
  minDaysOpen: number,
): void {
  if (weekdays.length < minDaysOpen) {
    throw new RangeError(
      `Invalid decision: daysOpen needs at least ${minDaysOpen} day(s): ${weekdays.length}`,
    )
  }
  weekdays.forEach((weekday, index) => {
    const previous = weekdays[index - 1] ?? MONDAY - 1
    if (
      !Number.isSafeInteger(weekday) ||
      weekday > SUNDAY ||
      weekday <= previous
    ) {
      throw new RangeError(
        `Invalid decision: daysOpen must be ascending weekdays from ${MONDAY} to ${SUNDAY}, each once: ${weekdays.join(', ')}`,
      )
    }
  })
}
