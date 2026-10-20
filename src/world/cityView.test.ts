import { describe, expect, it } from 'vitest'
import type { GrocerId } from '../content/schema.ts'
import { createInitialState, startChallenge, tick } from '../engine/clock.ts'
import { startContract } from '../engine/contracts.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { wentTo } from '../engine/places.ts'
import type { Day, GameState, Visit } from '../engine/types.ts'
import { todayWork } from '../ui/staffBoard.ts'
import { enRouteLine } from '../ui/tripBoard.ts'
import {
  actorsAt,
  cityShowsOn,
  cityView,
  lineAt,
  showsByMinute,
  type CityView,
} from './cityView.ts'
import { ASSETS } from './manifest.ts'
import type { Replay } from './replay.ts'

// Day 0 is a Monday, when the truck is closed; day 1 a Tuesday, open.
const START = createInitialState(42)
const { walkIns } = FOOD_TRUCK
const vanHours = ASSETS.city.deliveries.window

/** `state` with `changes` made, in order. */
function decided(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((game, change) => applyDecision(game, change), state)
}

/** `state` played to the morning of `day`. */
function playedTo(state: GameState, day: Day): GameState {
  let game = state
  while (game.day < day) game = tick(game)
  return game
}

/** `state` with a contract signed that morning with each of `grocers`. */
function signed(state: GameState, ...grocers: GrocerId[]): GameState {
  return grocers.reduce(
    (game, grocer) => ({
      ...game,
      contracts: startContract(game.contracts, game.day, grocer),
    }),
    state,
  )
}

/** How far through the open hours `minute` is. */
function at(minute: number): number {
  return (
    (minute - walkIns.opensAtMinute) /
    (walkIns.closesAtMinute - walkIns.opensAtMinute)
  )
}

/** The truck's staff hired on day 0, at work from day 1. */
function hired(...roles: ('camion' | 'livreur' | 'boulanger')[]): GameState {
  const candidates = {
    camion: 'amelie',
    livreur: 'kevin',
    boulanger: 'sophie',
  } as const
  return decided(
    START,
    ...roles.map((role): DecisionChange => ({
      kind: 'hire',
      role,
      candidate: candidates[role],
    })),
  )
}

describe('cityView', () => {
  it('shows a new game on its closed Monday: no trip, nobody at work, the bakery for rent', () => {
    expect(cityView(START)).toEqual({
      open: false,
      atTruck: 0,
      trip: null,
      bakery: false,
      bakers: 0,
      deliverers: 0,
      vanAt: null,
      van: null,
      contracts: [],
      trips: true,
    })
  })

  it('opens the truck as « Qui fait quoi » says, on the first open day', () => {
    const tuesday = playedTo(START, 1)
    expect(cityView(tuesday).open).toBe(true)
    expect(cityView(tuesday).open).toBe(todayWork(tuesday).opens)
  })

  it('names the trip in the top bar’s words, with its times', () => {
    const tuesday = wentTo(playedTo(START, 1), 'caisse')
    expect(cityView(tuesday).trip).toEqual({
      place: 'caisse',
      label: 'En route vers la Caisse',
      time: {
        wholeDay: false,
        legMinutes: 25,
        visitMinutes: 30,
        leavesAtMinute: 600,
        backAtMinute: 680,
      },
    })
    expect(cityView(tuesday).trip?.label).toBe(enRouteLine(tuesday))
  })

  it('counts the employees at the truck, the bakers and the deliverers where they work', () => {
    const staffed = playedTo(
      decided(hired('camion', 'livreur', 'boulanger'), {
        kind: 'openBakery',
        oven: 'louer',
      }),
      1,
    )
    expect(cityView(staffed)).toMatchObject({
      atTruck: 1,
      bakery: true,
      bakers: 1,
      deliverers: 1,
      vanAt: 'bakery',
      van: null,
    })
    // Without the bakery, the baker has nowhere to work and the van parks
    // at the truck.
    expect(cityView(playedTo(hired('livreur', 'boulanger'), 1))).toMatchObject({
      bakers: 0,
      deliverers: 1,
      vanAt: 'truck',
    })
  })

  it('counts each of several employees hired in the same role', () => {
    const twice = (role: 'livreur' | 'boulanger') =>
      playedTo(
        decided(
          START,
          { kind: 'hire', role, candidate: 'amelie' },
          { kind: 'hire', role, candidate: 'kevin' },
          { kind: 'openBakery', oven: 'louer' },
        ),
        1,
      )
    expect(cityView(twice('boulanger'))).toMatchObject({
      bakers: 2,
      deliverers: 0,
    })
    expect(cityView(twice('livreur'))).toMatchObject({
      bakers: 0,
      deliverers: 2,
      vanAt: 'bakery',
    })
  })

  it('lists the grocers whose contract runs, in the order signed', () => {
    const game = signed(playedTo(START, 1), 'marcheBioLogique', 'chezNormand')
    expect(cityView(game).contracts).toEqual([
      'marcheBioLogique',
      'chezNormand',
    ])
  })

  it('stops shutting the trips in a Défi, as the top bar hides « Aller à… »', () => {
    expect(cityView(startChallenge('travauxSaintDenis', 42)).trips).toBe(false)
  })
})

