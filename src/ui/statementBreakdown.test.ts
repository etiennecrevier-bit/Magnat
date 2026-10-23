import { describe, expect, it } from 'vitest'
import type { DifficultyId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { add, cents, type Cents } from '../engine/money.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import { postEntry } from '../finance/journal.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
} from '../finance/statements.ts'
import {
  breakdownTip,
  equipmentCashFlows,
  equipmentOnBooks,
  wagesByPerson,
  type BreakdownRow,
} from './statementBreakdown.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

const total = (rows: readonly BreakdownRow[]): Cents =>
  rows.reduce((sum, { amount }) => add(sum, amount), cents(0))

/**
 * A game of `difficulty` with plenty in Encaisse, an oven bought, then the
 * espresso machine on day 10 and the bigger truck on day 40, played to day
 * 75.
 */
function played(difficulty: DifficultyId): GameState {
  const start = createInitialState(42, undefined, {
    ...defaultProfile(),
    difficulty,
  })
  let game: GameState = applyDecision(
    {
      ...start,
      journal: postEntry(start.journal, {
        day: 0,
        memo: 'Mise de fonds',
        lines: [
          { account: '1000', debit: cents(20_000_000), credit: cents(0) },
          { account: '3000', debit: cents(0), credit: cents(20_000_000) },
        ],
      }),
    },
    { kind: 'openBakery', oven: 'acheter' },
  )
  while (game.day < 75) {
    if (game.day === 10) {
      game = applyDecision(game, { kind: 'buy', rung: 'espresso' })
    }
    if (game.day === 40) {
      game = applyDecision(game, { kind: 'buy', rung: 'grandCamion' })
    }
    game = tick(game)
  }
  return game
}

describe.each<DifficultyId>(['facile', 'moyen', 'difficile'])(
  'at %s',
  (difficulty) => {
    const game = played(difficulty)

    it('lists what the bilan’s « Équipement » holds, adding up to the line every day', () => {
      for (let day = 0; day <= game.day; day += 1) {
        const line = balanceSheet(game.journal, day).assets.longTerm.lines.find(
          ({ account }) => account === '1500',
        )
        expect(total(equipmentOnBooks(game.journal, day))).toBe(line?.amount)
      }
      const labels = equipmentOnBooks(game.journal, game.day).map(
        ({ label }) => label,
      )
      // The old truck sold back leaves no row.
      expect(labels).toEqual([
        'Four',
        'Machine à espresso pro',
        'Camion plus grand',
      ])
      expect(
        equipmentOnBooks(game.journal, 39).map(({ label }) => label),
      ).toEqual([
        ...(difficulty === 'difficile' ? [] : ['Camion']),
        'Four',
        'Machine à espresso pro',
      ])
    })

    it('lists what the investing « Équipement » holds, adding up to the row of each period', () => {
      const periods = [
        [0, 30],
        [31, 60],
        [61, 75],
        [0, 75],
        [10, 10],
        [40, 40],
      ] as const
      for (const [fromDay, toDay] of periods) {
        const row = cashFlowStatement(
          game.journal,
          fromDay,
          toDay,
        ).investing.lines.find(({ label }) => label === 'Équipement')
        expect(total(equipmentCashFlows(game.journal, fromDay, toDay))).toBe(
          row?.amount,
        )
      }
      const bigger = equipmentCashFlows(game.journal, 40, 40)
      expect(bigger.map(({ label }) => label)).toEqual(
        difficulty === 'difficile'
          ? ['Camion plus grand']
          : ['Camion', 'Camion plus grand'],
      )
      expect(total(bigger)).toBe(-4_000_000)
    })
  },
)

describe('breakdownTip', () => {
  it('lists each part as the statement writes it, then the total under a line', () => {
    expect(
      breakdownTip(
        'Équipement',
        [
          { label: 'Camion', amount: cents(8_500_000) },
          { label: 'Vente', amount: cents(-100) },
        ],
        cents(8_499_900),
      ),
    ).toEqual({
      title: 'Équipement',
      rows: [
        { label: 'Camion', value: `85${S}000,00${S}$` },
        { label: 'Vente', value: `(1,00${S}$)` },
        { label: 'Total', value: `84${S}999,00${S}$`, divider: true },
      ],
    })
  })
})

describe('wagesByPerson (#283)', () => {
  it('lists each person’s wages, adding up to « Salaires » for each period', () => {
    const start = createInitialState(42, undefined, defaultProfile())
    let game: GameState = [
      { kind: 'hire', role: 'camion', candidate: 'amelie' },
      { kind: 'hire', role: 'livreur', candidate: 'kevin' },
    ].reduce(
      (state, change) => applyDecision(state, change as DecisionChange),
      start,
    )
    while (game.day < 75) {
      if (game.day === 40) {
        game = applyDecision(game, { kind: 'fire', candidate: 'kevin' })
      }
      game = tick(game)
    }
    for (const [fromDay, toDay] of [
      [0, 30],
      [31, 60],
      [61, 75],
      [0, 75],
    ] as const) {
      const line = incomeStatement(
        game.journal,
        fromDay,
        toDay,
      ).expenses.lines.find(({ account }) => account === '6000')
      const rows = wagesByPerson(game.journal, fromDay, toDay)
      expect(total(rows)).toBe(line?.amount)
    }
    expect(
      wagesByPerson(game.journal, 0, 75).map(({ label }) => label),
    ).toEqual(['Amélie Gagnon', 'Kevin Bouchard', 'Vous'])
  })
})
