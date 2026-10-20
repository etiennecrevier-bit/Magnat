import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SegmentId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { next, seedRng } from '../engine/rng.ts'
import type { GameState, Visit, VisitOutcome } from '../engine/types.ts'
import { todayNumbers } from '../ui/todayNumbers.ts'
import { CROWD, type CrowdSettings } from './crowdSettings.ts'
import {
  arrivalShare,
  createDayClock,
  createSampler,
  moodOf,
  replayOf,
} from './replay.ts'

const WALK_INS = FOOD_TRUCK.walkIns
const MS_PER_DAY = 4000

/** A `random` the test can replay: the engine's generator from `seed`. */
function seeded(seed: number): () => number {
  let state = seedRng(seed)
  return () => {
    const [value, after] = next(state)
    state = after
    return value
  }
}

/** Plays `days` days from `state`. */
function play(state: GameState, days: number): GameState {
  let played = state
  for (let i = 0; i < days; i += 1) played = tick(played)
  return played
}

/** Day 0, a Monday: closed, nothing played yet. */
const monday = createInitialState(42)
/** Day 1: open, but Monday was closed, so it has no visits to replay. */
const tuesday = play(monday, 1)
/** Day 2: open, replaying Tuesday. */
const wednesday = play(monday, 2)
/** Day 6: open, replaying Saturday. */
const sunday = play(monday, 6)
/** Day 7: closed again, though Sunday had visits. */
const nextMonday = play(monday, 7)

function visit(
  arrivalMinute: number,
  outcome: VisitOutcome = 'bought',
  segment: SegmentId = 'habitue',
): Visit {
  return {
    arrivalMinute,
    segment,
    outcome,
    bought: {
      cafe: outcome === 'bought' ? 1 : 0,
      chocolat: 0,
      croissant: 0,
    },
    servedMinute:
      outcome === 'bought' || outcome === 'soldOut' ? arrivalMinute : null,
    leftMinute: outcome === 'leftLine' ? arrivalMinute : null,
    botched: 0,
  }
}

describe('replayOf', () => {
  it('replays nothing before a day is played', () => {
    expect(replayOf(monday)).toBeNull()
  })

  it('replays nothing after a day with no visits', () => {
    expect(tuesday.lastDay?.visits).toEqual([])
    expect(replayOf(tuesday)).toBeNull()
  })

  it('replays nothing on a day the truck is closed', () => {
    expect(nextMonday.lastDay?.visits.length).toBeGreaterThan(0)
    expect(replayOf(nextMonday)).toBeNull()
  })

  it('replays nothing on a day the street closes the truck', () => {
    expect(replayOf(wednesday)).not.toBeNull()
    const closed: GameState = {
      ...wednesday,
      events: {
        ...wednesday.events,
        modifiers: [
          {
            event: 'chalet',
            change: { kind: 'closed' },
            fromDay: wednesday.day,
            lastDay: wednesday.day,
          },
        ],
      },
    }
    expect(replayOf(closed)).toBeNull()
  })

  it('replays the last day played, its visits as they are', () => {
    const replay = replayOf(wednesday)
    expect(replay?.visits).toBe(wednesday.lastDay?.visits)
    expect(replay?.dayType).toBe('semaine')
  })

  it('replays a Saturday with the weekend crowd', () => {
    expect(replayOf(sunday)?.dayType).toBe('finDeSemaine')
  })

  it('counts as served the visits that reached the counter, as « Hier » does', () => {
    const replay = replayOf(wednesday)
    expect(replay?.served).toBe(
      todayNumbers(wednesday.lastDay!).customersServed,
    )
  })

  it('counts as served those who reached the counter, whatever they bought', () => {
    const game: GameState = {
      ...wednesday,
      lastDay: {
        ...wednesday.lastDay!,
        visits: [
          visit(430, 'bought'),
          visit(431, 'tooExpensive'),
          visit(432, 'soldOut'),
          visit(433, 'browsed'),
          visit(434, 'bought'),
          visit(435, 'leftLine'),
        ],
      },
    }
    expect(replayOf(game)?.served).toBe(3)
  })
})

describe('moodOf', () => {
  it.each([
    ['bought', 'happy'],
    ['tooExpensive', 'annoyed'],
    ['soldOut', 'sad'],
    ['leftLine', 'annoyed'],
    ['browsed', 'neutral'],
  ] as const)('shows a %s visit as %s', (outcome, mood) => {
    expect(moodOf(outcome)).toBe(mood)
  })
})

