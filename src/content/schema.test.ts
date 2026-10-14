import { describe, expect, it } from 'vitest'
import foodTruckJson from './foodtruck.json'
import {
  dayTypeIdSchema,
  loadCustomerContent,
  loadFoodTruckContent,
  productIdSchema,
  segmentIdSchema,
} from './schema.ts'
import segmentsJson from './segments.json'

type Json = Record<string, unknown>
type Load = (raw: unknown) => unknown

/**
 * Copies `source` and applies `change` to the object holding the last key of
 * the dotted `path`.
 */
function editedCopy(
  source: unknown,
  path: string,
  change: (parent: Json, key: string) => void,
): unknown {
  const copy = structuredClone(source) as Json
  const keys = path.split('.')
  const key = keys.pop() as string
  const parent = keys.reduce((node, k) => node[k] as Json, copy)
  change(parent, key)
  return copy
}

function withValue(
  path: string,
  value: unknown,
  source: unknown = foodTruckJson,
): unknown {
  return editedCopy(source, path, (parent, key) => {
    parent[key] = value
  })
}

function without(path: string, source: unknown = foodTruckJson): unknown {
  return editedCopy(source, path, (parent, key) => {
    delete parent[key]
  })
}

/** Expects the load to fail and the error to point at exactly `path`. */
function expectRejected(
  raw: unknown,
  path: string,
  load: Load = loadFoodTruckContent,
): void {
  const at = new RegExp(`→ at ${path.replace(/[.[\]]/g, '\\$&')}$`, 'm')
  expect(() => load(raw)).toThrow(at)
}

const WEEKDAY = 'walkIns.dayTypes.semaine'

