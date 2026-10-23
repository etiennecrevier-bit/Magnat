import { describe, expect, it } from 'vitest'
import staffJson from '../../src/content/staff.json'
import {
  loadStaffContent,
  type DifficultyId,
} from '../../src/content/schema.ts'
import { cents } from '../../src/engine/money.ts'
import { STAFF, askingWage } from '../../src/engine/staff.ts'
import { formatDollars } from '../sim/cli.ts'
import {
  OVENS,
  PRICE_SETS,
  TRUCK_STRATEGIES,
  breakEvenPerOpenDay,
  monthlyBakerWage,
  monthlyBakeryCosts,
  monthlyResult,
  type BakeryGame,
  type BakeryRun,
} from './bakery.ts'
import {
  bakeryCommand,
  bakeryTargets,
  energyPerOpenDay,
  formatBakeryReport,
  madePerOpenDay,
  medianPayback,
  paybackTarget,
  soldPerOpenDay,
  type BakeryReportRun,
} from './bakeryReport.ts'
import { HAND_WRITTEN, withHandWritten } from './report.ts'

const DIFFICULTIES: readonly DifficultyId[] = ['facile', 'moyen', 'difficile']

/** `$1,234.56` or `-$1,234.56`, from cents, rounded to the cent. */
function dollars(amount: number): string {
  return formatDollars(cents(Math.round(amount)))
}

/** A game of 10 open days, its two month ends at `cash`. */
function game(
  cash: readonly number[],
  sold: number,
  made = 0,
  energy = 50,
): BakeryGame {
  return {
    cashAtMonthEnds: cash.map((amount) => cents(amount)),
    daysPlayed: 61,
    endedDay: null,
    openDays: 10,
    croissantsSold: sold * 10,
    croissantsMade: made * 10,
    energyAtOpenCloses: energy * 10,
  }
}

/**
 * A run of two seeds at every difficulty and strategy, whose twins sell
 * each strategy's croissants less 20 a day, or `sold` when given, and
 * whose bakeries end at `bakeryCash` against twins at 0.
 */
function run(
  bakeryCash: readonly number[] = [-100, -50],
  sold?: number,
): BakeryReportRun {
  const runs = DIFFICULTIES.flatMap((difficulty) =>
    TRUCK_STRATEGIES.map(({ name, croissantsPerDay }): BakeryRun => ({
      difficulty,
      strategy: name,
      games: 2,
      months: 2,
      twins: [0, 1].map(() =>
        game([0, 0], sold ?? croissantsPerDay - 20, 0, 70),
      ),
      cells: PRICE_SETS.flatMap(({ name: set, prices }) =>
        OVENS.map((oven) => ({
          set,
          prices,
          oven,
          games: [0, 1].map(() =>
            game(
              bakeryCash,
              (sold ?? croissantsPerDay - 20) - 2,
              croissantsPerDay,
              12,
            ),
          ),
          paybacks: [0, 1].map(() =>
            (bakeryCash.at(-1) ?? 0) >= 0 ? 2 : null,
          ),
        })),
      ),
    })),
  )
  return { games: 2, months: 2, runs }
}

describe('per open day', () => {
  it('divides by the days the truck opened, 0 with none', () => {
    const played = game([0], 52, 70, 33)
    expect(soldPerOpenDay(played)).toBe(52)
    expect(madePerOpenDay(played)).toBe(70)
    expect(energyPerOpenDay(played)).toBe(33)
    const closed = { ...played, openDays: 0 }
    expect(soldPerOpenDay(closed)).toBe(0)
    expect(madePerOpenDay(closed)).toBe(0)
    expect(energyPerOpenDay(closed)).toBe(0)
  })
})

describe('medianPayback', () => {
  it('is the middle month, or never when it falls on a game that never pays back', () => {
    expect(medianPayback([1, 2, null])).toBe('2.0')
    expect(medianPayback([3, 4])).toBe('3.5')
    expect(medianPayback([null, null, 3])).toBe('never')
    expect(medianPayback([null, 3])).toBe('never')
    expect(() => medianPayback([])).toThrow(RangeError)
  })
})

