import { describe, expect, it } from 'vitest'
import type {
  AdaptiveDraw,
  DifficultyId,
  EventContent,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, postEntry } from '../finance/journal.ts'
import { createInitialState, startChallenge } from './clock.ts'
import { EVENTS, FOOD_TRUCK } from './day.ts'
import { drawEvent, resolveEvent } from './events.ts'
import { monthlyFixedCosts } from './fixedCosts.ts'
import { cents } from './money.ts'
import { PERCENTILES } from './percentiles.ts'
import { defaultProfile } from './profile.ts'
import { percentileOnMorning, standingOf } from './standing.ts'
import type { Day, GameState } from './types.ts'

// The player's standing, which Facile's draw follows (#137), and where they
// stand among the owners, which the « Bilan de la semaine » tells (#147).

const CASH: AccountCode = '1000'
const RECEIVABLES: AccountCode = '1100'
const EQUIPMENT: AccountCode = '1500'
const PAYABLES: AccountCode = '2000'
const SALES: AccountCode = '4000'
const OTHER_CHARGES: AccountCode = '6900'
const ZERO = cents(0)
/** 1 000 $, past the table's ends. */
const MARGIN = 100_000

const RULES: AdaptiveDraw = {
  difficulties: ['facile'],
  behindBelowPercentile: 30,
  aheadAbovePercentile: 70,
  behindBelowMonthsOfFixedCosts: 1,
}

function gameAt(difficulty: DifficultyId): GameState {
  return createInitialState(42, FOOD_TRUCK, { ...defaultProfile(), difficulty })
}

/**
 * `state` on `day`, with a bénéfice net of `income` from day `onDay`, owed
 * by a client or to a supplier so that the encaisse does not move.
 */
function withIncome(
  state: GameState,
  day: Day,
  income: number,
  onDay: Day = 1,
): GameState {
  const amount = cents(Math.abs(income))
  return {
    ...state,
    day,
    journal: postEntry(state.journal, {
      day: onDay,
      memo: income > 0 ? 'Vente à crédit' : 'Charge à payer',
      lines:
        income > 0
          ? [
              { account: RECEIVABLES, debit: amount, credit: ZERO },
              { account: SALES, debit: ZERO, credit: amount },
            ]
          : [
              { account: OTHER_CHARGES, debit: amount, credit: ZERO },
              { account: PAYABLES, debit: ZERO, credit: amount },
            ],
    }),
  }
}

/** The bénéfice net at the table's `percentile` in `week` at `difficulty`. */
function incomeAt(
  percentile: number,
  week: number,
  difficulty: DifficultyId = 'facile',
): number {
  const index = PERCENTILES.percentiles.indexOf(percentile)
  return PERCENTILES.difficulties[difficulty][week - 1]?.[index] ?? 0
}

describe('standingOf', () => {
  it('reads « dans la moyenne » before the first week is over, however it goes', () => {
    const state = withIncome(gameAt('facile'), 6, 10_000_000)
    expect(standingOf(state, RULES)).toBe('average')
  })

  it('reads the bénéfice net to the close of the last week played', () => {
    // On day 15, the last week closed is week 2: days 0 to 13.
    const [lowest = 0] = PERCENTILES.percentiles
    const highest = PERCENTILES.percentiles.at(-1) ?? 0
    const at = (income: number, onDay?: Day) =>
      standingOf(withIncome(gameAt('facile'), 15, income, onDay), RULES)
    expect(at(incomeAt(lowest, 2) - MARGIN)).toBe('behind')
    expect(at(incomeAt(50, 2))).toBe('average')
    expect(at(incomeAt(highest, 2) + MARGIN)).toBe('ahead')
    // A loss on day 14 is in week 3, which is not over.
    expect(at(incomeAt(lowest, 2) - MARGIN, 14)).toBe(
      standingOf({ ...gameAt('facile'), day: 15 }, RULES),
    )
  })

  it('reads « en difficulté » with less than a month of fixed costs in the encaisse', () => {
    const game = withIncome(gameAt('facile'), 21, incomeAt(50, 3))
    const cash = balance(game.journal, CASH, { toDay: 21 })
    const left = monthlyFixedCosts(21, 'facile') - 1
    const spent = cents(cash - left)
    const broke: GameState = {
      ...game,
      journal: postEntry(game.journal, {
        day: 1,
        memo: 'Achat d’équipement',
        lines: [
          { account: EQUIPMENT, debit: spent, credit: ZERO },
          { account: CASH, debit: ZERO, credit: spent },
        ],
      }),
    }
    expect(standingOf(game, RULES)).toBe('average')
    expect(standingOf(broke, RULES)).toBe('behind')
    expect(
      standingOf(broke, { ...RULES, behindBelowMonthsOfFixedCosts: 0 }),
    ).toBe('average')
  })
})

