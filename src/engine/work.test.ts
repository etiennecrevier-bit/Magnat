import { describe, expect, it } from 'vitest'
import type { DifficultyId } from '../content/schema.ts'
import { BAKERY_MEMO } from './bakery.ts'
import { createInitialState, tick } from './clock.ts'
import { noContracts, startContract } from './contracts.ts'
import { DIFFICULTIES, FOOD_TRUCK } from './day.ts'
import { applyDecision, type DecisionChange } from './decisions.ts'
import { add, cents, mulInt, sub, type Cents } from './money.ts'
import { defaultProfile } from './profile.ts'
import type { DaySummary, GameState, PersonDay, Worker } from './types.ts'
import { WORK_DAYS_KEPT, workOf } from './work.ts'

const sum = (amounts: readonly Cents[]): Cents =>
  amounts.reduce((total, amount) => add(total, amount), cents(0))

/** A croissant bought for the truck, with no trip to the mill. */
const CROISSANT = FOOD_TRUCK.products.croissant.unitCostCents

const STAFFED: DecisionChange[] = [
  { kind: 'openBakery', oven: 'louer' },
  { kind: 'croissantSource', source: 'fabriquer' },
  {
    kind: 'hire',
    role: 'camion',
    candidate: 'amelie',
    hourlyWage: cents(2500),
  },
  {
    kind: 'hire',
    role: 'livreur',
    candidate: 'kevin',
    hourlyWage: cents(2200),
  },
  {
    kind: 'hire',
    role: 'boulanger',
    candidate: 'sophie',
    hourlyWage: cents(3000),
  },
]

/**
 * A game of `difficulty` with a contract with Chez Normand, `changes` made
 * on its first morning, then played `days` days, with `morning` making
 * changes each morning. Returns each morning and close.
 */
function playedWith(
  difficulty: DifficultyId,
  changes: readonly DecisionChange[],
  days: number,
  morning: (state: GameState) => GameState = (state) => state,
): DaySummary[] {
  const start = createInitialState(42, undefined, {
    ...defaultProfile(),
    difficulty,
  })
  let game: GameState = changes.reduce(
    (state, change) => applyDecision(state, change),
    { ...start, contracts: startContract(noContracts(), 0, 'chezNormand') },
  )
  const summaries: DaySummary[] = []
  for (let day = 0; day < days; day += 1) {
    game = tick(morning(game))
    if (game.lastDay !== null && game.lastDay.day === day) {
      summaries.push(game.lastDay)
    }
    expect(game.workDays?.length).toBe(Math.min(day + 1, WORK_DAYS_KEPT))
    expect(game.workDays?.at(-1)?.people).toEqual(game.lastDay?.work)
  }
  return summaries
}

/** What « Ingrédients du fournil » took from Encaisse on `day`. */
function ingredientsOn(game: GameState, day: number): Cents {
  return sum(
    game.journal.entries
      .filter((entry) => entry.day === day)
      .filter(({ memo }) => memo === BAKERY_MEMO.ingredients)
      .flatMap(({ lines }) => lines.filter(({ account }) => account === '1000'))
      .map(({ credit }) => credit),
  )
}

const work = (summary: DaySummary): readonly PersonDay[] => summary.work ?? []

describe.each<DifficultyId>(['facile', 'moyen', 'difficile'])(
  'what each person did, at %s',
  (difficulty) => {
    const days = playedWith(difficulty, STAFFED, 35)

    it('adds up to the day’s sales and customers served, every day', () => {
      for (const summary of days) {
        expect(sum(work(summary).map(({ sales }) => sales))).toBe(
          summary.revenue,
        )
        expect(
          work(summary).reduce((total, { customers }) => total + customers, 0),
        ).toBe(
          summary.visits.filter(({ servedMinute }) => servedMinute !== null)
            .length,
        )
      }
    })

    it('adds up to the day’s deliveries and what they invoiced', () => {
      for (const summary of days) {
        expect(
          work(summary).reduce(
            (total, { deliveries }) => total + deliveries,
            0,
          ),
        ).toBe(summary.deliveries.length)
        expect(sum(work(summary).map(({ invoiced }) => invoiced))).toBe(
          sum(summary.deliveries.map(({ amount }) => amount)),
        )
      }
    })

    it('lists the owner, then each employee who came, in the order of the staff', () => {
      for (const summary of days) {
        const came: Worker[] = (['amelie', 'kevin', 'sophie'] as const).filter(
          (candidate) =>
            summary.day >= 1 && !(summary.absent ?? []).includes(candidate),
        )
        const who = work(summary).map(({ who: person }) => person)
        expect(who[0]).toBe('owner')
        // An absence whose role had no work is in no list: just check order.
        expect(who.slice(1)).toEqual(
          came.filter((candidate) => who.includes(candidate)),
        )
      }
    })

    it('gives each job to the one who did it', () => {
      const total = (who: string, field: keyof PersonDay) =>
        days
          .flatMap(work)
          .filter((person) => person.who === who)
          .reduce((n, person) => n + (person[field] as number), 0)
      // Day 0 the owner does it all; from day 1 the employees do.
      expect(total('amelie', 'customers')).toBeGreaterThan(0)
      expect(total('kevin', 'deliveries')).toBeGreaterThan(0)
      expect(total('sophie', 'baked')).toBeGreaterThan(0)
      for (const summary of days.slice(1)) {
        const owner = work(summary)[0]
        expect(owner?.deliveries).toBe(0)
        expect(owner?.baked).toBe(0)
      }
    })
  },
)