describe('the bakery', () => {
  const opened = playedTo(
    decided(START, { kind: 'openBakery', oven: 'louer' }),
    1,
  )

  it('runs from the morning it opens', () => {
    expect(
      cityView(decided(START, { kind: 'openBakery', oven: 'louer' })).bakery,
    ).toBe(false)
    expect(cityView(opened).bakery).toBe(true)
  })

  it('runs through its notice, then is for rent again', () => {
    // Closed on day 1, it takes its notice on the morning of day 2.
    const closing = playedTo(decided(opened, { kind: 'closeBakery' }), 3)
    const lastDay = closing.bakery.closesAfterDay
    expect(lastDay).not.toBeNull()
    expect(cityView(closing).bakery).toBe(true)
    const last = playedTo(closing, lastDay!)
    expect(cityView(last).bakery).toBe(true)
    expect(cityView(tick(last)).bakery).toBe(false)
  })
})

describe('the van', () => {
  // Day 7 is the next Monday; the contracts were signed on day 1.
  const contracted = (game: GameState) =>
    playedTo(signed(playedTo(game, 1), 'chezNormand', 'depanneur2424'), 7)

  it('drives on a Monday with the deliverer, stopping at each grocer in the order signed', () => {
    const monday = contracted(hired('livreur'))
    expect(cityView(monday).van).toEqual({
      stops: ['chezNormand', 'depanneur2424'],
      driver: 'employee',
    })
    expect(cityView(monday).vanAt).toBe('truck')
  })

  it('has the owner drive without a deliverer', () => {
    const monday = contracted(START)
    expect(cityView(monday).van).toEqual({
      stops: ['chezNormand', 'depanneur2424'],
      driver: 'owner',
    })
    expect(cityView(monday).vanAt).toBe('truck')
  })

  it('stays away when nobody can drive, since the delivery is missed', () => {
    const monday = wentTo(contracted(START), 'bureauPermis')
    expect(todayWork(monday).delivers).toBeNull()
    expect(cityView(monday)).toMatchObject({ van: null, vanAt: null })
  })

  it('skips a contract signed that very Monday', () => {
    const monday = signed(contracted(hired('livreur')), 'marcheBioLogique')
    expect(cityView(monday).van?.stops).toEqual([
      'chezNormand',
      'depanneur2424',
    ])
    expect(cityView(monday).contracts).toContain('marcheBioLogique')
  })

  it('drives through its window of the day only', () => {
    const view = cityView(contracted(hired('livreur')))
    expect(
      actorsAt(view, vanHours.from - 0.01, walkIns, vanHours).van,
    ).toBeNull()
    expect(actorsAt(view, vanHours.from, walkIns, vanHours).van).toBe(0)
    expect(
      actorsAt(view, (vanHours.from + vanHours.to) / 2, walkIns, vanHours).van,
    ).toBeCloseTo(0.5)
    expect(actorsAt(view, vanHours.to, walkIns, vanHours).van).toBeNull()
  })
})

