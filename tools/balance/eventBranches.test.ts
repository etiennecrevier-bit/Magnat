import { describe, expect, it } from 'vitest'
import {
  loadEventContent,
  type EventContent,
} from '../../src/content/schema.ts'
import { EVENTS } from '../../src/engine/day.ts'
import { NO_EVENTS } from '../../src/engine/events.ts'
import { cents } from '../../src/engine/money.ts'
import { isRngState } from '../../src/engine/rng.ts'
import type { GameState } from '../../src/engine/types.ts'
import { journalHash, playMorning, startGame } from '../sim/simulate.ts'
import {
  branchEvent,
  choiceVerdicts,
  dayStream,
  eventTarget,
  outcomeStream,
  playWindow,
  streamOf,
  WINDOW_DAYS,
  type EventSample,
} from './eventBranches.ts'

// The eight weeks each choice plays against the same morning with no card:
// what a choice changes and nothing else, the window's edges, the
// follow-ups it brings, and how often a choice is best.

const SEED = 42

/** A card whose choices each have `outcomes`, all with no text to speak of. */
function card(
  id: string,
  choices: Record<string, readonly (readonly unknown[])[]>,
  more: Record<string, unknown> = {},
) {
  return {
    id,
    weight: 1,
    character: { id: 'essai', name: 'Thérèse Essai', role: 'Vérificatrice' },
    title: 'Une carte',
    situation: 'Une situation.',
    ...more,
    choices: Object.entries(choices).map(([choice, outcomes]) => ({
      id: choice,
      label: choice,
      tags: ['Risqué'],
      outcomes: outcomes.map((effects) => ({
        chance: 1 / outcomes.length,
        result: 'Un résultat.',
        effects,
      })),
    })),
  }
}

function contentOf(...events: unknown[]): EventContent {
  return loadEventContent({
    pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
    events,
  })
}

function charge(amountCents: number, more: Record<string, unknown> = {}) {
  return { kind: 'charge', amountCents, description: 'Frais', ...more }
}

/** Seed 42 at Moyen, 20 days played with no card, then `event` waiting. */
function morningWith(event: string): GameState {
  let state = startGame(SEED, 'moyen')
  for (let day = 0; day < 20; day += 1) {
    state = playMorning(state, NO_EVENTS, null)
  }
  return {
    ...state,
    events: { ...state.events, pending: { event, followUp: false } },
  }
}

function results({ choices }: EventSample) {
  return Object.fromEntries(
    choices.map(({ choice, cash, netIncome }) => [choice, { cash, netIncome }]),
  )
}

describe('the streams', () => {
  it('are generator states, the same for the same values', () => {
    for (const stream of [
      streamOf(),
      streamOf(1, 2, 3),
      dayStream(SEED, 20),
      outcomeStream(SEED, 20, 1),
    ]) {
      expect(isRngState(stream)).toBe(true)
    }
    expect(dayStream(SEED, 20)).toBe(dayStream(SEED, 20))
    expect(outcomeStream(SEED, 20, 1)).toBe(outcomeStream(SEED, 20, 1))
  })

  it('differ for nearby values, and between the kinds of stream', () => {
    const streams = [
      dayStream(SEED, 20),
      dayStream(SEED, 21),
      dayStream(SEED + 1, 20),
      outcomeStream(SEED, 20, 0),
      outcomeStream(SEED, 20, 1),
      outcomeStream(SEED, 21, 0),
      streamOf(SEED, 20),
      streamOf(20, SEED),
    ]
    expect(new Set(streams).size).toBe(streams.length)
  })
})