describe('arrivalShare', () => {
  it('runs from 0 at opening to just under 1 at the last minute', () => {
    const { opensAtMinute, closesAtMinute } = WALK_INS
    expect(arrivalShare(visit(opensAtMinute), WALK_INS)).toBe(0)
    expect(
      arrivalShare(visit((opensAtMinute + closesAtMinute) / 2), WALK_INS),
    ).toBe(0.5)
    const last = arrivalShare(visit(closesAtMinute - 1), WALK_INS)
    expect(last).toBeLessThan(1)
    expect(last).toBeGreaterThan(0.99)
  })
})

describe('createDayClock', () => {
  it('takes a day of msPerDay at speed 1, faster at higher speeds, and stops at the end', () => {
    const clock = createDayClock(MS_PER_DAY)
    clock.follow(wednesday)
    expect(clock.elapse(1000, 1)).toBe(0.25)
    expect(clock.elapse(1000, 2)).toBe(0.75)
    expect(clock.elapse(10_000, 1)).toBe(1)
  })

  it('stands still while paused', () => {
    const clock = createDayClock(MS_PER_DAY)
    clock.follow(wednesday)
    clock.elapse(1000, 1)
    expect(clock.elapse(5000, 0)).toBe(0.25)
  })

  it('starts again on a new day, but not when a decision changes the game', () => {
    const clock = createDayClock(MS_PER_DAY)
    expect(clock.follow(wednesday)).toBe(true)
    clock.elapse(2000, 1)

    const decided = applyDecision(wednesday, {
      kind: 'price',
      product: 'cafe',
      price: cents(400),
    })
    expect(decided).not.toBe(wednesday)
    expect(clock.follow(decided)).toBe(false)
    expect(clock.follow(wednesday)).toBe(false)
    expect(clock.elapse(0, 1)).toBe(0.5)

    expect(clock.follow(tick(wednesday))).toBe(true)
    expect(clock.elapse(0, 1)).toBe(0)
  })

  it('starts again on a new game on the same day', () => {
    const clock = createDayClock(MS_PER_DAY)
    clock.follow(wednesday)
    clock.elapse(2000, 1)
    expect(clock.follow(play(createInitialState(7), 2))).toBe(true)
    expect(clock.elapse(0, 1)).toBe(0)
  })
})

/** Settings that keep many visits, so the gate has work to do. */
const BUSY: CrowdSettings['speeds'] = {
  1: { keepChance: 0.5, minGapMs: 300, jitterMs: 100, maxOnScreen: 4, pace: 1 },
  3: { keepChance: 0.3, minGapMs: 500, jitterMs: 250, maxOnScreen: 2, pace: 2 },
}

/** Every visit, kept at once, as soon as it comes up. */
const EVERYONE: CrowdSettings['speeds'] = {
  1: { keepChance: 1, minGapMs: 0, jitterMs: 0, maxOnScreen: 1000, pace: 1 },
}

/** A day's visits in arrival order, each a distinct object. */
const visitsArb = fc
  .array(
    fc.record({
      minute: fc.integer({
        min: WALK_INS.opensAtMinute,
        max: WALK_INS.closesAtMinute - 1,
      }),
      outcome: fc.constantFrom<VisitOutcome>(
        'bought',
        'tooExpensive',
        'soldOut',
        'browsed',
      ),
    }),
    { maxLength: 150 },
  )
  .map((drawn) =>
    drawn
      .sort((a, b) => a.minute - b.minute)
      .map(({ minute, outcome }) => visit(minute, outcome)),
  )

/** One frame: how long it took, the speed, and how many customers left. */
const framesArb = fc.array(
  fc.record({
    deltaMs: fc.integer({ min: 0, max: 250 }),
    speed: fc.constantFrom(0, 1, 1, 1, 3, 3, 10),
    leaving: fc.nat({ max: 2 }),
  }),
  { minLength: 1, maxLength: 300 },
)

interface Spawn {
  /** Its index in the list it came from. */
  index: number
  list: number
}

/**
 * Runs the sampler over `frames`, starting on the next list of `lists` at
 * each frame index in `startsAt`, with a crowd that only grows by the
 * sampler and shrinks by each frame's `leaving`. Checks each step's
 * invariants as it goes and returns what walked on.
 */
