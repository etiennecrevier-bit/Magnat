import { describe, expect, it } from 'vitest'
import type { ProductId } from '../content/schema.ts'
import {
  PRODUCTS,
  inventoryValue,
  onHand,
  perProduct,
  removeExpired,
  takeFifo,
} from './inventory.ts'
import { cents } from './money.ts'
import type { Lot } from './types.ts'

function lot(
  product: ProductId,
  quantity: number,
  unitCost: number,
  boughtOnDay = 0,
): Lot {
  return { product, quantity, unitCost: cents(unitCost), boughtOnDay }
}

/** Deep-freezes the lots, so a test fails if anything writes to them. */
function frozen(lots: Lot[]): readonly Lot[] {
  return Object.freeze(lots.map((l) => Object.freeze(l)))
}

const SHELF_LIFE = { cafe: 90, croissant: 1 }

describe('perProduct', () => {
  it('has every product and nothing else', () => {
    expect(perProduct((product) => product.length)).toEqual({
      cafe: 4,
      croissant: 9,
    })
    expect(PRODUCTS).toEqual(['cafe', 'croissant'])
  })
})

describe('onHand and inventoryValue', () => {
  const lots = frozen([
    lot('cafe', 3, 40),
    lot('croissant', 5, 90),
    lot('cafe', 2, 45, 1),
  ])

  it('counts the units of one product across its lots', () => {
    expect(onHand(lots, 'cafe')).toBe(5)
    expect(onHand(lots, 'croissant')).toBe(5)
    expect(onHand([], 'cafe')).toBe(0)
  })

  it('values every lot at its own unit cost', () => {
    expect(inventoryValue(lots)).toBe(3 * 40 + 5 * 90 + 2 * 45)
    expect(inventoryValue([])).toBe(0)
  })
})

describe('takeFifo', () => {
  const lots = frozen([
    lot('cafe', 3, 10, 0),
    lot('croissant', 4, 90, 0),
    lot('cafe', 5, 20, 1),
  ])

  it('takes from the oldest lot first', () => {
    expect(takeFifo(lots, 'cafe', 2)).toEqual({
      lots: [lot('cafe', 1, 10, 0), lots[1], lots[2]],
      taken: 2,
      cost: 20,
    })
  })

  it('empties a lot, then splits the next one, at each lot cost', () => {
    expect(takeFifo(lots, 'cafe', 5)).toEqual({
      lots: [lots[1], lot('cafe', 3, 20, 1)],
      taken: 5,
      cost: 3 * 10 + 2 * 20,
    })
  })

  it('takes no more than is on hand and drops the empty lots', () => {
    expect(takeFifo(lots, 'cafe', 100)).toEqual({
      lots: [lots[1]],
      taken: 8,
      cost: 3 * 10 + 5 * 20,
    })
  })

  it('leaves the lots as they are when taking nothing', () => {
    expect(takeFifo(lots, 'croissant', 0)).toEqual({
      lots,
      taken: 0,
      cost: 0,
    })
    expect(takeFifo([], 'cafe', 3)).toEqual({ lots: [], taken: 0, cost: 0 })
  })

  it('leaves the other products alone', () => {
    const { lots: left } = takeFifo(lots, 'croissant', 4)
    expect(left).toEqual([lots[0], lots[2]])
    expect(left[0]).toBe(lots[0])
  })

  it.each([-1, 1.5, Number.NaN])('rejects quantity %s', (quantity) => {
    expect(() => takeFifo(lots, 'cafe', quantity)).toThrow(RangeError)
  })
})

describe('removeExpired', () => {
  it('writes croissants off at the close of the day they were bought', () => {
    const lots = frozen([lot('croissant', 7, 90, 4), lot('cafe', 2, 40, 4)])
    expect(removeExpired(lots, 4, SHELF_LIFE)).toEqual({
      lots: [lots[1]],
      spoiled: { cafe: 0, croissant: 7 },
      cost: 7 * 90,
    })
  })

  it('keeps coffee for 90 days, counting the day it was bought', () => {
    const lots = frozen([lot('cafe', 6, 40, 10)])
    expect(removeExpired(lots, 10 + 88, SHELF_LIFE)).toEqual({
      lots,
      spoiled: { cafe: 0, croissant: 0 },
      cost: 0,
    })
    expect(removeExpired(lots, 10 + 89, SHELF_LIFE)).toEqual({
      lots: [],
      spoiled: { cafe: 6, croissant: 0 },
      cost: 6 * 40,
    })
  })

  it('also removes lots already past their shelf life', () => {
    const lots = frozen([lot('cafe', 1, 40, 0), lot('cafe', 2, 50, 20)])
    expect(removeExpired(lots, 100, SHELF_LIFE)).toEqual({
      lots: [lots[1]],
      spoiled: { cafe: 1, croissant: 0 },
      cost: 40,
    })
  })

  it('adds up several spoiled lots of one product', () => {
    const lots = frozen([lot('croissant', 2, 90, 3), lot('croissant', 5, 80)])
    expect(removeExpired(lots, 3, SHELF_LIFE)).toEqual({
      lots: [],
      spoiled: { cafe: 0, croissant: 7 },
      cost: 2 * 90 + 5 * 80,
    })
  })
})
