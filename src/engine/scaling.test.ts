import { describe, expect, it } from 'vitest'
import {
  loadEventContent,
  textParts,
  type DifficultyId,
  type EventCard,
  type EventChoice,
  type EventScaling,
  type TimedEventEffect,
} from '../content/schema.ts'
import { entriesOf } from '../finance/journal.ts'
import { createInitialState, tick } from './clock.ts'
import { EVENTS, FOOD_TRUCK } from './day.ts'
import { startOfDay, whenDue } from './effects.ts'
import { resolveEvent } from './events.ts'
import { cents } from './money.ts'
import { defaultProfile } from './profile.ts'
import { next } from './rng.ts'
import {
  cardText,
  choiceTags,
  effectsAt,
  scaledEffect,
  type TagAmount,
  type TextScope,
} from './scaling.ts'
import type { GameState } from './types.ts'

// What each difficulty does to the effects of the cards, and the tags that
// tell the player so (#137).

const DIFFICULTY_IDS: readonly DifficultyId[] = ['facile', 'moyen', 'difficile']

const SCALING: EventScaling = {
  lowestFactor: 0.1,
  difficulties: {
    facile: { gains: 1, losses: 0.7 },
    moyen: { gains: 1.3, losses: 1.3 },
    difficile: { gains: 0.7, losses: 1.2 },
  },
}

/** `effect` as `difficulty` plays it with `SCALING`. */
function at(difficulty: DifficultyId, effect: TimedEventEffect) {
  return scaledEffect(effect, difficulty, SCALING)
}

