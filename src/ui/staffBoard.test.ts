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
import { STAFF, isAbsent } from '../engine/staff.ts'
import type { Day, GameState, StreetModifier } from '../engine/types.ts'
import { entriesOf, entriesSince } from '../finance/journal.ts'
import { accepts } from './bakeryBoard.ts'
import {
  memberLine,
  staffBoard,
  todayWork,
  type TodayWork,
} from './staffBoard.ts'
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
      // Nothing played yet.
      yesterday: null,
      days: [],
      at: 'plateau',
    })
    expect(board.members).toEqual([])
    // One truck: nobody picks where to work, and none closes for want of staff.
    expect(board.trucks).toEqual([])
    expect(board.unstaffed).toEqual([])
    expect(board.roles).toEqual([
      {
        role: 'camion',
        name: 'Au camion',
        hoursPerWeek: 35,
      },
      {
        role: 'livreur',
        name: 'Livreur',
        hoursPerWeek: 10,
      },
      {
        role: 'boulanger',
        name: 'Boulanger',
        hoursPerWeek: 16,
      },
    ])
    expect(board.candidates.map(({ candidate }) => candidate)).toEqual(
      Object.keys(STAFF.candidates),
    )
    // Strong in accueil (+1,50 $), weak in rapidité (−1,00 $): she asks
    // 18,00 $ at the truck.
    expect(board.role).toBe('camion')
    expect(board.candidates[0]).toEqual({
      candidate: 'amelie',
      name: 'Amélie Gagnon',
      portrait: 'amelieGagnon',
      strength: 'accueil',
      askingWage: 1800,
      weeklyWage: 1800 * 35,
      training: 1800 * 35,
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
        portrait: 'amelieGagnon',
        role: 'camion',
        roleName: 'Au camion',
        hourlyWage: 1750,
        weeklyWage: AT_TRUCK_WEEK,
        askingWage: 1800,
        status: 'startsTomorrow',
        // Not started: only her strength shows.
        strength: 'accueil',
        weakness: null,
        leaving: false,
        tasks: [],
        fireCost: 0,
        training: AT_TRUCK_WEEK,
        yesterday: null,
        days: [],
        truck: 'plateau',
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

  it('shows someone fired as leaving tomorrow, still at work today, not yet a candidate again', () => {
    // Day 1, a Tuesday: the truck opens.
    const working = tick(
      decided(START, { kind: 'hire', role: 'camion', candidate: 'amelie' }),
    )
    const fired = decided(working, { kind: 'fire', candidate: 'amelie' })
    expect(todayWork(fired).opens).toBe(true)
    const board = staffBoard(fired)
    expect(board.members[0]).toMatchObject({
      status: 'leavesTomorrow',
      tasks: ['truck'],
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

describe('staffBoard: traits, asking wages and leaving (#256)', () => {
  /** Amélie at the truck from day 1, at `wage`, played to `day`. */
  function amelieTo(day: Day, wage = 1750): GameState {
    const hired = decided(START, {
      kind: 'hire',
      role: 'camion',
      candidate: 'amelie',
      hourlyWage: cents(wage),
    })
    return playedTo(hired, day)
  }

  it('shows her strength from the start, her weakness two weeks on the job', () => {
    expect(STAFF.discoveryDays).toBe(14)
    expect(staffBoard(amelieTo(1)).members[0]).toMatchObject({
      strength: 'accueil',
      weakness: null,
    })
    expect(staffBoard(amelieTo(14)).members[0]?.weakness).toBeNull()
    expect(staffBoard(amelieTo(15)).members[0]?.weakness).toBe('rapidite')
  })

  it('gives each employee what they ask in their role', () => {
    const game = decided(
      START,
      { kind: 'hire', role: 'camion', candidate: 'amelie' },
      { kind: 'hire', role: 'livreur', candidate: 'kevin' },
      { kind: 'hire', role: 'boulanger', candidate: 'sophie' },
    )
    expect(
      staffBoard(tick(game)).members.map(({ askingWage }) => askingWage),
    ).toEqual([
      1750 + 150 - 100,
      1600 + 150 - 100,
      // Strong in fiabilité (+2,50 $), weak in rapidité (−1,00 $).
      2200 + 250 - 100,
    ])
  })

  it('gives each candidate what they ask, a week of it and their training in the role picked', () => {
    const kevin = staffBoard(START, 'boulanger').candidates.find(
      ({ candidate }) => candidate === 'kevin',
    )
    expect(kevin).toMatchObject({
      strength: 'rapidite',
      askingWage: 2250,
      weeklyWage: 2250 * 16,
      training: 2250 * 16 * STAFF.trainingWeeks,
    })
    expect(staffBoard(START, 'boulanger').role).toBe('boulanger')
  })

  it('shows an underpaid employee leaving once she warned, until her latest wage is what she asks', () => {
    // Underpaid from day 1, she warns on the morning of day 57.
    expect(staffBoard(amelieTo(56)).members[0]?.leaving).toBe(false)
    const warned = amelieTo(57)
    const amelie = staffBoard(warned).members[0]!
    expect(amelie).toMatchObject({ status: 'atWork', leaving: true })
    expect(memberLine(amelie).fact).toEqual({
      tone: 'warn',
      text: 'Pense à partir',
    })
    const raised = decided(warned, {
      kind: 'setWage',
      candidate: 'amelie',
      hourlyWage: cents(1800),
    })
    expect(staffBoard(raised).members[0]?.leaving).toBe(false)
    expect(memberLine(staffBoard(raised).members[0]!).fact).toBeNull()
    // Paid what she asks from the start, she never thinks of leaving.
    expect(staffBoard(amelieTo(57, 1800)).members[0]?.leaving).toBe(false)
  })

  it('shows someone who quit this morning gone, with no work today, as the engine plays it', () => {
    // Day 64, a Tuesday: she quits, underpaid, a week after warning.
    const quitting = amelieTo(64)
    expect(quitting.day % 7).toBe(1)
    const board = staffBoard(quitting)
    const amelie = board.members[0]!
    expect(amelie).toMatchObject({
      status: 'quitsToday',
      tasks: [],
      fireCost: null,
      leaving: false,
    })
    expect(memberLine(amelie).fact).toEqual({
      tone: 'bad',
      text: 'Parti ce matin',
    })
    expect(board.owner.tasks).toEqual(['truck'])
    expect(todayWork(quitting)).toMatchObject({
      opens: true,
      quits: ['amelie'],
    })
    expect(tick(quitting).lastDay?.quits).toEqual(['amelie'])

    // The owner away, nobody is left at the truck: it stays closed.
    const away = { ...quitting, ownerAway: true }
    expect(todayWork(away).opens).toBe(false)
    expect(staffBoard(away).members[0]?.tasks).toEqual([])
    expect(openedOn(tick(away), 64)).toBe(false)
  })

  it('shows an employee absent on a day their job has work, as the engine plays it', () => {
    // Seed 42: Nadia, weak in fiabilité, misses day 2, a Wednesday.
    const game = playedTo(
      decided(START, { kind: 'hire', role: 'camion', candidate: 'nadia' }),
      2,
    )
    expect(isAbsent(game.seed, 2, { candidate: 'nadia', role: 'camion' })).toBe(
      true,
    )
    const work = todayWork(game)
    expect(work).toMatchObject({ absent: ['nadia'], opens: true })
    expect(work.hadWork.truck).toBe(true)
    expect(staffBoard(game).members[0]?.tasks).toEqual(['absent'])
    expect(tick(game).lastDay?.absent).toEqual(['nadia'])

    // The owner away too, nobody serves: the truck stays closed.
    const away = { ...game, ownerAway: true }
    expect(todayWork(away).opens).toBe(false)
    expect(openedOn(tick(away), 2)).toBe(false)
  })

  it('shows an employee absent on a day their job has none on leave, as the engine counts it', () => {
    // Seed 42: Olivier, deliverer, misses day 4, a Friday, with nothing due.
    const game = playedTo(
      decided(START, { kind: 'hire', role: 'livreur', candidate: 'olivier' }),
      4,
    )
    expect(todayWork(game)).toMatchObject({
      absent: ['olivier'],
      deliveriesDue: false,
    })
    expect(staffBoard(game).members[0]?.tasks).toEqual([])
    expect(tick(game).lastDay?.absent).toBeUndefined()
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
    expect(todayWork(due)).toMatchObject({
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
    expect(todayWork(away)).toMatchObject({
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
    expect(todayWork(due)).toMatchObject({
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

  it("opens the first truck on a day a choice closes the Vieux-Montréal's, made or queued (#262)", () => {
    const game = tick(START)
    const district = 'vieuxMontreal' as const
    const closed = {
      ...game,
      events: {
        ...game.events,
        modifiers: [
          {
            event: 'tournage',
            change: { kind: 'closed' } as const,
            fromDay: game.day,
            lastDay: game.day,
            district,
          },
        ],
        delayed: [
          {
            day: game.day,
            event: 'tournage',
            effect: { kind: 'closed', days: 1 } as const,
            district,
          },
        ],
      },
    }
    expect(todayWork(closed).opens).toBe(true)
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
  missedWork: number
}

/** The job of each role. */
const JOB = {
  camion: 'truck',
  livreur: 'deliveries',
  boulanger: 'bakery',
} as const

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
      missedWork: 0,
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
      // The absences that missed work (#256), as the engine records them.
      const missedWork = work.absent.filter((candidate) => {
        const role = game.decisions.staff.find(
          (hire) => hire.candidate === candidate,
        )?.role
        return role !== undefined && work.hadWork[JOB[role]]
      })
      expect(missedWork, at).toEqual(next.lastDay?.absent ?? [])
      expect(work.quits, at).toEqual(next.lastDay?.quits ?? [])

      seen[opened ? 'opened' : 'closed'] += 1
      if (delivered > 0) seen.delivered += 1
      if (missed > 0) seen.missed += 1
      if (work.bakes === 'owner') seen.bakedByOwner += 1
      if (work.bakes === 'employee') seen.bakedByEmployee += 1
      if (missedWork.length > 0) seen.missedWork += 1
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
    // At the role's start, below what she asks (#255).
    expect(game.staff).toEqual([
      {
        candidate: 'amelie',
        role: 'camion',
        hourlyWage: 1750,
        hiredOnDay: 1,
        underpaidSince: 1,
      },
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

describe('what each person did (#283)', () => {
  // Amélie at the truck, Kevin delivering and Sophie baking for Chez
  // Normand, from day 1, each paid what they ask.
  const STAFFED = decided(
    signed(START, 'chezNormand'),
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
  )
  const S = '\u00a0'
  const money = (amount: number) =>
    `${Math.round(amount / 100)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, S)}${S}$`

  it('tells what each one did yesterday, from the day the engine played', () => {
    // Day 8 is a Tuesday after Monday's deliveries.
    for (const day of [2, 3, 8, 9]) {
      const game = playedTo(STAFFED, day)
      const work = game.lastDay?.work ?? []
      const board = staffBoard(game)
      const of = (who: string) => work.find((person) => person.who === who)
      const amelie = of('amelie')
      const member = (candidate: string) =>
        board.members.find((row) => row.candidate === candidate)
      if (amelie !== undefined) {
        expect(member('amelie')?.yesterday).toBe(
          `Hier${S}: ${amelie.customers} client${amelie.customers < 2 ? ' servi' : 's servis'} · ${money(amelie.sales)} de ventes`,
        )
      }
      const kevin = of('kevin')
      if (kevin !== undefined) {
        expect(member('kevin')?.yesterday).toBe(
          `Hier${S}: ${kevin.deliveries} livraison${kevin.deliveries < 2 ? '' : 's'} · ${money(kevin.invoiced)} facturés`,
        )
      }
      const sophie = of('sophie')
      if (sophie !== undefined) {
        const saved = sophie.boughtCost - sophie.bakedCost
        expect(member('sophie')?.yesterday).toBe(
          `Hier${S}: ${sophie.baked.toString().replace(/\B(?=(\d{3})+(?!\d))/g, S)} croissant${sophie.baked < 2 ? '' : 's'} · ${money(Math.abs(saved))} ${saved >= 0 ? 'de moins' : 'de plus'} qu'achetés`,
        )
      }
    }
    // Over those days each did their job at least once.
    const monday = playedTo(STAFFED, 8).lastDay?.work ?? []
    expect(
      monday.find(({ who }) => who === 'kevin')?.deliveries,
    ).toBeGreaterThan(0)
  })

  it('lists the last seven days in the tooltip, after the wage', () => {
    const game = playedTo(STAFFED, 12)
    const amelie = staffBoard(game).members.find(
      ({ candidate }) => candidate === 'amelie',
    )
    if (amelie === undefined) throw new Error('no Amélie')
    expect(amelie.days.length).toBeGreaterThan(0)
    expect(amelie.days.length).toBeLessThanOrEqual(7)
    expect(amelie.days[0]?.divider).toBe(true)
    expect(amelie.days.every(({ label }) => /^[a-z]{3}\. \d/.test(label))).toBe(
      true,
    )
    const owner = staffBoard(game).owner
    expect(owner.days).toHaveLength(7)
    expect(owner.yesterday).toMatch(/^Hier\u00a0: \d+ clients? servis? · /)
  })

  it('says the owner was in town, and an employee absent', () => {
    let game = tick(tick(STAFFED))
    game = tick({ ...game, ownerAway: true })
    const board = staffBoard(game)
    expect(board.owner.yesterday).toBe(`Hier${S}: en ville`)
    expect(board.owner.days.at(-1)?.value).toBe('En ville')
    const absent = {
      ...game,
      workDays: game.workDays?.map((day, index, all) =>
        index === all.length - 1 ? { ...day, absent: ['kevin' as const] } : day,
      ),
    }
    const kevin = staffBoard(absent).members.find(
      ({ candidate }) => candidate === 'kevin',
    )
    expect(kevin?.yesterday).toBe(`Hier${S}: absence`)
  })

  it('says nothing for a save from before the days were kept', () => {
    const game = playedTo(STAFFED, 5)
    const board = staffBoard({ ...game, workDays: undefined })
    expect(board.owner).toMatchObject({ yesterday: null, days: [] })
  })
})
