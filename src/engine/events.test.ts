import { describe, expect, it } from 'vitest'
import { loadEventContent, type EventContent } from '../content/schema.ts'
import { balance } from '../finance/journal.ts'
import { createInitialState, tick, toCalendar } from './clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
  playDay,
} from './day.ts'
import { applyDecision, latestDecisions } from './decisions.ts'
import { nightRest } from './energy.ts'
import {
  NO_EVENTS,
  conditionsHold,
  drawEvent,
  noEvents,
  resolveEvent,
} from './events.ts'
import { next } from './rng.ts'
import { serialize } from './save.ts'
import { newTruck } from './trucks.ts'
import type { GameState, StreetModifier, TruckDecisions } from './types.ts'

// Drawing the morning's event card, and playing the player's choice.

// Day 1, a Tuesday the shipped truck opens, with no event.
const MORNING = tick(createInitialState(42))

/** Every morning a draw may come, with the chance of 1 unless given. */
const EVERY_DAY = { firstDay: 0, minDaysBetween: 0, dailyChance: 1 }

/**
 * An event `id` the player answers « Oui », which costs 5 energy, or
 * « Non », which does nothing; `extra` adds or replaces fields.
 */
function card(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    weight: 1,
    character: { id: 'gilles', name: 'Gilles Lacasse', role: 'Traiteur' },
    title: 'Une carte',
    situation: 'Il se passe quelque chose.',
    choices: [
      {
        id: 'oui',
        label: 'Oui',
        tags: ['Énergie −5'],
        outcomes: [
          {
            chance: 1,
            result: 'Fait.',
            effects: [{ kind: 'energy', amount: -5 }],
          },
        ],
      },
      {
        id: 'non',
        label: 'Non',
        tags: ['Rien ne change'],
        outcomes: [{ chance: 1, result: 'Rien.', effects: [] }],
      },
    ],
    ...extra,
  }
}

/** The Vieux-Montréal's truck, the second one (#260). */
const SECOND = 'vieuxMontreal'

/**
 * `state` with the Vieux-Montréal's truck too, run as the first one, but as
 * `own` changes it (#262).
 */
function withSecond(
  state: GameState,
  own: Partial<TruckDecisions> = {},
): GameState {
  const { prices, restock, daysOpen } = state.decisions
  const first = { prices, restock, daysOpen }
  return {
    ...state,
    trucks: [newTruck(state.seed, { id: SECOND, district: SECOND }, 0)],
    decisions: {
      ...state.decisions,
      trucks: { [SECOND]: { ...first, ...own } },
    },
  }
}

function content(
  events: readonly unknown[],
  pacing: Record<string, number> = EVERY_DAY,
): EventContent {
  return loadEventContent({ pacing, events })
}

function play(state: GameState, events: EventContent): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    events,
  )
}

/** `MORNING` moved to `day`, keeping everything else. */
function on(day: number, state: GameState = MORNING): GameState {
  return { ...state, day }
}

/** Whether `events` draws one on the morning of `state`. */
function draws(state: GameState, events: EventContent): string | null {
  return drawEvent(state, events).events.pending?.event ?? null
}

describe('noEvents', () => {
  it('is a game with no event yet', () => {
    expect(noEvents()).toEqual({
      pending: null,
      delayed: [],
      followUps: [],
      history: [],
      lastDrawnDay: null,
      headlines: [],
      modifiers: [],
    })
    expect(MORNING.events).toEqual(noEvents())
  })
})

describe('tick', () => {
  it('draws no event by default, nor with NO_EVENTS', () => {
    expect(NO_EVENTS.events).toEqual([])
    let state = createInitialState(7)
    for (let day = 0; day < 60; day += 1) {
      const played = playDay(state)
      state = tick(state)
      expect(state).toEqual({
        ...played,
        day: day + 1,
        decisions: latestDecisions(played),
        pendingDecisions: null,
        energy: nightRest(played.energy, ENERGY),
      })
      expect(state.events).toEqual(noEvents())
    }
  })

  it('draws the next morning from the events it is given', () => {
    const one = content([card('grosseCommande')])
    const next = play(createInitialState(42), one)
    expect(next.day).toBe(1)
    expect(next.events.pending).toEqual({
      event: 'grosseCommande',
      followUp: false,
    })
    expect(next.events.lastDrawnDay).toBe(1)
  })

  it('throws while an event waits, then plays normally once it is chosen', () => {
    const one = content([card('grosseCommande')])
    const waiting = play(createInitialState(42), one)
    expect(() => play(waiting, one)).toThrow(
      'Day 1 cannot be played: the event grosseCommande is waiting for a choice',
    )
    expect(() => tick(waiting)).toThrow('is waiting for a choice')
    expect(() => playDay(waiting)).toThrow('is waiting for a choice')
    const chosen = resolveEvent(waiting, 'non', one)
    const next = play(chosen, one)
    expect(next.day).toBe(2)
    // « Non » changed nothing but the events: the day plays as it would
    // have with none.
    const without = tick(MORNING)
    expect(next.journal).toEqual(without.journal)
    expect(next.lastDay).toEqual(without.lastDay)
  })
})

