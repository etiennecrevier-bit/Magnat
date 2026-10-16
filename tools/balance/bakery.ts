import type {
  BakeryContent,
  BakeryPrices,
  DifficultyContent,
  DifficultyId,
  FoodTruckContent,
  GrocerId,
  OvenTerms,
  StaffContent,
} from '../../src/content/schema.ts'
import { BAKERY, BAKERY_MEMO } from '../../src/engine/bakery.ts'
import { endOfMonth, toCalendar } from '../../src/engine/calendar.ts'
import { startContract } from '../../src/engine/contracts.ts'
import { DIFFICULTIES, EVENTS, FOOD_TRUCK } from '../../src/engine/day.ts'
import type { DecisionChange } from '../../src/engine/decisions.ts'
import { NO_EVENTS } from '../../src/engine/events.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { PERCENTILES } from '../../src/engine/percentiles.ts'
import { STAFF, weeklyWage } from '../../src/engine/staff.ts'
import type { GameState } from '../../src/engine/types.ts'
import type { AccountCode } from '../../src/finance/accounts.ts'
import { balance } from '../../src/finance/journal.ts'
import {
  contractChooser,
  grocerCards,
  playMorning,
  startGame,
} from '../sim/simulate.ts'
import { changedPrice } from './strategies.ts'

// The bakery's balance run, `npm run balance -- --bakery` (#157): each game
// opens the bakery on day 0 and makes its croissants there, with a baker
// hired that day (#158), and its twin plays the same seed and the same truck
// buying them, so the gap between their Encaisse is what the bakery made or
// cost, the baker's wages included. The price sets and the truck's
// strategies below are the test grid of #157 and #158, not tunables of the
// game. No I/O: cli.ts writes the report.

const CASH: AccountCode = '1000'

/** A set of the bakery's prices the run tries, at every difficulty. */
export interface PriceSet {
  /** How the report names it. */
  readonly name: string
  readonly prices: BakeryPrices
}

/** Ingredients 0,45 / 0,55 / 0,65 $, rent 2 000 / 2 400 / 2 800 $. */
export const PRICE_SETS: readonly PriceSet[] = [
  {
    name: 'low',
    prices: {
      ingredientCostCents: cents(45),
      monthlyRentCents: cents(200_000),
    },
  },
  {
    name: 'mid',
    prices: {
      ingredientCostCents: cents(55),
      monthlyRentCents: cents(240_000),
    },
  },
  {
    name: 'high',
    prices: {
      ingredientCostCents: cents(65),
      monthlyRentCents: cents(280_000),
    },
  },
]

export const OVENS: readonly OvenTerms[] = ['louer', 'acheter']

/**
 * How the truck runs in a game and its twin. The croissants bought by the
 * twin and made by the bakery are the same number, so the twins differ only
 * by the bakery.
 */
export interface TruckStrategy {
  /** How the report and the jobs name it. */
  readonly name: string
  /** Croissants bought, or made, each morning the truck opens. */
  readonly croissantsPerDay: number
  /** How far the croissant's price sits from its starting price, in %. */
  readonly croissantPriceChange: number
  /** The marketing budget, each day. */
  readonly marketingDaily: Cents
  /**
   * The grocers whose contracts the game and its twin sign on day 0, in
   * order, and renew each time.
   */
  readonly contracts: readonly GrocerId[]
  /** Whether the game and its twin hire an employee at the truck on day 0. */
  readonly atTruck: boolean
}

/**
 * The employee at the truck a strategy hires, and the baker every bakery
 * game hires, both on day 0 at their role's starting wage. Any candidate
 * would do.
 */
export const AT_TRUCK_HIRE = {
  kind: 'hire',
  role: 'camion',
  candidate: 'amelie',
} as const satisfies DecisionChange
export const BAKER_HIRE = {
  kind: 'hire',
  role: 'boulanger',
  candidate: 'sophie',
} as const satisfies DecisionChange

/**
 * The starting decisions; a busy truck that sells about as many croissants
 * as the street lets it; the same truck making 150 a day, the volume #157
 * asks the bakery to win at, though the street buys fewer; and that truck
 * with the two contracts of #157, Marché Bio-Logique's, who pays more for
 * the croissants the bakery makes, and Épicerie Chez Normand's. Then, for
 * #158, the busy truck and the truck with contracts with an employee at the
 * truck too.
 */