describe('percentileOnMorning', () => {
  it('reads nothing before the first week is over', () => {
    const state = withIncome(gameAt('difficile'), 6, incomeAt(50, 1))
    expect(percentileOnMorning(state)).toBeNull()
  })

  it('reads the bénéfice net from day 0 to the close of the last week played, at the game’s difficulty', () => {
    // On day 16, the last week closed is week 2: days 0 to 13.
    const at = (difficulty: DifficultyId, income: number, onDay?: Day) =>
      percentileOnMorning(withIncome(gameAt(difficulty), 16, income, onDay))
    expect(at('difficile', incomeAt(50, 2, 'difficile'))).toBe(50)
    expect(at('facile', incomeAt(80, 2, 'facile'))).toBe(80)
    // Day 14 is in week 3, which is not over.
    expect(at('difficile', incomeAt(50, 2, 'difficile'), 14)).toBe(
      percentileOnMorning({ ...gameAt('difficile'), day: 16 }),
    )
  })
})

describe('a Défi', () => {
  // « Payé dans 60 jours » plays at Moyen and forces « La grosse commande ».
  const opening = startChallenge('payeDans60Jours', 7)

  it('counts its weeks from its first day', () => {
    const start = opening.day
    const income = incomeAt(50, 1, 'moyen')
    expect(
      percentileOnMorning(withIncome(opening, start + 6, income, start)),
    ).toBeNull()
    expect(
      percentileOnMorning(withIncome(opening, start + 7, income, start)),
    ).toBe(50)
  })

  it('plays the cards as written, whatever its difficulty', () => {
    const waiting: GameState = {
      ...opening,
      events: {
        ...opening.events,
        pending: { event: 'formulaire14B', followUp: false },
      },
    }
    const paid = resolveEvent(waiting, 'payer', EVENTS)
    expect(
      balance(waiting.journal, CASH, { toDay: waiting.day }) -
        balance(paid.journal, CASH, { toDay: paid.day }),
    ).toBe(15_000)
  })

  it('draws by the weights alone, even at a difficulty that adapts', () => {
    const facile: GameState = {
      ...opening,
      profile: { ...opening.profile, difficulty: 'facile' },
    }
    const cash = balance(facile.journal, CASH, { toDay: facile.day })
    // All the encaisse into equipment: « en difficulté » outside a Défi.
    const drained: GameState = {
      ...facile,
      day: facile.day + 21,
      journal: postEntry(facile.journal, {
        day: facile.day,
        memo: 'Achat d’équipement',
        lines: [
          { account: EQUIPMENT, debit: cash, credit: ZERO },
          { account: CASH, debit: ZERO, credit: cash },
        ],
      }),
    }
    const adaptive = {
      ...EVENTS,
      pacing: { ...EVENTS.pacing, minDaysBetween: 0, dailyChance: 1 },
      adaptiveDraw: RULES,
    }
    const plain = { ...adaptive, adaptiveDraw: undefined }
    const picks = (state: GameState, content: EventContent) =>
      Array.from(
        { length: 200 },
        (_, seed) =>
          drawEvent({ ...state, rngState: seed }, content).events.pending
            ?.event,
      )
    const outside: GameState = { ...drained, challenge: null }
    expect(standingOf(outside, RULES)).toBe('behind')
    expect(picks(outside, adaptive)).not.toEqual(picks(outside, plain))
    expect(picks(drained, adaptive)).toEqual(picks(drained, plain))
  })
})