describe('scaledEffect', () => {
  const charge: TimedEventEffect = {
    kind: 'charge',
    amountCents: cents(15_000),
    description: 'Amende',
    inDays: 1,
  }
  const sale: TimedEventEffect = {
    kind: 'cashSale',
    amountCents: cents(67_500),
    description: 'Commande',
  }

  it('multiplies a charge by the losses and a sale by the gains', () => {
    expect(at('moyen', charge)).toEqual({ ...charge, amountCents: 19_500 })
    expect(at('facile', charge)).toEqual({ ...charge, amountCents: 10_500 })
    expect(at('difficile', sale)).toEqual({ ...sale, amountCents: 47_250 })
    expect(
      at('moyen', {
        kind: 'creditSale',
        amountCents: cents(75_000),
        client: 'Gilles Lacasse',
        dueInDays: 60,
      }),
    ).toEqual({
      kind: 'creditSale',
      amountCents: 97_500,
      client: 'Gilles Lacasse',
      dueInDays: 60,
    })
  })

  it('rounds money half away from zero to the cent, and never to 0', () => {
    const odd: TimedEventEffect = { ...charge, amountCents: cents(1_005) }
    // 1 005 × 0.7 = 703.5 on paper.
    expect(at('facile', odd)).toMatchObject({ amountCents: 704 })
    const cent: TimedEventEffect = { ...charge, amountCents: cents(1) }
    expect(
      scaledEffect(cent, 'facile', {
        ...SCALING,
        difficulties: {
          ...SCALING.difficulties,
          facile: { gains: 1, losses: 0.4 },
        },
      }),
    ).toMatchObject({ amountCents: 1 })
  })

  it('scales the owner’s energy and cash by their direction', () => {
    expect(at('difficile', { kind: 'energy', amount: 20 })).toEqual({
      kind: 'energy',
      amount: 14,
    })
    expect(at('difficile', { kind: 'energy', amount: -10 })).toEqual({
      kind: 'energy',
      amount: -12,
    })
    expect(at('moyen', { kind: 'energy', amount: -90 })).toEqual({
      kind: 'energy',
      amount: -100,
    })
    const gift = { kind: 'personal', label: 'Merci' } as const
    expect(at('moyen', { ...gift, amountCents: cents(6_000) })).toEqual({
      ...gift,
      amountCents: 7_800,
    })
    expect(at('facile', { ...gift, amountCents: cents(-100_000) })).toEqual({
      ...gift,
      amountCents: -70_000,
    })
  })

  it('rounds energy to the whole point, half away from zero, and never to 0', () => {
    const energy = (amount: number): TimedEventEffect => ({
      kind: 'energy',
      amount,
    })
    expect(at('facile', energy(-5))).toEqual(energy(-4))
    expect(at('difficile', energy(5))).toEqual(energy(4))
    expect(at('moyen', energy(-5))).toEqual(energy(-7))
    expect(at('facile', energy(-1))).toEqual(energy(-1))
    expect(at('difficile', energy(15))).toEqual(energy(11))
  })

  it('scales a change to the street by its distance from 1, never below the lowest factor', () => {
    const walkIns = (factor: number): TimedEventEffect => ({
      kind: 'walkIns',
      factor,
      days: 7,
    })
    expect(at('moyen', walkIns(0.65))).toMatchObject({ factor: 0.545 })
    expect(at('difficile', walkIns(1.2))).toMatchObject({ factor: 1.14 })
    expect(at('moyen', walkIns(1.8))).toMatchObject({ factor: 2.04 })
    expect(at('moyen', walkIns(0.2))).toMatchObject({ factor: 0.1 })
    expect(at('moyen', walkIns(1))).toEqual(walkIns(1))
    for (const effect of [walkIns(0.65), walkIns(1.2)]) {
      expect(at('moyen', effect)).toMatchObject({ days: 7 })
    }
  })

  it('multiplies what shares sell for by the gains, but not the share sold (#159)', () => {
    const shares: TimedEventEffect = {
      kind: 'shareSale',
      investor: 'Duvent Capital',
      amountCents: cents(2_000_000),
      share: 0.2,
    }
    expect(at('moyen', shares)).toEqual({ ...shares, amountCents: 2_600_000 })
    expect(at('difficile', shares)).toEqual({
      ...shares,
      amountCents: 1_400_000,
    })
  })

  it('keeps stock, durations, chances, receivable terms and an emergency loan as written', () => {
    const kept: TimedEventEffect[] = [
      {
        kind: 'emergencyLoan',
        lender: 'Caisse populaire Saint-Prudent',
        monthsOfFixedCosts: 1,
        maxCents: cents(1_500_000),
        annualRateBasisPoints: 1800,
        termMonths: 12,
        feeShare: 0.02,
      },
      { kind: 'buyStock', product: 'croissant', units: 400 },
      { kind: 'useStock', product: 'croissant', units: 6, to: 'giveaway' },
      { kind: 'delayReceivable', client: 'Gilles Lacasse', days: 30 },
      { kind: 'followUp', event: 'essai', days: 30, chance: 0.5 },
      { kind: 'closed', days: 3, onNextWeekday: 5 },
      { kind: 'unavailable', product: 'cafe', days: 4 },
    ]
    for (const difficulty of DIFFICULTY_IDS) {
      for (const effect of kept) expect(at(difficulty, effect)).toBe(effect)
    }
  })

  it('changes nothing without a scaling', () => {
    expect(scaledEffect(charge, 'moyen', undefined)).toBe(charge)
  })
})

describe('effectsAt', () => {
  it('leaves out the effects of other difficulties, and scales the others', () => {
    const effects: TimedEventEffect[] = [
      { kind: 'energy', amount: -5, difficulties: ['difficile'] },
      { kind: 'energy', amount: -10, difficulties: ['facile', 'moyen'] },
      { kind: 'headline', id: 'essai' },
    ]
    const scaling = { scaling: SCALING }
    expect(effectsAt(effects, 'difficile', scaling)).toEqual([
      { kind: 'energy', amount: -6, difficulties: ['difficile'] },
      { kind: 'headline', id: 'essai' },
    ])
    expect(effectsAt(effects, 'moyen', scaling)).toEqual([
      { kind: 'energy', amount: -13, difficulties: ['facile', 'moyen'] },
      { kind: 'headline', id: 'essai' },
    ])
  })
})