describe('playWindow', () => {
  it('plays the same days whatever generator the morning starts with', () => {
    const morning = morningWith('essai')
    const free = { ...morning, events: { ...morning.events, pending: null } }
    const one = playWindow({ ...free, rngState: 1 }, SEED)
    const other = playWindow({ ...free, rngState: 2 }, SEED)
    expect(one.day).toBe(morning.day + WINDOW_DAYS)
    expect(journalHash(one.journal)).toBe(journalHash(other.journal))
  })

  it('brings the follow-ups queued, answered, and no new card', () => {
    const content = contentOf(
      card('appel', {
        rappeler: [[{ kind: 'followUp', event: 'rappel', days: 10 }]],
        ignorer: [[]],
      }),
      card(
        'rappel',
        { payer: [[charge(50_000)]], payerAussi: [[charge(50_000)]] },
        { conditions: { followUpOnly: true } },
      ),
      card('intrus', {
        subir: [[charge(1_000_000)]],
        subirAussi: [[charge(1_000_000)]],
      }),
    )
    const morning = morningWith('appel')
    const answered = playWindow(
      {
        ...morning,
        events: {
          ...morning.events,
          pending: null,
          followUps: [{ day: morning.day + 10, event: 'rappel' }],
        },
      },
      SEED,
      content,
    )
    expect(answered.events.history).toMatchObject([
      { day: morning.day + 10, event: 'rappel', followUp: true },
    ])
    expect(answered.events.pending).toBeNull()
  })
})

describe('branchEvent', () => {
  it('measures nothing for a choice that changes nothing, and the charge alone for a charge', () => {
    const payer = EVENTS.events
      .find(({ id }) => id === 'formulaire14B')
      ?.choices.find(({ id }) => id === 'payer')
    const fine = payer?.outcomes[0]?.effects[0]
    if (fine?.kind !== 'charge') throw new Error('No fine to pay')
    expect(
      results(branchEvent(morningWith('formulaire14B'), SEED)).payer,
    ).toEqual({ cash: -fine.amountCents, netIncome: -fine.amountCents })
    expect(
      results(branchEvent(morningWith('grosseCommande'), SEED)).refuser,
    ).toEqual({ cash: 0, netIncome: 0 })
  })

  it('counts an effect on the window’s last day and none after it', () => {
    const content = contentOf(
      card('fenetre', {
        dernierJour: [[charge(10_000, { inDays: WINDOW_DAYS - 1 })]],
        lendemain: [[charge(10_000, { inDays: WINDOW_DAYS })]],
        rien: [[]],
      }),
    )
    const sample = branchEvent(morningWith('fenetre'), SEED, content)
    expect(sample).toMatchObject({ event: 'fenetre', day: 20 })
    expect(results(sample)).toEqual({
      dernierJour: { cash: -10_000, netIncome: -10_000 },
      lendemain: { cash: 0, netIncome: 0 },
      rien: { cash: 0, netIncome: 0 },
    })
  })

  it('plays the same business days whatever outcome a choice drew', () => {
    const content = contentOf(
      card('hasard', { pile: [[], []], trois: [[], [], []], une: [[]] }),
    )
    expect(results(branchEvent(morningWith('hasard'), SEED, content))).toEqual({
      pile: { cash: 0, netIncome: 0 },
      trois: { cash: 0, netIncome: 0 },
      une: { cash: 0, netIncome: 0 },
    })
  })

  it('answers the follow-up a choice queues within the window', () => {
    const content = contentOf(
      card('appel', {
        rappeler: [[{ kind: 'followUp', event: 'rappel', days: 10 }]],
        ignorer: [[]],
      }),
      card(
        'rappel',
        { payer: [[charge(50_000)]], payerAussi: [[charge(50_000)]] },
        { conditions: { followUpOnly: true } },
      ),
    )
    expect(results(branchEvent(morningWith('appel'), SEED, content))).toEqual({
      rappeler: { cash: -50_000, netIncome: -50_000 },
      ignorer: { cash: 0, netIncome: 0 },
    })
  })

  it('draws each choice’s outcome from its own stream', () => {
    const morning = morningWith('grosseCommande')
    expect(branchEvent(morning, SEED)).toEqual(branchEvent(morning, SEED))
    expect(branchEvent({ ...morning, rngState: 7 }, SEED)).toEqual(
      branchEvent(morning, SEED),
    )
  })

  it('throws when no card waits, or the content does not hold it', () => {
    const morning = morningWith('inconnu')
    expect(() =>
      branchEvent(
        { ...morning, events: { ...morning.events, pending: null } },
        SEED,
      ),
    ).toThrow('No event waits on day 20')
    expect(() => branchEvent(morning, SEED)).toThrow('Unknown event: inconnu')
  })
})