export const TRUCK_STRATEGIES: readonly TruckStrategy[] = [
  {
    name: 'start',
    croissantsPerDay: 70,
    croissantPriceChange: 0,
    marketingDaily: cents(0),
    contracts: [],
    atTruck: false,
  },
  {
    name: 'busy',
    croissantsPerDay: 110,
    croissantPriceChange: -20,
    marketingDaily: cents(8_000),
    contracts: [],
    atTruck: false,
  },
  {
    name: '150 a day',
    croissantsPerDay: 150,
    croissantPriceChange: -20,
    marketingDaily: cents(8_000),
    contracts: [],
    atTruck: false,
  },
  {
    name: '150 a day, 2 contracts',
    croissantsPerDay: 150,
    croissantPriceChange: -20,
    marketingDaily: cents(8_000),
    contracts: ['marcheBioLogique', 'chezNormand'],
    atTruck: false,
  },
  {
    name: 'busy, employee at the truck',
    croissantsPerDay: 110,
    croissantPriceChange: -20,
    marketingDaily: cents(8_000),
    contracts: [],
    atTruck: true,
  },
  {
    name: '150 a day, 2 contracts, employee at the truck',
    croissantsPerDay: 150,
    croissantPriceChange: -20,
    marketingDaily: cents(8_000),
    contracts: ['marcheBioLogique', 'chezNormand'],
    atTruck: true,
  },
]

/**
 * The grocers' cards with no draw: only the renewals come, each the morning
 * after a contract's last delivery.
 */
const RENEWALS_ONLY = {
  ...grocerCards(EVENTS),
  pacing: { ...EVENTS.pacing, dailyChance: 0 },
}

/** One game's months, as the report reads them. */
export interface BakeryGame {
  /** Encaisse at the close of each month's last day, the first month's first. */
  readonly cashAtMonthEnds: readonly Cents[]
  /** Days the truck opened. */
  readonly openDays: number
  /** Croissants sold. */
  readonly croissantsSold: number
  /** Croissants the bakery made; 0 in a twin. */
  readonly croissantsMade: number
  /** The owner's energy at the close of the days the truck opened, summed. */
  readonly energyAtOpenCloses: number
}

/** One price set and oven of a job: its games, seed 1 first. */
export interface BakeryCell {
  readonly set: string
  readonly oven: OvenTerms
  readonly games: readonly BakeryGame[]
  /** Each game's payback month against its twin (see `paybackMonth`). */
  readonly paybacks: readonly (number | null)[]
}

/** What one worker plays for `--bakery`: one difficulty and one strategy. */
export interface BakeryJob {
  readonly kind: 'bakery'
  readonly difficulty: DifficultyId
  /** A `TruckStrategy` name. */
  readonly strategy: string
  readonly games: number
  readonly months: number
}

/** What a bakery job played. */
export interface BakeryRun {
  readonly difficulty: DifficultyId
  readonly strategy: string
  readonly games: number
  readonly months: number
  /** The twins, seed 1 first. */
  readonly twins: readonly BakeryGame[]
  /** Each price set, then each oven, in the order of `PRICE_SETS` and `OVENS`. */
  readonly cells: readonly BakeryCell[]
}

/** The strategy named `name`; throws a RangeError for any other. */
export function truckStrategy(name: string): TruckStrategy {
  const strategy = TRUCK_STRATEGIES.find((each) => each.name === name)
  if (strategy === undefined) {
    throw new RangeError(`No truck strategy is named ${name}`)
  }
  return strategy
}

/**
 * The changes that put `strategy` in place: the croissant's price, the
 * croissants bought each morning, the marketing budget and, if it has one,
 * the employee at the truck.
 */
export function truckChanges(
  strategy: TruckStrategy,
  content: FoodTruckContent = FOOD_TRUCK,
): DecisionChange[] {
  return [
    {
      kind: 'price',
      product: 'croissant',
      price: changedPrice(strategy.croissantPriceChange, 'croissant', content),
    },
    {
      kind: 'restock',
      product: 'croissant',
      rule: { kind: 'buyDaily', quantity: strategy.croissantsPerDay },
    },
    { kind: 'marketingDaily', budget: strategy.marketingDaily },
    ...(strategy.atTruck ? [AT_TRUCK_HIRE] : []),
  ]
}

