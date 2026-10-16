import { describe, expect, it } from 'vitest'
import {
  loadEventContent,
  type DifficultyId,
  type EventContent,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { entriesOf, postEntry } from '../finance/journal.ts'
import { createInitialState, tick } from './clock.ts'
import { EVENTS, FOOD_TRUCK } from './day.ts'
import { startOfDay } from './effects.ts'
import { drawEvent, resolveEvent } from './events.ts'
import { onHand } from './inventory.ts'
import { cents } from './money.ts'
import { PERCENTILES, percentileOf } from './percentiles.ts'
import { defaultProfile } from './profile.ts'
import { next, seedRng } from './rng.ts'
import type { Day, GameState } from './types.ts'

// The same event card at each difficulty (#137): Facile changes which cards
// come up with the player's standing, Moyen raises the stakes, and
// Difficile gives little and charges for everything.

const DIFFICULTY_IDS: readonly DifficultyId[] = ['facile', 'moyen', 'difficile']
const ZERO = cents(0)

/** A new seed-42 game at `difficulty`. */
function gameAt(difficulty: DifficultyId): GameState {
  return createInitialState(42, FOOD_TRUCK, { ...defaultProfile(), difficulty })
}

/** `state` with the card `event` waiting for the player's choice. */
function waiting(state: GameState, event: string): GameState {
  return {
    ...state,
    events: { ...state.events, pending: { event, followUp: false } },
  }
}

/** What the entries of `memo` move in all: their debits. */
function moved(state: GameState, memo: string): number {
  return entriesOf(state.journal)
    .filter((entry) => entry.memo === memo)
    .flatMap(({ lines }) => lines)
    .reduce((sum, { debit }) => sum + debit, 0)
}

/**
 * The factor of the one change of `kind` to the street in `state`, of
 * everyone's or of `segment`'s for walk-ins and willingness.
 */
function factorOf(
  state: GameState,
  kind: 'walkIns' | 'appeal' | 'willingness',
  segment?: string,
): number {
  const factors = state.events.modifiers.flatMap(({ change }) => {
    if (change.kind !== kind) return []
    if (change.kind === 'appeal') return [change.factor]
    if (change.kind === 'walkIns' || change.kind === 'willingness') {
      return change.segment === segment ? [change.factor] : []
    }
    return []
  })
  if (factors.length !== 1) {
    throw new Error(`Not one ${kind} change, but ${factors.length}`)
  }
  return factors[0] ?? 0
}

describe('the essai card’s « Tout essayer » at each difficulty', () => {
  /**
   * Day 1's morning at `difficulty`, the player trying everything, and the
   * start of day 4, once the effects queued for 1 to 3 days later ran.
   */
  function tryEverything(difficulty: DifficultyId) {
    const morning = tick(gameAt(difficulty))
    const chosen = resolveEvent(
      waiting(morning, 'essai'),
      'toutEssayer',
      EVENTS,
    )
    const later = startOfDay({ ...chosen, day: chosen.day + 3 }, FOOD_TRUCK)
    return { morning, chosen, later }
  }

  type Played = ReturnType<typeof tryEverything>

  const played = new Map(
    DIFFICULTY_IDS.map((difficulty) => [difficulty, tryEverything(difficulty)]),
  )

  /** `size` of what the choice did at each difficulty. */
  function at(size: (game: Played) => number) {
    const sizeAt = (difficulty: DifficultyId) => {
      const game = played.get(difficulty)
      if (game === undefined) throw new Error(`Not played at ${difficulty}`)
      return size(game)
    }
    return {
      facile: sizeAt('facile'),
      moyen: sizeAt('moyen'),
      difficile: sizeAt('difficile'),
    }
  }

  // How much each gain gives: the more, the better for the player.
  const GAINS: { name: string; size: (game: Played) => number }[] = [
    {
      name: 'the cash sale « Vente d’essai »',
      size: ({ chosen }) => moved(chosen, "Vente d'essai"),
    },
    {
      name: 'the credit sale to « Client d’essai »',
      size: ({ chosen }) =>
        chosen.receivables.find(({ client }) => client === "Client d'essai")
          ?.amount ?? 0,
    },
    {
      name: 'the owner’s « Cadeau d’essai »',
      size: ({ chosen }) =>
        chosen.personal.movements.find(
          ({ label }) => label === "Cadeau d'essai",
        )?.amount ?? 0,
    },
    {
      name: 'the chic walk-ins ×1.25',
      size: ({ chosen }) => factorOf(chosen, 'walkIns', 'chic') - 1,
    },
    {
      name: 'the willingness ×1.1, a day later',
      size: ({ later }) => factorOf(later, 'willingness') - 1,
    },
  ]

  // How much each loss takes: the more, the worse for the player.
  const LOSSES: { name: string; size: (game: Played) => number }[] = [
    {
      name: 'the charge « Amende d’essai »',
      size: ({ chosen }) => moved(chosen, "Amende d'essai"),
    },
    {
      name: 'the charge « Gobelets d’essai », three days later',
      size: ({ later }) => moved(later, "Gobelets d'essai"),
    },
    {
      name: 'the energy −10',
      size: ({ morning, chosen }) => morning.energy - chosen.energy,
    },
    {
      name: 'everyone’s walk-ins ×0.65',
      size: ({ chosen }) => 1 - factorOf(chosen, 'walkIns'),
    },
    {
      name: 'the chocolat’s appeal ×0.3',
      size: ({ chosen }) => 1 - factorOf(chosen, 'appeal'),
    },
  ]

  it.each(GAINS)(
    'gives less of $name at Difficile, and more at Moyen, than at Facile',
    ({ size }) => {
      const { facile, moyen, difficile } = at(size)
      expect(facile).toBeGreaterThan(0)
      expect(difficile).toBeLessThan(facile)
      expect(moyen).toBeGreaterThan(facile)
    },
  )

  it.each(LOSSES)(
    'takes more of $name at Moyen and at Difficile than at Facile',
    ({ size }) => {
      const { facile, moyen, difficile } = at(size)
      expect(facile).toBeGreaterThan(0)
      expect(moyen).toBeGreaterThan(facile)
      expect(difficile).toBeGreaterThan(facile)
    },
  )

  it('keeps the stock, the durations and the terms as the card writes them', () => {
    // 20 croissants bought, 12 sold and 6 given away.
    const croissants = at(
      ({ morning, chosen }) =>
        onHand(chosen.inventory, 'croissant') -
        onHand(morning.inventory, 'croissant'),
    )
    expect(croissants).toEqual({ facile: 2, moyen: 2, difficile: 2 })
    for (const { chosen } of played.values()) {
      expect(
        chosen.events.modifiers.map(({ fromDay, lastDay }) => [
          fromDay,
          lastDay,
        ]),
      ).toEqual([
        [1, 15],
        [1, 3],
        [1, 5],
        [1, 2],
      ])
      expect(chosen.receivables.map(({ dueDay }) => dueDay)).toEqual([91])
    }
  })
})

describe('an effect for some difficulties only', () => {
  /**
   * A card whose « Refuser » costs 5 energy at Difficile only, as each
   * Difficile choice gets its cost.
   */
  function politeRefusal(): EventContent {
    return loadEventContent({
      pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
      events: [
        {
          id: 'politesse',
          weight: 1,
          character: { id: 'gilles', name: 'Gilles Lacasse', role: 'Traiteur' },
          title: 'Une carte',
          situation: 'Il se passe quelque chose.',
          choices: [
            {
              id: 'accepter',
              label: 'Accepter',
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
              id: 'refuser',
              label: 'Refuser',
              tags: ['Énergie −5'],
              outcomes: [
                {
                  chance: 1,
                  result: 'Refusé.',
                  effects: [
                    {
                      kind: 'energy',
                      amount: -5,
                      difficulties: ['difficile'],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
  }

  it.each(DIFFICULTY_IDS)('applies at Difficile only, here at %s', (level) => {
    const morning = tick(gameAt(level))
    const chosen = resolveEvent(
      waiting(morning, 'politesse'),
      'refuser',
      politeRefusal(),
    )
    expect(chosen.energy < morning.energy).toBe(level === 'difficile')
  })
})

describe('the draw by the player’s standing', () => {
  // The cards Facile draws more often « en difficulté », and « en avance ».
  const HELPFUL = ['gateauFete', 'traiteurPresse']
  const TEMPTING = ['placementMiracle', 'peintureLuxe']

  /**
   * The mornings of week 4, mid-month, away from the 1st's charges: the
   * last week closed is week 3, and the morning is in week 4.
   */
  const WEEKS = [3, 4]
  const MORNINGS: Day[] = [21, 22, 23, 24, 25, 26, 27]
  /** Generator states drawn from on each morning. */
  const DRAWS = 300

  /** The shipped cards, one drawn every morning. */
  const EVERY_MORNING: EventContent = {
    ...EVENTS,
    pacing: { ...EVENTS.pacing, minDaysBetween: 0, dailyChance: 1 },
  }

  const RECEIVABLES: AccountCode = '1100'
  const EQUIPMENT: AccountCode = '1500'
  const PAYABLES: AccountCode = '2000'
  const CASH: AccountCode = '1000'
  const SALES: AccountCode = '4000'
  const OTHER_CHARGES: AccountCode = '6900'

  /**
   * A game at `difficulty` whose bénéfice net since day 0 is `netIncome`,
   * owed by a client or to a supplier so the encaisse does not move, with
   * `spent` of the encaisse put into equipment, which leaves the income as
   * it is.
   */
  function standing(
    difficulty: DifficultyId,
    netIncome: number,
    spent = 0,
  ): GameState {
    const game = gameAt(difficulty)
    let { journal } = game
    const amount = cents(Math.abs(netIncome))
    journal = postEntry(journal, {
      day: 1,
      memo: netIncome > 0 ? 'Vente à crédit' : 'Charge à payer',
      lines:
        netIncome > 0
          ? [
              { account: RECEIVABLES, debit: amount, credit: ZERO },
              { account: SALES, debit: ZERO, credit: amount },
            ]
          : [
              { account: OTHER_CHARGES, debit: amount, credit: ZERO },
              { account: PAYABLES, debit: ZERO, credit: amount },
            ],
    })
    if (spent > 0) {
      journal = postEntry(journal, {
        day: 1,
        memo: 'Achat d’équipement',
        lines: [
          { account: EQUIPMENT, debit: cents(spent), credit: ZERO },
          { account: CASH, debit: ZERO, credit: cents(spent) },
        ],
      })
    }
    return { ...game, journal }
  }

  /** The bénéfice net at percentile `percentile` in weeks 3 and 4. */
  function amountsAt(difficulty: DifficultyId, percentile: number): number[] {
    const index = PERCENTILES.percentiles.indexOf(percentile)
    return WEEKS.map(
      (week) => PERCENTILES.difficulties[difficulty][week - 1]?.[index] ?? 0,
    )
  }

  /** 1 000 $, past the table's ends. */
  const MARGIN = 100_000

  /** Below the lowest percentile in weeks 3 and 4: « en difficulté ». */
  function behind(difficulty: DifficultyId): number {
    const [lowest] = PERCENTILES.percentiles
    return Math.min(...amountsAt(difficulty, lowest ?? 0)) - MARGIN
  }

  /** Halfway between the medians of weeks 3 and 4: « dans la moyenne ». */
  function middle(difficulty: DifficultyId): number {
    const [week3 = 0, week4 = 0] = amountsAt(difficulty, 50)
    return Math.round((week3 + week4) / 2)
  }

  /** Above the highest percentile in weeks 3 and 4: « en avance ». */
  function ahead(difficulty: DifficultyId): number {
    const highest = PERCENTILES.percentiles.at(-1) ?? 0
    return Math.max(...amountsAt(difficulty, highest)) + MARGIN
  }

  /** The card picked on each morning, from each generator state. */
  function picks(state: GameState): (string | null)[] {
    const picked: (string | null)[] = []
    for (const day of MORNINGS) {
      let rngState = seedRng(42)
      for (let draw = 0; draw < DRAWS; draw += 1) {
        const drawn = drawEvent({ ...state, day, rngState }, EVERY_MORNING)
        picked.push(drawn.events.pending?.event ?? null)
        rngState = next(rngState)[1]
      }
    }
    return picked
  }

  function count(picked: readonly (string | null)[], event: string): number {
    return picked.filter((id) => id === event).length
  }

  it.each(DIFFICULTY_IDS)(
    'reads « en difficulté », « dans la moyenne » and « en avance » off the table at %s',
    (difficulty) => {
      for (const week of WEEKS) {
        const at = (income: number) =>
          percentileOf(difficulty, week, cents(income))
        expect(at(behind(difficulty))).toBeLessThan(30)
        expect(at(middle(difficulty))).toBeGreaterThan(30)
        expect(at(middle(difficulty))).toBeLessThan(70)
        expect(at(ahead(difficulty))).toBeGreaterThan(70)
      }
    },
  )

  describe('at Facile', () => {
    const facileMiddle = picks(standing('facile', middle('facile')))

    it.each(HELPFUL)(
      'draws %s more often « en difficulté » than « dans la moyenne »',
      (event) => {
        const behindPicks = picks(standing('facile', behind('facile')))
        expect(count(behindPicks, event)).toBeGreaterThan(
          count(facileMiddle, event),
        )
      },
    )

    it.each(HELPFUL)(
      'draws %s more often with the encaisse below a month of fixed costs',
      (event) => {
        // All but 1 $ of the encaisse put into equipment.
        const opening = gameAt('facile')
        const cash = entriesOf(opening.journal)
          .flatMap(({ lines }) => lines)
          .filter(({ account }) => account === CASH)
          .reduce((sum, { debit, credit }) => sum + debit - credit, 0)
        const broke = picks(standing('facile', middle('facile'), cash - 100))
        expect(count(broke, event)).toBeGreaterThan(count(facileMiddle, event))
      },
    )

    it.each(TEMPTING)(
      'draws %s more often « en avance » than « dans la moyenne »',
      (event) => {
        const aheadPicks = picks(standing('facile', ahead('facile')))
        expect(count(aheadPicks, event)).toBeGreaterThan(
          count(facileMiddle, event),
        )
      },
    )
  })

  it.each(['moyen', 'difficile'] as const)(
    'ignores the standing at %s',
    (difficulty) => {
      const inTheMiddle = picks(standing(difficulty, middle(difficulty)))
      expect(picks(standing(difficulty, behind(difficulty)))).toEqual(
        inTheMiddle,
      )
      expect(picks(standing(difficulty, ahead(difficulty)))).toEqual(
        inTheMiddle,
      )
    },
  )
})
