import {
  ovenTermsSchema,
  type CroissantSource,
  type OvenTerms,
  type RestockRule,
} from '../content/schema.ts'
import {
  BAKED,
  BAKERY,
  bakeryMonthlyCosts,
  morningBakery,
  runsOn,
} from '../engine/bakery.ts'
import { endOfMonth } from '../engine/calendar.ts'
import { DIFFICULTIES, FOOD_TRUCK } from '../engine/day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from '../engine/decisions.ts'
import type { Cents } from '../engine/money.ts'
import type { BakeryState, Day, GameState } from '../engine/types.ts'

// What the « Fournil » tab of « Le camion » shows (#163). The
// engine runs the bakery (src/engine/bakery.ts) and decides what the player
// may change (applyDecision); this only reads them.

/** Where the bakery stands on a day. */
export type BakeryStatus =
  | { readonly kind: 'closed' }
  /** It runs with no notice, since `since`. */
  | { readonly kind: 'open'; readonly since: Day; readonly oven: OvenTerms }
  /** It runs to the end of its notice, `lastDay`. */
  | { readonly kind: 'notice'; readonly lastDay: Day; readonly oven: OvenTerms }

/** A way to open the bakery tomorrow. */
export interface OpeningOption {
  readonly oven: OvenTerms
  /** Whether the engine takes it. */
  readonly allowed: boolean
  /** What the bakery would then take each 1st; null when not allowed. */
  readonly fixedCosts: Cents | null
}

/** The « Fournil » section. */
export interface BakeryBoard {
  /** The bakery today, once this morning's plan is in effect. */
  readonly today: BakeryStatus
  /** The bakery tomorrow, with the latest plan; null when it stays as is. */
  readonly tomorrow: BakeryStatus | null
  /** Whether the latest plan wants a bakery, so it can be closed. */
  readonly planned: boolean
  /**
   * The last day of the notice closing it now would give; null when it
   * would not run tomorrow anyway.
   */
  readonly closingLastDay: Day | null
  /** The ways to open it, while none is planned; empty otherwise. */
  readonly options: readonly OpeningOption[]
  /** What the bakery planned takes each 1st; null while none is. */
  readonly fixedCosts: Cents | null
  readonly movingCost: Cents
  readonly monthlyRent: Cents
  readonly monthlyLease: Cents
  readonly ovenPrice: Cents
  /** Whether the business owns an oven already. */
  readonly ownsOven: boolean
  /** Croissants it makes a day at most. */
  readonly capacity: number
  /** What a croissant bought costs. */
  readonly boughtUnitCost: Cents
  /** What a croissant made costs in ingredients. */
  readonly madeUnitCost: Cents
  /** Where the croissants come from, as the player last left it. */
  readonly source: CroissantSource
  /** How many it makes each morning, as the player last left it. */
  readonly bake: RestockRule
  /**
   * Whether the croissants will be bought tomorrow though the player wants
   * them made, since no bakery runs then.
   */
  readonly boughtAnyway: boolean
}

/**
 * The « Fournil » section for `game` on the morning of `game.day`: today's
 * bakery and tomorrow's with the latest plan (see `morningBakery`), the
 * openings the engine takes (see `accepts`), the costs at the game's
 * difficulty, and the latest source and bake rule.
 */
export function bakeryBoard(game: GameState): BakeryBoard {
  const { day } = game
  const latest = latestDecisions(game)
  const prices = DIFFICULTIES.bakery[game.profile.difficulty]
  const today = morningBakery(game.bakery, game.decisions.bakery, day)
  const tomorrow = morningBakery(today, latest.bakery, day + 1)
  // The first 1st after tomorrow, a whole month's charges.
  const nextFirst = endOfMonth(day + 1) + 1
  const planned = latest.bakery !== null
  const todayStatus = statusOf(today)
  const tomorrowStatus = statusOf(tomorrow)
  const options = planned
    ? []
    : ovenTermsSchema.options.map((oven): OpeningOption => {
        const allowed = accepts(game, { kind: 'openBakery', oven })
        return {
          oven,
          allowed,
          fixedCosts: allowed
            ? bakeryMonthlyCosts(
                morningBakery(today, { oven }, day + 1),
                nextFirst,
                prices,
              )
            : null,
        }
      })
  return {
    today: todayStatus,
    tomorrow: tomorrowStatus.kind === todayStatus.kind ? null : tomorrowStatus,
    planned,
    closingLastDay: planned
      ? morningBakery(today, null, day + 1).closesAfterDay
      : null,
    options,
    fixedCosts: planned
      ? bakeryMonthlyCosts(tomorrow, nextFirst, prices)
      : null,
    movingCost: BAKERY.movingCostCents,
    monthlyRent: prices.monthlyRentCents,
    monthlyLease: BAKERY.oven.monthlyLeaseCents,
    ovenPrice: BAKERY.oven.priceCents,
    ownsOven: today.ovenBoughtOnDay !== null,
    capacity: BAKERY.capacityPerDay,
    boughtUnitCost: FOOD_TRUCK.products[BAKED].unitCostCents,
    madeUnitCost: prices.ingredientCostCents,
    source: latest.croissantSource,
    bake: latest.bake,
    boughtAnyway:
      latest.croissantSource === 'fabriquer' &&
      !runsOn(today, latest.bakery, day + 1),
  }
}

/**
 * Whether the engine takes `change` on top of `game`'s latest decisions:
 * `applyDecision` makes it without a RangeError. Nothing is kept.
 */
export function accepts(game: GameState, change: DecisionChange): boolean {
  try {
    applyDecision(game, change)
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

function statusOf(bakery: BakeryState): BakeryStatus {
  const { openedOnDay, oven, closesAfterDay } = bakery
  if (openedOnDay === null || oven === null) return { kind: 'closed' }
  return closesAfterDay === null
    ? { kind: 'open', since: openedOnDay, oven }
    : { kind: 'notice', lastDay: closesAfterDay, oven }
}
