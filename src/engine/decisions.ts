import {
  croissantSourceSchema,
  decisionKindSchema,
  ovenTermsSchema,
  type BakeryContent,
  type CroissantSource,
  type DecisionKind,
  type DecisionLimits,
  type DefiContent,
  type FoodTruckContent,
  type OvenTerms,
  type ProductId,
  type RestockRule,
} from '../content/schema.ts'
import { BAKERY, holdsPremises } from './bakery.ts'
import { isLocked } from './challenge.ts'
import { DEFIS, FOOD_TRUCK } from './day.ts'
import { PRODUCTS } from './inventory.ts'
import type { Cents } from './money.ts'
import type { BakeryPlan, Decisions, GameState } from './types.ts'

// The player's decisions: how the truck runs, from its prices to the days it
// opens, and the bakery that makes its croissants. A change waits in `pendingDecisions` until the next morning, so a
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
  | {
      readonly kind: 'openBakery'
      /** How its oven comes: leased by the month, or bought once. */
      readonly oven: OvenTerms
    }
  | { readonly kind: 'closeBakery' }
  | { readonly kind: 'croissantSource'; readonly source: CroissantSource }
  | {
      readonly kind: 'bake'
      /** How many croissants the bakery makes each morning. */
      readonly rule: RestockRule
    }

/**
 * The decisions a game starts with, from the content: the truck's, then no
 * bakery and the croissants as `bakery` has them. Throws a RangeError if
 * they break the content's own limits (see `validateDecisions`).
 */
export function startingDecisions(
  content: FoodTruckContent = FOOD_TRUCK,
  bakery: BakeryContent = BAKERY,
): Decisions {
  const start = content.startingDecisions
  const decisions: Decisions = {
    prices: { ...start.pricesCents },
    restock: perProductRule((product) => start.restock[product]),
    daysOpen: ascending(start.daysOpen),
    ownerWeeklyPay: start.ownerWeeklyPayCents,
    marketingDaily: start.marketingDailyCents,
    bakery: null,
    croissantSource: bakery.startingDecisions.croissantSource,
    bake: copied(bakery.startingDecisions.bake),
  }
  validateDecisions(decisions, content.decisionLimits, bakery)
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
 * `openBakery` plans a bakery and how its oven comes, and `closeBakery`
 * drops the plan, so the next morning opens the bakery or gives its notice
 * (see `bakeryMorning`). A bakery that still holds its premises keeps the
 * oven it has until it closes: planning it again takes a notice back.
 *
 * Throws a RangeError, naming the field, if the change names an unknown
 * kind or product, gives a product another kind of restock rule than it has,
 * or leaves the decisions outside the limits of `content` and `bakery` (see
 * `validateDecisions`); one if `openBakery` comes with a bakery already
 * planned, leases an oven when the business owns one, or gives a bakery that
 * holds its premises other oven terms, or if `closeBakery` comes with none
 * planned; and one naming the kind if the game's Défi, one of `defis`, locks
 * it. A Défi locks none of the bakery's changes.
 */
export function applyDecision(
  state: GameState,
  change: DecisionChange,
  content: FoodTruckContent = FOOD_TRUCK,
  defis: DefiContent = DEFIS,
  bakery: BakeryContent = BAKERY,
): GameState {
  if (isLockable(change.kind) && isLocked(state, change.kind, defis)) {
    throw new RangeError(
      `Invalid decision: the Défi ${state.challenge?.id} locks ${change.kind}`,
    )
  }
  const decisions = changed(state, latestDecisions(state), change)
  validateDecisions(decisions, content.decisionLimits, bakery)
  return { ...state, pendingDecisions: decisions }
}

/** Whether a Défi may lock changes of `kind`. */
function isLockable(kind: DecisionChange['kind']): kind is DecisionKind {
  return (decisionKindSchema.options as readonly string[]).includes(kind)
}

/**
 * Throws a RangeError naming the first field outside `limits`. Prices must be
 * whole multiples of the step within their range. Restock rules must name
 * whole numbers of units within their range, with `whenBelow` no higher
 * than `upTo`. The owner's pay and the marketing budget must be whole cents
 * within their ranges. The days open must be ascending ISO weekdays with no
 * repeats, at least `minDaysOpen` of them. Every product needs a price and a
 * rule, and no other key may appear. The bakery planned, if any, needs oven
 * terms, the croissants a source, and the bake rule, of either kind, whole
 * numbers of units from 0 to `bakery.capacityPerDay`, with `whenBelow` no
 * higher than `upTo`.
 */
export function validateDecisions(
  decisions: Decisions,
  limits: DecisionLimits,
  bakery: BakeryContent = BAKERY,
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
    expectRule(`restock.${product}`, decisions.restock[product], limits.units)
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
  expectPlan(decisions.bakery)
  if (!croissantSourceSchema.safeParse(decisions.croissantSource).success) {
    throw new RangeError(
      `Invalid decision: croissantSource must be one of ${croissantSourceSchema.options.join(', ')}: ${String(decisions.croissantSource)}`,
    )
  }
  expectRule('bake', decisions.bake, {
    min: 0,
    max: bakery.capacityPerDay,
  })
}

function changed(
  state: GameState,
  decisions: Decisions,
  change: DecisionChange,
): Decisions {
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
    case 'openBakery':
      return { ...decisions, bakery: opening(state, decisions, change.oven) }
    case 'closeBakery':
      if (decisions.bakery === null) {
        throw new RangeError('Invalid decision: no bakery is planned to close')
      }
      return { ...decisions, bakery: null }
    case 'croissantSource':
      return { ...decisions, croissantSource: change.source }
    case 'bake':
      return { ...decisions, bake: copied(change.rule) }
    default:
      throw new RangeError(
        `Unknown decision: ${String((change as { kind: unknown }).kind)}`,
      )
  }
}

