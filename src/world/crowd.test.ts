import { describe, expect, it } from 'vitest'
import type { Visit, VisitOutcome } from '../engine/types.ts'
import {
  bobOf,
  createCrowd,
  type AtCounter,
  type Crowd,
  type Customer,
  type Span,
} from './crowd.ts'
import { CROWD } from './crowdSettings.ts'
import { ASSETS } from './manifest.ts'

const SPAN: Span = { left: 0, right: 1440 }
const { counterX, slotSpacing, groundY, laneOffset, edgeMargin } = CROWD
/** Everyone comes from the left and leaves by the left. */
const LEFT = () => 0.1
/** Everyone comes from the right and leaves by the right. */
const RIGHT = () => 0.9

function visit(
  outcome: VisitOutcome = 'bought',
  minute = 450,
  botched = 0,
): Visit {
  return {
    arrivalMinute: minute,
    segment: 'habitue',
    outcome,
    bought: {
      cafe: outcome === 'bought' ? 1 : 0,
      chocolat: 0,
      croissant: 0,
      limonade: 0,
    },
    servedMinute: outcome === 'bought' || outcome === 'soldOut' ? minute : null,
    leftMinute: outcome === 'leftLine' ? minute : null,
    botched,
  }
}

/**
 * Runs `crowd` for `ms` in frames of 16 ms; returns the customers who
 * reached the counter.
 */
function run(crowd: Crowd, ms: number, pace = 1, span = SPAN): AtCounter[] {
  const arrived: AtCounter[] = []
  for (let t = 0; t < ms; t += 16) arrived.push(...crowd.update(16, pace, span))
  return arrived
}

/** Runs `crowd` until `done` holds, at most a minute. */
function runUntil(crowd: Crowd, done: () => boolean, pace = 1): AtCounter[] {
  const arrived: AtCounter[] = []
  for (let t = 0; t < 60_000 && !done(); t += 16) {
    arrived.push(...crowd.update(16, pace, SPAN))
  }
  expect(done()).toBe(true)
  return arrived
}

function snapshot(customers: readonly Customer[]) {
  return customers.map((c) => ({ ...c }))
}

