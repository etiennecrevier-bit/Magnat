import { describe, expect, it } from 'vitest'
import type { GrocerId } from '../content/schema.ts'
import { createInitialState, tick, toCalendar } from '../engine/clock.ts'
import { GROCERS, startContract } from '../engine/contracts.ts'
import { ENERGY, EVENTS } from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { cents } from '../engine/money.ts'
import type { Day, GameState } from '../engine/types.ts'
import { entriesOf } from '../finance/journal.ts'
import {
  MAX_MESSAGES,
  MESSAGES,
  NO_MEMORY,
  contractTriggers,
  pickLine,
  received,
  staffTriggers,
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
    expect(memory).toEqual({ ...NO_MEMORY, exhaustedWeek: 0 })
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
      triggersBetween(before, morning(10, EXHAUSTED, [0, 10]), NO_MEMORY)
        .triggers,
    ).toEqual([])
    expect(
      triggersBetween(before, morning(3, EXHAUSTED, [0, 1]), NO_MEMORY),
    ).toEqual({ triggers: [], memory: NO_MEMORY })
  })

  it('calls for the owner the morning after a decision leaves them exhausted', () => {
    // Day 9: an event's choice takes the tired owner below exhausted.
    const decided = triggersBetween(
      morning(9, TIRED),
      morning(9, EXHAUSTED),
      NO_MEMORY,
    )
    expect(decided.triggers).toEqual([])
    expect(
      triggersBetween(
        morning(9, EXHAUSTED),
        morning(10, EXHAUSTED),
        decided.memory,
      ),
    ).toEqual({
      triggers: [{ kind: 'exhausted', day: 10 }],
      memory: { ...NO_MEMORY, exhaustedWeek: 1 },
    })
    // Another game, going back in time, does not carry the decision.
    expect(
      triggersBetween(
        morning(9, EXHAUSTED),
        morning(3, EXHAUSTED),
        decided.memory,
      ).memory,
    ).toEqual(NO_MEMORY)
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

/**
 * A game store whose truck opens every day, from day 1 on, with no event
 * card to stop the days.
 */
function everyDayStore(): GameStore {
  const store = createGameStore(START, NO_EVENTS)
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

  it("sends the owner's line the morning after an event's choice leaves them exhausted", () => {
    // Day 15, a Tuesday, open, on the formulaire card: the owner is tired,
    // and « Contester » costs 10 energy before the day is played.
    const store = createGameStore(
      {
        ...START,
        day: 15,
        energy: ENERGY.exhausted.below + 3,
        events: {
          ...START.events,
          pending: { event: 'formulaire14B', followUp: false },
        },
      },
      EVENTS,
    )
    const sent: Message[] = []
    const stop = startMessages(
      store,
      (message) => sent.push(message),
      () => 0,
    )

    store.getState().chooseEvent('contester')
    expect(store.getState().game.energy).toBeLessThan(ENERGY.exhausted.below)
    store.getState().closePanel()
    store.getState().advance(1)

    // Day 16: the owner wakes up exhausted, the first time this week.
    expect(store.getState().game.day).toBe(16)
    expect(store.getState().game.energy).toBeLessThan(ENERGY.exhausted.below)
    const { from, lines } = MESSAGES.exhausted
    expect(sent).toEqual([
      { id: 0, kind: 'exhausted', from, text: lines[0], day: 16 },
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

/** `state` with a contract signed that morning with `grocer`. */
function signed(state: GameState, grocer: GrocerId): GameState {
  return {
    ...state,
    contracts: startContract(state.contracts, state.day, grocer),
  }
}

/** `state` played to the morning of `day`, the owner away on `away`. */
function playedTo(
  state: GameState,
  day: Day,
  away: (day: Day) => boolean = () => false,
): GameState {
  let game = state
  while (game.day < day) game = tick({ ...game, ownerAway: away(game.day) })
  return game
}

const NORMAND = 'Normand, Épicerie Chez Normand'
const MONDAYS_AWAY = (day: Day) => toCalendar(day).weekday === 1

describe('contractTriggers', () => {
  it("calls for the grocer's message, by name, for each delivery missed", () => {
    const before = playedTo(signed(START, 'chezNormand'), 7)
    const after = playedTo(before, 15, MONDAYS_AWAY)
    expect(after.contracts.missed.map(({ day }) => day)).toEqual([7, 14])
    expect(contractTriggers(before, after)).toEqual([
      { kind: 'missedDelivery', day: 7, from: NORMAND },
      { kind: 'missedDelivery', day: 14, from: NORMAND },
    ])
    // The days after call for nothing new.
    expect(contractTriggers(after, playedTo(after, 16))).toEqual([])
  })

  it('calls once for the miss that ends the contract: its contractBroken alone', () => {
    const before = playedTo(signed(START, 'chezNormand'), 1)
    const after = playedTo(before, 7 * GROCERS.maxStrikes + 1, MONDAYS_AWAY)
    expect(after.contracts.running).toEqual([])
    const triggers = contractTriggers(before, after)
    expect(triggers).toEqual([
      { kind: 'missedDelivery', day: 7, from: NORMAND },
      { kind: 'missedDelivery', day: 14, from: NORMAND },
      { kind: 'contractBroken', day: 21, from: NORMAND },
    ])
    expect(
      triggers.filter(({ kind }) => kind === 'contractBroken'),
    ).toHaveLength(1)
  })

  it('counts the strikes the contract already had', () => {
    const before = playedTo(signed(START, 'chezNormand'), 15, MONDAYS_AWAY)
    expect(before.contracts.running[0]?.strikes).toBe(2)
    expect(
      contractTriggers(before, playedTo(before, 22, MONDAYS_AWAY)),
    ).toEqual([{ kind: 'contractBroken', day: 21, from: NORMAND }])
  })

  it('calls for contractEnded on the day of the last delivery', () => {
    const start = signed(START, 'depanneur2424')
    const before = playedTo(start, 1)
    const after = playedTo(before, 7 * GROCERS.grocers.depanneur2424.weeks + 2)
    expect(after.contracts.running).toEqual([])
    expect(contractTriggers(before, after)).toEqual([
      { kind: 'contractEnded', day: 56, from: 'M. Kim, Dépanneur 24/24' },
    ])
  })

  it('calls for the miss and the end when the last week is missed', () => {
    const start = signed(START, 'chezNormand')
    const lastWeek = {
      ...start,
      contracts: {
        ...start.contracts,
        running: start.contracts.running.map((contract) => ({
          ...contract,
          weeksLeft: 1,
        })),
      },
    }
    const before = playedTo(lastWeek, 1)
    const after = playedTo(before, 8, MONDAYS_AWAY)
    expect(contractTriggers(before, after)).toEqual([
      { kind: 'missedDelivery', day: 7, from: NORMAND },
      { kind: 'contractEnded', day: 7, from: NORMAND },
    ])
  })
})

describe('staffTriggers', () => {
  it("calls for the employee's message, by name, the morning they start and the morning they leave", () => {
    const store = createGameStore(START, NO_EVENTS)
    store
      .getState()
      .decide({ kind: 'hire', role: 'livreur', candidate: 'kevin' })
    const before = store.getState().game
    store.getState().advance(3)
    store.getState().decide({ kind: 'fire', candidate: 'kevin' })
    store.getState().advance(2)
    expect(staffTriggers(before, store.getState().game)).toEqual([
      { kind: 'hired', day: 1, from: 'Kevin Bouchard' },
      { kind: 'fired', day: 4, from: 'Kevin Bouchard' },
    ])
  })
})

describe("the employees' own words (#255)", () => {
  /**
   * Kevin hired as deliverer at the role's start, below what he asks, from
   * day 1: he warns on the morning of day 57 and quits on day 64.
   */
  function underpaid() {
    const store = createGameStore(START, NO_EVENTS)
    store
      .getState()
      .decide({ kind: 'hire', role: 'livreur', candidate: 'kevin' })
    const sent: Message[] = []
    const stop = startMessages(
      store,
      (message) => sent.push(message),
      () => 0,
    )
    return { store, sent, stop }
  }

  const WARNING = {
    kind: 'underpaid',
    from: 'Kevin Bouchard',
    text: MESSAGES.underpaid.kevin,
    day: 57,
  }
  const GOODBYE = {
    kind: 'quit',
    from: 'Kevin Bouchard',
    text: MESSAGES.quit.kevin,
    day: 64,
  }

  it('sends his warning a week before he quits, then his goodbye, once each, day by day', () => {
    const { store, sent, stop } = underpaid()
    for (let day = 0; day < 70; day += 1) store.getState().advance(1)
    expect(sent.filter(({ kind }) => kind !== 'hired')).toEqual([
      { id: 1, ...WARNING },
      { id: 2, ...GOODBYE },
    ])
    expect(store.getState().game.staff).toEqual([])
    stop()
  })

  it('sends both when one advance goes through the two mornings', () => {
    const { store, sent, stop } = underpaid()
    store.getState().advance(50)
    store.getState().advance(20)
    expect(sent.map(({ kind, day }) => [kind, day])).toEqual([
      ['hired', 1],
      ['underpaid', 57],
      ['quit', 64],
    ])
    stop()
  })

  it('sends both when one advance goes from his first morning past his last', () => {
    // The code review's case: the staff before the advance does not hold
    // him yet, and the staff after it no longer does.
    const { store, sent, stop } = underpaid()
    store.getState().advance(70)
    expect(store.getState().game.day).toBe(70)
    expect(store.getState().game.staff).toEqual([])
    expect(sent.filter(({ kind }) => kind !== 'hired')).toEqual([
      { id: 1, ...WARNING },
      { id: 2, ...GOODBYE },
    ])
    stop()
  })

  it('sends the same words however the 70 days are cut into advances', () => {
    const heard = (chunks: readonly number[]) => {
      const { store, sent, stop } = underpaid()
      for (const days of chunks) store.getState().advance(days)
      stop()
      expect(store.getState().game.day).toBe(70)
      return sent.map(({ kind, day, from, text }) => [kind, day, from, text])
    }
    const dayByDay = heard(Array.from({ length: 70 }, () => 1))
    expect(dayByDay.map(([kind]) => kind)).toEqual([
      'hired',
      'underpaid',
      'quit',
    ])
    for (const chunks of [
      [70],
      [7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
      [56, 1, 13],
      [57, 7, 6],
      [63, 7],
    ]) {
      expect(heard(chunks)).toEqual(dayByDay)
    }
  })

  it('hears nothing more once stopped', () => {
    const { store, sent, stop } = underpaid()
    store.getState().advance(2)
    stop()
    store.getState().advance(68)
    expect(sent.map(({ kind }) => kind)).toEqual(['hired'])
  })

  it('sends no goodbye once he is raised to what he asks in the warning week', () => {
    const { store, sent, stop } = underpaid()
    store.getState().advance(58)
    store
      .getState()
      .decide({ kind: 'setWage', candidate: 'kevin', hourlyWage: cents(1650) })
    store.getState().advance(12)
    expect(sent.map(({ kind }) => kind)).toEqual(['hired', 'underpaid'])
    expect(store.getState().game.staff).toHaveLength(1)
    stop()
  })
})

describe('startMessages for the grocers and the employees', () => {
  it('sends who left and who came back in one stretch of days, both', () => {
    // The plan review's case: Amélie leaves on day 3 and starts again on
    // day 4, all in one advance(), so the staff before and after both hold
    // her.
    const store = createGameStore(START, NO_EVENTS)
    const { decide } = store.getState()
    decide({ kind: 'hire', role: 'camion', candidate: 'amelie' })
    store.getState().advance(2)
    store.getState().decide({ kind: 'fire', candidate: 'amelie' })
    store.getState().advance(1)
    store
      .getState()
      .decide({ kind: 'hire', role: 'camion', candidate: 'amelie' })
    const sent: Message[] = []
    const stop = startMessages(
      store,
      (message) => sent.push(message),
      () => 0,
    )
    const day3 = store.getState().game
    store.getState().advance(2)
    const day5 = store.getState().game
    expect(day3.staff.map(({ candidate }) => candidate)).toEqual(['amelie'])
    expect(day5.staff.map(({ candidate }) => candidate)).toEqual(['amelie'])
    expect(sent).toEqual([
      {
        id: 0,
        kind: 'fired',
        from: 'Amélie Gagnon',
        text: MESSAGES.fired.lines[0],
        day: 3,
      },
      {
        id: 1,
        kind: 'hired',
        from: 'Amélie Gagnon',
        text: MESSAGES.hired.lines[0],
        day: 4,
      },
    ])
    stop()
  })

  it('sends nothing when a hire is cancelled before they start', () => {
    const store = createGameStore(START, NO_EVENTS)
    const sent: Message[] = []
    const stop = startMessages(store, (message) => sent.push(message))
    store
      .getState()
      .decide({ kind: 'hire', role: 'camion', candidate: 'amelie' })
    store.getState().decide({ kind: 'fire', candidate: 'amelie' })
    store.getState().advance(3)
    expect(sent).toEqual([])
    expect(
      entriesOf(store.getState().game.journal).filter(({ memo }) =>
        memo.includes('Amélie'),
      ),
    ).toEqual([])
    stop()
  })

  it("sends a grocer's missed delivery, signed by the grocer", () => {
    const store = createGameStore(
      playedTo(signed(START, 'chezNormand'), 7),
      NO_EVENTS,
    )
    store.setState({ game: { ...store.getState().game, ownerAway: true } })
    const sent: Message[] = []
    const stop = startMessages(
      store,
      (message) => sent.push(message),
      () => 0.5,
    )
    store.getState().advance(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      kind: 'missedDelivery',
      from: NORMAND,
      day: 7,
    })
    expect(MESSAGES.missedDelivery.lines).toContain(sent[0]?.text)
    stop()
  })
})
