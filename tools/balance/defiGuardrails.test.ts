import { describe, expect, it } from 'vitest'
import { medalSchema, type Defi, type Medal } from '../../src/content/schema.ts'
import { DEFIS, FOOD_TRUCK } from '../../src/engine/day.ts'
import type { DecisionChange } from '../../src/engine/decisions.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { cents } from '../../src/engine/money.ts'
import {
  gridOwnerChanges,
  medalCounts,
  playDefi,
  type DefiGame,
} from './defis.ts'
import { ownerStrategy } from './owners.ts'
import type { Strategy } from './strategies.ts'

// The shipped Défis as P3-14 (#102) tuned them: each can be won, and not by
// just anything. For each, the grid's best strategy, as the last
// `npm run balance -- --defis` found it (docs/balance/phase-3.md), wins « Or »
// in at least 80 % of seeds 1 to 50; every price at 20 $ wins nothing on any
// of them, and no croissants at most bronze, or argent in « Les deux
// semaines sans congé »; and there, the starting prices fall under the floor
// on seeds 1 to 100. P3-13's owners, who play the grid in its own values,
// keep the same medals on seeds 1 to 200, so that a change that moves them
// shows: run the balance again then, and update both.

const SEEDS = 50
const OWNER_SEEDS = 200

/** Seeds 1 to `seeds`, each played by `play`. */
function games(seeds: number, play: (seed: number) => DefiGame): DefiGame[] {
  return Array.from({ length: seeds }, (_, index) => play(index + 1))
}

/** The best strategy of the grid for each Défi, from the last full run. */
const BEST: Readonly<Record<string, Strategy>> = {
  travauxSaintDenis: {
    priceChange: 0,
    croissantsPerDay: 40,
    marketingDaily: cents(0),
    daysOpen: 7,
    ownerWeeklyPay: cents(40_000),
  },
  semaineDesMilleDollars: {
    priceChange: -20,
    croissantsPerDay: 70,
    marketingDaily: cents(0),
    daysOpen: 6,
    ownerWeeklyPay: cents(40_000),
  },
  zeroGaspillage: {
    priceChange: -20,
    croissantsPerDay: 40,
    marketingDaily: cents(8000),
    daysOpen: 7,
    ownerWeeklyPay: cents(40_000),
  },
  festivalDuPasPire: {
    priceChange: 0,
    croissantsPerDay: 110,
    marketingDaily: cents(8000),
    daysOpen: 6,
    ownerWeeklyPay: cents(40_000),
  },
  payeDans60Jours: {
    priceChange: 0,
    croissantsPerDay: 40,
    marketingDaily: cents(0),
    daysOpen: 7,
    ownerWeeklyPay: cents(40_000),
  },
  moisSansConge: {
    priceChange: 0,
    croissantsPerDay: 40,
    marketingDaily: cents(3000),
    daysOpen: 7,
    ownerWeeklyPay: cents(40_000),
  },
}

/** Every price at the most the content allows: nobody buys. */
const PRICED_OUT: DecisionChange[] = PRODUCTS.map((product) => ({
  kind: 'price',
  product,
  price: cents(FOOD_TRUCK.decisionLimits.priceCents.max),
}))

/** No croissants at all: a truck of café and chocolat. */
const NO_CROISSANTS: DecisionChange[] = [
  {
    kind: 'restock',
    product: 'croissant',
    rule: { kind: 'buyDaily', quantity: 0 },
  },
]

/**
 * The content's starting prices, with nothing else changed: in « Les deux
 * semaines sans congé », which opens 30 % above them, everyone comes, and
 * the owner must fall under the floor (#102).
 */
const STARTING_PRICES: DecisionChange[] = PRODUCTS.map((product) => ({
  kind: 'price',
  product,
  price: FOOD_TRUCK.startingDecisions.pricesCents[product],
}))

/**
 * The best medal no croissants may win in each Défi: bronze, except in
 * « Les deux semaines sans congé », whose lesson, fewer customers who pay
 * more, it follows.
 */