/** One game of a card with choices a, b and c, each measured so. */
function sample(
  cash: readonly [number, number, number],
  netIncome: readonly [number, number, number] = cash,
): EventSample {
  return {
    event: 'carte',
    day: 0,
    choices: (['a', 'b', 'c'] as const).map((choice, index) => ({
      choice,
      cash: cents(cash[index] ?? 0),
      netIncome: cents(netIncome[index] ?? 0),
    })),
  }
}

describe('choiceVerdicts', () => {
  it('counts a choice best on a measure when no other did strictly better, ties included', () => {
    const verdicts = choiceVerdicts([
      sample([10, 10, 0]),
      sample([0, 5, 5], [9, 1, 1]),
      sample([-1, -3, -2], [-1, -2, -3]),
      sample([1, 2, 3], [3, 2, 1]),
    ])
    expect(verdicts).toEqual([
      {
        choice: 'a',
        games: 4,
        medianCash: 1,
        medianNetIncome: 6,
        bestOnCash: 2,
        bestOnNetIncome: 4,
        bestOnBoth: 2,
        bestOnNeither: 0,
      },
      {
        choice: 'b',
        games: 4,
        medianCash: 4,
        medianNetIncome: 2,
        bestOnCash: 2,
        bestOnNetIncome: 1,
        bestOnBoth: 1,
        bestOnNeither: 2,
      },
      {
        choice: 'c',
        games: 4,
        medianCash: 2,
        medianNetIncome: 1,
        bestOnCash: 2,
        bestOnNetIncome: 0,
        bestOnBoth: 0,
        bestOnNeither: 2,
      },
    ])
  })

  it('gives nothing for no games, and throws when the games disagree on the choices', () => {
    expect(choiceVerdicts([])).toEqual([])
    const other = { ...sample([0, 0, 0]) }
    const renamed = {
      ...other,
      choices: other.choices.map((result, index) =>
        index === 1 ? { ...result, choice: 'z' } : result,
      ),
    }
    expect(() => choiceVerdicts([sample([0, 0, 0]), renamed])).toThrow(
      RangeError,
    )
  })
})

describe('eventTarget', () => {
  /** `games` games where a wins both in `wins`, and b and c tie otherwise. */
  function games(count: number, wins: number): EventSample[] {
    return Array.from({ length: count }, (_, index) =>
      index < wins ? sample([1, 0, 0]) : sample([0, 1, 1]),
    )
  }

  it('lets a choice be best on both in 80 % of the games, not more', () => {
    expect(eventTarget('carte', choiceVerdicts(games(10, 8))).met).toBe(true)
    const check = eventTarget('carte', choiceVerdicts(games(10, 9)))
    expect(check.met).toBe(false)
    expect(check.tooStrong.map(({ choice }) => choice)).toEqual(['a'])
    // b and c are best on neither in 9 games of 10: more than 85 %.
    expect(check.tooWeak.map(({ choice }) => choice)).toEqual(['b', 'c'])
  })

  it('lets a choice be best on neither in 85 % of the games, not more', () => {
    const at = choiceVerdicts(games(20, 17)).map((verdict) =>
      verdict.choice === 'a' ? { ...verdict, bestOnBoth: 0 } : verdict,
    )
    expect(eventTarget('carte', at)).toMatchObject({ met: true, games: 20 })
    const over = choiceVerdicts(games(20, 18)).map((verdict) =>
      verdict.choice === 'a' ? { ...verdict, bestOnBoth: 0 } : verdict,
    )
    expect(eventTarget('carte', over).tooWeak).toHaveLength(2)
  })

  it('judges nothing for a card that never came up', () => {
    expect(eventTarget('carte', [])).toEqual({
      event: 'carte',
      games: 0,
      met: null,
      tooStrong: [],
      tooWeak: [],
    })
  })
})