describe('actorsAt', () => {
  const tuesday = playedTo(START, 1)

  it('keeps the owner serving all day without a trip', () => {
    const view = cityView(tuesday)
    for (const progress of [0, 0.5, 1]) {
      expect(actorsAt(view, progress, walkIns, vanHours)).toEqual({
        owner: { kind: 'serving' },
        truckOpen: true,
        van: null,
      })
    }
  })

  it('draws nobody at a truck closed for the day', () => {
    expect(actorsAt(cityView(START), 0.5, walkIns, vanHours)).toEqual({
      owner: null,
      truckOpen: false,
      van: null,
    })
  })

  describe('on a trip to the Caisse, with nobody at the truck', () => {
    // Leaves at 10 h, 25 min each way, 30 min there: back at 11 h 20.
    const view = cityView(wentTo(tuesday, 'caisse'))
    const when = (minute: number) =>
      actorsAt(view, at(minute), walkIns, vanHours)

    it('serves until the owner leaves', () => {
      expect(when(599)).toMatchObject({
        owner: { kind: 'serving' },
        truckOpen: true,
      })
    })

    it('walks there, closing the truck', () => {
      const leaving = when(610)
      expect(leaving.truckOpen).toBe(false)
      expect(leaving.owner).toEqual({
        kind: 'away',
        share: expect.closeTo(10 / 25),
      })
    })

    it('waits at the door for the visit', () => {
      expect(when(625).owner).toEqual({ kind: 'away', share: 1 })
      expect(when(654).owner).toEqual({ kind: 'away', share: 1 })
    })

    it('walks back, then serves again once back', () => {
      expect(when(665).owner).toEqual({
        kind: 'away',
        share: expect.closeTo(1 - 10 / 25),
      })
      expect(when(665).truckOpen).toBe(false)
      expect(when(680)).toMatchObject({
        owner: { kind: 'serving' },
        truckOpen: true,
      })
    })
  })

  it('keeps the truck serving through a trip with an employee at it', () => {
    const view = cityView(wentTo(playedTo(hired('camion'), 1), 'caisse'))
    const away = actorsAt(view, at(640), walkIns, vanHours)
    expect(away.owner).toEqual({ kind: 'away', share: 1 })
    expect(away.truckOpen).toBe(true)
  })

  it('keeps the owner at the permits office all day, the truck closed', () => {
    const view = cityView(wentTo(tuesday, 'bureauPermis'))
    expect(view.open).toBe(false)
    for (const progress of [0, 0.5, 1]) {
      expect(actorsAt(view, progress, walkIns, vanHours)).toEqual({
        owner: { kind: 'away', share: 1 },
        truckOpen: false,
        van: null,
      })
    }
  })

  it('serves at the truck through a whole-day trip with an employee at it', () => {
    const view = cityView(wentTo(playedTo(hired('camion'), 1), 'bureauPermis'))
    expect(view.open).toBe(true)
    expect(actorsAt(view, 0.5, walkIns, vanHours).truckOpen).toBe(true)
  })

  it('walks a closed day’s trip, then draws nobody', () => {
    const view = cityView(wentTo(START, 'meunerie'))
    expect(actorsAt(view, at(500), walkIns, vanHours).owner).toBeNull()
    expect(actorsAt(view, at(620), walkIns, vanHours).owner).toMatchObject({
      kind: 'away',
    })
    expect(actorsAt(view, at(800), walkIns, vanHours)).toMatchObject({
      owner: null,
      truckOpen: false,
    })
  })
})

describe('lineAt', () => {
  const visit = (arrivalMinute: number): Visit =>
    ({ arrivalMinute }) as unknown as Visit
  const replay: Replay = {
    visits: [500, 505, 510, 511, 512, 513, 514, 515, 600].map(visit),
    dayType: 'semaine',
    served: 9,
    lost: 0,
  }
  const line = { max: 6, minutes: 20 }

  it('stands those who came in the last minutes in line, at most the most', () => {
    expect(lineAt(replay, 499, true, line, true)).toBe(0)
    expect(lineAt(replay, 505, true, line, true)).toBe(2)
    expect(lineAt(replay, 515, true, line, true)).toBe(6)
    expect(lineAt(replay, 524, true, line, true)).toBe(6)
    expect(lineAt(replay, 531, true, line, true)).toBe(4)
    expect(lineAt(replay, 590, true, line, true)).toBe(0)
  })

  it('stands nobody at a truck closed, without a day to replay, or at ×10', () => {
    expect(lineAt(replay, 515, false, line, true)).toBe(0)
    expect(lineAt(null, 515, true, line, true)).toBe(0)
    expect(lineAt(replay, 515, true, line, false)).toBe(0)
  })
})

describe('cityShowsOn', () => {
  const view: Pick<CityView, 'bakery' | 'contracts'> = {
    bakery: true,
    contracts: ['chezNormand'],
  }

  it('shows the hatch or the shutter by the minute, the rest by the day', () => {
    expect(cityShowsOn('truckOpen', view, true)).toBe(true)
    expect(cityShowsOn('truckClosed', view, true)).toBe(false)
    expect(cityShowsOn('bakeryRuns', view, false)).toBe(true)
    expect(cityShowsOn('bakeryForRent', view, false)).toBe(false)
    expect(cityShowsOn({ contract: 'chezNormand' }, view, true)).toBe(true)
    expect(cityShowsOn({ contract: 'depanneur2424' }, view, true)).toBe(false)
    expect(showsByMinute('truckOpen')).toBe(true)
    expect(showsByMinute('truckClosed')).toBe(true)
    expect(showsByMinute('bakeryRuns')).toBe(false)
    expect(showsByMinute({ contract: 'chezNormand' })).toBe(false)
  })
})