/**
 * The changes that open the bakery with `oven` on top of `strategy`, make
 * there the croissants the twin buys, and hire the baker who makes them.
 */
export function bakeryChanges(
  strategy: TruckStrategy,
  oven: OvenTerms,
): DecisionChange[] {
  return [
    ...truckChanges(strategy),
    { kind: 'openBakery', oven },
    { kind: 'croissantSource', source: 'fabriquer' },
    {
      kind: 'bake',
      rule: { kind: 'buyDaily', quantity: strategy.croissantsPerDay },
    },
    BAKER_HIRE,
  ]
}

/** `difficulties` with the bakery at `prices` at every difficulty. */
export function withPrices(
  prices: BakeryPrices,
  difficulties: DifficultyContent = DIFFICULTIES,
): DifficultyContent {
  return {
    ...difficulties,
    bakery: { facile: prices, moyen: prices, difficile: prices },
  }
}

/** The last day of each of the first `months` months, from day 0. */
export function monthEnds(months: number): number[] {
  return Array.from({ length: months }, (_, month) => endOfMonth(0, month))
}

/**
 * Plays seed `seed` at `difficulty` with `changes` in effect from day 0 and
 * `difficulties` every day, to the close of the last day of its `months`th
 * month, and sums it up. The contracts of `contracts` are signed on day 0,
 * in order, and each renewal accepted; no other event card comes up. Returns
 * the last state too, for the tests.
 */
export function playBakeryGame(
  seed: number,
  difficulty: DifficultyId,
  changes: readonly DecisionChange[],
  difficulties: DifficultyContent,
  months: number,
  contracts: readonly GrocerId[] = [],
): { game: BakeryGame; state: GameState } {
  const ends = monthEnds(months)
  const lastDay = ends.at(-1) ?? 0
  const started = startGame(seed, difficulty, changes, difficulties)
  let state: GameState = {
    ...started,
    contracts: contracts.reduce(
      (signed, grocer) => startContract(signed, 0, grocer),
      started.contracts,
    ),
  }
  const renewing = contracts.length > 0
  const events = renewing ? RENEWALS_ONLY : NO_EVENTS
  const choose = renewing ? contractChooser('all', null) : null
  const cashAtMonthEnds: Cents[] = []
  let openDays = 0
  let croissantsSold = 0
  let energyAtOpenCloses = 0
  for (let day = 0; day <= lastDay; day += 1) {
    const opens = state.decisions.daysOpen.includes(toCalendar(day).weekday)
    state = playMorning(state, events, choose, PERCENTILES, difficulties)
    if (opens) {
      openDays += 1
      energyAtOpenCloses += state.lastDay?.energy ?? 0
    }
    croissantsSold += state.lastDay?.sold.croissant ?? 0
    if (day === ends[cashAtMonthEnds.length]) {
      cashAtMonthEnds.push(balance(state.journal, CASH, { toDay: day }))
    }
  }
  const { ingredientCostCents } = difficulties.bakery[difficulty]
  const croissantsMade = state.journal.entries
    .filter(({ memo }) => memo === BAKERY_MEMO.ingredients)
    .reduce(
      (made, { lines }) => made + (lines[0]?.debit ?? 0) / ingredientCostCents,
      0,
    )
  return {
    game: {
      cashAtMonthEnds,
      openDays,
      croissantsSold,
      croissantsMade,
      energyAtOpenCloses,
    },
    state,
  }
}

/**
 * The first month, counting from 1, at whose end the bakery game's Encaisse
 * is at least its twin's and stays so to the last month; null when it is
 * below at the last month. Throws a RangeError unless both have the same
 * months, at least one.
 */
export function paybackMonth(
  bakery: readonly Cents[],
  twin: readonly Cents[],
): number | null {
  if (bakery.length !== twin.length || bakery.length === 0) {
    throw new RangeError(
      `Expected the same months, at least one: ${bakery.length} and ${twin.length}`,
    )
  }
  let first: number | null = null
  for (let month = 0; month < bakery.length; month += 1) {
    const ahead = (bakery[month] ?? 0) >= (twin[month] ?? 0)
    if (!ahead) first = null
    else if (first === null) first = month + 1
  }
  return first
}

