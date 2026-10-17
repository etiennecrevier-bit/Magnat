import { describe, expect, it } from 'vitest'
import type { GrocerId, RestockRule } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { startContract } from '../engine/contracts.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from '../engine/decisions.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { cents } from '../engine/money.ts'
import { defaultProfile } from '../engine/profile.ts'
import { STAFF } from '../engine/staff.ts'
import type { Day, GameState, StreetModifier } from '../engine/types.ts'
import { entriesOf, entriesSince } from '../finance/journal.ts'
import { accepts } from './bakeryBoard.ts'
import { staffBoard, todayWork, type TodayWork } from './staffBoard.ts'
import { createGameStore } from './store.ts'

const START = createInitialState(42)
const AT_TRUCK_WEEK = 1750 * 35
const BAKED_MEMO = 'Ingrédients du fournil'

/** `state` with `changes` made, in order. */
function decided(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((game, change) => applyDecision(game, change), state)
}

/** `state` with a contract signed that morning with `grocer`. */
function signed(state: GameState, grocer: GrocerId): GameState {
  return {
    ...state,
    contracts: startContract(state.contracts, state.day, grocer),
  }
}

/** `state` with the street changed by `change` that day only. */
function withStreet(
  state: GameState,
  change: StreetModifier['change'],
): GameState {
  const modifier = {
    event: 'test',
    change,
    fromDay: state.day,
    lastDay: state.day,
  }
  return {
    ...state,
    events: {
      ...state.events,
      modifiers: [...state.events.modifiers, modifier],
    },
  }
}

function playedTo(state: GameState, day: Day): GameState {
  let game = state
  while (game.day < day) game = tick(game)
  return game
}

/** Whether the bakery made croissants on `day`, as the books say. */
function bakedOn(game: GameState, day: Day): boolean {
  return entriesSince(game.journal, day).some(
    (entry) => entry.day === day && entry.memo === BAKED_MEMO,
  )
}

/** Whether the truck opened on `day`, as the engine recorded the week. */
function openedOn(game: GameState, day: Day): boolean {
  const days = [...game.weekSoFar.days, ...(game.lastWeek?.days ?? [])]
  const found = days.find((weekDay) => weekDay.day === day)
  if (found === undefined) throw new Error(`Day ${day} not recorded`)
  return found.open
}

/**
 * The bakery open since day 1, with a leased oven, the croissants made at
 * `rule`, played to the morning of `day`.
 */
function baking(day: Day, rule: RestockRule): GameState {
  const game = decided(
    START,
    { kind: 'openBakery', oven: 'louer' },
    { kind: 'croissantSource', source: 'fabriquer' },
    { kind: 'bake', rule },
  )
  return playedTo(game, day)
}

