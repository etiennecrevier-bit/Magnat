import { describe, expect, it } from 'vitest'
import { difficultyIdSchema } from '../../src/content/schema.ts'
import { SEED_LOSSES, SURVIVAL, seedsOf } from './audit.ts'
import { playSensibleGame, type Answers } from './sensible.ts'

// The guardrails of #298's definitions 1 and 2, as the audit of October
// 2026 left the game (docs/balance/audit-2026-10.md): the sensible player
// survives two years in at least 95 % of the games at Facile, 85 % at
// Moyen and 65 % at Difficile, the cards answered at random, and loses at
// most 5 % when every card gets its first choice, so the seed alone does
// not kill. On seeds 1 to 15, the bankruptcies stay under those shares and
// at the counts the last full run pinned below, so that a change that
// moves them shows: run `npm run balance -- --audit` again then, and
// update both. Every bankrupt game had its warnings first (definition 7).

const SEEDS = 15
const MONTHS = 24

/** Bankruptcies on seeds 1 to 15, as the last full audit run left them. */
const PINNED: Readonly<Record<Answers, Readonly<Record<string, number>>>> = {
  random: { facile: 0, moyen: 0, difficile: 0 },
  first: { facile: 0, moyen: 0, difficile: 0 },
}

// Fifteen two-year games a test, a second or two here: an explicit budget
// for a slow CI runner, as #305 asks.
const TIMEOUT = 60_000

describe.each(difficultyIdSchema.options)(
  'the sensible player at %s',
  (difficulty) => {
    function bankruptcies(answers: Answers): number {
      const games = seedsOf(SEEDS).map(
        (seed) => playSensibleGame(seed, difficulty, MONTHS, answers).game,
      )
      expect(
        games.filter(({ endedDay, warned }) => endedDay !== null && !warned),
      ).toEqual([])
      return games.filter(({ endedDay }) => endedDay !== null).length
    }

    it(
      'survives two years, the cards answered at random (definition 1)',
      () => {
        const lost = bankruptcies('random')
        expect(lost).toBeLessThanOrEqual(
          Math.floor(SEEDS * (1 - SURVIVAL[difficulty]) + 1e-9),
        )
        expect(lost).toBe(PINNED.random[difficulty])
      },
      TIMEOUT,
    )

    it(
      'is not killed by the seed alone, every card answered alike (definition 2)',
      () => {
        const lost = bankruptcies('first')
        expect(lost).toBeLessThanOrEqual(Math.floor(SEEDS * SEED_LOSSES + 1e-9))
        expect(lost).toBe(PINNED.first[difficulty])
      },
      TIMEOUT,
    )
  },
)