// Shape only, like pacing.test.ts: the values themselves are tunable.
describe('loadFoodTruckContent', () => {
  it('loads the shipped foodtruck.json with every product in each section', () => {
    const content = loadFoodTruckContent()
    const ids = [...productIdSchema.options].sort()
    expect(Object.keys(content.products).sort()).toEqual(ids)
    expect(Object.keys(content.restockPolicy).sort()).toEqual(ids)
    expect(Object.keys(content.walkIns.dayTypes).sort()).toEqual(
      [...dayTypeIdSchema.options].sort(),
    )
    for (const dayType of Object.values(content.walkIns.dayTypes)) {
      expect(Object.keys(dayType.productAppeal).sort()).toEqual(ids)
      expect(Object.keys(dayType.segmentShares).sort()).toEqual(
        [...segmentIdSchema.options].sort(),
      )
    }
  })

  it('rejects a float price', () => {
    expectRejected(
      withValue('products.cafe.basePriceCents', 2.5),
      'products.cafe.basePriceCents',
    )
  })

  it.each([
    'products.croissant.basePriceCents',
    'products.chocolat.basePriceCents',
    'products.cafe.unitCostCents',
    'products.croissant.unitCostCents',
    'startingCapitalCents',
    'dailyFixedCostsCents.rentAndPermit',
    'dailyFixedCostsCents.fuelAndMaintenance',
  ])('rejects a float in %s', (path) => {
    expectRejected(withValue(path, 12.5), path)
  })

  it('rejects a negative amount', () => {
    expectRejected(
      withValue('products.cafe.unitCostCents', -40),
      'products.cafe.unitCostCents',
    )
  })

  it.each(['products.croissant', 'products.chocolat'])(
    'rejects a missing product: %s',
    (path) => {
      expectRejected(without(path), path)
    },
  )

  it.each([
    'restockPolicy.chocolat',
    `${WEEKDAY}.productAppeal.chocolat`,
    `${WEEKDAY}.segmentShares.chic`,
    'walkIns.dayTypes.finDeSemaine',
  ])('rejects a key missing from its record: %s', (path) => {
    expectRejected(without(path), path)
  })

  it('rejects an unknown product id', () => {
    const muffin = { ...foodTruckJson.products.cafe, name: 'Muffin' }
    const raw = withValue('products.muffin', muffin)
    expectRejected(raw, 'products')
    expect(() => loadFoodTruckContent(raw)).toThrow(
      'Unrecognized key: "muffin"',
    )
  })

  it.each([
    ['walkIns', 'customer'],
    [WEEKDAY, 'patience'],
  ])('rejects a mistyped key in %s', (parent, key) => {
    const raw = withValue(`${parent}.${key}`, 1)
    expectRejected(raw, parent)
    expect(() => loadFoodTruckContent(raw)).toThrow(
      `Unrecognized key: "${key}"`,
    )
  })

  it('rejects the walk-ins of phase 1', () => {
    const raw = withValue('walkIns', {
      weekdayCustomers: 120,
      weekendCustomers: 80,
      noiseStdDevRatio: 0.15,
    })
    expect(() => loadFoodTruckContent(raw)).toThrow(
      /Unrecognized keys: "weekdayCustomers", "weekendCustomers"\n +→ at walkIns$/m,
    )
  })

  it('rejects a shelf life of 0 days', () => {
    expectRejected(
      withValue('products.croissant.shelfLifeDays', 0),
      'products.croissant.shelfLifeDays',
    )
  })

  it.each([
    [`${WEEKDAY}.customers`, -1],
    ['walkIns.dayTypes.finDeSemaine.customers', 90.5],
    ['restockPolicy.croissant.quantity', -70],
  ])('rejects %s = %d, which is not a count', (path, value) => {
    expectRejected(withValue(path, value), path)
  })

  it('rejects a top-up threshold above its target', () => {
    expectRejected(
      withValue('restockPolicy.cafe.whenBelow', 400),
      'restockPolicy.cafe.whenBelow',
    )
  })

  it('rejects an unknown restock kind', () => {
    expectRejected(
      withValue('restockPolicy.croissant.kind', 'buyWeekly'),
      'restockPolicy.croissant.kind',
    )
  })

  it.each([
    ['walkIns.noiseStdDevRatio', -0.1],
    [`${WEEKDAY}.segmentShares.chic`, 1.2],
    [`${WEEKDAY}.segmentShares.chic`, -0.2],
    [`${WEEKDAY}.productAppeal.cafe`, -1],
    [`${WEEKDAY}.patienceMultiplier`, 0],
    [`${WEEKDAY}.patienceMultiplier`, -0.5],
    [`${WEEKDAY}.arrivalWeights.3`, -2],
    ['walkIns.opensAtMinute', -30],
    ['walkIns.opensAtMinute', 420.5],
    ['walkIns.closesAtMinute', 1470],
    ['walkIns.arrivalSlotMinutes', 0],
    ['walkIns.arrivalSlotMinutes', 30.5],
  ])('rejects %s = %d', (path, value) => {
    expectRejected(withValue(path, value), path.replace(/\.(\d+)$/, '[$1]'))
  })

  it('rejects segment shares that do not sum to 1', () => {
    expectRejected(
      withValue(`${WEEKDAY}.segmentShares`, {
        aubaine: 0.3,
        habitue: 0.5,
        chic: 0.3,
      }),
      `${WEEKDAY}.segmentShares`,
    )
  })

  it('accepts segment shares off 1 by rounding only', () => {
    const shares = { aubaine: 0.7, habitue: 0.2, chic: 0.1 }
    expect(shares.aubaine + shares.habitue + shares.chic).not.toBe(1)
    expect(() =>
      loadFoodTruckContent(withValue(`${WEEKDAY}.segmentShares`, shares)),
    ).not.toThrow()
  })

  it('rejects arrival weights that are all 0', () => {
    expectRejected(
      withValue(
        `${WEEKDAY}.arrivalWeights`,
        foodTruckJson.walkIns.dayTypes.semaine.arrivalWeights.map(() => 0),
      ),
      `${WEEKDAY}.arrivalWeights`,
    )
  })

  it('rejects arrival weights that do not fill the opening hours', () => {
    const weights = foodTruckJson.walkIns.dayTypes.semaine.arrivalWeights
    for (const wrong of [weights.slice(1), [...weights, 1]]) {
      expectRejected(
        withValue(`${WEEKDAY}.arrivalWeights`, wrong),
        `${WEEKDAY}.arrivalWeights`,
      )
    }
  })

  it.each([900, 960])(
    'rejects a closing time of %d, not after opening',
    (opensAtMinute) => {
      expectRejected(
        withValue('walkIns.opensAtMinute', opensAtMinute),
        'walkIns.closesAtMinute',
      )
    },
  )

  it('rejects opening hours that do not divide into slots', () => {
    expectRejected(
      withValue('walkIns.arrivalSlotMinutes', 25),
      'walkIns.arrivalSlotMinutes',
    )
  })

  it('accepts other slots that fill the opening hours', () => {
    const raw = dayTypeIdSchema.options.reduce(
      (source, dayType) =>
        withValue(
          `walkIns.dayTypes.${dayType}.arrivalWeights`,
          [1, 2, 3, 4, 5, 6, 7, 8],
          source,
        ),
      withValue('walkIns.arrivalSlotMinutes', 60),
    )
    expect(loadFoodTruckContent(raw).walkIns.arrivalSlotMinutes).toBe(60)
  })
})