describe('staffBoard', () => {
  it('shows the owner alone at the start, the roles and every candidate', () => {
    const board = staffBoard(START)
    expect(board.owner).toEqual({
      weeklyPay: FOOD_TRUCK.startingDecisions.ownerWeeklyPayCents,
      away: false,
      // Day 0, a Monday: the truck is closed and nothing is due.
      tasks: [],
    })
    expect(board.members).toEqual([])
    expect(board.roles).toEqual([
      {
        role: 'camion',
        name: 'Au camion',
        hoursPerWeek: 35,
        hourlyWage: 1750,
        weeklyWage: AT_TRUCK_WEEK,
        training: AT_TRUCK_WEEK,
      },
      {
        role: 'livreur',
        name: 'Livreur',
        hoursPerWeek: 10,
        hourlyWage: 1600,
        weeklyWage: 16_000,
        training: 16_000,
      },
      {
        role: 'boulanger',
        name: 'Boulanger',
        hoursPerWeek: 30,
        hourlyWage: 2200,
        weeklyWage: 66_000,
        training: 66_000,
      },
    ])
    expect(board.candidates.map(({ candidate }) => candidate)).toEqual(
      Object.keys(STAFF.candidates),
    )
    expect(board.candidates[0]).toEqual({
      candidate: 'amelie',
      name: 'Amélie Gagnon',
    })
    expect(board).toMatchObject({ full: false, maxEmployees: 3 })
  })

  it('shows a hire who starts tomorrow, free to cancel, then at work with the notice firing costs', () => {
    const hired = decided(START, {
      kind: 'hire',
      role: 'camion',
      candidate: 'amelie',
    })
    const board = staffBoard(hired)
    expect(board.members).toEqual([
      {
        candidate: 'amelie',
        name: 'Amélie Gagnon',
        role: 'camion',
        roleName: 'Au camion',
        hourlyWage: 1750,
        weeklyWage: AT_TRUCK_WEEK,
        status: 'startsTomorrow',
        tasks: [],
        fireCost: 0,
        training: AT_TRUCK_WEEK,
      },
    ])
    expect(board.candidates.map(({ candidate }) => candidate)).not.toContain(
      'amelie',
    )

    // Day 1, a Tuesday: she serves beside the owner.
    const working = staffBoard(tick(hired))
    expect(working.members[0]).toMatchObject({
      status: 'atWork',
      tasks: ['truck'],
      fireCost: AT_TRUCK_WEEK * STAFF.noticeWeeks,
      training: null,
    })
    expect(working.owner.tasks).toEqual(['truck'])
  })

  it('charges the notice at the wage of today, and shows the latest wage', () => {
    const working = tick(
      decided(START, { kind: 'hire', role: 'camion', candidate: 'amelie' }),
    )
    const raised = decided(working, {
      kind: 'setWage',
      candidate: 'amelie',
      hourlyWage: cents(2000),
    })
    expect(staffBoard(raised).members[0]).toMatchObject({
      hourlyWage: 2000,
      weeklyWage: 2000 * 35,
      fireCost: AT_TRUCK_WEEK * STAFF.noticeWeeks,
    })
  })

  it('shows someone fired as leaving tomorrow, not yet a candidate again', () => {
    const working = tick(
      decided(START, { kind: 'hire', role: 'camion', candidate: 'amelie' }),
    )
    const board = staffBoard(
      decided(working, { kind: 'fire', candidate: 'amelie' }),
    )
    expect(board.members[0]).toMatchObject({
      status: 'leavesTomorrow',
      tasks: [],
      fireCost: null,
    })
    expect(board.candidates.map(({ candidate }) => candidate)).not.toContain(
      'amelie',
    )
  })

  it('is full at the most employees the content allows', () => {
    const full = decided(
      START,
      { kind: 'hire', role: 'camion', candidate: 'amelie' },
      { kind: 'hire', role: 'livreur', candidate: 'kevin' },
      { kind: 'hire', role: 'boulanger', candidate: 'sophie' },
    )
    expect(staffBoard(full).full).toBe(true)
    expect(
      accepts(full, { kind: 'hire', role: 'camion', candidate: 'nadia' }),
    ).toBe(false)
  })

  it('shows the owner away all day doing nothing', () => {
    const away = { ...tick(START), ownerAway: true }
    expect(staffBoard(away).owner).toMatchObject({ away: true, tasks: [] })
  })
})

describe('todayWork', () => {
  const MONDAY = 7

  it('delivers on Monday, the truck closed, the owner baking the deliveries', () => {
    const game = baking(1, { kind: 'buyDaily', quantity: 70 })
    // Signed on a Monday morning: nothing due until the Monday after.
    expect(
      todayWork(signed(playedTo(game, MONDAY), 'chezNormand')),
    ).toMatchObject({ deliveriesDue: false })
    const due = playedTo(signed(game, 'chezNormand'), MONDAY)
    expect(todayWork(due)).toEqual({
      ownerAway: false,
      opens: false,
      deliveriesDue: true,
      delivers: 'owner',
      bakes: 'owner',
    })
    const after = tick(due)
    expect(after.lastDay?.deliveries).toHaveLength(1)
    expect(bakedOn(after, MONDAY)).toBe(true)
  })

  it('misses the deliveries when the owner is away and nobody delivers', () => {
    const due = playedTo(signed(tick(START), 'chezNormand'), MONDAY)
    const away = { ...due, ownerAway: true }
    expect(todayWork(away)).toEqual({
      ownerAway: true,
      opens: false,
      deliveriesDue: true,
      delivers: null,
      bakes: null,
    })
    expect(tick(away).lastDay?.missed).toHaveLength(1)
  })

  it('gives the deliveries to a deliverer and the baking to a baker', () => {
    const game = decided(
      signed(tick(START), 'chezNormand'),
      { kind: 'openBakery', oven: 'louer' },
      { kind: 'croissantSource', source: 'fabriquer' },
      { kind: 'hire', role: 'livreur', candidate: 'kevin' },
      { kind: 'hire', role: 'boulanger', candidate: 'sophie' },
    )
    const due = { ...playedTo(game, MONDAY), ownerAway: true }
    expect(todayWork(due)).toEqual({
      ownerAway: true,
      opens: false,
      deliveriesDue: true,
      delivers: 'employee',
      bakes: 'employee',
    })
    expect(staffBoard(due).members.map(({ tasks }) => tasks)).toEqual([
      ['deliveries'],
      ['bakery'],
    ])
  })

  it('bakes nothing on an open day when the rule calls for none', () => {
    const game = baking(2, { kind: 'buyDaily', quantity: 0 })
    const work = todayWork(game)
    expect(work).toMatchObject({ opens: true, bakes: null })
    expect(bakedOn(tick(game), 2)).toBe(false)
  })

  it('bakes nothing when the croissants cannot be sold that day', () => {
    const game = withStreet(baking(2, { kind: 'buyDaily', quantity: 70 }), {
      kind: 'unavailable',
      product: 'croissant',
    })
    expect(todayWork(game)).toMatchObject({ opens: true, bakes: null })
    expect(bakedOn(tick(game), 2)).toBe(false)
  })

  it('bakes nothing when a top-up finds enough on hand', () => {
    // 50 croissants on hand this morning, as a fixture, and a top-up
    // below 10.
    const game = baking(2, { kind: 'topUp', whenBelow: 10, upTo: 300 })
    const stocked = {
      ...game,
      inventory: [
        {
          product: 'croissant',
          quantity: 50,
          unitCost: cents(55),
          boughtOnDay: 2,
        },
      ] as const,
    }
    expect(todayWork(game)).toMatchObject({ opens: true, bakes: 'owner' })
    expect(todayWork(stocked)).toMatchObject({ opens: true, bakes: null })
    expect(bakedOn(tick(stocked), 2)).toBe(false)
  })

  it('keeps the truck closed on a day an earlier choice closes it', () => {
    const game = tick(START)
    const delayed = {
      ...game,
      events: {
        ...game.events,
        delayed: [
          {
            day: game.day,
            event: 'test',
            effect: { kind: 'closed', days: 1 } as const,
          },
        ],
      },
    }
    expect(todayWork(game).opens).toBe(true)
    expect(todayWork(delayed).opens).toBe(false)
    expect(openedOn(tick(delayed), game.day)).toBe(false)
  })
})