describe('createCrowd', () => {
  it('brings customers in just past an edge, in the lane nearer the viewer', () => {
    const fromLeft = createCrowd(CROWD, LEFT).spawn(visit(), SPAN)
    expect(fromLeft).toMatchObject({
      phase: 'walkingIn',
      x: SPAN.left - edgeMargin,
      y: groundY + laneOffset,
      facing: 1,
    })
    const wide = { left: -300, right: 1740 }
    const fromRight = createCrowd(CROWD, RIGHT).spawn(visit(), wide)
    expect(fromRight).toMatchObject({ x: wide.right + edgeMargin, facing: -1 })
  })

  it('lines customers up first come, first served, one spot apart from the counter leftwards', () => {
    const crowd = createCrowd(CROWD, RIGHT)
    const [a, b, c] = [visit(), visit(), visit()].map((v) =>
      crowd.spawn(v, SPAN),
    )
    runUntil(crowd, () => crowd.customers.every((x) => x.phase !== 'walkingIn'))

    expect(
      crowd.customers.map((x) => [x.id, x.phase, x.slot, x.x, x.y]),
    ).toEqual([
      [a!.id, 'atCounter', 0, counterX, groundY],
      [b!.id, 'inLine', 1, counterX - slotSpacing, groundY],
      [c!.id, 'inLine', 2, counterX - 2 * slotSpacing, groundY],
    ])
  })

  it('moves everyone up a spot when the customer at the counter leaves', () => {
    const crowd = createCrowd(CROWD, LEFT)
    const [a, b, c] = [visit(), visit(), visit()].map((v) =>
      crowd.spawn(v, SPAN),
    )
    runUntil(crowd, () => crowd.customers.every((x) => x.phase !== 'walkingIn'))
    runUntil(crowd, () => crowd.customers[0]?.phase === 'leaving')

    const byId = (id: number) => crowd.customers.find((x) => x.id === id)!
    expect(byId(a!.id).slot).toBe(-1)
    expect(byId(b!.id).slot).toBe(0)
    expect(byId(c!.id).slot).toBe(1)
    runUntil(crowd, () => byId(b!.id).phase === 'atCounter')
    expect(byId(b!.id).x).toBe(counterX)
    runUntil(crowd, () => byId(c!.id).x === counterX - slotSpacing)
    expect(byId(c!.id).phase).toBe('inLine')
  })

  it('walks a newcomer past the line in the lane and steps them into line at their spot', () => {
    // Served long enough for the newcomer to reach the line behind them.
    const crowd = createCrowd({ ...CROWD, serveMs: 60_000 }, RIGHT)
    crowd.spawn(visit(), SPAN)
    runUntil(crowd, () => crowd.customers[0]?.phase === 'atCounter')
    const late = crowd.spawn(visit(), SPAN)
    crowd.update(16, 1, SPAN)
    const walking = crowd.customers.find((x) => x.id === late.id)!
    expect(walking.y).toBe(groundY + laneOffset)
    runUntil(
      crowd,
      () =>
        crowd.customers.find((x) => x.id === late.id)!.phase !== 'walkingIn',
    )
    expect(crowd.customers.find((x) => x.id === late.id)).toMatchObject({
      phase: 'inLine',
      y: groundY,
      x: counterX - slotSpacing,
    })
  })

  it('brings each customer to the counter once, served only if they bought', () => {
    const crowd = createCrowd(CROWD, LEFT)
    const outcomes: VisitOutcome[] = [
      'tooExpensive',
      'bought',
      'soldOut',
      'browsed',
      'bought',
    ]
    const spawned = outcomes.map((o) => crowd.spawn(visit(o), SPAN))
    const arrived = runUntil(crowd, () => crowd.customers.length === 0)

    expect(arrived.map((a) => [a.customer.id, a.kind])).toEqual([
      [spawned[0]!.id, 'looked'],
      [spawned[1]!.id, 'served'],
      [spawned[2]!.id, 'looked'],
      [spawned[3]!.id, 'looked'],
      [spawned[4]!.id, 'served'],
    ])
  })

  it('reports a sold-out customer whose last unit was botched', () => {
    const crowd = createCrowd(CROWD, LEFT)
    crowd.spawn(visit('soldOut', 450, 1), SPAN)
    const [arrived] = runUntil(crowd, () => crowd.customers.length === 0)
    expect(arrived?.kind).toBe('looked')
    expect(arrived?.customer.visit.botched).toBe(1)
  })

  it('shows each mood bubble as the customer leaves, then takes them off past the edge', () => {
    const crowd = createCrowd(CROWD, LEFT)
    crowd.spawn(visit('soldOut'), SPAN)
    runUntil(crowd, () => crowd.customers[0]?.phase === 'leaving')
    expect(crowd.customers[0]).toMatchObject({ mood: 'sad', bubble: true })
    run(crowd, CROWD.bubbleMs + 16)
    expect(crowd.customers[0]?.bubble ?? false).toBe(false)
    runUntil(crowd, () => crowd.customers.length === 0)
  })

  it('freezes everyone, their timers and their bubbles at pace 0', () => {
    const crowd = createCrowd(CROWD, LEFT)
    for (const outcome of ['bought', 'browsed', 'bought'] as const) {
      crowd.spawn(visit(outcome), SPAN)
    }
    runUntil(crowd, () => crowd.customers[0]?.phase === 'leaving')
    crowd.update(16, 1, SPAN)
    const before = snapshot(crowd.customers)

    expect(run(crowd, 30_000, 0)).toEqual([])
    expect(snapshot(crowd.customers)).toEqual(before)

    // The bubble's time did not run while paused.
    run(crowd, CROWD.bubbleMs - 100)
    expect(crowd.customers[0]?.bubble).toBe(true)
  })

  it('walks and serves faster at a higher pace', () => {
    const slow = createCrowd(CROWD, LEFT)
    const fast = createCrowd(CROWD, LEFT)
    slow.spawn(visit(), SPAN)
    fast.spawn(visit(), SPAN)
    slow.update(200, 1, SPAN)
    fast.update(200, 2.5, SPAN)
    expect(fast.customers[0]!.walked).toBeCloseTo(
      2.5 * slow.customers[0]!.walked,
    )

    const t1 = timeToLeave(1)
    const t3 = timeToLeave(2.5)
    expect(t3).toBeLessThan(t1 / 2)
  })

  it('sends everyone still waiting away without buying or a bubble', () => {
    const crowd = createCrowd(CROWD, LEFT)
    for (let i = 0; i < 4; i += 1) crowd.spawn(visit('bought'), SPAN)
    runUntil(crowd, () => crowd.customers[0]?.phase === 'atCounter')

    crowd.dismiss()
    expect(
      crowd.customers.every(
        (c) => c.phase === 'leaving' && !c.bubble && c.slot === -1,
      ),
    ).toBe(true)
    expect(runUntil(crowd, () => crowd.customers.length === 0)).toEqual([])
  })

  it('takes everyone off at once when cleared', () => {
    const crowd = createCrowd(CROWD, LEFT)
    for (let i = 0; i < 5; i += 1) crowd.spawn(visit(), SPAN)
    run(crowd, 3000)
    crowd.clear()
    expect(crowd.customers).toEqual([])
    expect(crowd.spawn(visit(), SPAN).slot).toBe(0)
  })

  it('leaves past the edge of the street as it is on screen now', () => {
    const crowd = createCrowd(CROWD, RIGHT)
    crowd.spawn(visit('browsed'), SPAN)
    runUntil(crowd, () => crowd.customers[0]?.phase === 'leaving')
    const wide = { left: -400, right: 1840 }
    for (let t = 0; t < 60_000 && crowd.customers.length > 0; t += 16) {
      const before = crowd.customers[0]!.x
      crowd.update(16, 1, wide)
      if (crowd.customers.length > 0)
        expect(crowd.customers[0]!.x).toBeGreaterThan(before)
      else expect(before).toBeGreaterThan(wide.right)
    }
    expect(crowd.customers).toEqual([])
  })
})