describe('loadCustomerContent', () => {
  const loadCustomers: Load = loadCustomerContent
  const reject = (raw: unknown, path: string) =>
    expectRejected(raw, path, loadCustomers)
  const withCustomerValue = (path: string, value: unknown) =>
    withValue(path, value, segmentsJson)

  it('loads the shipped segments.json with every product for each segment', () => {
    const { segments } = loadCustomerContent()
    expect(Object.keys(segments).sort()).toEqual(
      [...segmentIdSchema.options].sort(),
    )
    for (const segment of Object.values(segments)) {
      expect(Object.keys(segment.products).sort()).toEqual(
        [...productIdSchema.options].sort(),
      )
    }
    expect(segments.chic.tooCheap).toBeDefined()
  })

  it('names segments.json in its error', () => {
    expect(() => loadCustomerContent({})).toThrow(/^segments\.json is invalid/)
  })

  it('rejects a missing segment', () => {
    reject(without('segments.habitue', segmentsJson), 'segments.habitue')
  })

  it('rejects an unknown segment', () => {
    const raw = withCustomerValue(
      'segments.touriste',
      segmentsJson.segments.habitue,
    )
    reject(raw, 'segments')
    expect(() => loadCustomerContent(raw)).toThrow(
      'Unrecognized key: "touriste"',
    )
  })

  it('rejects a missing product', () => {
    reject(
      without('segments.aubaine.products.chocolat', segmentsJson),
      'segments.aubaine.products.chocolat',
    )
  })

  it('rejects a mistyped key', () => {
    const raw = withCustomerValue('segments.chic.products.cafe.sensitivty', 1)
    reject(raw, 'segments.chic.products.cafe')
    expect(() => loadCustomerContent(raw)).toThrow(
      'Unrecognized key: "sensitivty"',
    )
  })

  it.each([
    ['segments.habitue.products.cafe.referencePriceCents', 0],
    ['segments.habitue.products.cafe.referencePriceCents', -250],
    ['segments.habitue.products.cafe.referencePriceCents', 249.5],
    ['segments.aubaine.products.croissant.purchaseProbability', 1.1],
    ['segments.aubaine.products.croissant.purchaseProbability', -0.1],
    ['segments.chic.products.chocolat.sensitivity', -1],
    ['segments.chic.tooCheap.belowRatio', 0],
    ['segments.chic.tooCheap.belowRatio', 1],
    ['segments.chic.tooCheap.steepness', 0],
    ['segments.chic.tooCheap.steepness', -15],
    ['segments.chic.name', ''],
  ])('rejects %s = %s', (path, value) => {
    reject(withCustomerValue(path, value), path)
  })

  it('accepts a segment without tooCheap', () => {
    const raw = without('segments.chic.tooCheap', segmentsJson)
    expect(loadCustomerContent(raw).segments.chic.tooCheap).toBeUndefined()
  })
})