describe('bakeryTargets', () => {
  it('finds made croissants cheaper, and no slow truck paying back', () => {
    const [cheaper, slow, ...rest] = bakeryTargets(run())
    const wins = rest.slice(0, PRICE_SETS.length)
    expect(cheaper).toEqual({
      target: 'A croissant made costs less than one bought, $1.10',
      measured: 'low $0.45, mid $0.55, high $0.65',
      met: true,
    })
    expect(slow).toEqual({
      target:
        'Under 80 croissants sold an open day, the bakery never pays back within 2 months',
      measured:
        '0 of 36 games pay back, their twins selling at most 50.0 an open day',
      met: true,
    })
    expect(wins.map(({ target }) => target)).toEqual([
      'Making 150 croissants a day, the bakery wins at the low prices',
      'Making 150 croissants a day, the bakery wins at the mid prices',
      'Making 150 croissants a day, the bakery wins at the high prices',
    ])
    // The baker's wages: no set wins in the books.
    const low = PRICE_SETS[0]?.prices
    if (low === undefined) throw new Error('No low prices')
    expect(wins[0]?.measured).toBe(
      `leased ${dollars(monthlyResult(low, 'louer', 150, 6))}, bought ${dollars(monthlyResult(low, 'acheter', 150, 6))} a month in the books; 0 of 12 games pay back`,
    )
    expect(wins.every(({ met }) => !met)).toBe(true)
  })

  it('fails the slow truck when its bakery pays back, and passes the win when the books and the games say so', () => {
    const paying = run([-100, 10])
    const [, slow, low] = bakeryTargets(paying)
    expect(slow?.met).toBe(false)
    expect(slow?.measured).toMatch(/^36 of 36 games pay back/)
    // The games pay back, but the baker's wages lose in the books.
    expect(low?.met).toBe(false)
    // A baker paid next to nothing: making 150 wins in the books only at
    // the low prices, with a bought oven.
    const cheap = loadStaffContent({
      ...staffJson,
      roles: {
        ...staffJson.roles,
        boulanger: {
          ...staffJson.roles.boulanger,
          hoursPerWeek: 1,
          hourlyWageCents: { min: 1, start: 1, max: 1 },
        },
      },
    })
    const [, , cheapLow, cheapMid] = bakeryTargets(paying, undefined, cheap)
    expect(cheapLow?.met).toBe(true)
    expect(cheapMid?.met).toBe(false)
  })

  it("checks each difficulty's payback with two contracts at the prices difficulty.json gives it", () => {
    // Each price set pays back in its own month: low 4, mid 6, high 9.
    const months: Record<string, number> = { low: 4, mid: 6, high: 9 }
    const base = run()
    const scheduled: BakeryReportRun = {
      ...base,
      runs: base.runs.map((each) =>
        each.strategy === '150 a day, 2 contracts'
          ? {
              ...each,
              cells: each.cells.map((cell) => ({
                ...cell,
                paybacks: [months[cell.set] ?? null, months[cell.set] ?? null],
              })),
            }
          : each,
      ),
    }
    const prices = (name: string) => {
      const set = PRICE_SETS.find((each) => each.name === name)
      if (set === undefined) throw new Error(`No price set ${name}`)
      return set.prices
    }
    expect(paybackTarget(scheduled, 'facile', prices('low'))).toEqual({
      target:
        'At Facile, making 150 croissants a day with two contracts, the bakery pays back in month 4 at the prices of `src/content/difficulty.json`, low, every game and twin playing the 2 months',
      measured:
        'low leased 4.0, bought 4.0; mid leased 6.0, bought 6.0; high leased 9.0, bought 9.0; bankrupt at low: 0 games, 0 twins',
      met: true,
    })
    expect(paybackTarget(scheduled, 'moyen', prices('mid')).met).toBe(true)
    expect(paybackTarget(scheduled, 'difficile', prices('high')).met).toBe(true)
    // A month late or early is on schedule; two are not.
    expect(paybackTarget(scheduled, 'moyen', prices('low')).met).toBe(false)
    expect(paybackTarget(scheduled, 'facile', prices('mid')).met).toBe(false)
    // Never paying back is never on schedule, and a set the run did not
    // play cannot be.
    expect(paybackTarget(run(), 'moyen', prices('mid'))).toMatchObject({
      measured:
        'low leased never, bought never; mid leased never, bought never; high leased never, bought never; bankrupt at mid: 0 games, 0 twins',
      met: false,
    })
    expect(
      paybackTarget(scheduled, 'moyen', {
        ingredientCostCents: cents(1),
        monthlyRentCents: cents(1),
      }),
    ).toMatchObject({
      target: expect.stringMatching(/, a set the run did not play, /),
      met: false,
    })
    // The report checks every difficulty at the shipped prices.
    expect(
      bakeryTargets(scheduled)
        .slice(-3)
        .map(({ target }) => target.split(',')[0]),
    ).toEqual(['At Facile', 'At Moyen', 'At Difficile'])
  })

  it('reads the shipped set when difficulty.json gives prices off the grid', () => {
    const offGrid = {
      ingredientCostCents: cents(60),
      monthlyRentCents: cents(260_000),
    }
    const base = run()
    const shipped: BakeryReportRun = {
      ...base,
      runs: base.runs.map((each) =>
        each.strategy === '150 a day, 2 contracts' &&
        each.difficulty === 'difficile'
          ? {
              ...each,
              cells: [
                ...each.cells,
                ...OVENS.map((oven) => ({
                  set: 'shipped',
                  prices: offGrid,
                  oven,
                  games: each.cells[0]?.games ?? [],
                  paybacks: [8, 10],
                })),
              ],
            }
          : each,
      ),
    }
    expect(paybackTarget(shipped, 'difficile', offGrid)).toEqual({
      target:
        'At Difficile, making 150 croissants a day with two contracts, the bakery pays back in month 9 at the prices of `src/content/difficulty.json`, shipped, every game and twin playing the 2 months',
      measured:
        'low leased never, bought never; mid leased never, bought never; high leased never, bought never; shipped leased 9.0, bought 9.0; bankrupt at shipped: 0 games, 0 twins',
      met: true,
    })
  })

  it('never meets the payback when a game or a twin went bankrupt, even ahead before it', () => {
    // On schedule at the median, but a bakery game, or a twin, ended in
    // bankruptcy: its months after compare a frozen Encaisse.
    const base = run()
    const withEnded = (bakery: boolean): BakeryReportRun => ({
      ...base,
      runs: base.runs.map((each) =>
        each.strategy === '150 a day, 2 contracts'
          ? {
              ...each,
              twins: bakery
                ? each.twins
                : each.twins.map((twin, index) =>
                    index === 0 ? { ...twin, endedDay: 40 } : twin,
                  ),
              cells: each.cells.map((cell) => ({
                ...cell,
                games: bakery
                  ? cell.games.map((played, index) =>
                      index === 0 ? { ...played, endedDay: 40 } : played,
                    )
                  : cell.games,
                paybacks: [6, 6],
              })),
            }
          : each,
      ),
    })
    const mid = PRICE_SETS[1]?.prices
    if (mid === undefined) throw new Error('No mid prices')
    expect(paybackTarget(withEnded(true), 'moyen', mid)).toMatchObject({
      measured: expect.stringMatching(/; bankrupt at mid: 2 games, 0 twins$/),
      met: false,
    })
    expect(paybackTarget(withEnded(false), 'moyen', mid)).toMatchObject({
      measured: expect.stringMatching(/; bankrupt at mid: 0 games, 1 twins$/),
      met: false,
    })
  })

  it('cannot meet the slow truck target with no truck selling under 80', () => {
    const [, slow] = bakeryTargets(run([-100, -50], 90))
    expect(slow).toMatchObject({
      measured: 'no truck sold under that',
      met: false,
    })
  })
})

