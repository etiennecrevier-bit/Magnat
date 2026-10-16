import { beforeAll, describe, expect, it } from 'vitest'
import { createInitialState, tick, toCalendar } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { resolveEvent } from '../engine/events.ts'
import { defaultProfile } from '../engine/profile.ts'
import { int, seedRng } from '../engine/rng.ts'
import { streetOn } from '../engine/street.ts'
import type { Day, EventRecord, GameState } from '../engine/types.ts'

// The acceptance test of issue #155: 100 games of two years at Moyen, the
// player making each choice at random, as `npm run sim -- --events random`
// does. No card comes more often than its maxPerGame, « Le 1er juillet »
// comes every June 30 whose July 1 the truck opens, « Le chalet » comes in
// at least 80 % of the games, and the median gap between two events is 20
// to 30 days.

const GAMES = 100
const DAYS = 730
const CHALET_SHARE = 0.8
const MEDIAN_GAP = { from: 20, to: 30 }
/** June 30 of the first two years: day 0 is May 1st. */
const JUNE_30: readonly Day[] = [60, 60 + 365]
// The sim's salt, so the choices draw from a stream of their own.
const CHOICE_SALT = 0x5eed_c0de

/** What one game brought: its events, and the June 30s that open July 1. */
interface Game {
  readonly history: readonly EventRecord[]
  readonly june30sOpenJuly1: readonly Day[]
}

/**
 * Whether the truck opens tomorrow as the morning of `state` sees it: the
 * days open hold its weekday, and no change to the street, made or queued,
 * closes it.
 */
function opensTomorrow(state: GameState): boolean {
  const tomorrow = state.day + 1
  const { modifiers, delayed } = state.events
  return (
    state.decisions.daysOpen.includes(toCalendar(tomorrow).weekday) &&
    !streetOn(modifiers, tomorrow).closed &&
    !delayed.some(
      ({ day, effect }) =>
        effect.kind === 'closed' &&
        day <= tomorrow &&
        tomorrow < day + effect.days,
    )
  )
}

/** Two years of the game of `seed` at Moyen, each choice made at random. */
function play(seed: number): Game {
  let state = createInitialState(seed, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty: 'moyen',
  })
  let stream = seedRng((seed ^ CHOICE_SALT) >>> 0)
  const june30sOpenJuly1: Day[] = []
  for (let day = 0; day < DAYS; day += 1) {
    const { pending } = state.events
    if (JUNE_30.includes(state.day) && opensTomorrow(state)) {
      june30sOpenJuly1.push(state.day)
    }
    if (pending !== null) {
      const card = EVENTS.events.find(({ id }) => id === pending.event)
      if (card === undefined) throw new Error(`No card ${pending.event}`)
      const [index, after] = int(stream, 0, card.choices.length - 1)
      stream = after
      const choice = card.choices[index]
      if (choice === undefined) throw new Error(`No choice ${index}`)
      state = resolveEvent(state, choice.id, EVENTS)
    }
    state = tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      EVENTS,
    )
  }
  return { history: state.events.history, june30sOpenJuly1 }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

describe('events over 100 games of two years at Moyen, choices at random', () => {
  let games: Game[] = []
  beforeAll(() => {
    games = Array.from({ length: GAMES }, (_, seed) => play(seed + 1))
  }, 120_000)

  it('never bring a card more often than its maxPerGame', () => {
    const caps = EVENTS.events.flatMap(({ id, conditions }) =>
      conditions?.maxPerGame === undefined ? [] : [[id, conditions.maxPerGame]],
    )
    expect(caps).toHaveLength(3)
    const over = games.flatMap(({ history }, game) =>
      caps.flatMap(([id, cap]) => {
        const times = history.filter(({ event }) => event === id).length
        return times > (cap as number)
          ? [`game ${game + 1}: ${id} ×${times}`]
          : []
      }),
    )
    expect(over).toEqual([])
  })

  it('bring « Le 1er juillet » every June 30 whose July 1 the truck opens', () => {
    const missed = games.flatMap(({ history, june30sOpenJuly1 }, game) =>
      june30sOpenJuly1
        .filter(
          (day) =>
            !history.some(
              (record) =>
                record.event === 'premierJuillet' && record.day === day,
            ),
        )
        .map((day) => `game ${game + 1}, day ${day}`),
    )
    expect(missed).toEqual([])
    // Most June 30s open July 1; an earlier choice, such as the chalet's,
    // closes the others.
    const opened = games.reduce((n, g) => n + g.june30sOpenJuly1.length, 0)
    expect(opened).toBeGreaterThan(GAMES * JUNE_30.length * 0.9)
  })

  it('bring « Le chalet » in at least 80 % of the games', () => {
    const withChalet = games.filter(({ history }) =>
      history.some(({ event }) => event === 'chalet'),
    ).length
    expect(withChalet / GAMES).toBeGreaterThanOrEqual(CHALET_SHARE)
  })

  it('leave a median gap of 20 to 30 days between two events', () => {
    const gaps = games.flatMap(({ history }) =>
      history
        .slice(1)
        .map((record, at) => record.day - (history[at]?.day ?? 0)),
    )
    const gap = median(gaps)
    expect(gap).toBeGreaterThanOrEqual(MEDIAN_GAP.from)
    expect(gap).toBeLessThanOrEqual(MEDIAN_GAP.to)
  })
})