/** How long a lone buyer takes from the edge until they leave the counter. */
function timeToLeave(pace: number): number {
  const crowd = createCrowd(CROWD, LEFT)
  crowd.spawn(visit(), SPAN)
  let t = 0
  while (crowd.customers[0]?.phase !== 'leaving') {
    crowd.update(16, pace, SPAN)
    t += 16
  }
  return t
}

describe('bobOf', () => {
  it('lifts a walker up and down once a stride, never below the ground', () => {
    const { bob } = CROWD
    expect(bobOf(0, bob)).toBe(0)
    expect(bobOf(bob.stride / 2, bob)).toBeCloseTo(bob.height)
    expect(bobOf(bob.stride, bob)).toBeCloseTo(0)
    for (let walked = 0; walked < 500; walked += 7) {
      expect(bobOf(walked, bob)).toBeGreaterThanOrEqual(0)
      expect(bobOf(walked, bob)).toBeLessThanOrEqual(bob.height)
    }
  })
})

describe('where the crowd stands', () => {
  const at = (id: string) => ASSETS.pieces.find((p) => p.id === id)!

  it('lines up on the sidewalk, left of the truck, a few of them in sight', () => {
    const sidewalk = at('sidewalk')
    const truck = at('truck')
    expect(groundY).toBeGreaterThan(sidewalk.y)
    expect(groundY).toBeLessThan(sidewalk.y + sidewalk.height)
    expect(counterX).toBeLessThan(truck.x)
    // The first five in line stand on the screen.
    expect(counterX - 4 * slotSpacing).toBeGreaterThan(0)
  })

  it('walks past the line in the road, in front of the truck', () => {
    const truck = at('truck')
    expect(groundY + laneOffset).toBeGreaterThan(truck.y + truck.height)
    expect(groundY + laneOffset).toBeLessThan(ASSETS.designSize.height)
  })
})