/** What a year of `todayWork` found, by case, to show each case was met. */
interface Seen {
  opened: number
  closed: number
  delivered: number
  missed: number
  bakedByOwner: number
  bakedByEmployee: number
  bakingIdle: number
}

describe('todayWork against the engine', () => {
  it('predicts each day of a scripted year: the truck, the deliveries and the bakery', () => {
    const GROCER_IDS: readonly GrocerId[] = [
      'chezNormand',
      'marcheBioLogique',
      'depanneur2424',
    ]
    const RULES: readonly RestockRule[] = [
      { kind: 'buyDaily', quantity: 0 },
      { kind: 'buyDaily', quantity: 80 },
      { kind: 'topUp', whenBelow: 30, upTo: 90 },
      { kind: 'buyDaily', quantity: 150 },
    ]
    const STAFF_PLAN: readonly DecisionChange[][] = [
      [{ kind: 'hire', role: 'livreur', candidate: 'kevin' }],
      [{ kind: 'hire', role: 'boulanger', candidate: 'sophie' }],
      [{ kind: 'fire', candidate: 'kevin' }],
      [{ kind: 'hire', role: 'camion', candidate: 'amelie' }],
      [
        { kind: 'fire', candidate: 'sophie' },
        { kind: 'fire', candidate: 'amelie' },
      ],
      [],
    ]
    const seen: Seen = {
      opened: 0,
      closed: 0,
      delivered: 0,
      missed: 0,
      bakedByOwner: 0,
      bakedByEmployee: 0,
      bakingIdle: 0,
    }
    const tryTo = (game: GameState, change: DecisionChange) =>
      accepts(game, change) ? applyDecision(game, change) : game

    let game = decided(
      createInitialState(7, FOOD_TRUCK, {
        ...defaultProfile(),
        difficulty: 'facile',
      }),
      { kind: 'ownerWeeklyPay', pay: cents(0) },
      { kind: 'openBakery', oven: 'louer' },
      { kind: 'croissantSource', source: 'fabriquer' },
    )
    while (game.day < 365 && game.ended === null) {
      const { day } = game
      const week = Math.floor(day / 7)
      if (day % 7 === 3) {
        for (const grocer of GROCER_IDS) game = signed(game, grocer)
      }
      if (day % 7 === 0) {
        game = tryTo(game, {
          kind: 'bake',
          rule: RULES[week % RULES.length]!,
        })
        for (const change of STAFF_PLAN[week % STAFF_PLAN.length]!) {
          game = tryTo(game, change)
        }
        game = tryTo(game, {
          kind: 'daysOpen',
          weekdays: week % 3 === 2 ? [1, 2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6, 7],
        })
        if (week === 20) game = tryTo(game, { kind: 'closeBakery' })
        if (week === 30) {
          game = tryTo(game, { kind: 'openBakery', oven: 'louer' })
        }
      }
      if (day % 11 === 3) game = { ...game, ownerAway: true }
      if (day % 17 === 5) game = withStreet(game, { kind: 'closed' })
      if (day % 13 === 6) {
        game = withStreet(game, { kind: 'unavailable', product: 'croissant' })
      }

      const work: TodayWork = todayWork(game)
      const next = tick(game)
      const at = `day ${day}`
      const opened = openedOn(next, day)
      expect(work.opens, at).toBe(opened)
      const delivered = next.lastDay?.deliveries.length ?? 0
      const missed = next.lastDay?.missed.length ?? 0
      expect(work.deliveriesDue && work.delivers !== null, at).toBe(
        delivered > 0,
      )
      expect(work.deliveriesDue && work.delivers === null, at).toBe(missed > 0)
      const baked = bakedOn(next, day)
      expect(work.bakes !== null, at).toBe(baked)

      seen[opened ? 'opened' : 'closed'] += 1
      if (delivered > 0) seen.delivered += 1
      if (missed > 0) seen.missed += 1
      if (work.bakes === 'owner') seen.bakedByOwner += 1
      if (work.bakes === 'employee') seen.bakedByEmployee += 1
      const assigned =
        latestDecisions(game).croissantSource === 'fabriquer' && opened
      if (assigned && !baked) seen.bakingIdle += 1
      game = next
    }
    expect(game.day).toBe(365)
    for (const [kind, count] of Object.entries(seen)) {
      expect(count, kind).toBeGreaterThan(0)
    }
    expect(entriesOf(game.journal).length).toBeGreaterThan(0)
  })
})