describe('drawEvent', () => {
  describe('pacing', () => {
    it('draws nothing before firstDay', () => {
      const events = content([card('a')], { ...EVERY_DAY, firstDay: 7 })
      expect(draws(on(6), events)).toBeNull()
      expect(draws(on(7), events)).toBe('a')
    })

    it('leaves minDaysBetween days from the last drawn', () => {
      const events = content([card('a')], { ...EVERY_DAY, minDaysBetween: 5 })
      const drawnOn = (day: number) => ({
        ...MORNING.events,
        lastDrawnDay: day,
      })
      expect(draws({ ...on(14), events: drawnOn(10) }, events)).toBeNull()
      expect(draws({ ...on(15), events: drawnOn(10) }, events)).toBe('a')
      expect(draws({ ...on(15), events: drawnOn(15) }, events)).toBeNull()
    })

    it('draws once against the daily chance', () => {
      const [value, after] = next(MORNING.rngState)
      const at = (dailyChance: number) =>
        drawEvent(MORNING, content([card('a')], { ...EVERY_DAY, dailyChance }))
      const missed = at(value)
      expect(missed.events.pending).toBeNull()
      expect(missed.events.lastDrawnDay).toBeNull()
      expect(missed.rngState).toBe(after)
      const hit = at(value + 0.001)
      expect(hit.events.pending?.event).toBe('a')
      expect(hit.rngState).toBe(after)
    })

    it('does not draw at a chance of 1 with a single event, nor at a chance of 0', () => {
      const one = drawEvent(MORNING, content([card('a')]))
      expect(one.events.pending?.event).toBe('a')
      expect(one.rngState).toBe(MORNING.rngState)
      const never = content([card('a')], { ...EVERY_DAY, dailyChance: 0 })
      expect(drawEvent(MORNING, never)).toBe(MORNING)
    })

    it('does not draw when no event may come', () => {
      const none = content([
        card('zero', { weight: 0 }),
        card('suite', { conditions: { followUpOnly: true } }),
        card('plusTard', { conditions: { fromDay: 100 } }),
      ])
      expect(drawEvent(MORNING, none)).toBe(MORNING)
      expect(drawEvent(MORNING, EVENTS)).toBe(MORNING)
    })

    it('never draws a card only the tutorial brings, even with a weight above 0 (#236)', () => {
      const loaded = content([card('tuto', { weight: 0, tutorialOnly: true })])
      // The schema holds such a card to a weight of 0; the draw does not rely on it.
      const weighed: EventContent = {
        ...loaded,
        events: loaded.events.map((event) => ({ ...event, weight: 5 })),
      }
      expect(drawEvent(MORNING, weighed)).toBe(MORNING)
      const withOther = content([
        card('tuto', { weight: 0, tutorialOnly: true }),
        card('a'),
      ])
      expect(draws(MORNING, withOther)).toBe('a')
    })

    it('picks among the events that may come by weight, with one more draw', () => {
      const events = content([
        card('lourd', { weight: 3 }),
        card('zero', { weight: 0 }),
        card('leger', { weight: 1 }),
      ])
      const counts = new Map<string, number>()
      for (let seed = 0; seed < 4000; seed += 1) {
        const state = { ...MORNING, rngState: seed * 7919 }
        const drawn = drawEvent(state, events)
        const id = drawn.events.pending?.event ?? 'none'
        counts.set(id, (counts.get(id) ?? 0) + 1)
        expect(drawn.rngState).toBe(next(state.rngState)[1])
      }
      expect(counts.get('zero')).toBeUndefined()
      expect(counts.get('none')).toBeUndefined()
      const heavy = (counts.get('lourd') ?? 0) / 4000
      expect(heavy).toBeGreaterThan(0.72)
      expect(heavy).toBeLessThan(0.78)
    })

    it('changes nothing while an event already waits, or once one was chosen that morning', () => {
      const waiting = drawEvent(MORNING, content([card('a')]))
      expect(drawEvent(waiting, content([card('b')]))).toBe(waiting)
      const chosen = resolveEvent(waiting, 'non', content([card('a')]))
      expect(drawEvent(chosen, content([card('b')]))).toBe(chosen)
      expect(draws(on(2, chosen), content([card('b')]))).toBe('b')
    })
  })

  describe('follow-ups', () => {
    const followUps = (...queue: [number, string][]) => ({
      ...MORNING.events,
      lastDrawnDay: 9,
      followUps: queue.map(([day, event]) => ({ day, event })),
    })
    const events = content(
      [
        card('a'),
        card('b'),
        card('suite', { conditions: { followUpOnly: true } }),
      ],
      { firstDay: 50, minDaysBetween: 5, dailyChance: 0.5 },
    )

    it('come up on their day, before any draw, whatever the pacing and conditions', () => {
      const state = { ...on(10), events: followUps([10, 'suite']) }
      const drawn = drawEvent(state, events)
      expect(drawn.events.pending).toEqual({ event: 'suite', followUp: true })
      expect(drawn.events.followUps).toEqual([])
      expect(drawn.events.lastDrawnDay).toBe(9)
      expect(drawn.rngState).toBe(state.rngState)
    })

    it('wait for their day', () => {
      const state = { ...on(9), events: followUps([10, 'suite']) }
      expect(drawEvent(state, events)).toBe(state)
    })

    it('come up one a morning, the next one waiting', () => {
      const state = { ...on(10), events: followUps([8, 'a'], [10, 'b']) }
      const first = drawEvent(state, events)
      expect(first.events.pending?.event).toBe('a')
      const chosen = resolveEvent(first, 'non', events)
      expect(drawEvent(chosen, events)).toBe(chosen)
      const second = play(chosen, events)
      expect(second.day).toBe(11)
      expect(second.events.pending).toEqual({ event: 'b', followUp: true })
      expect(second.events.followUps).toEqual([])
    })

    it('of a card that only comes as a follow-up come first, the rest of a story keeping its day', () => {
      const state = { ...on(10), events: followUps([8, 'a'], [10, 'suite']) }
      const first = drawEvent(state, events)
      expect(first.events.pending).toEqual({ event: 'suite', followUp: true })
      expect(first.events.followUps).toEqual([{ day: 8, event: 'a' }])
      const second = play(resolveEvent(first, 'non', events), events)
      expect(second.events.pending).toEqual({ event: 'a', followUp: true })
    })

    it('stay queued while the content does not hold their event', () => {
      const state = { ...on(10), events: followUps([10, 'ailleurs']) }
      expect(draws(state, events)).toBeNull()
      expect(drawEvent(state, events).events.followUps).toHaveLength(1)
    })

    it('are never drawn by themselves', () => {
      const only = content([
        card('suite', { conditions: { followUpOnly: true } }),
      ])
      expect(draws(MORNING, only)).toBeNull()
    })
  })

  describe('an event dated that day', () => {
    // Day 60 is Friday, June 30, and the shipped truck opens on Saturdays.
    const JUNE_30 = { date: { month: 6, dayOfMonth: 30 } }
    const PACING = { firstDay: 10, minDaysBetween: 30, dailyChance: 0.5 }
    /** The morning of `day`, the last event drawn on `lastDrawnDay`. */
    const at = (day: number, lastDrawnDay: number | null = 55): GameState => ({
      ...on(day),
      events: { ...MORNING.events, lastDrawnDay },
    })
    const history = (...records: [number, string, boolean][]) =>
      records.map(([day, event, followUp]) => ({
        day,
        event,
        followUp,
        choice: 'non',
        outcome: 0,
      }))

    it('comes up on its day inside the gap, with no draw, and sets the gap from it', () => {
      const events = content([card('juin', { conditions: JUNE_30 })], PACING)
      expect(toCalendar(60)).toMatchObject({ month: 6, dayOfMonth: 30 })
      const state = at(60)
      const drawn = drawEvent(state, events)
      expect(drawn.events.pending).toEqual({ event: 'juin', followUp: false })
      expect(drawn.events.lastDrawnDay).toBe(60)
      expect(drawn.rngState).toBe(state.rngState)
      expect(draws(at(59), events)).toBeNull()
      expect(draws(at(61, 60), events)).toBeNull()
    })

    it('comes up before a draw of the others', () => {
      const events = content(
        [card('a', { weight: 9 }), card('juin', { conditions: JUNE_30 })],
        { ...PACING, minDaysBetween: 0 },
      )
      for (let seed = 0; seed < 50; seed += 1) {
        const state = { ...at(60), rngState: seed * 7919 }
        const drawn = drawEvent(state, events)
        expect(drawn.events.pending?.event).toBe('juin')
        expect(drawn.rngState).toBe(state.rngState)
      }
    })

    it('picks by weight among several, with one draw', () => {
      const events = content(
        [
          card('lourd', { weight: 3, conditions: JUNE_30 }),
          card('a', { weight: 100 }),
          card('leger', { weight: 1, conditions: JUNE_30 }),
        ],
        PACING,
      )
      const counts = new Map<string, number>()
      for (let seed = 0; seed < 4000; seed += 1) {
        const state = { ...at(60), rngState: seed * 7919 }
        const drawn = drawEvent(state, events)
        const id = drawn.events.pending?.event ?? 'none'
        counts.set(id, (counts.get(id) ?? 0) + 1)
        expect(drawn.rngState).toBe(next(state.rngState)[1])
      }
      expect([...counts.keys()].sort()).toEqual(['leger', 'lourd'])
      const heavy = (counts.get('lourd') ?? 0) / 4000
      expect(heavy).toBeGreaterThan(0.72)
      expect(heavy).toBeLessThan(0.78)
    })

    it('comes up before a follow-up of a card that may be drawn, which waits a morning', () => {
      const events = content(
        [card('a'), card('juin', { conditions: JUNE_30 })],
        PACING,
      )
      const state = {
        ...at(60),
        events: { ...at(60).events, followUps: [{ day: 60, event: 'a' }] },
      }
      const first = drawEvent(state, events)
      expect(first.events.pending).toEqual({ event: 'juin', followUp: false })
      expect(first.events.followUps).toEqual([{ day: 60, event: 'a' }])
      const second = play(resolveEvent(first, 'non', events), events)
      expect(second.day).toBe(61)
      expect(second.events.pending).toEqual({ event: 'a', followUp: true })
      expect(second.events.lastDrawnDay).toBe(60)
    })

    it('waits behind a follow-up of a card that only comes as one, and is gone the next morning', () => {
      const events = content(
        [
          card('suite', { conditions: { followUpOnly: true } }),
          card('juin', { conditions: JUNE_30 }),
        ],
        PACING,
      )
      const state = {
        ...at(60),
        events: { ...at(60).events, followUps: [{ day: 60, event: 'suite' }] },
      }
      const first = drawEvent(state, events)
      expect(first.events.pending).toEqual({ event: 'suite', followUp: true })
      const second = play(resolveEvent(first, 'non', events), events)
      expect(second.events.pending).toBeNull()
    })

    it('keeps its other conditions: once per game, the cooldown, tomorrow open', () => {
      const dated = (conditions: Record<string, unknown>) =>
        content([card('juin', { conditions: { ...JUNE_30, ...conditions } })], {
          ...PACING,
          minDaysBetween: 0,
        })
      const lastYear = (state: GameState): GameState => ({
        ...state,
        events: { ...state.events, history: history([60, 'juin', false]) },
      })
      const nextYear = at(60 + 365)
      expect(draws(nextYear, dated({ oncePerGame: true }))).toBe('juin')
      expect(draws(lastYear(nextYear), dated({ oncePerGame: true }))).toBeNull()
      expect(draws(lastYear(nextYear), dated({ cooldownDays: 365 }))).toBe(
        'juin',
      )
      expect(draws(lastYear(nextYear), dated({ cooldownDays: 366 }))).toBeNull()
      expect(draws(at(60), dated({ openTomorrow: false }))).toBeNull()
      expect(draws(at(60), dated({ weekdays: [1] }))).toBeNull()
    })

    it('falls back on the gap and the chance when its conditions do not hold', () => {
      const events = content(
        [card('a'), card('juin', { conditions: { ...JUNE_30, fromDay: 100 } })],
        { ...PACING, minDaysBetween: 0, dailyChance: 1 },
      )
      expect(draws(at(60), events)).toBe('a')
      expect(draws(at(60), { ...events, pacing: PACING })).toBeNull()
    })

    it('never comes before firstDay, nor at a chance of 0', () => {
      const events = content([card('juin', { conditions: JUNE_30 })], PACING)
      expect(
        draws(at(60), { ...events, pacing: { ...PACING, firstDay: 61 } }),
      ).toBeNull()
      expect(
        draws(at(60), { ...events, pacing: { ...PACING, dailyChance: 0 } }),
      ).toBeNull()
    })
  })

  describe('conditions', () => {
    // Day 1 is Tuesday, May 2nd; day 60 is Friday, June 30.
    it.each<[string, Record<string, unknown>, GameState, boolean]>([
      ['fromDay', { fromDay: 2 }, on(1), false],
      ['fromDay', { fromDay: 2 }, on(2), true],
      [
        'difficulties',
        { difficulties: ['facile', 'difficile'] },
        MORNING,
        false,
      ],
      ['difficulties', { difficulties: ['moyen'] }, MORNING, true],
      ['months', { months: [6, 7, 8] }, on(1), false],
      ['months', { months: [6, 7, 8] }, on(31), true],
      ['date', { date: { month: 6, dayOfMonth: 30 } }, on(59), false],
      ['date', { date: { month: 6, dayOfMonth: 30 } }, on(60), true],
      ['date', { date: { month: 6, dayOfMonth: 30 } }, on(60 + 365), true],
      ['weekdays', { weekdays: [1, 3] }, on(1), false],
      ['weekdays', { weekdays: [1, 3] }, on(2), true],
      ['energyBelow', { energyBelow: 60 }, { ...MORNING, energy: 60 }, false],
      ['energyBelow', { energyBelow: 60 }, { ...MORNING, energy: 59.5 }, true],
    ])('%s %j', (_, conditions, state, holds) => {
      expect(toCalendar(60)).toMatchObject({ month: 6, dayOfMonth: 30 })
      const events = content([card('a', { conditions })])
      expect(draws(state, events)).toBe(holds ? 'a' : null)
    })

    it('productOnMenu: a restock rule that buys some', () => {
      const events = content([
        card('a', { conditions: { productOnMenu: 'croissant' } }),
      ])
      expect(draws(MORNING, events)).toBe('a')
      const none = applyDecision(MORNING, {
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity: 0 },
      })
      expect(draws({ ...none, decisions: latestDecisions(none) }, events)).toBe(
        null,
      )
      const drinks = content([
        card('a', { conditions: { productOnMenu: 'chocolat' } }),
      ])
      const noChocolat = applyDecision(MORNING, {
        kind: 'restock',
        product: 'chocolat',
        rule: { kind: 'topUp', whenBelow: 0, upTo: 0 },
      })
      expect(draws(MORNING, drinks)).toBe('a')
      expect(
        draws(
          { ...noChocolat, decisions: latestDecisions(noChocolat) },
          drinks,
        ),
      ).toBeNull()
    })

    it('openTomorrow: the days open and the changes to the street, made or queued', () => {
      const opens = content([card('a', { conditions: { openTomorrow: true } })])
      const closes = content([
        card('a', { conditions: { openTomorrow: false } }),
      ])
      // Day 6 is a Sunday, and the shipped truck is closed on Mondays.
      expect(toCalendar(7).weekday).toBe(1)
      expect(draws(on(5), opens)).toBe('a')
      expect(draws(on(6), opens)).toBeNull()
      expect(draws(on(5), closes)).toBeNull()
      expect(draws(on(6), closes)).toBe('a')
      const everyDay = {
        ...MORNING,
        decisions: { ...MORNING.decisions, daysOpen: [1, 2, 3, 4, 5, 6, 7] },
      }
      expect(draws(on(6, everyDay), opens)).toBe('a')

      // Day 2, a Wednesday: Thursday opens unless a change closes it.
      const street = (events: Partial<GameState['events']>) =>
        on(2, { ...MORNING, events: { ...MORNING.events, ...events } })
      const made = (fromDay: number, lastDay: number) =>
        street({
          modifiers: [
            { event: 'b', change: { kind: 'closed' }, fromDay, lastDay },
          ],
        })
      const queued = (day: number, kind: 'closed' | 'walkIns') =>
        street({
          delayed: [
            {
              day,
              event: 'b',
              effect:
                kind === 'closed'
                  ? { kind, days: 2 }
                  : { kind, factor: 0.5, days: 2 },
            },
          ],
        })
      expect(draws(made(2, 3), opens)).toBeNull()
      expect(draws(made(1, 2), opens)).toBe('a')
      expect(draws(queued(2, 'closed'), opens)).toBeNull()
      expect(draws(queued(3, 'closed'), opens)).toBeNull()
      expect(draws(queued(4, 'closed'), opens)).toBe('a')
      expect(draws(queued(3, 'walkIns'), opens)).toBe('a')
    })

    it('district: a truck works there, stored or not (#262)', () => {
      const at = (district: string) =>
        content([card('a', { conditions: { district } })])
      expect(draws(MORNING, at('plateau'))).toBe('a')
      expect(draws(MORNING, at(SECOND))).toBeNull()
      expect(draws(withSecond(MORNING), at(SECOND))).toBe('a')
      expect(draws(withSecond(MORNING), at('plateau'))).toBe('a')
      const stored = withSecond(MORNING, {
        storage: { from: { month: 1, day: 1 }, to: { month: 12, day: 31 } },
      })
      expect(draws(stored, at(SECOND))).toBe('a')
    })

    it("openTomorrow with a district: that district's truck, its days open, its storage and its own changes to the street, made or queued (#262)", () => {
      const first = content([card('a', { conditions: { openTomorrow: true } })])
      const second = content([
        card('a', { conditions: { openTomorrow: true, district: SECOND } }),
      ])
      const closesSecond = content([
        card('a', { conditions: { openTomorrow: false, district: SECOND } }),
      ])
      // Day 2, a Wednesday: both trucks open Thursday, day 3, May 4.
      expect(toCalendar(3)).toMatchObject({ month: 5, weekday: 4 })
      const both = (
        own: Partial<TruckDecisions> = {},
        events: Partial<GameState['events']> = {},
      ) =>
        on(2, {
          ...withSecond(MORNING, own),
          events: { ...MORNING.events, ...events },
        })
      expect(draws(both(), first)).toBe('a')
      expect(draws(both(), second)).toBe('a')
      expect(draws(both(), closesSecond)).toBeNull()

      // Its own days open and its storage, not the first truck's.
      const noThursday = both({ daysOpen: [1, 2, 3, 5, 6, 7] })
      expect(draws(noThursday, second)).toBeNull()
      expect(draws(noThursday, closesSecond)).toBe('a')
      expect(draws(noThursday, first)).toBe('a')
      const inMay = both({
        storage: { from: { month: 5, day: 1 }, to: { month: 5, day: 31 } },
      })
      expect(draws(inMay, second)).toBeNull()
      expect(draws(inMay, first)).toBe('a')

      // A change made for one truck's district closes that truck only; one
      // made for none, or for the Plateau, closes the first truck.
      const made = (district?: 'plateau' | typeof SECOND) => {
        const modifier: StreetModifier = {
          event: 'b',
          change: { kind: 'closed' },
          fromDay: 2,
          lastDay: 3,
          ...(district === undefined ? {} : { district }),
        }
        return both({}, { modifiers: [modifier] })
      }
      expect(draws(made(SECOND), second)).toBeNull()
      expect(draws(made(SECOND), first)).toBe('a')
      expect(draws(made(), second)).toBe('a')
      expect(draws(made(), first)).toBeNull()
      expect(draws(made('plateau'), first)).toBeNull()
      expect(draws(made('plateau'), second)).toBe('a')
      const queued = (district?: typeof SECOND) =>
        both(
          {},
          {
            delayed: [
              {
                day: 3,
                event: 'b',
                effect: { kind: 'closed', days: 1 },
                ...(district === undefined ? {} : { district }),
              },
            ],
          },
        )
      expect(draws(queued(SECOND), second)).toBeNull()
      expect(draws(queued(SECOND), first)).toBe('a')
      expect(draws(queued(), second)).toBe('a')
      expect(draws(queued(), first)).toBeNull()
    })

    it('cashAboveCents and cashBelowCents: Encaisse that morning', () => {
      const cash = balance(MORNING.journal, '1000', { toDay: 1 })
      const at = (conditions: Record<string, number>) =>
        draws(MORNING, content([card('a', { conditions })]))
      expect(at({ cashAboveCents: cash - 1 })).toBe('a')
      expect(at({ cashAboveCents: cash })).toBeNull()
      expect(at({ cashBelowCents: cash + 1 })).toBe('a')
      expect(at({ cashBelowCents: cash })).toBeNull()
      expect(at({ cashAboveCents: cash - 1, cashBelowCents: cash + 1 })).toBe(
        'a',
      )
    })

    it('oncePerGame: never again once it came up, even as a follow-up', () => {
      const events = content([card('a', { conditions: { oncePerGame: true } })])
      const seen = (followUp: boolean) => ({
        ...on(400),
        events: {
          ...MORNING.events,
          history: [
            { day: 3, event: 'a', followUp, choice: 'non', outcome: 0 },
          ],
        },
      })
      expect(draws(MORNING, events)).toBe('a')
      expect(draws(seen(false), events)).toBeNull()
      expect(draws(seen(true), events)).toBeNull()
    })

    it('cooldownDays: from the last time it came up', () => {
      const events = content([card('a', { conditions: { cooldownDays: 30 } })])
      const state = (day: number) => ({
        ...on(day),
        events: {
          ...MORNING.events,
          history: [
            { day: 3, event: 'a', followUp: false, choice: 'non', outcome: 0 },
            { day: 10, event: 'b', followUp: false, choice: 'non', outcome: 0 },
            { day: 20, event: 'a', followUp: true, choice: 'non', outcome: 0 },
          ],
        },
      })
      expect(draws(state(49), events)).toBeNull()
      expect(draws(state(50), events)).toBe('a')
    })

    /** `on(day)` with `records` of `[day, event, followUp, choice]`. */
    const after = (
      day: number,
      ...records: [number, string, boolean, string][]
    ): GameState => ({
      ...on(day),
      events: {
        ...MORNING.events,
        history: records.map(([at, event, followUp, choice]) => ({
          day: at,
          event,
          followUp,
          choice,
          outcome: 0,
        })),
      },
    })

    it('maxPerGame: until it came up that many times, follow-ups included', () => {
      const events = content([card('a', { conditions: { maxPerGame: 2 } })])
      expect(draws(after(100), events)).toBe('a')
      expect(draws(after(100, [3, 'a', false, 'non']), events)).toBe('a')
      expect(
        draws(
          after(100, [3, 'a', false, 'non'], [9, 'b', false, 'oui']),
          events,
        ),
      ).toBe('a')
      expect(
        draws(
          after(100, [3, 'a', false, 'non'], [9, 'a', true, 'oui']),
          events,
        ),
      ).toBeNull()
    })

    it('chosen: one of the choices listed was made before, follow-ups included', () => {
      const conditions = {
        chosen: [
          { event: 'b', choice: 'oui' },
          { event: 'c', choice: 'oui' },
        ],
      }
      const events = content([card('a', { conditions }), card('b'), card('c')])
      const [a] = events.events
      if (a === undefined) throw new Error('No event')
      const holds = (state: GameState) => conditionsHold(a, state, new Map())
      expect(holds(after(100))).toBe(false)
      expect(holds(after(100, [9, 'b', false, 'non']))).toBe(false)
      expect(holds(after(100, [9, 'a', false, 'oui']))).toBe(false)
      expect(holds(after(100, [9, 'b', false, 'oui']))).toBe(true)
      expect(holds(after(100, [9, 'c', true, 'oui']))).toBe(true)
    })

    it('notChosen: none of the choices listed was ever made', () => {
      const conditions = { notChosen: [{ event: 'b', choice: 'oui' }] }
      const events = content([card('a', { conditions }), card('b')])
      const [a] = events.events
      if (a === undefined) throw new Error('No event')
      const holds = (state: GameState) => conditionsHold(a, state, new Map())
      expect(holds(after(100))).toBe(true)
      expect(holds(after(100, [9, 'b', false, 'non']))).toBe(true)
      expect(
        holds(after(100, [9, 'b', false, 'non'], [40, 'b', true, 'oui'])),
      ).toBe(false)
    })

    it('all at once', () => {
      const conditions = { months: [5], weekdays: [2], energyBelow: 50 }
      const events = content([card('a', { conditions })])
      expect(draws({ ...MORNING, energy: 40 }, events)).toBe('a')
      expect(draws({ ...MORNING, energy: 50 }, events)).toBeNull()
      expect(draws({ ...on(8), energy: 40 }, events)).toBe('a')
      expect(draws({ ...on(9), energy: 40 }, events)).toBeNull()
    })

    it('are checked by conditionsHold, follow-up only aside', () => {
      const [event] = content([
        card('a', { conditions: { followUpOnly: true } }),
      ]).events
      if (event === undefined) throw new Error('No event')
      expect(conditionsHold(event, MORNING, new Map())).toBe(true)
    })
  })
})

