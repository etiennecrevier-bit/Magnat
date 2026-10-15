import { describe, expect, it } from 'vitest'
import { createInitialState, toCalendar } from '../engine/clock.ts'
import { ENERGY } from '../engine/day.ts'
import { cents } from '../engine/money.ts'
import type { Day, GameState } from '../engine/types.ts'
import {
  MAX_MESSAGES,
  MESSAGES,
  NO_MEMORY,
  pickLine,
  received,
  startMessages,
  triggersBetween,
  type Message,
} from './messageTriggers.ts'
import { createGameStore, type GameStore } from './store.ts'

const START = createInitialState(42)

/** `START` on the morning of `day`, with `energy` and those unpaid rents. */
function morning(
  day: Day,
  energy: number,
  unpaidRents: readonly Day[] = [],
): GameState {
  return {
    ...START,
    day,
    energy,
    personal: { ...START.personal, unpaidRents },
  }
}

const RESTED = 80
const TIRED = ENERGY.exhausted.below
const EXHAUSTED = ENERGY.exhausted.below - 0.1

describe('triggersBetween', () => {
  it('calls for the landlord once for each rent unpaid on the days played', () => {
    const before = morning(31, RESTED, [0])
    const after = morning(63, RESTED, [0, 31, 61])
    expect(triggersBetween(before, after, NO_MEMORY).triggers).toEqual([
      { kind: 'landlord', day: 31 },
      { kind: 'landlord', day: 61 },
    ])
    // The next day played adds none.
    expect(
      triggersBetween(after, morning(64, RESTED, [0, 31, 61]), NO_MEMORY)
        .triggers,
    ).toEqual([])
  })

  it('calls for the owner the morning they wake up exhausted', () => {
    const { triggers, memory } = triggersBetween(
      morning(2, TIRED),
      morning(3, EXHAUSTED),
      NO_MEMORY,
    )
    expect(triggers).toEqual([{ kind: 'exhausted', day: 3 }])
    expect(memory).toEqual({ exhaustedWeek: 0 })
  })

  it('stays quiet while the owner stays exhausted, or is only tired', () => {
    expect(
      triggersBetween(morning(3, EXHAUSTED), morning(4, 3), NO_MEMORY),
    ).toEqual({ triggers: [], memory: NO_MEMORY })
    expect(
      triggersBetween(morning(3, RESTED), morning(4, TIRED), NO_MEMORY)
        .triggers,
    ).toEqual([])
  })

  it('calls for the owner once a game week at most, Monday to Sunday', () => {
    // Day 0 is a Monday: days 0 to 6 are week 0, days 7 to 13 week 1.
    let memory = NO_MEMORY
    const wake = (day: Day) => {
      const found = triggersBetween(
        morning(day - 1, RESTED),
        morning(day, EXHAUSTED),
        memory,
      )
      memory = found.memory
      return found.triggers.length
    }
    expect(wake(2)).toBe(1)
    expect(wake(6)).toBe(0)
    expect(wake(7)).toBe(1)
    expect(wake(13)).toBe(0)
    expect(wake(15)).toBe(1)
  })

  it('stays quiet when no day was played: a decision, or another game going back in time', () => {
    const before = morning(10, RESTED, [0])
    expect(
      triggersBetween(before, morning(10, EXHAUSTED, [0, 10]), NO_MEMORY),
    ).toEqual({ triggers: [], memory: NO_MEMORY })
    expect(
      triggersBetween(before, morning(3, EXHAUSTED, [0, 1]), NO_MEMORY),
    ).toEqual({ triggers: [], memory: NO_MEMORY })
  })

  it('lists the rent before the owner, oldest first', () => {
    expect(
      triggersBetween(
        morning(0, RESTED),
        morning(2, EXHAUSTED, [0]),
        NO_MEMORY,
      ).triggers.map(({ kind }) => kind),
    ).toEqual(['landlord', 'exhausted'])
  })
})

describe('pickLine', () => {
  const LINES = ['a', 'b', 'c']

  it('picks with the random draw', () => {
    expect(pickLine(LINES, () => 0, null)).toBe('a')
    expect(pickLine(LINES, () => 0.5, null)).toBe('b')
    expect(pickLine(LINES, () => 0.999, null)).toBe('c')
  })

  it('never picks the line to avoid while another is left', () => {
    expect(pickLine(LINES, () => 0, 'a')).toBe('b')
    expect(pickLine(LINES, () => 0.999, 'c')).toBe('b')
    expect(pickLine(['a'], () => 0, 'a')).toBe('a')
  })
})

describe('received', () => {
  it(`keeps the newest ${MAX_MESSAGES}, newest first`, () => {
    let kept: Message[] = []
    for (let id = 0; id < 5; id += 1) {
      kept = received(kept, {
        id,
        kind: 'landlord',
        from: 'Votre propriétaire',
        text: 'Le loyer.',
        day: id,
      })
    }
    expect(kept.map(({ id }) => id)).toEqual([4, 3, 2])
  })
})

/** A game store whose truck opens every day, from day 1 on. */
function everyDayStore(): GameStore {
  const store = createGameStore(START)
  store.getState().decide({ kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] })
  store.getState().advance(1)
  return store
}

/** Sets the owner's energy this morning, as a fixture: no day is played. */
function setEnergy(store: GameStore, energy: number) {
  store.setState({ game: { ...store.getState().game, energy } })
}

describe('startMessages', () => {
  it("sends the owner's line on a real exhausted morning, a new line each time", () => {
    const store = everyDayStore()
    const sent: Message[] = []
    const stop = startMessages(
      store,
      (message) => sent.push(message),
      () => 0,
    )

    // Day 1, a Tuesday, worked from 26: the owner wakes up exhausted.
    setEnergy(store, 26)
    store.getState().advance(1)
    expect(store.getState().game.energy).toBeLessThan(ENERGY.exhausted.below)
    // Again on day 2, the same week: nothing.
    setEnergy(store, 26)
    store.getState().advance(1)
    // Day 7, a Monday, starts a new week.
    store.getState().advance(7 - store.getState().game.day)
    setEnergy(store, 26)
    store.getState().advance(1)

    const { from, lines } = MESSAGES.exhausted
    expect(sent).toEqual([
      { id: 0, kind: 'exhausted', from, text: lines[0], day: 2 },
      { id: 1, kind: 'exhausted', from, text: lines[1], day: 8 },
    ])
    stop()
  })

  it("sends the landlord's line when a real rent goes unpaid, never on a decision", () => {
    const store = everyDayStore()
    const sent: Message[] = []
    const stop = startMessages(
      store,
      (message) => sent.push(message),
      () => 0.5,
    )
    store.getState().decide({ kind: 'ownerWeeklyPay', pay: cents(0) })
    expect(sent).toEqual([])

    while (sent.length === 0 && store.getState().game.day < 400) {
      store.getState().advance(1)
      setEnergy(store, RESTED)
    }
    const [message] = sent
    expect(message?.kind).toBe('landlord')
    expect(message?.from).toBe('Votre propriétaire')
    expect(MESSAGES.landlord.lines).toContain(message?.text)
    expect(toCalendar(message!.day).dayOfMonth).toBe(1)
    expect(store.getState().game.personal.unpaidRents).toEqual([message!.day])

    stop()
    store.getState().advance(40)
    expect(sent).toHaveLength(1)
  })
})
