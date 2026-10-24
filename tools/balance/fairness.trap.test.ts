import { describe, expect, it } from 'vitest'
import { difficultyIdSchema } from '../../src/content/schema.ts'
import { monthOf, playGrowthGame, type GrowthStrategy } from './growth.ts'
import { CAREFUL, NAIVE, TRAP_AT, TRAP_MONTHS } from './growthReport.ts'
import { CARELESS, LETTERED_GROWTH, seedsOf } from './audit.ts'
import {
  lastDayOf,
  playUntil,
  sensiblePolicy,
  startPlayer,
  summarize,
} from './sensible.ts'
import { strategyChanges } from './strategies.ts'

// The guardrails of #298's definitions 5 and 7, as the audit of October
// 2026 left the game (docs/balance/audit-2026-10.md). The cash trap of
// #166 stays: the naive player, every grocer signed at once, first closes
// below zero in month 2 or 3 in more than half of seeds 1 to 10 at Moyen
// and Difficile, and at Facile takes an emergency loan in more than half
// of them and never goes bankrupt in two years; the careful player never
// closes below zero. And warnings come first: the careless player goes
// bankrupt, and every one of its bankrupt games closed below zero and had
// Mme Prudhomme's three letters first. The counts the last full run left
// are pinned below, so that a change that moves them shows: run `npm run
// balance -- --audit` again then, and update both.

const SEEDS = 10
const MONTHS = 24

/** The careless player's bankruptcies on seeds 1 to 10, by difficulty. */
const CARELESS_BANKRUPT: Readonly<Record<string, number>> = {
  facile: 8,
  moyen: 10,
  difficile: 10,
}

// Up to thirty two-year games a test, a few seconds here: an explicit
// budget for a slow CI runner, as #305 asks.
const TIMEOUT = 60_000

function play(
  strategy: GrowthStrategy,
  difficulty: (typeof difficultyIdSchema.options)[number],
  months: number,
) {
  return seedsOf(SEEDS).map(
    (seed) =>
      playGrowthGame(
        seed,
        difficulty,
        strategy,
        months,
        strategy.financing,
        LETTERED_GROWTH,
      ).game,
  )
}

describe('the cash trap (definition 5)', () => {
  it.each(TRAP_AT)(
    'catches the naive player in month 2 or 3 at %s',
    (difficulty) => {
      // The first close below zero falls by month 4: no need to play on.
      const games = play(NAIVE, difficulty, 4)
      const trapped = games.filter(
        ({ firstDayBelowZero }) =>
          firstDayBelowZero !== null &&
          TRAP_MONTHS.includes(monthOf(firstDayBelowZero)),
      )
      expect(2 * trapped.length).toBeGreaterThan(games.length)
    },
    TIMEOUT,
  )

  it.each(difficultyIdSchema.options.filter((d) => !TRAP_AT.includes(d)))(
    'lends to the naive player at %s, who never goes bankrupt in two years',
    (difficulty) => {
      const games = play(NAIVE, difficulty, MONTHS)
      const borrowed = games.filter(({ emergencyLoans }) => emergencyLoans > 0)
      expect(2 * borrowed.length).toBeGreaterThan(games.length)
      expect(games.filter(({ endedDay }) => endedDay !== null)).toEqual([])
    },
    TIMEOUT,
  )

  it.each(difficultyIdSchema.options)(
    'never takes the careful player below zero at %s',
    (difficulty) => {
      // It never sees the financing's cards, so one policy covers both.
      const games = play(
        { ...CAREFUL, financing: 'accept' },
        difficulty,
        MONTHS,
      )
      expect(
        games.filter(({ firstDayBelowZero }) => firstDayBelowZero !== null),
      ).toEqual([])
    },
    TIMEOUT,
  )
})

describe('warnings come first (definition 7)', () => {
  it.each(difficultyIdSchema.options)(
    'warn the careless player before every bankruptcy at %s',
    (difficulty) => {
      const games = seedsOf(SEEDS).map((seed) =>
        summarize(
          playUntil(
            startPlayer(seed, difficulty, strategyChanges(CARELESS)),
            { ...sensiblePolicy(), restockMargin: null },
            lastDayOf(MONTHS),
          ),
        ),
      )
      const bankrupt = games.filter(({ endedDay }) => endedDay !== null)
      expect(bankrupt.length).toBeGreaterThan(0)
      expect(bankrupt.filter(({ warned }) => !warned)).toEqual([])
      expect(bankrupt).toHaveLength(CARELESS_BANKRUPT[difficulty] ?? -1)
    },
    TIMEOUT,
  )
})