/**
 * The bakery `oven` plans, on top of `decisions`: none may be planned yet,
 * the business leases no oven while it owns one, and a bakery that holds its
 * premises keeps its oven terms until it closes.
 */
function opening(
  state: GameState,
  decisions: Decisions,
  oven: OvenTerms,
): BakeryPlan {
  if (decisions.bakery !== null) {
    throw new RangeError('Invalid decision: a bakery is already planned')
  }
  const { bakery } = state
  if (oven === 'louer' && bakery.ovenBoughtOnDay !== null) {
    throw new RangeError(
      `Invalid decision: bakery.oven cannot be louer, the business owns an oven since day ${bakery.ovenBoughtOnDay}`,
    )
  }
  if (holdsPremises(bakery, state.day) && bakery.oven !== oven) {
    throw new RangeError(
      `Invalid decision: bakery.oven must stay ${bakery.oven} until the bakery closes: ${oven}`,
    )
  }
  return { oven }
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

/** A bakery planned has oven terms and nothing else; none is planned too. */
function expectPlan(plan: BakeryPlan | null): void {
  if (plan === null) return
  const keys = typeof plan === 'object' ? Object.keys(plan) : []
  if (
    keys.length !== 1 ||
    keys[0] !== 'oven' ||
    !ovenTermsSchema.safeParse(plan.oven).success
  ) {
    throw new RangeError(
      `Invalid decision: bakery must be null or name its oven, one of ${ovenTermsSchema.options.join(', ')}: ${JSON.stringify(plan)}`,
    )
  }
}

function expectRule(
  field: string,
  rule: RestockRule,
  units: { min: number; max: number },
): void {
  switch (rule.kind) {
    case 'buyDaily':
      expectWithin(`${field}.quantity`, rule.quantity, units)
      return
    case 'topUp':
      expectWithin(`${field}.whenBelow`, rule.whenBelow, units)
      expectWithin(`${field}.upTo`, rule.upTo, units)
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
