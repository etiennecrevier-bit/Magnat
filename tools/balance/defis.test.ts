import { describe, expect, it } from 'vitest'
import type { Defi, DefiContent } from '../../src/content/schema.ts'
import { defiById } from '../../src/engine/challenge.ts'
import { DEFIS } from '../../src/engine/day.ts'
import { cents } from '../../src/engine/money.ts'
import {
  bestStrategy,
  DEFI_TARGETS,
  defiOwnerChanges,
  defiTarget,
  finishedPercentiles,
  gridOwnerChanges,
  medalCounts,
  outcomeAt,
  playDefi,
  quantile,
  runDefi,
  score,
  suggestedThresholds,
  worstFirst,
  type DefiGame,
  type DefiRun,
} from './defis.ts'
import { ownerStrategy } from './owners.ts'
import { STRATEGIES, strategyChanges, type Strategy } from './strategies.ts'

// The Défis as `npm run balance -- --defis` plays them: the owners'
// decisions, one game, the search for the best strategy, and the shares
// and percentiles the report and the table hold.

const BASE: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(0),
  daysOpen: 6,
  ownerWeeklyPay: cents(70_000),
}

/** The shipped Défis with `id` changed by `change`. */
function withDefi(id: string, change: (defi: Defi) => Defi): DefiContent {
  return {
    ...DEFIS,
    defis: DEFIS.defis.map((defi) => (defi.id === id ? change(defi) : defi)),
  }
}

/** A game that ended with `value`, for the summaries. */
function game(
  seed: number,
  value: number,
  {
    broken = false,
    medal = null,
  }: Partial<Pick<DefiGame, 'broken' | 'medal'>> = {},
): DefiGame {
  return {
    seed,
    strategy: BASE,
    status: medal === null ? 'echoue' : 'reussi',
    medal,
    broken,
    value,
    daysPlayed: 7,
  }
}

describe('defiOwnerChanges', () => {
  it("is the grid's own changes in a Défi that opens on the starting decisions", () => {
    const defi = defiById(DEFIS, 'semaineDesMilleDollars')
    for (const strategy of STRATEGIES) {
      expect(defiOwnerChanges(strategy, defi)).toEqual(
        strategyChanges(strategy),
      )
    }
  })

  it("scales the Défi's opening croissants as the grid scales the starting 70, rounded half up", () => {
    const defi: Defi = {
      ...defiById(DEFIS, 'zeroGaspillage'),
      setup: { restock: { croissant: { kind: 'buyDaily', quantity: 30 } } },
    }
    const croissants = (croissantsPerDay: number) =>
      defiOwnerChanges({ ...BASE, croissantsPerDay }, defi).find(
        (change) => change.kind === 'restock',
      )
    expect([40, 70, 110].map(croissants)).toEqual(
      [17, 30, 47].map((quantity) => ({
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity },
      })),
    )
  })

  it("moves the Défi's opening prices", () => {
    const defi: Defi = {
      ...defiById(DEFIS, 'semaineDesMilleDollars'),
      setup: { prices: { croissant: cents(400) } },
    }
    const prices = defiOwnerChanges({ ...BASE, priceChange: 20 }, defi).filter(
      (change) => change.kind === 'price',
    )
    expect(prices).toEqual([
      { kind: 'price', product: 'cafe', price: 390 },
      { kind: 'price', product: 'chocolat', price: 420 },
      { kind: 'price', product: 'croissant', price: 480 },
      { kind: 'price', product: 'limonade', price: 480 },
    ])
  })

  it('leaves out the kinds the Défi locks', () => {
    const changes = defiOwnerChanges(BASE, defiById(DEFIS, 'moisSansConge'))
    expect(changes.map(({ kind }) => kind)).toEqual([
      'price',
      'price',
      'price',
      'price',
      'restock',
      'marketingDaily',
      'ownerWeeklyPay',
    ])
  })
})

describe('gridOwnerChanges', () => {
  it("is the grid's own values, P3-13's owners, less the kinds the Défi locks", () => {
    const strategy = ownerStrategy(4)
    const zero = defiById(DEFIS, 'zeroGaspillage')
    expect(gridOwnerChanges(strategy, zero)).toEqual(strategyChanges(strategy))
    expect(
      gridOwnerChanges(strategy, defiById(DEFIS, 'moisSansConge')),
    ).toEqual(
      strategyChanges(strategy).filter(({ kind }) => kind !== 'daysOpen'),
    )
  })
})