function runSampler(
  speeds: CrowdSettings['speeds'],
  lists: readonly (readonly Visit[])[],
  frames: readonly { deltaMs: number; speed: number; leaving: number }[],
  seed: number,
  startsAt: readonly number[] = [],
): Spawn[] {
  const sampler = createSampler(WALK_INS, speeds, seeded(seed))
  const clock = createDayClock(MS_PER_DAY)
  let list = 0
  sampler.start(lists[0] ?? [])
  let onScreen = 0
  let sinceMs = Number.POSITIVE_INFINITY
  const spawns: Spawn[] = []

  frames.forEach(({ deltaMs, speed, leaving }, frame) => {
    if (startsAt.includes(frame) && list + 1 < lists.length) {
      list += 1
      sampler.start(lists[list]!)
    }
    onScreen = Math.max(0, onScreen - leaving)
    if (speed > 0) sinceMs += deltaMs
    const progress = clock.elapse(deltaMs, speed)
    const arriving = sampler.step(progress, deltaMs, onScreen, speed)
    if (arriving === null) return

    const settings = speeds[speed]
    // Only at a speed that walks, and never past its cap.
    expect(settings).toBeDefined()
    expect(onScreen).toBeLessThan(settings!.maxOnScreen)
    // Only real visits of the list being replayed, once its time came.
    const index = lists[list]!.indexOf(arriving)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(arrivalShare(arriving, WALK_INS)).toBeLessThanOrEqual(progress)
    // Never closer together than the gap allows.
    expect(sinceMs).toBeGreaterThanOrEqual(
      settings!.minGapMs - settings!.jitterMs,
    )
    spawns.push({ index, list })
    onScreen += 1
    sinceMs = 0
  })
  return spawns
}

/** Whether `spawns` follow their list in strictly increasing order. */
function inOrder(spawns: readonly Spawn[]): boolean {
  return spawns.every((spawn, i) => {
    const before = spawns[i - 1]
    return (
      before === undefined ||
      spawn.list > before.list ||
      (spawn.list === before.list && spawn.index > before.index)
    )
  })
}

describe('createSampler', () => {
  it('never goes over the cap, and only replays real visits, each once, in their order', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(BUSY, CROWD.speeds),
        visitsArb,
        framesArb,
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        (speeds, visits, frames, seed) => {
          const spawns = runSampler(speeds, [visits], frames, seed)
          expect(inOrder(spawns)).toBe(true)
        },
      ),
    )
  })

  it('fills the street up to the cap and no further', () => {
    const visits = Array.from({ length: 240 }, (_, i) =>
      visit(WALK_INS.opensAtMinute + i * 2),
    )
    const frames = Array.from({ length: 300 }, () => ({
      deltaMs: 16,
      speed: 1,
      leaving: 0,
    }))
    const spawns = runSampler(BUSY, [visits], frames, 3)
    expect(spawns).toHaveLength(BUSY[1]!.maxOnScreen)
  })

  it('drops the visits still to come when the next day starts', () => {
    fc.assert(
      fc.property(
        visitsArb,
        visitsArb,
        framesArb,
        fc.nat({ max: 300 }),
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        (first, second, frames, startAt, seed) => {
          const spawns = runSampler(BUSY, [first, second], frames, seed, [
            startAt,
          ])
          // runSampler finds each visit in the list being replayed, so
          // none of the first list's comes once the second starts.
          expect(inOrder(spawns)).toBe(true)
        },
      ),
    )
  })

  it('lets no one in while paused or at a speed that does not walk', () => {
    fc.assert(
      fc.property(
        visitsArb,
        fc.constantFrom(0, 10),
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        (visits, speed, seed) => {
          const sampler = createSampler(WALK_INS, EVERYONE, seeded(seed))
          sampler.start(visits)
          for (let i = 0; i <= 10; i += 1) {
            expect(sampler.step(i / 10, 500, 0, speed)).toBeNull()
          }
        },
      ),
    )
  })

  it('replays every visit, in order, when it keeps them all and never waits', () => {
    const visits = [visit(430), visit(445), visit(600), visit(899)]
    const sampler = createSampler(WALK_INS, EVERYONE, seeded(1))
    sampler.start(visits)
    expect(sampler.step(0, 16, 0, 1)).toBeNull()
    for (const v of visits) {
      expect(sampler.step(arrivalShare(v, WALK_INS), 16, 0, 1)).toBe(v)
    }
    expect(sampler.step(1, 16, 0, 1)).toBeNull()
  })

  it('lets at most one visit walk on per step and drops the others due', () => {
    const visits = [visit(430), visit(431), visit(432)]
    const sampler = createSampler(WALK_INS, EVERYONE, seeded(1))
    sampler.start(visits)
    expect(sampler.step(1, 16, 0, 1)).toBe(visits[0])
    expect(sampler.step(1, 16, 0, 1)).toBeNull()
  })

  it('drops a visit that comes up while the street is full, rather than holding it back', () => {
    const visits = [visit(430), visit(500)]
    const full: CrowdSettings['speeds'] = {
      1: { ...EVERYONE[1]!, maxOnScreen: 3 },
    }
    const sampler = createSampler(WALK_INS, full, seeded(1))
    sampler.start(visits)
    expect(
      sampler.step(arrivalShare(visits[0]!, WALK_INS), 16, 3, 1),
    ).toBeNull()
    expect(
      sampler.step(arrivalShare(visits[0]!, WALK_INS), 16, 0, 1),
    ).toBeNull()
    expect(sampler.step(1, 16, 2, 1)).toBe(visits[1])
  })
})
