import type { ProductId, RestockRule, SegmentId } from '../content/schema.ts'
import { BAKED, morningBakery, runsOn, supplyRule } from '../engine/bakery.ts'
import { SEGMENTS } from '../engine/customers.ts'
import { CUSTOMERS, DIFFICULTIES, FOOD_TRUCK } from '../engine/day.ts'
import { latestDecisions } from '../engine/decisions.ts'
import { onHand, orderSize, PRODUCTS } from '../engine/inventory.ts'
import { add, cents, sub, type Cents } from '../engine/money.ts'
import type { DaySummary, GameState } from '../engine/types.ts'
import { formatCount, formatMoney } from './formatMoney.ts'
import type { TipContent, TipRow } from './tooltip.ts'
import { clockTime } from './tripBoard.ts'

// What each product's card in « Le camion » shows beside its price and its
// restock rule (#203): one status line from yesterday's numbers, and the
// tooltip with the rest. The engine counts them (DaySummary); this only
// picks which one to show and words it.

// Minutes per hour, a clock fact.
const MINUTES_PER_HOUR = 60
// French puts a no-break space (U+00A0) before a colon.
const COLON = '\u00a0:'

/** How a status line's dot reads: its colour, always with words. */
export type Tone = 'ok' | 'warn' | 'bad' | 'off'

/** What a card's status line says about yesterday, and in what tone. */
export interface StatusFact {
  readonly tone: Tone
  readonly text: string
}

/**
 * A card's one status line: yesterday's most important fact, then what
 * changes tomorrow; either may be missing, and with neither, no line shows.
 */
export interface StatusLine {
  readonly fact: StatusFact | null
  /** « Demain : 3,50 $ », when the latest decision differs from today's. */
  readonly tomorrow: string | null
}

/**
 * What one segment did with the product yesterday. No « trop cher » here:
 * a visit records what it bought, not which products its prices turned
 * away (`Visit.outcome` is `tooExpensive` only when it bought nothing), so
 * a segment's count for one product is not known.
 */
export interface SegmentProductFacts {
  readonly segment: SegmentId
  readonly sold: number
}

/** Yesterday at the truck, for one product. */
export interface YesterdayFacts {
  readonly sold: number
  /** Customers a price above their reference turned away from the product. */
  readonly pricedOut: number
  /** Units asked for after the product had sold out. */
  readonly lostSales: number
  readonly spoiled: number
  /**
   * When the last unit sold went, in minutes from midnight, the day it sold
   * out; null when it did not sell out, or no unit sold to tell when.
   */
  readonly soldOutMinute: number | null
  readonly segments: readonly SegmentProductFacts[]
}

/** Yesterday's facts for `product`, from `day`, the last day played. */
export function yesterdayFacts(
  day: DaySummary,
  product: ProductId,
): YesterdayFacts {
  const lostSales = day.lostSales[product]
  let lastSale: number | null = null
  for (const { bought, servedMinute } of day.visits) {
    if (bought[product] > 0 && servedMinute !== null) {
      lastSale = Math.max(lastSale ?? servedMinute, servedMinute)
    }
  }
  return {
    sold: day.sold[product],
    pricedOut: day.pricedOut[product],
    lostSales,
    spoiled: day.spoiled[product],
    soldOutMinute: lostSales > 0 ? lastSale : null,
    segments: SEGMENTS.map((segment) => ({
      segment,
      sold: day.visits.reduce(
        (units, visit) =>
          visit.segment === segment ? units + visit.bought[product] : units,
        0,
      ),
    })),
  }
}

/**
 * Whether `product` is on sale today: the truck has some on hand this
 * morning, or the rule that supplies it today brings some (see
 * `supplyRule`: the bake rule for croissants the running bakery makes, the
 * restock rule otherwise, croissants the player wants made included while
 * no bakery runs).
 */
export function onSale(game: GameState, product: ProductId): boolean {
  const units = onHand(game.inventory, product)
  if (units > 0) return true
  const bakery = morningBakery(game.bakery, game.decisions.bakery, game.day)
  const rule = supplyRule(bakery, game.decisions, game.day, product)
  return orderSize(rule, units) > 0
}

/**
 * What a unit of `product` costs the truck as of the latest decisions:
 * the content's cost, or the bakery's ingredients for croissants it will
 * make tomorrow, plus what it goes out in.
 */
export function unitCost(game: GameState, product: ProductId): Cents {
  const { unitCostCents, packagingCents } = FOOD_TRUCK.products[product]
  const latest = latestDecisions(game)
  const today = morningBakery(game.bakery, game.decisions.bakery, game.day)
  const made =
    product === BAKED &&
    latest.croissantSource === 'fabriquer' &&
    runsOn(today, latest.bakery, game.day + 1)
  const cost = made
    ? DIFFICULTIES.bakery[game.profile.difficulty].ingredientCostCents
    : unitCostCents
  return add(cents(cost), cents(packagingCents))
}

/** « vers 14 h », the hour nearest `minute`. */
function aroundHour(minute: number): string {
  const hour = Math.round(minute / MINUTES_PER_HOUR)
  return `vers ${clockTime(hour * MINUTES_PER_HOUR)}`
}

function stockout(facts: YesterdayFacts): StatusFact {
  return {
    tone: 'bad',
    text:
      facts.soldOutMinute === null
        ? 'Rupture hier'
        : `Rupture ${aroundHour(facts.soldOutMinute)}`,
  }
}

