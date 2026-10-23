import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import type { GameState, MarketingDay } from '../engine/types.ts'
import { marketingFacts, marketingText } from './marketingFacts.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

const day = (n: number, spent = 3_000, customers = 2, sales = 500) => ({
  day: n,
  spent: cents(spent),
  customers,
  sales: cents(sales),
})

describe('marketingText', () => {
  it('tells what was spent, the walk-ins it brought and what they paid', () => {
    expect(
      marketingText({
        spent: cents(21_000),
        customers: 41,
        sales: cents(31_840),
      }),
    ).toBe(
      `210${S}$ dépensés · 41 clients venus par la pub · 318${S}$ de ventes`,
    )
    expect(
      marketingText({ spent: cents(3_000), customers: 1, sales: cents(0) }),
    ).toBe(`30${S}$ dépensés · 1 client venu par la pub · 0${S}$ de ventes`)
  })
})

describe('marketingFacts', () => {
  it('says nothing before a day is kept', () => {
    expect(marketingFacts(undefined)).toBeNull()
    expect(marketingFacts([])).toBeNull()
  })

  it('sums the last 7 days in a line, and shows the 4 weeks side by side', () => {
    const history: MarketingDay[] = Array.from({ length: 28 }, (_, index) =>
      day(100 + index, 1_000 * (1 + Math.floor(index / 7)), index, 100),
    )
    const facts = marketingFacts(history)
    // The last week spent 40 $ a day; its walk-ins 21 to 27.
    expect(facts?.line).toBe(
      `7 derniers jours${S}: 280${S}$ dépensés · ${21 + 22 + 23 + 24 + 25 + 26 + 27} clients venus par la pub · 7${S}$ de ventes`,
    )
    expect(facts?.tip.rows).toHaveLength(4)
    expect(facts?.tip.rows?.map(({ value }) => value.split(' · ')[0])).toEqual([
      `70${S}$`,
      `140${S}$`,
      `210${S}$`,
      `280${S}$`,
    ])
    // No ratio, no verdict: only amounts and counts.
    expect(JSON.stringify(facts)).not.toMatch(/%|rendement|rentab/i)
  })

  it('shows only the weeks kept, in an early game', () => {
    expect(marketingFacts([day(0), day(1)])?.tip.rows).toHaveLength(1)
  })

  it('reads what the engine kept over a seeded month', () => {
    let game: GameState = applyDecision(createInitialState(42), {
      kind: 'marketingDaily',
      budget: cents(4_000),
    })
    for (let n = 0; n < 30; n += 1) game = tick(game)
    const facts = marketingFacts(game.marketingDays)
    const week = (game.marketingDays ?? []).slice(-7)
    const customers = week.reduce((total, { customers: c }) => total + c, 0)
    expect(customers).toBeGreaterThan(0)
    expect(facts?.line).toContain(` ${customers} clients venus par la pub`)
  })
})
