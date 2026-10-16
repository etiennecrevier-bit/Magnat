import { describe, expect, it } from 'vitest'
import type { DifficultyId, EventChoice } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { EVENTS, FOOD_TRUCK } from '../engine/day.ts'
import { resolveEvent } from '../engine/events.ts'
import { cents } from '../engine/money.ts'
import { defaultProfile } from '../engine/profile.ts'
import { next } from '../engine/rng.ts'
import { choiceTags } from '../engine/scaling.ts'
import type { GameState } from '../engine/types.ts'
import { choiceChanges, formatChangeLine } from './eventChanges.ts'
import { formatCardText, formatChoiceTag, wholeEnergy } from './eventTags.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

describe('formatChoiceTag', () => {
  it('shows a tag with no amount as it is written', () => {
    expect(formatChoiceTag({ text: 'Risqué', amount: null })).toBe('Risqué')
  })

  it('writes money to the dollar, in fr-CA', () => {
    const sale = (amount: number) =>
      formatChoiceTag({
        text: 'Ventes +{montant}',
        amount: { unit: 'money', cents: cents(amount) },
      })
    expect(sale(97_500)).toBe(`Ventes +975${S}$`)
    expect(sale(123_550)).toBe(`Ventes +1${S}236${S}$`)
    expect(sale(4_049)).toBe(`Ventes +40${S}$`)
  })

  it('writes energy in whole points and a percentage whole', () => {
    expect(
      formatChoiceTag({
        text: 'Énergie −{montant}',
        amount: { unit: 'energy', points: 6.5 },
      }),
    ).toBe('Énergie −7')
    expect(
      formatChoiceTag({
        text: 'Clients −{montant} pendant 1 semaine',
        amount: { unit: 'percent', percent: 45.5 },
      }),
    ).toBe(`Clients −46${S}% pendant 1 semaine`)
  })
})

describe('wholeEnergy', () => {
  it('rounds a loss and a gain of the same size to the same size', () => {
    expect(wholeEnergy(-3.5)).toBe(-4)
    expect(wholeEnergy(3.5)).toBe(4)
    expect(wholeEnergy(-6.4)).toBe(-6)
    expect(wholeEnergy(0)).toBe(0)
  })
})

describe('formatCardText', () => {
  it('writes the amounts of a card’s text as the tags write them', () => {
    expect(
      formatCardText([
        'Mettez ',
        { unit: 'money', cents: cents(130_000) },
        ', en ',
        { unit: 'energy', points: 4 },
        ' points.',
      ]),
    ).toBe(`Mettez 1${S}300${S}$, en 4 points.`)
    expect(formatCardText(['Sans montant.'])).toBe('Sans montant.')
  })
})

describe('the energy a tag shows and the energy the choice shows it took', () => {
  // A morning with the owner's energy halfway, so that no energy effect is
  // held at 0 or 100.
  const HALF_ENERGY = 50
  const DIFFICULTIES: readonly DifficultyId[] = ['facile', 'moyen', 'difficile']

  /** A generator state whose next draw picks outcome `index` of `choice`. */
  function drawing(choice: EventChoice, index: number): number {
    const chances = choice.outcomes.map(({ chance }) => chance)
    const from = chances.slice(0, index).reduce((sum, c) => sum + c, 0)
    const to = from + (chances[index] ?? 0)
    // Off the edges, where the float sums could tip either way.
    const margin = 0.01
    for (let state = 0; ; state += 1) {
      const [value] = next(state)
      if (value > from + margin && value < to - margin) return state
    }
  }

  /** The signed points of `text`'s energy, as « Énergie −4 » writes them. */
  function points(text: string): number {
    const match = /Énergie ([−+])(\d+)/.exec(text)
    if (match === null) throw new Error(`No energy in « ${text} »`)
    return (match[1] === '−' ? -1 : 1) * Number(match[2])
  }

  const CASES = EVENTS.events.flatMap(({ id, choices }) =>
    choices.flatMap((choice) =>
      DIFFICULTIES.flatMap((difficulty) =>
        choice.outcomes.map(
          (_, outcome) => [id, choice.id, difficulty, outcome] as const,
        ),
      ),
    ),
  )

  it.each(CASES)(
    'agree for %s, %s, at %s, outcome %i',
    (event, choiceId, difficulty, index) => {
      const choice = EVENTS.events
        .find(({ id }) => id === event)
        ?.choices.find(({ id }) => id === choiceId)
      const outcome = choice?.outcomes[index]
      if (choice === undefined || outcome === undefined) {
        throw new Error(`No ${event}, ${choiceId}, ${index}`)
      }
      const tag = choiceTags(choice, difficulty, EVENTS).find(
        ({ amount }) => amount?.unit === 'energy',
      )
      const plays = outcome.effects.some(
        ({ kind, difficulties }) =>
          kind === 'energy' &&
          (difficulties === undefined || difficulties.includes(difficulty)),
      )
      if (tag === undefined || !plays) return
      const start = tick(
        createInitialState(42, FOOD_TRUCK, { ...defaultProfile(), difficulty }),
      )
      const before: GameState = {
        ...start,
        energy: HALF_ENERGY,
        rngState:
          choice.outcomes.length > 1 ? drawing(choice, index) : start.rngState,
        events: { ...start.events, pending: { event, followUp: false } },
      }
      const after = resolveEvent(before, choice.id, EVENTS)
      const shown = choiceChanges(before, after)
        .filter(({ label }) => label === 'Énergie')
        .map((line) => formatChangeLine(line, before.day))
      expect(shown.length, formatChoiceTag(tag)).toBeGreaterThan(0)
      expect(
        shown.reduce((sum, line) => sum + points(line), 0),
        shown.join(', '),
      ).toBe(points(formatChoiceTag(tag)))
    },
  )
})