const NO_CROISSANTS_AT_MOST: Readonly<Record<string, Medal>> = {
  travauxSaintDenis: 'bronze',
  semaineDesMilleDollars: 'bronze',
  zeroGaspillage: 'bronze',
  festivalDuPasPire: 'bronze',
  payeDans60Jours: 'bronze',
  moisSansConge: 'argent',
}

/** Seeds 1 to `seeds` of the Défi `id`, each played with `changes` only. */
function playedWith(
  id: string,
  seeds: number,
  changes: readonly DecisionChange[],
): DefiGame[] {
  // The play ignores the strategy it is handed.
  const only = (_: Strategy, defi: Defi) =>
    changes.filter(({ kind }) => !defi.locked.includes(kind))
  return games(seeds, (seed) => playDefi(id, seed, BEST[id]!, DEFIS, only))
}

/** What P3-13's owners won on seeds 1 to 200, each Défi as now tuned. */
const P3_13_OWNERS: Readonly<Record<string, ReturnType<typeof medalCounts>>> = {
  travauxSaintDenis: {
    games: 200,
    broken: 63,
    or: 10,
    argentOrBetter: 76,
    bronzeOrBetter: 137,
  },
  semaineDesMilleDollars: {
    games: 200,
    broken: 0,
    or: 17,
    argentOrBetter: 73,
    bronzeOrBetter: 136,
  },
  zeroGaspillage: {
    games: 200,
    broken: 153,
    or: 12,
    argentOrBetter: 31,
    bronzeOrBetter: 47,
  },
  festivalDuPasPire: {
    games: 200,
    broken: 124,
    or: 27,
    argentOrBetter: 61,
    bronzeOrBetter: 76,
  },
  payeDans60Jours: {
    games: 200,
    broken: 57,
    or: 20,
    argentOrBetter: 85,
    bronzeOrBetter: 143,
  },
  moisSansConge: {
    games: 200,
    broken: 132,
    or: 8,
    argentOrBetter: 59,
    bronzeOrBetter: 68,
  },
}

const ids = DEFIS.defis.map(({ id }) => id)

describe('the shipped Défis', () => {
  it('each have a best strategy, a no-croissant bound and P3-13 counts here', () => {
    for (const table of [BEST, NO_CROISSANTS_AT_MOST, P3_13_OWNERS]) {
      expect(Object.keys(table)).toEqual(ids)
    }
  })

  it.each(ids)('%s: the best strategy of the grid wins « Or »', (id) => {
    const strategy = BEST[id]!
    const played = games(SEEDS, (seed) => playDefi(id, seed, strategy))
    expect(100 * medalCounts(played).or).toBeGreaterThanOrEqual(80 * SEEDS)
  })

  it.each(ids)('%s: every price at 20 $ wins nothing', (id) => {
    const played = playedWith(id, SEEDS, PRICED_OUT)
    expect(played.filter(({ medal }) => medal !== null)).toEqual([])
  })

  it.each(ids)('%s: no croissants win no better than its bound', (id) => {
    const better = medalSchema.options.slice(
      0,
      medalSchema.options.indexOf(NO_CROISSANTS_AT_MOST[id]!),
    )
    const played = playedWith(id, SEEDS, NO_CROISSANTS)
    expect(
      played.filter(({ medal }) => medal !== null && better.includes(medal)),
    ).toEqual([])
  })

  it('« Les deux semaines sans congé »: the starting prices, nothing else changed, fall under the floor on every seed', () => {
    const played = playedWith('moisSansConge', 100, STARTING_PRICES)
    expect(played.filter(({ broken }) => !broken)).toEqual([])
  })

  it.each(ids)("%s: P3-13's owners win the same medals", (id) => {
    const played = games(OWNER_SEEDS, (seed) =>
      playDefi(id, seed, ownerStrategy(seed), DEFIS, gridOwnerChanges),
    )
    expect(medalCounts(played)).toEqual(P3_13_OWNERS[id])
  })
})