describe('resolveEvent', () => {
  const risky = content([
    card('pari', {
      choices: [
        {
          id: 'risquer',
          label: 'Risquer',
          tags: ['Risqué'],
          outcomes: [
            {
              chance: 0.5,
              result: 'Gagné.',
              effects: [
                { kind: 'cashSale', amountCents: 1_000, description: 'Gain' },
                { kind: 'energy', amount: -5, inDays: 2 },
                { kind: 'headline', id: 'gagne' },
                { kind: 'energy', amount: -10, onNextWeekday: 4 },
              ],
            },
            {
              chance: 0.5,
              result: 'Perdu.',
              effects: [
                { kind: 'charge', amountCents: 1_000, description: 'Perte' },
              ],
            },
          ],
        },
        {
          id: 'passer',
          label: 'Passer',
          tags: ['Rien ne change'],
          outcomes: [{ chance: 1, result: 'Rien.', effects: [] }],
        },
      ],
    }),
  ])
  const waiting = drawEvent(MORNING, risky)

  it('throws when no event waits', () => {
    expect(() => resolveEvent(MORNING, 'risquer', risky)).toThrow(
      'No event is waiting on day 1',
    )
  })

  it('throws on an event the content does not hold, or a choice it does not have', () => {
    expect(() => resolveEvent(waiting, 'risquer', NO_EVENTS)).toThrow(
      new RangeError('Unknown event: pari'),
    )
    expect(() => resolveEvent(waiting, 'tricher', risky)).toThrow(
      new RangeError('The event pari has no choice tricher'),
    )
  })

  it('records the choice and clears the event, with no draw for a single outcome', () => {
    const chosen = resolveEvent(waiting, 'passer', risky)
    expect(chosen.events.pending).toBeNull()
    expect(chosen.events.history).toEqual([
      { day: 1, event: 'pari', followUp: false, choice: 'passer', outcome: 0 },
    ])
    expect(chosen.rngState).toBe(waiting.rngState)
    expect(chosen.journal).toBe(waiting.journal)
  })

  it("keeps a district card's changes to the street, made now or queued, for its district's truck, and those of a card with none for the first truck (#262)", () => {
    const streetCard = (id: string, conditions: Record<string, unknown>) =>
      card(id, {
        conditions,
        choices: [
          {
            id: 'oui',
            label: 'Oui',
            tags: ['Fermé'],
            outcomes: [
              {
                chance: 1,
                result: 'Fait.',
                effects: [
                  { kind: 'walkIns', factor: 0.5, days: 3 },
                  { kind: 'closed', days: 2, inDays: 2 },
                  { kind: 'energy', amount: -5, inDays: 2 },
                ],
              },
            ],
          },
          {
            id: 'non',
            label: 'Non',
            tags: ['Rien ne change'],
            outcomes: [{ chance: 1, result: 'Rien.', effects: [] }],
          },
        ],
      })
    const cards = content([
      streetCard('vieux', { district: SECOND }),
      streetCard('plateau', { fromDay: 1000 }),
    ])
    const morning = withSecond(MORNING)
    const chosen = (event: string) =>
      resolveEvent(
        {
          ...morning,
          events: { ...morning.events, pending: { event, followUp: false } },
        },
        'oui',
        cards,
      )

    const vieux = chosen('vieux')
    expect(vieux.events.modifiers).toEqual([
      {
        event: 'vieux',
        change: { kind: 'walkIns', factor: 0.5 },
        fromDay: 1,
        lastDay: 3,
        district: SECOND,
      },
    ])
    expect(vieux.events.delayed).toEqual([
      {
        day: 3,
        event: 'vieux',
        effect: { kind: 'closed', days: 2 },
        district: SECOND,
      },
      {
        day: 3,
        event: 'vieux',
        effect: { kind: 'energy', amount: -5 },
        district: SECOND,
      },
    ])
    // On day 3, the queued closing starts for the same truck.
    const later = play(play(play(vieux, NO_EVENTS), NO_EVENTS), NO_EVENTS)
    expect(later.day).toBe(4)
    expect(later.events.modifiers).toEqual([
      {
        event: 'vieux',
        change: { kind: 'closed' },
        fromDay: 3,
        lastDay: 4,
        district: SECOND,
      },
    ])

    const plateau = chosen('plateau')
    expect(plateau.events.modifiers[0]).not.toHaveProperty('district')
    expect(plateau.events.delayed[0]).not.toHaveProperty('district')
    expect(
      play(
        play(play(plateau, NO_EVENTS), NO_EVENTS),
        NO_EVENTS,
      ).events.modifiers.some((modifier) => 'district' in modifier),
    ).toBe(false)
  })

  it('draws the outcome by its chance, then applies its effects now or later', () => {
    const [value, after] = next(waiting.rngState)
    const chosen = resolveEvent(waiting, 'risquer', risky)
    expect(chosen.rngState).toBe(after)
    const outcome = value < 0.5 ? 0 : 1
    expect(chosen.events.history[0]?.outcome).toBe(outcome)

    // Both outcomes, whatever this seed drew.
    const won = resolveEvent(
      { ...waiting, rngState: seedWith(0.2) },
      'risquer',
      risky,
    )
    expect(won.events.history[0]?.outcome).toBe(0)
    expect(won.journal.entries.at(-1)?.memo).toBe('Gain')
    expect(won.events.headlines).toEqual([{ day: 1, id: 'gagne' }])
    // Day 1 is a Tuesday: two days later, then Thursday, kept by day.
    expect(won.events.delayed).toEqual([
      { day: 3, event: 'pari', effect: { kind: 'energy', amount: -5 } },
      { day: 3, event: 'pari', effect: { kind: 'energy', amount: -10 } },
    ])
    expect(won.energy).toBe(waiting.energy)

    const lost = resolveEvent(
      { ...waiting, rngState: seedWith(0.8) },
      'risquer',
      risky,
    )
    expect(lost.events.history[0]?.outcome).toBe(1)
    expect(lost.journal.entries.at(-1)?.memo).toBe('Perte')
    expect(lost.events.delayed).toEqual([])
  })

  it('runs what it queued at the start of its day', () => {
    const won = resolveEvent(
      { ...waiting, rngState: seedWith(0.2) },
      'risquer',
      risky,
    )
    const day3 = play(play(won, NO_EVENTS), NO_EVENTS)
    expect(day3.day).toBe(3)
    expect(day3.events.delayed).toHaveLength(2)
    const played = playDay(day3)
    expect(played.events.delayed).toEqual([])
    const without = playDay({
      ...day3,
      events: { ...day3.events, delayed: [] },
    })
    expect(played.lastDay?.energy).toBeLessThan(without.lastDay?.energy ?? 0)
  })

  it('plays the same game from the same seed and the same choices, journal included', () => {
    const essai = {
      pacing: { firstDay: 3, minDaysBetween: 2, dailyChance: 0.5 },
      events: EVENTS.events
        .filter(({ id }) => id === 'essai')
        .map((event) => ({ ...event, weight: 1 })),
    }
    const game = (choices: readonly string[]) => {
      let state = createInitialState(2026)
      let made = 0
      for (let day = 0; day < 200; day += 1) {
        if (state.events.pending !== null) {
          state = resolveEvent(
            state,
            choices[made % choices.length] ?? '',
            essai,
          )
          made += 1
        }
        state = play(state, essai)
      }
      return state
    }
    const choices = ['toutEssayer', 'relancer', 'rienFaire', 'relancer']
    const once = game(choices)
    expect(once.events.history.length).toBeGreaterThan(20)
    expect(serialize(game(choices))).toBe(serialize(once))
    expect(serialize(game(['rienFaire']))).not.toBe(serialize(once))
  })
})

