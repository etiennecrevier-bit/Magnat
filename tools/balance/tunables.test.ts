import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BALANCE_FILES,
  BALANCE_JSON,
  EXCLUDED_FILES,
  classifyFiles,
  getAt,
  inventory,
  perturb,
  roundHalfUp,
  setAt,
  tunablesOf,
  validate,
  type Tunable,
} from './tunables.ts'

// The tunables of #298: every content file is classified, every numeric
// leaf of the balance files is in the inventory, and each one moves on its
// own, as the game's loaders allow.

const CONTENT = fileURLToPath(new URL('../../src/content/', import.meta.url))

function tunable(file: string, label: string): Tunable {
  const found = inventory().find(
    (each) => each.file === file && each.label === label,
  )
  if (found === undefined) throw new Error(`No tunable ${file} ${label}`)
  return found
}

function moved(file: string, label: string, factor: number): number {
  const result = perturb(BALANCE_JSON[file], tunable(file, label), factor)
  if (!result.ok) throw new Error(result.why)
  return result.value
}

/** Every number under `json`, counted the plain way. */
function numbers(json: unknown): number {
  if (typeof json === 'number') return 1
  if (json === null || typeof json !== 'object') return 0
  return Object.values(json).reduce<number>(
    (total, value) => total + numbers(value),
    0,
  )
}

describe('classifyFiles', () => {
  it('knows every JSON file of src/content/', () => {
    const files = classifyFiles(readdirSync(CONTENT))
    expect(files.filter(({ kind }) => kind === 'unknown')).toEqual([])
    for (const file of [...BALANCE_FILES, ...Object.keys(EXCLUDED_FILES)]) {
      expect(files.some((each) => each.file === file)).toBe(true)
    }
  })

  it('leaves the player text out, and an unknown file unknown', () => {
    expect(classifyFiles(['lines.fr.json', 'nouveau.json', 'x.ts'])).toEqual([
      {
        file: 'lines.fr.json',
        kind: 'excluded',
        why: "text: the player's French",
      },
      { file: 'nouveau.json', kind: 'unknown' },
    ])
  })
})

describe('inventory', () => {
  const all = inventory()

  it('holds every numeric leaf of every balance file', () => {
    for (const file of BALANCE_FILES) {
      expect(all.filter((each) => each.file === file)).toHaveLength(
        numbers(BALANCE_JSON[file]),
      )
    }
  })

  it('says what each leaf acts on, or why it is left out', () => {
    for (const each of all) {
      if (each.excluded === null) expect(each.actsOn, each.label).not.toBe('')
    }
    expect(tunable('foodtruck.json', 'ownerPayWeekday').excluded).toBe(
      'a weekday',
    )
    expect(tunable('districts.json', 'winterStorage.from.month').excluded).toBe(
      'a date',
    )
  })

  it("folds a difficulty's leaf into one row", () => {
    const cash = tunable(
      'difficulty.json',
      'difficulties.moyen.startingCashCents',
    )
    expect(cash).toMatchObject({
      difficulty: 'moyen',
      row: 'difficulties.*.startingCashCents',
      value: 1_000_000,
      actsOn: 'Encaisse at the start',
    })
    expect(tunable('energy.json', 'openDayCost').difficulty).toBeNull()
  })

  it('names the items of an array by their id', () => {
    const labels = tunablesOf('events.json', BALANCE_JSON['events.json']).map(
      ({ label }) => label,
    )
    expect(labels).toContain(
      'events[grosseCommande].choices[accepter].outcomes[0].effects[2:creditSale].amountCents',
    )
  })

  it('ties a share to the others of its whole', () => {
    const share = tunable(
      'districts.json',
      'districts.plateau.dayTypes.semaine.segmentShares.chic',
    )
    expect(share.shares).toHaveLength(3)
    const chance = tunable(
      'events.json',
      'events[grosseCommande].choices[accepter].outcomes[0].chance',
    )
    expect(chance.shares).toEqual([
      ['events', 1, 'choices', 0, 'outcomes', 1, 'chance'],
    ])
  })
})

describe('perturb', () => {
  it('rounds whole numbers half up, or moves them by one', () => {
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(-2.5)).toBe(-2)
    expect(moved('energy.json', 'openDayCost', 1.2)).toBe(7)
    expect(moved('energy.json', 'openDayCost', 0.8)).toBe(5)
    const one = perturb(
      BALANCE_JSON['bakery.json'],
      tunable('bakery.json', 'noticeMonths'),
      1.2,
    )
    expect(one).toMatchObject({ ok: true, value: 2 })
    expect(one.ok && one.note).toContain('moved by one')
  })

  it('keeps a fraction a fraction, and a probability within 0 and 1', () => {
    expect(
      moved('foodtruck.json', 'walkIns.noiseStdDevRatio', 1.2),
    ).toBeCloseTo(0.18)
    expect(
      moved(
        'segments.json',
        'segments.habitue.products.cafe.purchaseProbability',
        1.2,
      ),
    ).toBe(1)
  })

  it('rescales the shares of a whole to keep its sum', () => {
    const share = tunable(
      'districts.json',
      'districts.plateau.dayTypes.semaine.segmentShares.chic',
    )
    const result = perturb(BALANCE_JSON['districts.json'], share, 1.2)
    if (!result.ok) throw new Error(result.why)
    const sum = [share.path, ...share.shares].reduce(
      (total, path) => total + (getAt(result.json, path) as number),
      0,
    )
    expect(sum).toBeCloseTo(1, 12)
    expect(getAt(result.json, share.path)).toBeCloseTo(0.24)
    // The content itself is left alone.
    expect(getAt(BALANCE_JSON['districts.json'], share.path)).toBe(0.2)
  })

  it('says why a value cannot move', () => {
    const json = BALANCE_JSON['foodtruck.json']
    expect(
      perturb(
        json,
        tunable('foodtruck.json', 'startingDecisions.marketingDailyCents'),
        1.2,
      ),
    ).toEqual({ ok: false, why: '0 does not move' })
    expect(
      perturb(json, tunable('foodtruck.json', 'ownerPayWeekday'), 1.2),
    ).toEqual({ ok: false, why: 'a weekday' })
    const refused = perturb(
      json,
      tunable('foodtruck.json', 'walkIns.opensAtMinute'),
      1.2,
    )
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.why).toContain('the loaders refuse')
  })
})

describe('getAt and setAt', () => {
  it('read and write a value at a path, in place', () => {
    const json = { a: [{ b: 1 }] }
    expect(getAt(json, ['a', 0, 'b'])).toBe(1)
    setAt(json, ['a', 0, 'b'], 2)
    expect(json.a[0]?.b).toBe(2)
    expect(getAt(json, ['x', 'y'])).toBeUndefined()
    expect(() => setAt(json, ['x', 'y'], 1)).toThrow(RangeError)
  })
})

describe('validate', () => {
  it('accepts every balance file as shipped, and refuses what its loaders do', () => {
    for (const file of BALANCE_FILES) {
      expect(validate(file, BALANCE_JSON[file]), file).toBeNull()
    }
    expect(validate('energy.json', { openDayCost: 'beaucoup' })).not.toBeNull()
    expect(validate('lines.fr.json', {})).toContain('no balance file')
  })
})