describe('choiceTags', () => {
  const [card] = loadEventContent({
    pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
    events: [
      {
        id: 'carte',
        weight: 1,
        character: { id: 'gilles', name: 'Gilles Lacasse', role: 'Traiteur' },
        title: 'Une carte',
        situation: 'Il se passe quelque chose.',
        choices: [
          {
            id: 'oui',
            label: 'Oui',
            tags: [
              { text: 'Ventes +{montant}', effect: 'vente' },
              { text: 'Clients −{montant}', effect: 'clients' },
              { text: 'Plus tard', effect: 'clients' },
              'Risqué',
            ],
            outcomes: [
              {
                chance: 0.5,
                result: 'Oui.',
                effects: [
                  {
                    kind: 'cashSale',
                    amountCents: 20_000,
                    description: 'Vente',
                    name: 'vente',
                  },
                  {
                    kind: 'creditSale',
                    amountCents: 75_000,
                    client: 'Client',
                    dueInDays: 30,
                    name: 'vente',
                  },
                ],
              },
              {
                chance: 0.5,
                result: 'Non.',
                effects: [
                  {
                    kind: 'walkIns',
                    factor: 0.9,
                    days: 7,
                    name: 'clients',
                    difficulties: ['difficile'],
                  },
                ],
              },
            ],
          },
          {
            id: 'non',
            label: 'Non',
            tags: [
              { text: 'Rien ne change', difficulties: ['facile', 'moyen'] },
              { text: 'Énergie −{montant}', effect: 'energie' },
            ],
            outcomes: [
              {
                chance: 1,
                result: 'Non.',
                effects: [
                  {
                    kind: 'energy',
                    amount: -5,
                    difficulties: ['difficile'],
                    name: 'energie',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }).events
  const content = { scaling: SCALING }
  const [oui, non] = card?.choices ?? []

  it('sums the effects a tag names, in the first outcome that holds one', () => {
    expect(choiceTags(oui as EventChoice, 'moyen', content)).toEqual([
      { text: 'Ventes +{montant}', amount: { unit: 'money', cents: 123_500 } },
      { text: 'Risqué', amount: null },
    ])
  })

  it('shows a tag only where its effect applies, or at its difficulties', () => {
    const tags = (choice: EventChoice | undefined, level: DifficultyId) =>
      choiceTags(choice as EventChoice, level, content)
    expect(tags(oui, 'difficile').map(({ text }) => text)).toEqual([
      'Ventes +{montant}',
      'Clients −{montant}',
      'Plus tard',
      'Risqué',
    ])
    expect(tags(oui, 'difficile')[1]?.amount?.unit).toBe('percent')
    expect(tags(non, 'facile')).toEqual([
      { text: 'Rien ne change', amount: null },
    ])
    expect(tags(non, 'difficile')).toEqual([
      { text: 'Énergie −{montant}', amount: { unit: 'energy', points: 6 } },
    ])
  })
})

describe('the tags of the financing cards (#159)', () => {
  const tagsOf = (event: string, difficulty: DifficultyId) => {
    const choice = EVENTS.events
      .find(({ id }) => id === event)
      ?.choices.find(({ id }) => id === 'accepter')
    return choiceTags(choice as EventChoice, difficulty, EVENTS)
  }

  it.each(DIFFICULTY_IDS)(
    'shows the most the emergency loan lends, unscaled, at %s',
    (difficulty) => {
      expect(tagsOf('pretUrgence', difficulty)).toContainEqual({
        text: "Prêt d'au plus {montant}",
        amount: { unit: 'money', cents: 1_500_000 },
      })
    },
  )

  it.each([
    ['facile', 2_000_000],
    ['moyen', 2_200_000],
    ['difficile', 1_700_000],
  ] as const)(
    'shows what the shares sell for at %s: %i',
    (difficulty, price) => {
      expect(tagsOf('offreDuvent', difficulty)[0]).toEqual({
        text: 'Encaisse +{montant}',
        amount: { unit: 'money', cents: price },
      })
    },
  )
})

describe('cardText', () => {
  const [card] = loadEventContent({
    pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
    events: [
      {
        id: 'carte',
        weight: 1,
        character: { id: 'gilles', name: 'Gilles Lacasse', role: 'Traiteur' },
        title: 'Une carte',
        situation: 'Mettez {montant:mise}, revoyez {montant:retour}.',
        quote: 'Pas de montant ici.',
        choices: [
          {
            id: 'miser',
            label: 'Miser {montant:mise}',
            tags: ['Risqué'],
            outcomes: [
              {
                chance: 0.5,
                result: 'Perdu {montant:mise}.',
                effects: [
                  {
                    kind: 'personal',
                    amountCents: -100_000,
                    label: 'Mise',
                    name: 'mise',
                  },
                ],
              },
              {
                chance: 0.5,
                result:
                  'Gagné {montant:retour}, en {montant:fatigue} de fatigue.',
                effects: [
                  {
                    kind: 'personal',
                    amountCents: -100_000,
                    label: 'Mise',
                    name: 'mise',
                  },
                  {
                    kind: 'personal',
                    amountCents: 150_000,
                    label: 'Retour',
                    inDays: 90,
                    name: 'retour',
                    difficulties: ['facile', 'moyen'],
                  },
                  {
                    kind: 'personal',
                    amountCents: 200_000,
                    label: 'Retour',
                    inDays: 90,
                    name: 'retour',
                    difficulties: ['difficile'],
                  },
                  { kind: 'energy', amount: -5, name: 'fatigue' },
                ],
              },
            ],
          },
          {
            id: 'non',
            label: 'Non',
            tags: ['Rien ne change'],
            outcomes: [{ chance: 1, result: 'Non.', effects: [] }],
          },
        ],
      },
    ],
  }).events as [EventCard]
  const content = { scaling: SCALING }
  const [miser] = card.choices as [EventChoice]
  const [lost, won] = miser.outcomes

  it('cuts the text into its words and the amounts it shows, scaled', () => {
    expect(cardText(card.situation, card, 'moyen', content)).toEqual([
      'Mettez ',
      { unit: 'money', cents: 130_000 },
      ', revoyez ',
      { unit: 'money', cents: 195_000 },
      '.',
    ])
    expect(cardText(card.quote ?? '', card, 'moyen', content)).toEqual([
      'Pas de montant ici.',
    ])
  })

  it('reads the event’s choices, the choice’s outcomes or the outcome’s own effects, at the game’s difficulty', () => {
    expect(cardText(card.situation, card, 'difficile', content)[3]).toEqual({
      unit: 'money',
      cents: 140_000,
    })
    expect(cardText(miser.label, miser, 'facile', content)).toEqual([
      'Miser ',
      { unit: 'money', cents: 70_000 },
    ])
    if (lost === undefined || won === undefined) throw new Error('No outcome')
    expect(cardText(won.result, won, 'facile', content)).toEqual([
      'Gagné ',
      { unit: 'money', cents: 150_000 },
      ', en ',
      { unit: 'energy', points: 4 },
      ' de fatigue.',
    ])
    expect(() => cardText(won.result, lost, 'facile', content)).toThrow(
      RangeError,
    )
  })

  it('is the text as written without amounts, or as written with no scaling', () => {
    expect(cardText('Sans montant.', card, 'facile', content)).toEqual([
      'Sans montant.',
    ])
    expect(cardText(miser.label, miser, 'moyen', {})[1]).toEqual({
      unit: 'money',
      cents: 100_000,
    })
  })
})

describe('every tag of every card tells the amount played', () => {
  // A morning with the owner's energy halfway, so that no energy effect is
  // held at 0 or 100.
  const HALF_ENERGY = 50

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

  /**
   * The morning of day 1 at `difficulty`, the player choosing `choice` of
   * `event`, which turns out as its outcome `index`, then every effect it
   * queued played on its day.
   */
  function played(
    difficulty: DifficultyId,
    event: string,
    choice: EventChoice,
    index: number,
  ): { morning: GameState; after: GameState } {
    const start = tick(
      createInitialState(42, FOOD_TRUCK, { ...defaultProfile(), difficulty }),
    )
    const morning: GameState = {
      ...start,
      energy: HALF_ENERGY,
      rngState:
        choice.outcomes.length > 1 ? drawing(choice, index) : start.rngState,
      events: { ...start.events, pending: { event, followUp: false } },
    }
    let after = resolveEvent(morning, choice.id, EVENTS)
    const lastDay = Math.max(
      after.day,
      ...after.events.delayed.map(({ day }) => day),
    )
    for (let day = after.day + 1; day <= lastDay; day += 1) {
      after = startOfDay({ ...after, day }, FOOD_TRUCK)
    }
    return { morning, after }
  }

  /** What the entries of `memo` moved in all. */
  function moved(state: GameState, memo: string): number {
    return entriesOf(state.journal)
      .filter((entry) => entry.memo === memo)
      .flatMap(({ lines }) => lines)
      .reduce((sum, { debit }) => sum + debit, 0)
  }

  /**
   * The size of what `effect`, of a choice made on `day`, did between
   * `morning` and `after`, as a tag shows it.
   */
  function sizeOf(
    effect: TimedEventEffect,
    day: number,
    morning: GameState,
    after: GameState,
  ): number {
    switch (effect.kind) {
      case 'charge':
      case 'cashSale':
        return moved(after, effect.description)
      case 'creditSale':
        return moved(after, `Vente à crédit · ${effect.client}`)
      case 'shareSale':
        return moved(after, `Émission d'actions · ${effect.investor}`)
      case 'emergencyLoan':
        // The tag shows the most the loan lends, whatever it lends that
        // morning: financing.test.ts holds the loan to it.
        return effect.maxCents
      case 'personal':
        return Math.abs(
          after.personal.movements
            .filter(({ label }) => label === effect.label)
            .reduce((sum, { amount }) => sum + amount, 0),
        )
      case 'energy':
        return Math.abs(after.energy - morning.energy)
      case 'walkIns':
      case 'appeal':
      case 'willingness': {
        const fromDay = whenDue(effect, day)
        const modifier = after.events.modifiers.find(
          ({ change, fromDay: from, lastDay }) =>
            change.kind === effect.kind &&
            from === fromDay &&
            lastDay === fromDay + effect.days - 1 &&
            ('segment' in change ? change.segment : undefined) ===
              ('segment' in effect ? effect.segment : undefined) &&
            ('product' in change ? change.product : undefined) ===
              ('product' in effect ? effect.product : undefined),
        )
        if (modifier === undefined || !('factor' in modifier.change)) {
          throw new Error(`No ${effect.kind} from day ${fromDay}`)
        }
        return Math.abs(modifier.change.factor - 1) * 100
      }
      default:
        throw new Error(`A tag shows no amount of ${effect.kind}`)
    }
  }

  function sizeOfTag(amount: TagAmount): number {
    switch (amount.unit) {
      case 'money':
        return amount.cents
      case 'energy':
        return amount.points
      case 'percent':
        return amount.percent
    }
  }

  const CASES = EVENTS.events.flatMap(({ id, choices }) =>
    choices.flatMap((choice) =>
      DIFFICULTY_IDS.flatMap((difficulty) =>
        choice.outcomes.map(
          (_, outcome) => [id, choice.id, difficulty, outcome] as const,
        ),
      ),
    ),
  )

  it.each(CASES)(
    '%s, %s, at %s, outcome %i',
    (event, choiceId, difficulty, index) => {
      const choice = EVENTS.events
        .find(({ id }) => id === event)
        ?.choices.find(({ id }) => id === choiceId)
      if (choice === undefined) throw new Error(`No ${event}, ${choiceId}`)
      const { morning, after } = played(difficulty, event, choice, index)
      const applied = (choice.outcomes[index]?.effects ?? []).filter(
        ({ difficulties }) =>
          difficulties === undefined || difficulties.includes(difficulty),
      )
      const shown = choiceTags(choice, difficulty, EVENTS)
      for (const tag of choice.tags) {
        if (typeof tag === 'string' || tag.effect === undefined) continue
        const named = applied.filter(({ name }) => name === tag.effect)
        const amount = shown.find(({ text }) => text === tag.text)?.amount
        if (named.length === 0 || amount === null || amount === undefined) {
          continue
        }
        if (named.some(({ kind }) => kind === 'energy')) {
          // The energy measured is all the outcome's, so the tag names it all.
          expect(
            applied.filter(({ kind }) => kind === 'energy'),
            tag.text,
          ).toEqual(named)
        }
        const size = named.reduce(
          (total, effect) =>
            total + sizeOf(effect, morning.day, morning, after),
          0,
        )
        expect(sizeOfTag(amount), tag.text).toBeCloseTo(size, 9)
      }
    },
  )

  /**
   * Whether the effects named `name` that `cardText` reads in `outcomes` at
   * `difficulty` are those of `played`: the first outcome holding one that
   * applies there.
   */
  function readsFrom(
    outcomes: readonly { readonly effects: readonly TimedEventEffect[] }[],
    played: { readonly effects: readonly TimedEventEffect[] } | undefined,
    name: string,
    difficulty: DifficultyId,
  ): boolean {
    return (
      outcomes.find(({ effects }) =>
        effects.some(
          (effect) =>
            effect.name === name &&
            (effect.difficulties === undefined ||
              effect.difficulties.includes(difficulty)),
        ),
      ) === played
    )
  }

  it.each(CASES)(
    'tells in its text the amounts played: %s, %s, at %s, outcome %i',
    (event, choiceId, difficulty, index) => {
      const card = EVENTS.events.find(({ id }) => id === event)
      const choice = card?.choices.find(({ id }) => id === choiceId)
      const outcome = choice?.outcomes[index]
      if (card === undefined || choice === undefined || outcome === undefined) {
        throw new Error(`No ${event}, ${choiceId}, ${index}`)
      }
      const everyOutcome = card.choices.flatMap(({ outcomes }) => outcomes)
      type Written = readonly [
        text: string,
        scope: TextScope,
        outcomes: readonly { effects: readonly TimedEventEffect[] }[],
      ]
      const texts: Written[] = [
        [card.situation, card, everyOutcome],
        ...(card.quote === undefined
          ? []
          : [[card.quote, card, everyOutcome] satisfies Written]),
        [choice.label, choice, choice.outcomes],
        [outcome.result, outcome, [outcome]],
      ]
      const { morning, after } = played(difficulty, event, choice, index)
      for (const [text, scope, outcomes] of texts) {
        const pieces = cardText(text, scope, difficulty, EVENTS)
        textParts(text).forEach((part, at) => {
          if (typeof part === 'string') return
          if (!readsFrom(outcomes, outcome, part.amountOf, difficulty)) return
          const named = outcome.effects.filter(
            ({ name, difficulties }) =>
              name === part.amountOf &&
              (difficulties === undefined || difficulties.includes(difficulty)),
          )
          const piece = pieces[at]
          if (piece === undefined || typeof piece === 'string') {
            throw new Error(`No amount for ${part.amountOf} in « ${text} »`)
          }
          const size = named.reduce(
            (total, effect) =>
              total + sizeOf(effect, morning.day, morning, after),
            0,
          )
          expect(sizeOfTag(piece), text).toBeCloseTo(size, 9)
        })
      }
    },
  )

  it.each(DIFFICULTY_IDS)(
    'shows every tag naming an effect exactly where it applies, at %s',
    (difficulty) => {
      for (const { id, choices } of EVENTS.events) {
        for (const choice of choices) {
          const shown = choiceTags(choice, difficulty, EVENTS).map(
            ({ text }) => text,
          )
          for (const tag of choice.tags) {
            if (typeof tag === 'string') continue
            const applies =
              (tag.difficulties === undefined ||
                tag.difficulties.includes(difficulty)) &&
              (tag.effect === undefined ||
                choice.outcomes.some(({ effects }) =>
                  effects.some(
                    ({ name, difficulties }) =>
                      name === tag.effect &&
                      (difficulties === undefined ||
                        difficulties.includes(difficulty)),
                  ),
                ))
            expect(shown.includes(tag.text), `${id}, ${choice.id}`).toBe(
              applies,
            )
          }
          expect(shown.length, `${id}, ${choice.id}`).toBeGreaterThan(0)
        }
      }
    },
  )
})