describe('a choice that changes the street', () => {
  // Day 1 is a Tuesday: the construction starts now, the festival two days
  // later, on Thursday, and the truck closes on the next Saturday, day 5.
  const street = content([
    card('chantier', {
      choices: [
        {
          id: 'subir',
          label: 'Subir',
          tags: ['Moins de clients'],
          outcomes: [
            {
              chance: 1,
              result: 'Les cônes sont là.',
              effects: [
                { kind: 'walkIns', factor: 0.65, days: 15 },
                { kind: 'walkIns', factor: 1.8, days: 2, inDays: 2 },
                { kind: 'closed', days: 1, onNextWeekday: 6 },
              ],
            },
          ],
        },
        {
          id: 'passer',
          label: 'Passer',
          tags: ['Rien ne change'],
          outcomes: [{ chance: 1, result: 'Rien.', effects: [] }],
        },
      ],
    }),
  ])
  const chosen = resolveEvent(drawEvent(MORNING, street), 'subir', street)

  it('changes it from the day of the choice, and queues the later ones, with no draw', () => {
    expect(chosen.events.modifiers).toEqual([
      {
        event: 'chantier',
        change: { kind: 'walkIns', factor: 0.65 },
        fromDay: 1,
        lastDay: 15,
      },
    ])
    expect(chosen.events.delayed).toEqual([
      {
        day: 3,
        event: 'chantier',
        effect: { kind: 'walkIns', factor: 1.8, days: 2 },
      },
      { day: 5, event: 'chantier', effect: { kind: 'closed', days: 1 } },
    ])
    expect(chosen.rngState).toBe(drawEvent(MORNING, street).rngState)
    expect(chosen.journal).toBe(MORNING.journal)
  })

  it('starts each queued one at the start of its day, from the same event', () => {
    let state = chosen
    const summaries = []
    for (let day = 1; day <= 6; day += 1) {
      state = play(state, NO_EVENTS)
      summaries.push(state.lastDay)
    }
    const kinds = summaries.map((summary) =>
      summary?.modifiers.map(
        ({ event, change, fromDay, lastDay }) =>
          `${event} ${change.kind} ${fromDay}-${lastDay}`,
      ),
    )
    expect(kinds).toEqual([
      ['chantier walkIns 1-15'],
      ['chantier walkIns 1-15'],
      ['chantier walkIns 1-15', 'chantier walkIns 3-4'],
      ['chantier walkIns 1-15', 'chantier walkIns 3-4'],
      ['chantier walkIns 1-15', 'chantier closed 5-5'],
      ['chantier walkIns 1-15'],
    ])
    expect(state.events.delayed).toEqual([])
    expect(state.events.modifiers).toHaveLength(1)
  })
})

