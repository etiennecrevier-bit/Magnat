import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from './clock.ts'
import { FOOD_TRUCK } from './day.ts'
import { applyDecision } from './decisions.ts'
import { withoutLemonade } from './fixtures/lemonade.ts'
import { cents } from './money.ts'
import { deserialize, serialize } from './save.ts'
import type { GameState } from './types.ts'

// Saves and the lemonade (#261): a save from before it has none in its
// records by product, and loads with what a new game starts with; a save
// with it keeps it.

const SEED = 42
/** Day 31 is June 1st, lemonade's first day. */
const JUNE_FIRST = 31

function played(days: number, from = createInitialState(SEED)): GameState {
  let state = from
  for (let day = 0; day < days; day += 1) state = tick(state)
  return state
}

/** A spring game, with a café price waiting for the next morning. */
const SPRING = applyDecision(played(10), {
  kind: 'price',
  product: 'cafe',
  price: cents(300),
})

/**
 * A game that ordered 40 glasses a day from the start, played into June,
 * with lemonade's price waiting for the next morning.
 */
const SUMMER = applyDecision(
  played(
    JUNE_FIRST + 3,
    applyDecision(createInitialState(SEED), {
      kind: 'restock',
      product: 'limonade',
      rule: { kind: 'buyDaily', quantity: 40 },
    }),
  ),
  { kind: 'price', product: 'limonade', price: cents(450) },
)

/** The JSON of `state`'s save, which `edit` changes before it loads. */
function edited(
  state: GameState,
  edit: (save: Record<string, Record<string, Record<string, unknown>>>) => void,
): string {
  const save = JSON.parse(serialize(state)) as Parameters<typeof edit>[0]
  edit(save)
  return JSON.stringify(save)
}

describe('a save from before the lemonade (#261)', () => {
  it('loads with the lemonade a new game starts with, and nothing else moved', () => {
    const old = JSON.stringify(withoutLemonade(JSON.parse(serialize(SPRING))))
    expect(old).not.toContain('limonade')
    const loaded = deserialize(old)
    expect(loaded).toStrictEqual(SPRING)
    const { pricesCents, restock } = FOOD_TRUCK.startingDecisions
    for (const decisions of [loaded.decisions, loaded.pendingDecisions]) {
      expect(decisions?.prices.limonade).toBe(pricesCents.limonade)
      expect(decisions?.restock.limonade).toEqual(restock.limonade)
    }
    expect(loaded.lastDay?.sold.limonade).toBe(0)
    expect(loaded.lastDay?.pricedOut.limonade).toBe(0)
  })

  it('still needs every other product', () => {
    expect(() =>
      deserialize(
        edited(SPRING, (save) => {
          delete save.decisions?.prices?.croissant
        }),
      ),
    ).toThrow(/croissant/)
    expect(() =>
      deserialize(
        edited(SPRING, (save) => {
          delete save.lastDay?.sold?.cafe
        }),
      ),
    ).toThrow(/cafe/)
  })

  it('rejects a product it does not know', () => {
    expect(() =>
      deserialize(
        edited(SPRING, (save) => {
          const prices = save.decisions?.prices
          if (prices !== undefined) prices.poutine = 500
        }),
      ),
    ).toThrow(/poutine/)
  })
})

describe('a save with the lemonade (#261)', () => {
  it('sold some in June and has its next price waiting', () => {
    expect(SUMMER.lastDay?.sold.limonade).toBeGreaterThan(0)
    expect(SUMMER.pendingDecisions?.prices.limonade).toBe(450)
  })

  it('keeps it when saved and loaded again', () => {
    expect(deserialize(serialize(SUMMER))).toStrictEqual(SUMMER)
  })

  it.each([
    ['a price below zero', 'prices', -400],
    ['a restock rule without its quantity', 'restock', { kind: 'buyDaily' }],
    ['a restock rule of another kind', 'restock', topUp()],
  ])('rejects %s', (_, record, value) => {
    const text = edited(SUMMER, (save) => {
      const decisions = save.decisions?.[record]
      if (decisions !== undefined) decisions.limonade = value
    })
    expect(() => deserialize(text)).toThrow(/limonade/)
  })

  it('rejects units that are not whole', () => {
    const text = edited(SUMMER, (save) => {
      const sold = save.lastDay?.sold
      if (sold !== undefined) sold.limonade = 1.5
    })
    expect(() => deserialize(text)).toThrow(/limonade/)
  })
})

function topUp() {
  return { kind: 'topUp', whenBelow: 10, upTo: 40 }
}
