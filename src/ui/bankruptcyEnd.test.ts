import { describe, expect, it } from 'vitest'
import { loadBankruptcyText } from '../content/bankruptcyText.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import { incomeStatement } from '../finance/statements.ts'
import {
  bankruptcyFigures,
  bestWeek,
  figureLine,
  prudhommeLine,
} from './bankruptcyEnd.ts'
import { formatMoney } from './formatMoney.ts'

// What the « Faillite » screen shows (#160), worked out from the game.

/**
 * Seed 7 at Difficile, its owner paying themself 3 000 $ a week from day
 * 1: the close of November 30th, day 213, ends it in bankruptcy. The
 * morning after.
 */
function bankrupt(): GameState {
  let game = applyDecision(
    createInitialState(7, FOOD_TRUCK, {
      ...defaultProfile(),
      difficulty: 'difficile',
    }),
    { kind: 'ownerWeeklyPay', pay: cents(300_000) },
  )
  while (game.ended === null) game = tick(game)
  return game
}

const ENDED = bankrupt()
const END = { reason: 'bankruptcy', day: 213 } as const

describe('bankruptcyFigures', () => {
  it('lists the days played, the best week, the ventes, the bénéfice net and the valeur nette, from the books', () => {
    expect(ENDED.ended).toEqual(END)
    const { sales, netIncome } = incomeStatement(ENDED.journal, 0, 213)
    const best = Math.max(...ENDED.weekHistory.map((week) => week.sales))
    expect(bankruptcyFigures(ENDED, END)).toEqual([
      { label: 'Jours joués', value: '214' },
      { label: 'Meilleure semaine', value: formatMoney(cents(best)) },
      { label: 'Ventes', value: formatMoney(sales.amount) },
      { label: 'Bénéfice net', value: formatMoney(netIncome.amount) },
      { label: 'Valeur nette', value: formatMoney(netWorth(ENDED)) },
    ])
    expect(netIncome.amount).toBeLessThan(0)
  })

  it('leaves the best week out before a week is reported', () => {
    const labels = bankruptcyFigures({ ...ENDED, lastWeek: null }, END).map(
      ({ label }) => label,
    )
    expect(labels).toEqual([
      'Jours joués',
      'Ventes',
      'Bénéfice net',
      'Valeur nette',
    ])
  })
})

describe('bestWeek', () => {
  const week = (sales: number, previousBest: number | null) => ({
    lastWeek: {
      ...ENDED.lastWeek!,
      sales: cents(sales),
      previousBest: previousBest === null ? null : cents(previousBest),
    },
  })

  it.each<[string, number, number | null, number]>([
    ['the only week reported', 100_00, null, 100_00],
    ['an earlier week, higher', 100_00, 250_00, 250_00],
    ['the last week, higher', 300_00, 250_00, 300_00],
  ])('is %s', (_, sales, previousBest, best) => {
    expect(bestWeek(week(sales, previousBest))).toBe(best)
  })

  it('is null before a week is reported', () => {
    expect(bestWeek({ lastWeek: null })).toBeNull()
  })
})

describe('figureLine', () => {
  it('puts a no-break space before the colon', () => {
    expect(figureLine({ label: 'Jours joués', value: '214' })).toBe(
      'Jours joués : 214',
    )
  })
})

describe('prudhommeLine', () => {
  const text = loadBankruptcyText()

  it('picks one of her lines by the seed, the same every time', () => {
    const { length } = text.prudhomme
    const lines = Array.from({ length }, (_, seed) => prudhommeLine(seed, text))
    expect(lines).toEqual(text.prudhomme)
    expect(prudhommeLine(length + 2, text)).toBe(text.prudhomme[2])
    expect(prudhommeLine(2 ** 32 - 1, text)).toBe(
      text.prudhomme[(2 ** 32 - 1) % length],
    )
  })
})