describe('formatBakeryReport', () => {
  const report = formatBakeryReport(run())

  it('says how to write it again', () => {
    expect(bakeryCommand(run())).toBe(
      'npm run balance -- --bakery --games 2 --months 2',
    )
    expect(report).toContain(
      'Generated by `npm run balance -- --bakery --games 2 --months 2`',
    )
  })

  it('has its sections, a table per difficulty', () => {
    const headings = report.split('\n').filter((line) => line.startsWith('#'))
    expect(headings).toEqual([
      '# Balance report: phase 4',
      '## What each game plays',
      '## Targets (#157)',
      '## Break-even in the books',
      '## Payback by difficulty',
      '### Facile',
      '### Moyen',
      '### Difficile',
    ])
  })

  it('shows each strategy, price set and oven at each difficulty', () => {
    const rows = report
      .split('\n')
      .filter((line) =>
        TRUCK_STRATEGIES.some(({ name }) =>
          new RegExp(`^\\| ${name} \\| (low|mid|high) \\|`).test(line),
        ),
      )
    expect(rows).toHaveLength(3 * TRUCK_STRATEGIES.length * 6)
    expect(rows[0]).toBe(
      '| start | low | leased | 70.0 | 48.0 (50.0) | 12.0 (70.0) | 0 of 2 | never | -$0.50 | 0 (0) |',
    )
  })

  it('shows the break-even of each price set and oven', () => {
    const mid = PRICE_SETS[1]?.prices
    if (mid === undefined) throw new Error('No mid prices')
    expect(report).toContain(
      `| mid | leased | ${dollars(monthlyBakeryCosts(mid, 'louer'))} | $0.55 | ${breakEvenPerOpenDay(mid, 'louer', 6).toFixed(1)} | ${dollars(monthlyResult(mid, 'louer', 80, 6))} | ${dollars(monthlyResult(mid, 'louer', 150, 6))} |`,
    )
    expect(report).toContain('| start | 70 | $3.75 | $0.00 | none | no |')
    expect(report).toContain('| 150 a day | 150 | $3.00 | $80.00 | none | no |')
    expect(report).toContain(
      '| 150 a day, 2 contracts | 150 | $3.00 | $80.00 | Marché Bio-Logique, 1250 a week; Épicerie Chez Normand, 750 a week | no |',
    )
    expect(report).toContain(
      '| busy, employee at the truck | 110 | $3.00 | $80.00 | none | yes |',
    )
  })

  it('says who the baker and the employee at the truck are, and what they cost', () => {
    const { hoursPerWeek } = STAFF.roles.boulanger
    const asked = askingWage('sophie', 'boulanger')
    expect(report).toContain(
      `It hires a baker that day (#158), « Boulanger » at ${dollars(asked)} an hour, ${hoursPerWeek} h a week, the wage they ask (#255), so the owner never bakes: the baker costs a week of training on day 0 and ${dollars(asked * hoursPerWeek)} each Friday.`,
    )
    expect(report).toContain(
      '« Au camion » at $18.00 an hour, 35 h a week, $630.00 a week, who serves beside the owner.',
    )
    expect(report).toContain(
      `and the baker's wages, ${dollars(monthlyBakerWage())} in an average month`,
    )
  })

  it('ends with one line break, and keeps the hand-written part', () => {
    expect(report.endsWith('|\n')).toBe(true)
    const kept = withHandWritten(`old\n${HAND_WRITTEN}\n\nMine.\n`, report)
    expect(kept).toBe(`${report.trimEnd()}\n\n${HAND_WRITTEN}\n\nMine.\n`)
  })
})
