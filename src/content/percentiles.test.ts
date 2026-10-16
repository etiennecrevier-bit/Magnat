import { describe, expect, it } from 'vitest'
import percentilesJson from './percentiles.json'
import { difficultyIdSchema, loadPercentileContent } from './schema.ts'

// percentiles.json, which `npm run balance -- --percentiles` writes: the
// shipped file loads, and the schema turns down a table the engine could
// not read.

/** A valid table of two weeks at three percentiles. */
function table(): {
  games: number
  percentiles: number[]
  difficulties: Record<string, number[][]>
} {
  return {
    games: 3,
    percentiles: [10, 50, 90],
    difficulties: {
      facile: [
        [-100, 0, 100],
        [-50, 50, 50],
      ],
      moyen: [[0, 0, 0]],
      difficile: [[-300, -200, -100]],
    },
  }
}

describe('loadPercentileContent', () => {
  it('loads the shipped percentiles.json, from week 1 to 104 at every difficulty', () => {
    const { games, percentiles, difficulties } = loadPercentileContent()
    expect(games).toBeGreaterThanOrEqual(1000)
    expect(percentiles).toEqual([5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95])
    expect(Object.keys(difficulties)).toEqual(difficultyIdSchema.options)
    for (const rows of Object.values(difficulties)) {
      expect(rows).toHaveLength(104)
    }
    expect(loadPercentileContent(percentilesJson)).toEqual(
      loadPercentileContent(),
    )
  })

  it('accepts a table with equal amounts and negative ones', () => {
    expect(loadPercentileContent(table()).difficulties.moyen).toEqual([
      [0, 0, 0],
    ])
  })

  it('names percentiles.json in its error', () => {
    expect(() => loadPercentileContent({})).toThrow(
      /^percentiles\.json is invalid/,
    )
  })

  it.each([
    [
      'a missing difficulty',
      (raw: ReturnType<typeof table>) => {
        delete raw.difficulties.difficile
      },
      'difficile',
    ],
    [
      'an unknown difficulty',
      (raw: ReturnType<typeof table>) => {
        raw.difficulties.extreme = [[0, 0, 0]]
      },
      'Unrecognized key: "extreme"',
    ],
    [
      'a difficulty with no week',
      (raw: ReturnType<typeof table>) => {
        raw.difficulties.moyen = []
      },
      'difficulties.moyen',
    ],
    [
      'a week short of a percentile',
      (raw: ReturnType<typeof table>) => {
        raw.difficulties.facile = [[-100, 0]]
      },
      'one amount per percentile, 3, not 2',
    ],
    [
      'a week whose amounts go down',
      (raw: ReturnType<typeof table>) => {
        raw.difficulties.facile = [[-100, 100, 0]]
      },
      'the amounts must not go down: 0 after 100',
    ],
    [
      'an amount that is not whole cents',
      (raw: ReturnType<typeof table>) => {
        raw.difficulties.facile = [[-100, 0.5, 100]]
      },
      'difficulties.facile[0][1]',
    ],
    [
      'an amount past the safe integers',
      (raw: ReturnType<typeof table>) => {
        raw.difficulties.facile = [[-100, 0, 2 ** 53]]
      },
      'difficulties.facile[0][2]',
    ],
    [
      'percentiles out of order',
      (raw: ReturnType<typeof table>) => {
        raw.percentiles = [10, 90, 50]
      },
      'the percentiles must go up: 50 after 90',
    ],
    [
      'a percentile twice',
      (raw: ReturnType<typeof table>) => {
        raw.percentiles = [10, 50, 50]
      },
      'the percentiles must go up: 50 after 50',
    ],
    [
      'a percentile of 0',
      (raw: ReturnType<typeof table>) => {
        raw.percentiles = [0, 50, 90]
      },
      'percentiles[0]',
    ],
    [
      'a percentile of 100',
      (raw: ReturnType<typeof table>) => {
        raw.percentiles = [10, 50, 100]
      },
      'percentiles[2]',
    ],
    [
      'a percentile that is not whole',
      (raw: ReturnType<typeof table>) => {
        raw.percentiles = [10, 50.5, 90]
      },
      'percentiles[1]',
    ],
    [
      'no percentiles',
      (raw: ReturnType<typeof table>) => {
        raw.percentiles = []
        raw.difficulties = { facile: [[]], moyen: [[]], difficile: [[]] }
      },
      'percentiles',
    ],
    [
      'no games',
      (raw: ReturnType<typeof table>) => {
        raw.games = 0
      },
      'games',
    ],
  ])('rejects %s', (_, change, message) => {
    const raw = table()
    change(raw)
    expect(() => loadPercentileContent(raw)).toThrow(message)
  })
})