describe('a credit sale whose follow-up comes up the morning it is due', () => {
  // Gilles owes 750 $ in 10 days, and comes back that morning.
  const events = content(
    [
      card('commande', {
        conditions: { oncePerGame: true },
        choices: [
          {
            id: 'accepter',
            label: 'Accepter',
            tags: ['Ventes +750 $'],
            outcomes: [
              {
                chance: 1,
                result: 'Accepté.',
                effects: [
                  {
                    kind: 'creditSale',
                    amountCents: 75_000,
                    client: 'Gilles Lacasse',
                    dueInDays: 10,
                  },
                  { kind: 'followUp', event: 'cheque', days: 10 },
                ],
              },
            ],
          },
          {
            id: 'refuser',
            label: 'Refuser',
            tags: ['Rien ne change'],
            outcomes: [{ chance: 1, result: 'Refusé.', effects: [] }],
          },
        ],
      }),
      card('cheque', {
        conditions: { followUpOnly: true },
        choices: [
          {
            id: 'patienter',
            label: 'Patienter',
            tags: ['Payé plus tard'],
            outcomes: [
              {
                chance: 1,
                result: 'On attend.',
                effects: [
                  {
                    kind: 'delayReceivable',
                    client: 'Gilles Lacasse',
                    days: 30,
                  },
                ],
              },
            ],
          },
          {
            id: 'radier',
            label: 'Radier',
            tags: ['Perdu'],
            outcomes: [
              {
                chance: 1,
                result: 'Perdu.',
                effects: [{ kind: 'writeOff', client: 'Gilles Lacasse' }],
              },
            ],
          },
        ],
      }),
    ],
    { firstDay: 1, minDaysBetween: 0, dailyChance: 1 },
  )

  /** Plays to day `until`, answering the follow-up with `answer`. */
  function game(answer: string, until: number) {
    let state = createInitialState(42)
    while (state.day < until) {
      const pending = state.events.pending?.event
      if (pending === 'commande')
        state = resolveEvent(state, 'accepter', events)
      if (pending === 'cheque') {
        expect(state.receivables[0]?.dueDay).toBe(state.day)
        state = resolveEvent(state, answer, events)
      }
      state = play(state, events)
    }
    return state
  }

  function collections(state: GameState): number[] {
    return state.journal.entries
      .filter(({ memo }) => memo === 'Encaissement · Gilles Lacasse')
      .map(({ day }) => day)
  }

  it('is collected on its new day when the player waits, once', () => {
    const state = game('patienter', 60)
    expect(state.events.history.map(({ event, day }) => [event, day])).toEqual([
      ['commande', 1],
      ['cheque', 11],
    ])
    expect(collections(state)).toEqual([41])
    expect(balance(state.journal, '1100', { toDay: 59 })).toBe(0)
    expect(state.receivables).toEqual([])
  })

  it('is never collected once written off', () => {
    const state = game('radier', 60)
    expect(collections(state)).toEqual([])
    expect(
      state.journal.entries
        .filter(({ memo }) => memo === 'Mauvaise créance · Gilles Lacasse')
        .map(({ day }) => day),
    ).toEqual([11])
    expect(balance(state.journal, '1100', { toDay: 59 })).toBe(0)
  })
})

/** A generator state whose next draw is about `value`. */
function seedWith(value: number): number {
  for (let state = 0; ; state += 1) {
    const [drawn] = next(state)
    if (Math.abs(drawn - value) < 0.05) return state
  }
}