describe('the baker’s croissants', () => {
  it('cost what the bakery’s ingredients took, waste included, against buying them', () => {
    const start = createInitialState(42, undefined, defaultProfile())
    let game: GameState = STAFFED.reduce(
      (state, change) => applyDecision(state, change),
      { ...start, contracts: startContract(noContracts(), 0, 'chezNormand') },
    )
    const ingredient =
      DIFFICULTIES.bakery[game.profile.difficulty].ingredientCostCents
    let wasteDays = 0
    for (let day = 0; day < 60; day += 1) {
      game = tick(game)
      const people = game.lastDay?.work ?? []
      const baked = people.reduce((n, { baked: made }) => n + made, 0)
      expect(sum(people.map(({ bakedCost }) => bakedCost))).toBe(
        ingredientsOn(game, day),
      )
      expect(sum(people.map(({ boughtCost }) => boughtCost))).toBe(
        mulInt(CROISSANT, baked),
      )
      const baker = people.find(({ who }) => who === 'sophie')
      if (baker !== undefined && baker.bakedCost > baker.baked * ingredient) {
        wasteDays += 1
      }
    }
    // Sophie throws some away: her cost counts them.
    expect(wasteDays).toBeGreaterThan(0)
  })
})

describe('a day the owner is away', () => {
  it('leaves the owner out, the employee at the truck serving every customer', () => {
    const start = createInitialState(42, undefined, defaultProfile())
    let game: GameState = applyDecision(start, {
      kind: 'hire',
      role: 'camion',
      candidate: 'amelie',
      hourlyWage: cents(2500),
    })
    game = tick(tick(game))
    game = tick({ ...game, ownerAway: true })
    const day = game.lastDay
    expect(day?.ownerAway).toBe(true)
    expect(day?.work?.map(({ who }) => who)).toEqual(['amelie'])
    expect(day?.work?.[0]?.sales).toBe(day?.revenue)
    expect(day?.revenue).toBeGreaterThan(0)
    expect(game.workDays?.at(-1)).toMatchObject({ ownerAway: true })
    game = tick(game)
    expect(game.lastDay?.ownerAway).toBeUndefined()
    expect(game.lastDay?.work?.[0]?.who).toBe('owner')
  })
})

describe('workOf', () => {
  it('gives each person their visits, deliveries and croissants', () => {
    const visit = (servedBy: 'owner' | 'amelie' | undefined, cafe: number) => ({
      arrivalMinute: 480,
      segment: 'habitue' as const,
      bought: { cafe, chocolat: 0, croissant: 0, limonade: 0 },
      outcome: cafe > 0 ? ('bought' as const) : ('browsed' as const),
      servedMinute: servedBy === undefined ? null : 481,
      leftMinute: null,
      botched: 0,
      ...(servedBy === undefined ? {} : { servedBy }),
    })
    const amelie = {
      candidate: 'amelie' as const,
      role: 'camion' as const,
      hourlyWage: cents(1750),
      hiredOnDay: 0,
    }
    const sophie = {
      ...amelie,
      candidate: 'sophie' as const,
      role: 'boulanger' as const,
    }
    expect(
      workOf({
        ownerAway: false,
        came: [amelie, sophie],
        visits: [
          visit('owner', 1),
          visit('amelie', 1),
          visit('amelie', 0),
          visit(undefined, 0),
        ],
        price: () => cents(300),
        deliveries: [
          {
            day: 3,
            grocer: 'chezNormand',
            units: 50,
            baked: 50,
            amount: cents(10_000),
            dueDay: 10,
          },
        ],
        delivers: 'owner',
        baked: 120,
        wasted: 2,
        bakes: 'sophie',
        ingredientCost: cents(45),
        boughtCost: sub(cents(110), cents(5)),
      }),
    ).toEqual([
      {
        who: 'owner',
        customers: 1,
        sales: 300,
        deliveries: 1,
        invoiced: 10_000,
        baked: 0,
        bakedCost: 0,
        boughtCost: 0,
      },
      {
        who: 'amelie',
        customers: 2,
        sales: 300,
        deliveries: 0,
        invoiced: 0,
        baked: 0,
        bakedCost: 0,
        boughtCost: 0,
      },
      {
        who: 'sophie',
        customers: 0,
        sales: 0,
        deliveries: 0,
        invoiced: 0,
        baked: 120,
        bakedCost: 122 * 45,
        boughtCost: 120 * 105,
      },
    ])
  })
})
