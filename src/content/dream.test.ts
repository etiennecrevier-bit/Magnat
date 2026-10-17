import { describe, expect, it } from 'vitest'
import dreamJson from './dream.json'
import { loadDreamContent, rungIdSchema } from './schema.ts'

// « Le rêve » (#162): the ladders of dream.json, their rungs as the issue
// proposes them, and the rules the loader holds them to.

type Json = Record<string, unknown>

const content = loadDreamContent()

/** dream.json with `change` made to a copy of it. */
function changed(change: (dream: Json & typeof dreamJson) => void): unknown {
  const copy = structuredClone(dreamJson) as Json & typeof dreamJson
  change(copy)
  return copy
}

/** Expects `raw` to fail to load, its message holding `reason`. */
function expectInvalid(raw: unknown, reason: string): void {
  expect(() => loadDreamContent(raw)).toThrow(reason)
}

describe('dream.json', () => {
  it('holds the owner’s ladder and the company’s, in the order they are climbed', () => {
    expect(
      content.personal.map(({ id, name, priceCents }) => [
        id,
        name,
        priceCents,
      ]),
    ).toEqual([
      ['velo', 'Vélo électrique', 150_000],
      ['voitureOccasion', "Voiture d'occasion", 800_000],
      ['condo', 'Condo sur le Plateau', 4_000_000],
      ['voitureLuxe', 'Voiture de luxe', 4_500_000],
      ['maison', 'Maison à Outremont', 15_000_000],
      ['chalet', 'Chalet dans les Laurentides', 9_000_000],
    ])
    expect(
      content.company.map(({ id, name, priceCents }) => [id, name, priceCents]),
    ).toEqual([
      ['espresso', 'Machine à espresso pro', 600_000],
      ['grandCamion', 'Camion plus grand', 4_000_000],
      ['deuxiemeCamion', 'Deuxième camion', 8_500_000],
    ])
  })

  it('gives each rung the bonus the issue proposes', () => {
    const bonuses = Object.fromEntries(
      [...content.personal, ...content.company].map(({ id, bonuses }) => [
        id,
        bonuses,
      ]),
    )
    expect(bonuses).toEqual({
      velo: [{ kind: 'travelTime', factor: 0.7 }],
      voitureOccasion: [{ kind: 'travelTime', factor: 0.5 }],
      condo: [],
      voitureLuxe: [
        { kind: 'travelTime', factor: 0.4 },
        { kind: 'walkIns', segment: 'chic', factor: 1.05 },
      ],
      maison: [],
      chalet: [{ kind: 'closedDayRecovery', extra: 15 }],
      espresso: [{ kind: 'serviceTime', factor: 0.8 }],
      grandCamion: [
        { kind: 'stock', factor: 1.5 },
        { kind: 'line', factor: 1.5 },
        { kind: 'walkIns', segment: 'chic', factor: 1.1 },
      ],
      deuxiemeCamion: [],
    })
    const [, , condo, , maison] = content.personal
    expect(condo?.housing).toEqual({
      label: 'Hypothèque du condo',
      monthlyCents: 110_000,
    })
    expect(maison?.housing).toEqual({
      label: 'Hypothèque de la maison',
      monthlyCents: 220_000,
    })
    expect(maison?.sells).toBe('condo')
    expect(content.company[1]?.replacesTruck).toBe(true)
    expect(content.company[2]?.comingSoon).toBe(true)
  })

  it('holds the titles, the last one « Magnat »', () => {
    expect(content.titles).toEqual([
      { name: 'Débrouillard', netWorthCents: 2_500_000 },
      { name: 'Commerçant', netWorthCents: 10_000_000 },
      { name: 'Entrepreneur', netWorthCents: 25_000_000 },
      { name: 'Magnat', netWorthCents: 100_000_000 },
    ])
  })
})

describe('loadDreamContent rejects', () => {
  it('a key it does not know', () => {
    expectInvalid(
      changed((dream) => {
        ;(dream.personal[0] as Json).discount = 1
      }),
      'Unrecognized key: "discount"',
    )
  })

  it('a rung missing, or in a ladder twice', () => {
    expectInvalid(
      changed((dream) => {
        dream.personal.pop()
      }),
      'the rung chalet must be in one ladder once, not 0 times',
    )
    expectInvalid(
      changed((dream) => {
        dream.company.push({ ...dream.company[0]! })
      }),
      'the rung espresso must be in one ladder once, not 2 times',
    )
    expect(rungIdSchema.options).toHaveLength(9)
  })

  it('housing or sells on a company rung, and a useful life on a personal one', () => {
    expectInvalid(
      changed((dream) => {
        ;(dream.company[0] as Json).sells = 'condo'
      }),
      'Unrecognized key: "sells"',
    )
    expectInvalid(
      changed((dream) => {
        ;(dream.personal[0] as Json).usefulLifeMonths = 12
      }),
      'Unrecognized key: "usefulLifeMonths"',
    )
  })

  it('a rung that sells a later rung, or one with no housing', () => {
    expectInvalid(
      changed((dream) => {
        ;(dream.personal[4] as Json).sells = 'chalet'
      }),
      'chalet is not an earlier personal rung with housing',
    )
    expectInvalid(
      changed((dream) => {
        ;(dream.personal[4] as Json).sells = 'velo'
      }),
      'velo is not an earlier personal rung with housing',
    )
  })

  it('two rungs that replace the truck', () => {
    expectInvalid(
      changed((dream) => {
        ;(dream.company[0] as Json).replacesTruck = true
      }),
      'one company rung at most replaces the truck',
    )
  })

  it('a rung coming soon before one for sale', () => {
    expectInvalid(
      changed((dream) => {
        ;(dream.company[0] as Json).comingSoon = true
      }),
      'a rung coming soon must come after every rung for sale in its ladder',
    )
  })

  it('titles that do not go up', () => {
    expectInvalid(
      changed((dream) => {
        dream.titles[1]!.netWorthCents = dream.titles[0]!.netWorthCents
      }),
      'each title needs a higher net worth than the one before',
    )
  })

  it('a factor of 0, a price of 0, or a name with a space at its end', () => {
    expectInvalid(
      changed((dream) => {
        dream.personal[0]!.bonuses = [{ kind: 'travelTime', factor: 0 }]
      }),
      'personal[0].bonuses[0].factor',
    )
    expectInvalid(
      changed((dream) => {
        dream.personal[0]!.priceCents = 0
      }),
      'personal[0].priceCents',
    )
    expectInvalid(
      changed((dream) => {
        dream.personal[0]!.name = 'Vélo '
      }),
      'personal[0].name',
    )
  })
})