function spoiledFact(spoiled: number): StatusFact {
  return {
    tone: 'warn',
    text: `${formatCount(spoiled)} périmé${spoiled > 1 ? 's' : ''} hier`,
  }
}

const OFF_SALE: StatusFact = { tone: 'off', text: 'Hors vente' }

/**
 * Yesterday's most important fact for a product's price, `null` before the
 * first day is over: « Hors vente » first, whatever the day, then a
 * stockout, customers who found it too expensive, units spoiled, and
 * whether it sold at all.
 */
export function menuFact(
  facts: YesterdayFacts | null,
  sale: boolean,
): StatusFact | null {
  if (!sale) return OFF_SALE
  if (facts === null) return null
  if (facts.lostSales > 0) return stockout(facts)
  const { pricedOut } = facts
  if (pricedOut > 0) {
    return {
      tone: 'warn',
      text:
        pricedOut === 1
          ? '1 client trouvait ça cher'
          : `${formatCount(pricedOut)} clients trouvaient ça cher`,
    }
  }
  if (facts.spoiled > 0) return spoiledFact(facts.spoiled)
  return facts.sold > 0
    ? { tone: 'ok', text: 'Bien vendu hier' }
    : { tone: 'off', text: 'Aucune vente hier' }
}

/**
 * Yesterday's most important fact for a product's restock rule, `null`
 * before the first day is over: a stockout, then units spoiled, then what
 * was left this morning, `left`.
 */
export function stockFact(
  facts: YesterdayFacts | null,
  left: number,
): StatusFact | null {
  if (facts === null) return null
  if (facts.lostSales > 0) return stockout(facts)
  if (facts.spoiled > 0) return spoiledFact(facts.spoiled)
  return {
    tone: 'off',
    text:
      left === 0
        ? "Il n'en restait plus hier"
        : `Il en restait ${formatCount(left)} hier`,
  }
}

/** « Demain : 3,50 $ », when `latest` differs from today's `current`. */
export function tomorrowPrice(current: Cents, latest: Cents): string | null {
  return latest === current ? null : `Demain${COLON} ${formatMoney(latest)}`
}

function ruleText(rule: RestockRule): string {
  switch (rule.kind) {
    case 'buyDaily':
      return `${formatCount(rule.quantity)} par jour`
    case 'topUp':
      return `sous ${formatCount(rule.whenBelow)}, jusqu'à ${formatCount(rule.upTo)}`
  }
}

/** « Demain : sous 120, jusqu'à 300 », when the rule changes tomorrow. */
export function tomorrowRule(
  current: RestockRule,
  latest: RestockRule,
): string | null {
  const text = ruleText(latest)
  return text === ruleText(current) && latest.kind === current.kind
    ? null
    : `Demain${COLON} ${text}`
}

function warnCount(label: string, count: number): TipRow {
  return { label, value: formatCount(count), warn: count > 0 }
}

/**
 * The tooltip of a product's card: « Croissant · hier », the units sold,
 * the customers it was too expensive for, the units it lacked and those
 * spoiled, what a unit costs and leaves at `price`, then each segment's
 * sales under a thin line. Before the first day is over, only the cost and
 * the margin.
 */
export function productTip(
  product: ProductId,
  facts: YesterdayFacts | null,
  price: Cents,
  cost: Cents,
): TipContent {
  const { name } = FOOD_TRUCK.products[product]
  const money: TipRow[] = [
    { label: 'Coût unitaire', value: formatMoney(cost) },
    { label: 'Marge unitaire', value: formatMoney(sub(price, cost)) },
  ]
  if (facts === null) {
    return {
      title: name,
      text: "Aucune journée terminée pour l'instant.",
      rows: money,
    }
  }
  const segments = facts.segments.map(({ segment, sold }, index): TipRow => ({
    label: CUSTOMERS.segments[segment].name,
    value: `${formatCount(sold)} vendus`,
    divider: index === 0,
  }))
  return {
    title: `${name} · hier`,
    rows: [
      { label: 'Vendus', value: formatCount(facts.sold) },
      warnCount('Trop cher', facts.pricedOut),
      warnCount('Rupture', facts.lostSales),
      { label: 'Périmés', value: formatCount(facts.spoiled) },
      ...money,
      ...segments,
    ],
  }
}

/** What « Le camion » shows of one product beside its decisions. */
export interface ProductBoard {
  /** Yesterday's facts; null before the first day is over. */
  readonly facts: YesterdayFacts | null
  /** Whether it is on sale today (see `onSale`). */
  readonly onSale: boolean
  /** Units on hand this morning, what was left of yesterday. */
  readonly left: number
  /** What a unit costs (see `unitCost`). */
  readonly cost: Cents
}

/** Each product's board for `game` on the morning of `game.day`. */
export function productBoards(
  game: GameState,
): Readonly<Record<ProductId, ProductBoard>> {
  const { lastDay } = game
  const board = (product: ProductId): ProductBoard => ({
    facts: lastDay === null ? null : yesterdayFacts(lastDay, product),
    onSale: onSale(game, product),
    left: onHand(game.inventory, product),
    cost: unitCost(game, product),
  })
  return Object.fromEntries(
    PRODUCTS.map((product) => [product, board(product)]),
  ) as Record<ProductId, ProductBoard>
}