/**
 * Plays `job`: seeds 1 to `games`, each first as the twin, then with the
 * bakery at each price set and oven, in order.
 */
export function runBakery({
  difficulty,
  strategy: name,
  games,
  months,
}: BakeryJob): BakeryRun {
  const strategy = truckStrategy(name)
  const seeds = Array.from({ length: games }, (_, index) => index + 1)
  const twins = seeds.map(
    (seed) =>
      playBakeryGame(
        seed,
        difficulty,
        truckChanges(strategy),
        DIFFICULTIES,
        months,
        strategy.contracts,
      ).game,
  )
  const cells = PRICE_SETS.flatMap(({ name: set, prices }) =>
    OVENS.map((oven): BakeryCell => {
      const played = seeds.map(
        (seed) =>
          playBakeryGame(
            seed,
            difficulty,
            bakeryChanges(strategy, oven),
            withPrices(prices),
            months,
            strategy.contracts,
          ).game,
      )
      return {
        set,
        oven,
        games: played,
        paybacks: played.map((game, index) =>
          paybackMonth(
            game.cashAtMonthEnds,
            twins[index]?.cashAtMonthEnds ?? [],
          ),
        ),
      }
    }),
  )
  return { difficulty, strategy: name, games, months, twins, cells }
}

/** Open days in an average month, the truck open `daysPerWeek` days a week. */
export function openDaysPerMonth(daysPerWeek: number): number {
  return (365 / 12) * (daysPerWeek / 7)
}

/**
 * What the baker `BAKER_HIRE` hires is paid in an average month, in the
 * books: their weekly wage at their role's starting wage, paid each week.
 */
export function monthlyBakerWage(staff: StaffContent = STAFF): number {
  const { role } = BAKER_HIRE
  const { start } = staff.roles[role].hourlyWageCents
  return (weeklyWage({ role, hourlyWage: start }, staff) * 365) / 12 / 7
}

/**
 * What the bakery costs each month whatever it makes, in the books: the
 * rent, the oven's lease or its month of depreciation, and the baker's
 * wages (see `monthlyBakerWage`).
 */
export function monthlyBakeryCosts(
  prices: BakeryPrices,
  oven: OvenTerms,
  content: BakeryContent = BAKERY,
  staff: StaffContent = STAFF,
): number {
  const { priceCents, usefulLifeMonths, monthlyLeaseCents } = content.oven
  return (
    prices.monthlyRentCents +
    (oven === 'louer' ? monthlyLeaseCents : priceCents / usefulLifeMonths) +
    monthlyBakerWage(staff)
  )
}

/** What making a croissant saves on buying it. */
export function savingPerCroissant(
  prices: BakeryPrices,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
): number {
  return foodTruck.products.croissant.unitCostCents - prices.ingredientCostCents
}

/**
 * What the bakery adds to the bénéfice net in an average month, in cents,
 * making `perOpenDay` croissants each day the truck opens `daysPerWeek` days
 * a week: the saving on each, less its monthly costs, the baker's wages
 * included.
 */
export function monthlyResult(
  prices: BakeryPrices,
  oven: OvenTerms,
  perOpenDay: number,
  daysPerWeek: number,
  content: BakeryContent = BAKERY,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
  staff: StaffContent = STAFF,
): number {
  return (
    savingPerCroissant(prices, foodTruck) *
      perOpenDay *
      openDaysPerMonth(daysPerWeek) -
    monthlyBakeryCosts(prices, oven, content, staff)
  )
}

/**
 * The croissants a day the truck opens `daysPerWeek` days a week must make
 * for the bakery to break even, in the books (see `monthlyResult`).
 */
export function breakEvenPerOpenDay(
  prices: BakeryPrices,
  oven: OvenTerms,
  daysPerWeek: number,
  content: BakeryContent = BAKERY,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
  staff: StaffContent = STAFF,
): number {
  return (
    monthlyBakeryCosts(prices, oven, content, staff) /
    (savingPerCroissant(prices, foodTruck) * openDaysPerMonth(daysPerWeek))
  )
}