describe('playDefi', () => {
  it('plays the same game from the same seed and strategy, to its end', () => {
    const strategy = ownerStrategy(3)
    const played = playDefi('semaineDesMilleDollars', 3, strategy)
    expect(playDefi('semaineDesMilleDollars', 3, strategy)).toEqual(played)
    expect(played).toMatchObject({ seed: 3, strategy, daysPlayed: 7 })
    expect(['reussi', 'echoue']).toContain(played.status)
    expect(played.broken).toBe(false)
  })

  it("makes the owner's changes on the first morning, so they take effect on the second day", () => {
    // The Défi opens on Monday, May 8, a day the starting decisions close;
    // these would open it.
    const cheap = { ...BASE, priceChange: -20 as const, daysOpen: 7 as const }
    const dear = { ...BASE, priceChange: 40 as const, daysOpen: 7 as const }
    const days = (lengthDays: number) =>
      withDefi('semaineDesMilleDollars', (defi) => ({ ...defi, lengthDays }))
    const value = (strategy: Strategy, lengthDays: number) =>
      playDefi('semaineDesMilleDollars', 5, strategy, days(lengthDays)).value
    expect(value(cheap, 1)).toBe(value(dear, 1))
    expect(value(cheap, 2)).not.toBe(value(dear, 2))
  })

  it("makes the changes it is given in place of the owner's", () => {
    const strategy = ownerStrategy(2)
    expect(
      playDefi('zeroGaspillage', 2, strategy, DEFIS, gridOwnerChanges),
    ).not.toEqual(playDefi('zeroGaspillage', 2, strategy))
    expect(
      playDefi('zeroGaspillage', 2, strategy, DEFIS, defiOwnerChanges),
    ).toEqual(playDefi('zeroGaspillage', 2, strategy))
  })

  it('answers a forced card only with a choice the Défi allows', () => {
    // Every choice of « La grosse commande » but `accepter` would throw.
    const defis = withDefi('payeDans60Jours', (defi) => ({
      ...defi,
      lengthDays: 3,
    }))
    for (let seed = 1; seed <= 12; seed += 1) {
      expect(playDefi('payeDans60Jours', seed, BASE, defis).daysPlayed).toBe(3)
    }
  })

  it('ends at once when a condition breaks, with no medal', () => {
    const defis = withDefi('travauxSaintDenis', (defi) => ({
      ...defi,
      setup: { cashCents: cents(0) },
    }))
    const played = playDefi('travauxSaintDenis', 1, BASE, defis)
    expect(played).toMatchObject({
      status: 'echoue',
      medal: null,
      broken: true,
    })
    expect(played.daysPlayed).toBeLessThan(21)
    expect(played.value).toBeLessThan(0)
  })
})

describe('score and worstFirst', () => {
  it('ranks a broken game below every other, whatever it measured', () => {
    const games = [game(1, 50), game(2, 900, { broken: true }), game(3, -10)]
    expect(score('netIncome', games[1]!)).toBe(-Infinity)
    expect(worstFirst('netIncome', games).map(({ seed }) => seed)).toEqual([
      2, 3, 1,
    ])
  })

  it('ranks a lower spoilage rate higher, and ties by seed', () => {
    const games = [game(1, 0.02), game(2, 0.05), game(3, 0.01), game(4, 0.02)]
    expect(worstFirst('spoilageRate', games).map(({ seed }) => seed)).toEqual([
      2, 1, 4, 3,
    ])
  })
})

describe('bestStrategy', () => {
  it('picks the strategy with the best median, on the seeds searched', () => {
    const strategies = [
      { ...BASE, priceChange: 40 as const, daysOpen: 5 as const },
      BASE,
      { ...BASE, marketingDaily: cents(3000) },
    ]
    const median = (strategy: Strategy) => {
      const values = [1, 2, 3]
        .map((seed) => playDefi('semaineDesMilleDollars', seed, strategy).value)
        .sort((a, b) => a - b)
      return values[1] ?? 0
    }
    const best = strategies.reduce((a, b) => (median(b) > median(a) ? b : a))
    expect(bestStrategy('semaineDesMilleDollars', 3, strategies)).toBe(best)
  })

  it('keeps the first of strategies that play the same games', () => {
    // Mois sans congé locks the days open, so these two play alike.
    const strategies = [BASE, { ...BASE, daysOpen: 7 as const }]
    expect(bestStrategy('moisSansConge', 1, strategies)).toBe(strategies[0])
  })

  it('throws on no strategies or no seeds', () => {
    expect(() => bestStrategy('moisSansConge', 1, [])).toThrow(RangeError)
    expect(() => bestStrategy('moisSansConge', 0, [BASE])).toThrow(
      'Seeds must be a whole number from 1: 0',
    )
  })
})

describe('runDefi', () => {
  it("plays each seed's owner, and the best strategy on the same seeds", () => {
    const run = runDefi({
      defi: 'semaineDesMilleDollars',
      games: 2,
      search: 1,
      strategies: [BASE],
    })
    expect(run).toEqual({
      defi: 'semaineDesMilleDollars',
      owners: [1, 2].map((seed) =>
        playDefi('semaineDesMilleDollars', seed, ownerStrategy(seed)),
      ),
      best: {
        strategy: BASE,
        games: [1, 2].map((seed) =>
          playDefi('semaineDesMilleDollars', seed, BASE),
        ),
      },
    })
  })

  it('throws unless games and search are whole numbers from 1', () => {
    const run = (games: number, search: number) => () =>
      runDefi({ defi: 'moisSansConge', games, search, strategies: [BASE] })
    expect(run(0, 1)).toThrow('Games must be a whole number from 1: 0')
    expect(run(1, 1.5)).toThrow('Search must be a whole number from 1: 1.5')
  })
})

