import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { DIFFICULTIES, FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import { cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import {
  menuFact,
  onSale,
  productBoards,
  productTip,
  stockFact,
  tomorrowPrice,
  tomorrowRule,
  unitCost,
  yesterdayFacts,
  type YesterdayFacts,
} from './productFacts.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

const START = createInitialState(42)

/** `game` played to the morning of `day`. */
function playedTo(game: GameState, day: number): GameState {
  let next = game
  while (next.day < day) next = tick(next)
  return next
}

function facts(over: Partial<YesterdayFacts> = {}): YesterdayFacts {
  return {
    sold: 40,
    pricedOut: 0,
    lostSales: 0,
    spoiled: 0,
    soldOutMinute: null,
    segments: [],
    ...over,
  }
}

describe('menuFact', () => {
  it('picks « Hors vente », then a stockout, too expensive, spoiled, then how it sold', () => {
    const all = facts({
      lostSales: 4,
      soldOutMinute: 14 * 60 + 10,
      pricedOut: 12,
      spoiled: 8,
    })
    expect(menuFact(all, false)).toEqual({ tone: 'off', text: 'Hors vente' })
    expect(menuFact(all, true)).toEqual({
      tone: 'bad',
      text: `Rupture vers 14${S}h`,
    })
    expect(menuFact(facts({ pricedOut: 12, spoiled: 8 }), true)).toEqual({
      tone: 'warn',
      text: '12 clients trouvaient ça cher',
    })
    expect(menuFact(facts({ spoiled: 8 }), true)).toEqual({
      tone: 'warn',
      text: '8 périmés hier',
    })
    expect(menuFact(facts(), true)).toEqual({
      tone: 'ok',
      text: 'Bien vendu hier',
    })
    expect(menuFact(facts({ sold: 0 }), true)).toEqual({
      tone: 'off',
      text: 'Aucune vente hier',
    })
  })

  it('words one customer and one unit in the singular', () => {
    expect(menuFact(facts({ pricedOut: 1 }), true)?.text).toBe(
      '1 client trouvait ça cher',
    )
    expect(menuFact(facts({ spoiled: 1 }), true)?.text).toBe('1 périmé hier')
  })

  it('rounds the stockout to the nearest hour, and says only « hier » when no sale tells when', () => {
    expect(
      menuFact(facts({ lostSales: 1, soldOutMinute: 512 }), true)?.text,
    ).toBe(`Rupture vers 9${S}h`)
    expect(
      menuFact(facts({ lostSales: 1, soldOutMinute: 869 }), true)?.text,
    ).toBe(`Rupture vers 14${S}h`)
    expect(
      menuFact(facts({ lostSales: 3, soldOutMinute: null, sold: 0 }), true),
    ).toEqual({ tone: 'bad', text: 'Rupture hier' })
  })

  it('has no fact of yesterday before the first day is over, but still « Hors vente »', () => {
    expect(menuFact(null, true)).toBeNull()
    expect(menuFact(null, false)?.text).toBe('Hors vente')
  })

  it('says « Hors saison » first, out of its season (#261)', () => {
    const all = facts({ lostSales: 4, pricedOut: 12, spoiled: 8 })
    const offSeason = { tone: 'off', text: 'Hors saison' }
    expect(menuFact(all, false, false)).toEqual(offSeason)
    expect(menuFact(null, false, false)).toEqual(offSeason)
    expect(menuFact(all, true, true)?.text).toBe('Rupture hier')
  })
})

describe('stockFact', () => {
  it('picks a stockout, then spoiled, then what was left', () => {
    expect(
      stockFact(facts({ lostSales: 2, soldOutMinute: 600, spoiled: 3 }), 0),
    ).toEqual({ tone: 'bad', text: `Rupture vers 10${S}h` })
    expect(stockFact(facts({ spoiled: 3 }), 5)).toEqual({
      tone: 'warn',
      text: '3 périmés hier',
    })
    expect(stockFact(facts(), 24)).toEqual({
      tone: 'off',
      text: 'Il en restait 24 hier',
    })
    expect(stockFact(facts(), 0)?.text).toBe("Il n'en restait plus hier")
    expect(stockFact(null, 0)).toBeNull()
  })

  it('says « Hors saison » first, out of its season, when its rule buys nothing (#261)', () => {
    const offSeason = { tone: 'off', text: 'Hors saison' }
    expect(stockFact(facts({ spoiled: 3 }), 0, false)).toEqual(offSeason)
    expect(stockFact(null, 0, false)).toEqual(offSeason)
    expect(stockFact(facts({ spoiled: 3 }), 0, true)?.text).toBe(
      '3 périmés hier',
    )
  })
})

describe('tomorrow', () => {
  it('says the price of tomorrow only when it changes', () => {
    expect(tomorrowPrice(cents(325), cents(325))).toBeNull()
    expect(tomorrowPrice(cents(325), cents(350))).toBe(`Demain${S}: 3,50${S}$`)
  })

  it('says the rule of tomorrow only when it changes', () => {
    const daily = { kind: 'buyDaily', quantity: 70 } as const
    const topUp = { kind: 'topUp', whenBelow: 100, upTo: 300 } as const
    expect(tomorrowRule(daily, daily)).toBeNull()
    expect(tomorrowRule(daily, { ...daily, quantity: 80 })).toBe(
      `Demain${S}: 80 par jour`,
    )
    expect(tomorrowRule(topUp, { ...topUp })).toBeNull()
    expect(tomorrowRule(topUp, { ...topUp, whenBelow: 120 })).toBe(
      `Demain${S}: sous 120, jusqu'à 300`,
    )
  })
})

describe('onSale', () => {
  it('is on sale while the rule of the day brings some', () => {
    for (const product of PRODUCTS) {
      if (product !== 'limonade') expect(onSale(START, product)).toBe(true)
    }
  })

  it('is off sale out of its season, whatever its rule (#261)', () => {
    const ordered = applyDecision(START, {
      kind: 'restock',
      product: 'limonade',
      rule: { kind: 'buyDaily', quantity: 30 },
    })
    // May 31st, then June 1st, both ends of the season, then September 16th.
    const may31 = playedTo(ordered, 30)
    expect(onSale(may31, 'limonade')).toBe(false)
    expect(productBoards(may31).limonade).toMatchObject({
      inSeason: false,
      onSale: false,
    })
    const june1 = playedTo(may31, 31)
    expect(productBoards(june1).limonade).toMatchObject({
      inSeason: true,
      onSale: true,
    })
    const september15 = playedTo(june1, 137)
    expect(onSale(september15, 'limonade')).toBe(true)
    expect(onSale(playedTo(september15, 138), 'limonade')).toBe(false)
  })

  it('is off sale with none on hand and a rule that brings none', () => {
    const game = playedTo(
      applyDecision(START, {
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity: 0 },
      }),
      2,
    )
    expect(onSale(game, 'croissant')).toBe(false)
    expect(onSale(game, 'cafe')).toBe(true)
  })

  it('reads the restock rule for croissants wanted made while no bakery runs', () => {
    // Made, with no bakery, so bought: the restock rule of 0 supplies
    // them, not the bake rule of 70.
    const game = playedTo(
      applyDecision(
        applyDecision(START, {
          kind: 'restock',
          product: 'croissant',
          rule: { kind: 'buyDaily', quantity: 0 },
        }),
        { kind: 'croissantSource', source: 'fabriquer' },
      ),
      2,
    )
    expect(game.decisions.bake).toEqual({ kind: 'buyDaily', quantity: 70 })
    expect(onSale(game, 'croissant')).toBe(false)
  })
})

describe('unitCost', () => {
  const { croissant } = FOOD_TRUCK.products

  it('is the content cost plus the packaging', () => {
    expect(unitCost(START, 'croissant')).toBe(
      croissant.unitCostCents + croissant.packagingCents,
    )
  })

  it('is the bought cost for croissants wanted made while no bakery runs', () => {
    const game = applyDecision(START, {
      kind: 'croissantSource',
      source: 'fabriquer',
    })
    expect(unitCost(game, 'croissant')).toBe(
      croissant.unitCostCents + croissant.packagingCents,
    )
  })

  it("is the bakery's ingredients for croissants it will make", () => {
    const game = applyDecision(
      applyDecision(START, { kind: 'openBakery', oven: 'louer' }),
      { kind: 'croissantSource', source: 'fabriquer' },
    )
    const { ingredientCostCents } =
      DIFFICULTIES.bakery[START.profile.difficulty]
    expect(unitCost(game, 'croissant')).toBe(
      ingredientCostCents + croissant.packagingCents,
    )
  })
})

describe("a seeded day's facts", () => {
  // Day 0 is a Monday, closed; the croissants run out on day 1.
  const game = playedTo(
    applyDecision(START, {
      kind: 'restock',
      product: 'croissant',
      rule: { kind: 'buyDaily', quantity: 20 },
    }),
    2,
  )
  const day = game.lastDay
  if (day === null) throw new Error('No day played')

  it("equal the engine's numbers, by product and by segment", () => {
    for (const product of PRODUCTS) {
      const found = yesterdayFacts(day, product)
      expect(found.sold).toBe(day.sold[product])
      expect(found.lostSales).toBe(day.lostSales[product])
      expect(found.spoiled).toBe(day.spoiled[product])
      for (const { segment, sold } of found.segments) {
        expect(sold).toBe(
          day.visits
            .filter((visit) => visit.segment === segment)
            .reduce((units, visit) => units + visit.bought[product], 0),
        )
      }
      expect(found.segments.reduce((units, { sold }) => units + sold, 0)).toBe(
        day.sold[product],
      )
    }
  })

  it('times the stockout by the last croissant served', () => {
    const croissant = yesterdayFacts(day, 'croissant')
    expect(croissant.lostSales).toBeGreaterThan(0)
    const last = Math.max(
      ...day.visits
        .filter((visit) => visit.bought.croissant > 0)
        .map((visit) => visit.servedMinute ?? 0),
    )
    expect(croissant.soldOutMinute).toBe(last)
    expect(yesterdayFacts(day, 'cafe').soldOutMinute).toBeNull()
  })

  it('puts them in the tooltip, then the cost and margin, then each segment under a line', () => {
    const board = productBoards(game).croissant
    const price = game.decisions.prices.croissant
    const tip = productTip('croissant', board.facts, price, board.cost)
    expect(tip.title).toBe('Croissant · hier')
    const rows = tip.rows ?? []
    const value = (label: string) =>
      rows.find((row) => row.label === label)?.value
    expect(value('Vendus')).toBe(String(day.sold.croissant))
    expect(value('Rupture')).toBe(String(day.lostSales.croissant))
    expect(rows.find((row) => row.label === 'Rupture')?.warn).toBe(true)
    expect(value('Périmés')).toBe(String(day.spoiled.croissant))
    expect(value('Coût unitaire')).toBe(`1,15${S}$`)
    expect(value('Marge unitaire')).toBe(`2,60${S}$`)
    // The tourists (#260) come last, none of them on the Plateau.
    const segments = rows.slice(-4)
    expect(segments.map((row) => row.label)).toEqual([
      "Chasseurs d'aubaines",
      'Habitués',
      'Clientèle chic',
      'Touristes',
    ])
    expect(segments.map((row) => row.divider === true)).toEqual([
      true,
      false,
      false,
      false,
    ])
    for (const [index, row] of segments.entries()) {
      expect(row.value).toBe(
        `${board.facts?.segments[index]?.sold ?? NaN} vendus`,
      )
    }
  })

  it('shows only the cost and the margin before the first day is over', () => {
    const tip = productTip('cafe', null, cents(325), cents(65))
    expect(tip).toEqual({
      title: 'Café',
      text: "Aucune journée terminée pour l'instant.",
      rows: [
        { label: 'Coût unitaire', value: `0,65${S}$` },
        { label: 'Marge unitaire', value: `2,60${S}$` },
      ],
    })
  })
})

describe('a seeded day where the croissant is too expensive (#268)', () => {
  // Croissants at 6 $, with plenty on hand so no stockout hides the line.
  const game = playedTo(
    applyDecision(
      applyDecision(START, {
        kind: 'price',
        product: 'croissant',
        price: cents(600),
      }),
      {
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity: 200 },
      },
    ),
    2,
  )
  const day = game.lastDay
  if (day === null) throw new Error('No day played')

  it("counts the engine's « trop cher » for each product", () => {
    expect(day.pricedOut.croissant).toBeGreaterThan(0)
    expect(day.lostSales.croissant).toBe(0)
    for (const product of PRODUCTS) {
      expect(yesterdayFacts(day, product).pricedOut).toBe(
        day.pricedOut[product],
      )
    }
  })

  it("says so on the card's status line", () => {
    const board = productBoards(game).croissant
    expect(menuFact(board.facts, board.onSale)).toEqual({
      tone: 'warn',
      text: `${day.pricedOut.croissant} clients trouvaient ça cher`,
    })
  })

  it('shows a « Trop cher » row in the tooltip, after « Vendus »', () => {
    const board = productBoards(game).croissant
    const price = game.decisions.prices.croissant
    const rows = productTip('croissant', board.facts, price, board.cost).rows
    expect((rows ?? []).slice(0, 3).map((row) => row.label)).toEqual([
      'Vendus',
      'Trop cher',
      'Rupture',
    ])
    expect(rows?.[1]).toEqual({
      label: 'Trop cher',
      value: String(day.pricedOut.croissant),
      warn: true,
    })
  })
})
