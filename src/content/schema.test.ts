import { describe, expect, it } from 'vitest'
import foodTruckJson from './foodtruck.json'
import { loadFoodTruckContent, productIdSchema } from './schema.ts'

type Json = Record<string, unknown>

/**
 * Copies the shipped file and applies `change` to the object holding the last
 * key of the dotted `path`.
 */
function editedCopy(
  path: string,
  change: (parent: Json, key: string) => void,
): unknown {
  const copy = structuredClone(foodTruckJson) as Json
  const keys = path.split('.')
  const key = keys.pop() as string
  const parent = keys.reduce((node, k) => node[k] as Json, copy)
  change(parent, key)
  return copy
}

function withValue(path: string, value: unknown): unknown {
  return editedCopy(path, (parent, key) => {
    parent[key] = value
  })
}

function without(path: string): unknown {
  return editedCopy(path, (parent, key) => {
    delete parent[key]
  })
}

/** Expects the load to fail and the error to point at exactly `path`. */
function expectRejected(raw: unknown, path: string): void {
  const at = new RegExp(`→ at ${path.replaceAll('.', '\\.')}$`, 'm')
  expect(() => loadFoodTruckContent(raw)).toThrow(at)
}

// Shape only, like pacing.test.ts: the values themselves are tunable.
describe('loadFoodTruckContent', () => {
  it('loads the shipped foodtruck.json with every product in each section', () => {
    const content = loadFoodTruckContent()
    const ids = [...productIdSchema.options].sort()
    expect(Object.keys(content.products).sort()).toEqual(ids)
    expect(Object.keys(content.purchaseProbability).sort()).toEqual(ids)
    expect(Object.keys(content.restockPolicy).sort()).toEqual(ids)
  })

  it('rejects a float price', () => {
    expectRejected(
      withValue('products.cafe.basePriceCents', 2.5),
      'products.cafe.basePriceCents',
    )
  })

  it.each([
    'products.croissant.basePriceCents',
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

  it('rejects a missing product', () => {
    expectRejected(without('products.croissant'), 'products.croissant')
  })

  it.each(['purchaseProbability.croissant', 'restockPolicy.croissant'])(
    'rejects a product missing from %s',
    (path) => {
      expectRejected(without(path), path)
    },
  )

  it('rejects an unknown product id', () => {
    const muffin = { ...foodTruckJson.products.cafe, name: 'Muffin' }
    const raw = withValue('products.muffin', muffin)
    expectRejected(raw, 'products')
    expect(() => loadFoodTruckContent(raw)).toThrow(
      'Unrecognized key: "muffin"',
    )
  })

  it('rejects a mistyped key', () => {
    const raw = withValue('walkIns.weekdayCustomer', 120)
    expectRejected(raw, 'walkIns')
    expect(() => loadFoodTruckContent(raw)).toThrow(
      'Unrecognized key: "weekdayCustomer"',
    )
  })

  it('rejects a probability above 1', () => {
    expectRejected(
      withValue('purchaseProbability.cafe', 1.2),
      'purchaseProbability.cafe',
    )
  })

  it('rejects a shelf life of 0 days', () => {
    expectRejected(
      withValue('products.croissant.shelfLifeDays', 0),
      'products.croissant.shelfLifeDays',
    )
  })

  it.each([
    ['walkIns.weekendCustomers', -1],
    ['walkIns.weekdayCustomers', 120.5],
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
})
