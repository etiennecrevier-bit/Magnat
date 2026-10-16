import { describe, expect, it } from 'vitest'
import defiPercentilesJson from './defis-percentiles.json'
import { loadDefiContent, loadDefiPercentileContent } from './schema.ts'

// defis-percentiles.json, which `npm run balance -- --defis` writes: the
// shipped file loads and matches the Défis, and the schema turns down a
// table a lookup could not read.

/** A valid table of two Défis at three percentiles. */
function table(): {
  games: number
  percentiles: number[]
  defis: Record<
    string,
    { metric: string; brokenShare: number; values: number[] | null }
  >
} {
  return {
    games: 3,
    percentiles: [10, 50, 90],
    defis: {
      essai: { metric: 'sales', brokenShare: 0.25, values: [100, 100, 300] },
      tropDur: { metric: 'lowestEnergy', brokenShare: 1, values: null },
      gaspillage: {
        metric: 'spoilageRate',
        brokenShare: 0,
        values: [0.0125, 0.03, 0.2],
      },
    },
  }
}

describe('loadDefiPercentileContent', () => {
  it('loads the shipped table, one entry per Défi in their order, each with its goal’s metric', () => {
    const { games, percentiles, defis } = loadDefiPercentileContent()
    expect(games).toBeGreaterThanOrEqual(1000)
    expect(percentiles).toEqual([5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95])
    const content = loadDefiContent()
    expect(Object.keys(defis)).toEqual(content.defis.map(({ id }) => id))
    for (const defi of content.defis) {
      expect(defis[defi.id]?.metric).toBe(defi.goal.metric)
    }
    expect(loadDefiPercentileContent(defiPercentilesJson)).toEqual(
      loadDefiPercentileContent(),
    )
  })

  it('accepts equal values, shares, and a Défi every game broke', () => {
    expect(loadDefiPercentileContent(table()).defis).toEqual(table().defis)
  })

  it('names defis-percentiles.json in its error', () => {
    expect(() => loadDefiPercentileContent({})).toThrow(
      /^defis-percentiles\.json is invalid/,
    )
  })

  it.each([
    [
      'an unknown metric',
      (raw: ReturnType<typeof table>) => {
        raw.defis.essai!.metric = 'profit'
      },
      'defis.essai.metric',
    ],
    [
      'a broken share above 1',
      (raw: ReturnType<typeof table>) => {
        raw.defis.essai!.brokenShare = 1.5
      },
      'defis.essai.brokenShare',
    ],
    [
      'values short of a percentile',
      (raw: ReturnType<typeof table>) => {
        raw.defis.essai!.values = [100, 200]
      },
      'one value per percentile, 3, not 2',
    ],
    [
      'values that go down',
      (raw: ReturnType<typeof table>) => {
        raw.defis.gaspillage!.values = [0.03, 0.02, 0.2]
      },
      'the values must not go down: 0.02 after 0.03',
    ],
    [
      'cents that are not whole',
      (raw: ReturnType<typeof table>) => {
        raw.defis.essai!.values = [100, 150.5, 300]
      },
      'sales counts whole units: 150.5',
    ],
    [
      'no values while some games broke no condition',
      (raw: ReturnType<typeof table>) => {
        raw.defis.essai!.values = null
      },
      'values are null only when every game broke a condition',
    ],
    [
      'values while every game broke a condition',
      (raw: ReturnType<typeof table>) => {
        raw.defis.tropDur!.values = [10, 20, 30]
      },
      'every game broke a condition, so values must be null',
    ],
    [
      'a Défi id that is not camelCase',
      (raw: ReturnType<typeof table>) => {
        raw.defis['Essai-2'] = raw.defis.essai!
      },
      'Invalid key in record\n  → at defis["Essai-2"]',
    ],
    [
      'percentiles out of order',
      (raw: ReturnType<typeof table>) => {
        raw.percentiles = [10, 90, 50]
      },
      'the percentiles must go up: 50 after 90',
    ],
    [
      'an unknown key',
      (raw: ReturnType<typeof table>) => {
        Object.assign(raw, { difficulties: {} })
      },
      'Unrecognized key: "difficulties"',
    ],
  ])('turns down %s', (_, change, message) => {
    const raw = table()
    change(raw)
    expect(() => loadDefiPercentileContent(raw)).toThrow(message)
  })
})