describe('the staff through the store', () => {
  it('hires: on staff the next morning, after a week of training', () => {
    const store = createGameStore(START, NO_EVENTS)
    store
      .getState()
      .decide({ kind: 'hire', role: 'camion', candidate: 'amelie' })
    store.getState().advance(1)
    expect(staffBoard(store.getState().game).members[0]?.status).toBe('atWork')
    store.getState().advance(1)
    const { game } = store.getState()
    expect(game.staff).toEqual([
      { candidate: 'amelie', role: 'camion', hourlyWage: 1750, hiredOnDay: 1 },
    ])
    expect(
      entriesSince(game.journal, 1).find(
        ({ memo }) => memo === 'Formation · Amélie Gagnon',
      )?.day,
    ).toBe(1)
  })

  it('fires: gone the next morning, after two weeks of notice', () => {
    const store = createGameStore(START, NO_EVENTS)
    store
      .getState()
      .decide({ kind: 'hire', role: 'camion', candidate: 'amelie' })
    store.getState().advance(2)
    store.getState().decide({ kind: 'fire', candidate: 'amelie' })
    store.getState().advance(2)
    const { game } = store.getState()
    expect(game.staff).toEqual([])
    const notice = entriesSince(game.journal, 3).find(
      ({ memo }) => memo === 'Préavis · Amélie Gagnon',
    )
    expect(notice?.day).toBe(3)
    expect(notice?.lines[0]?.debit).toBe(AT_TRUCK_WEEK * STAFF.noticeWeeks)
  })

  it("changes the wage the next Friday's « Salaire » pays", () => {
    const store = createGameStore(START, NO_EVENTS)
    store
      .getState()
      .decide({ kind: 'hire', role: 'camion', candidate: 'amelie' })
    store.getState().advance(1)
    store
      .getState()
      .decide({ kind: 'setWage', candidate: 'amelie', hourlyWage: cents(2000) })
    // Day 4, a Friday, is payday.
    store.getState().advance(4)
    const wage = entriesSince(store.getState().game.journal, 4).find(
      ({ memo }) => memo === 'Salaire · Amélie Gagnon',
    )
    expect(wage?.day).toBe(4)
    expect(wage?.lines[0]?.debit).toBe(2000 * 35)
  })

  it('cancels a hire who has not started, for nothing', () => {
    const store = createGameStore(START, NO_EVENTS)
    store
      .getState()
      .decide({ kind: 'hire', role: 'camion', candidate: 'amelie' })
    store.getState().decide({ kind: 'fire', candidate: 'amelie' })
    store.getState().advance(2)
    const { game } = store.getState()
    expect(game.staff).toEqual([])
    expect(
      entriesOf(game.journal).filter(({ memo }) => memo.includes('Amélie')),
    ).toEqual([])
  })
})