describe('medalCounts and defiTarget', () => {
  /** 1000 games: `or` with « Or », then « Argent », « Bronze », none. */
  function games(or: number, argent: number, bronze: number, broken = 0) {
    const medals = [
      ...Array<'or'>(or).fill('or'),
      ...Array<'argent'>(argent).fill('argent'),
      ...Array<'bronze'>(bronze).fill('bronze'),
    ]
    return Array.from({ length: 1000 }, (_, index) =>
      game(index + 1, 0, {
        medal: medals[index] ?? null,
        broken: index >= 1000 - broken,
      }),
    )
  }

  function run(owners: DefiGame[], best: DefiGame[]): DefiRun {
    return {
      defi: 'semaineDesMilleDollars',
      owners,
      best: { strategy: BASE, games: best },
    }
  }

  it('counts the medals cumulatively, and the broken games', () => {
    expect(medalCounts(games(80, 270, 350, 100))).toEqual({
      games: 1000,
      broken: 100,
      or: 80,
      argentOrBetter: 350,
      bronzeOrBetter: 700,
    })
  })

  it('meets every target in the middle of each', () => {
    expect(defiTarget(run(games(80, 270, 350), games(900, 0, 0))).met).toBe(
      true,
    )
  })

  it('wants « Or » in under 10 % of the owners: 100 of 1000 is too many', () => {
    expect(DEFI_TARGETS.orBelow).toBe(10)
    expect(defiTarget(run(games(99, 251, 350), games(900, 0, 0))).or).toBe(true)
    const check = defiTarget(run(games(100, 250, 350), games(900, 0, 0)))
    expect(check).toMatchObject({ or: false, met: false })
  })

  it('takes the bounds of « Argent » and « Bronze » as within', () => {
    const at = (argent: number, bronze: number) =>
      defiTarget(run(games(0, argent, bronze - argent), games(1000, 0, 0)))
    expect(at(300, 650)).toMatchObject({ argent: true, bronze: true })
    expect(at(400, 750)).toMatchObject({ argent: true, bronze: true })
    expect(at(299, 649)).toMatchObject({ argent: false, bronze: false })
    expect(at(401, 751)).toMatchObject({ argent: false, bronze: false })
  })

  it('wants « Or » in 80 % of the best strategy’s games', () => {
    const owners = games(80, 270, 350)
    expect(defiTarget(run(owners, games(800, 0, 0))).bestOr).toBe(true)
    expect(defiTarget(run(owners, games(799, 0, 0)))).toMatchObject({
      bestOr: false,
      met: false,
    })
  })
})

describe('the percentiles', () => {
  it('interpolates a share or an energy to 4 decimals', () => {
    expect(quantile('spoilageRate', [0, 0.1], 25)).toBe(0.025)
    expect(quantile('lowestEnergy', [30, 40, 41], 75)).toBe(40.5)
    expect(quantile('lowestEnergy', [1 / 3], 50)).toBe(0.3333)
  })

  it('rounds cents and customers half away from zero', () => {
    expect(quantile('netIncome', [-3, -2], 50)).toBe(-3)
    expect(quantile('customersServed', [10, 11], 50)).toBe(11)
  })

  it("holds the finished games' values in increasing order, null if every game broke", () => {
    const games = [
      game(1, 300),
      game(2, -100, { broken: true }),
      game(3, 100),
      game(4, 200),
    ]
    expect(finishedPercentiles('sales', games, [0, 50, 100])).toEqual([
      100, 200, 300,
    ])
    expect(
      finishedPercentiles('sales', [game(1, 5, { broken: true })]),
    ).toBeNull()
  })

  it('suggests the outcomes counted from the worst, n/a among the broken', () => {
    // 10 games: 3 broken, then 10 to 70.
    const games = [
      ...[1, 2, 3].map((seed) => game(seed, 0, { broken: true })),
      ...[10, 20, 30, 40, 50, 60, 70].map((value, index) =>
        game(index + 4, value),
      ),
    ]
    // Rank 9 × 92 % = 8.28: 60 + 0.28 × 10; rank 9 × 65 % = 5.85, 38.5.
    expect(suggestedThresholds('netIncome', games)).toEqual({
      or: 63,
      argent: 39,
      bronze: null,
    })
    expect(outcomeAt('netIncome', games, 30)).toBeNull()
    expect(outcomeAt('netIncome', games, 40)).toBe(16)
  })

  it('counts from the worst where lower is better', () => {
    const games = [0.01, 0.02, 0.03, 0.04, 0.05].map((value, index) =>
      game(index + 1, value),
    )
    // The best fifth of the games threw out at most 1.8 % of the goods.
    expect(outcomeAt('spoilageRate', games, 80)).toBe(0.018)
    expect(suggestedThresholds('spoilageRate', games)).toEqual({
      or: 0.0132,
      argent: 0.024,
      bronze: 0.038,
    })
  })
})
