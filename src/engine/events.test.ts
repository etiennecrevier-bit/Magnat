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
import type { GameState } from './types.ts'

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
      [card('a'), card('suite', { conditions: { followUpOnly: true } })],
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
      const state = { ...on(10), events: followUps([8, 'a'], [10, 'suite']) }
      const first = drawEvent(state, events)
      expect(first.events.pending?.event).toBe('a')
      const chosen = resolveEvent(first, 'non', events)
      expect(drawEvent(chosen, events)).toBe(chosen)
      const second = play(chosen, events)
      expect(second.day).toBe(11)
      expect(second.events.pending).toEqual({ event: 'suite', followUp: true })
      expect(second.events.followUps).toEqual([])
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
      events: EVENTS.events.map((event) => ({ ...event, weight: 1 })),
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
