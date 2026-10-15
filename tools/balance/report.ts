import { DIFFICULTIES, FOOD_TRUCK } from '../../src/engine/day.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { cents, mulRatio, type Cents } from '../../src/engine/money.ts'
import { formatDollars } from '../sim/cli.ts'
import {
  DAYS_PER_YEAR,
  type BalanceRun,
  type DifficultyRun,
  type GameResult,
} from './play.ts'
import {
  CROISSANTS_PER_DAY,
  DAYS_OPEN,
  MARKETING_DAILY,
  PRICE_CHANGES,
  type Axis,
  type Strategy,
} from './strategies.ts'

// Sums up the games of each strategy, ranks the strategies and writes the
// report, with no I/O. The report is for developers, so it is in English.

/** Strategies in each of the best and worst tables. */
export const TOP = 10

/** One strategy's games at one difficulty, summed up. */
export interface StrategySummary {
  readonly strategy: Strategy
  /** The strategy's place in the run, from 0: the ranking's last tie-break. */
  readonly index: number
  readonly games: number
  readonly medianCashAtEnd: Cents
  readonly worstCashAtEnd: Cents
  readonly medianNetIncome: Cents
  /** The lowest cash of any game. */
  readonly lowestCash: Cents
  /** Games whose cash went below zero. */
  readonly gamesBelowZero: number
  /** Spoiled ÷ (sold + spoiled), every product, from 0 to 1. */
  readonly medianSpoilageRate: number
  readonly medianLostToStockouts: number
  readonly medianLostToPrices: number
}

const AXES: Readonly<Record<Axis, string>> = {
  priceChange: 'prices',
  croissantsPerDay: 'croissants per day',
  marketingDaily: 'marketing budget',
  daysOpen: 'days open',
}

const COLUMNS: readonly (readonly [string, 'left' | 'right'])[] = [
  ['#', 'right'],
  ['Prices', 'left'],
  ['Croissants/day', 'right'],
  ['Marketing/day', 'right'],
  ['Days open', 'right'],
  ['Median cash at end', 'right'],
  ['Worst cash at end', 'right'],
  ['Median net income', 'right'],
  ['Lowest cash', 'right'],
  ['Below zero', 'right'],
  ['Spoilage', 'right'],
  ['Lost to stockouts', 'right'],
  ['Lost to prices', 'right'],
]

/**
 * The middle value, or the mean of the middle two for an even count. Throws
 * a RangeError on no values.
 */
export function median(values: readonly number[]): number {
  const [low, high] = middle(values)
  return low === high ? low : (low + high) / 2
}

/**
 * The middle amount, or the mean of the middle two for an even count,
 * rounded half away from zero to the cent. Throws a RangeError on no values.
 */
export function medianCents(values: readonly Cents[]): Cents {
  const [low, high] = middle(values)
  return low === high ? cents(low) : mulRatio(cents(low + high), 0.5)
}

/**
 * Sums up `games`, the games of `strategy`, whose place in the run, from 0,
 * is `index`. Throws a RangeError on no games.
 */
export function summarize(
  strategy: Strategy,
  games: readonly GameResult[],
  index: number,
): StrategySummary {
  const cashAtEnd = games.map(({ cashAtEnd }) => cashAtEnd)
  return {
    strategy,
    index,
    games: games.length,
    medianCashAtEnd: medianCents(cashAtEnd),
    worstCashAtEnd: cents(Math.min(...cashAtEnd)),
    medianNetIncome: medianCents(games.map(({ netIncome }) => netIncome)),
    lowestCash: cents(Math.min(...games.map(({ lowestCash }) => lowestCash))),
    gamesBelowZero: games.filter(({ wentBelowZero }) => wentBelowZero).length,
    medianSpoilageRate: median(games.map(spoilageRate)),
    medianLostToStockouts: median(
      games.map(({ lostToStockouts }) => lostToStockouts),
    ),
    medianLostToPrices: median(games.map(({ lostToPrices }) => lostToPrices)),
  }
}

/**
 * Best first: the highest median cash at the end, then the highest median
 * net income, then the earlier in the run. Never mutates `summaries`.
 */
export function rank(summaries: readonly StrategySummary[]): StrategySummary[] {
  return [...summaries].sort(
    (a, b) =>
      b.medianCashAtEnd - a.medianCashAtEnd ||
      b.medianNetIncome - a.medianNetIncome ||
      a.index - b.index,
  )
}

/** A strategy's summary and its rank, from 1 for the best. */
export interface RankedStrategy extends StrategySummary {
  readonly rank: number
}

/** Every strategy of `run`, summed up and ranked, best first. */
export function ranked(run: DifficultyRun): RankedStrategy[] {
  const summaries = run.strategies.map(({ strategy, games }, index) =>
    summarize(strategy, games, index),
  )
  return rank(summaries).map((summary, index) => ({
    ...summary,
    rank: index + 1,
  }))
}

/**
 * The choices that changed nothing in `run`: those where every seed played
 * the same books, by journal hash, whatever the choice's value, with the
 * other choices held. A choice the run gave only one value is not listed.
 * In the order of `Strategy`'s fields.
 */
export function unchangedDecisions(run: DifficultyRun): Axis[] {
  const axes = Object.keys(AXES) as Axis[]
  return axes.filter((axis) => {
    const others = axes.filter((other) => other !== axis)
    // Games that differ only by `axis`: the values tried, the books played.
    const groups = new Map<
      string,
      { values: Set<number>; hashes: Set<string> }
    >()
    for (const { strategy, games } of run.strategies) {
      for (const { seed, journalHash } of games) {
        const key = [...others.map((other) => strategy[other]), seed].join()
        const group = groups.get(key) ?? {
          values: new Set(),
          hashes: new Set(),
        }
        group.values.add(strategy[axis])
        group.hashes.add(journalHash)
        groups.set(key, group)
      }
    }
    const tried = [...groups.values()]
    return (
      tried.some(({ values }) => values.size > 1) &&
      tried.every(({ hashes }) => hashes.size === 1)
    )
  })
}

/** The whole report, in Markdown. */
export function formatReport(run: BalanceRun): string {
  const tables = run.difficulties.map((difficultyRun) => ({
    name: DIFFICULTIES.difficulties[difficultyRun.difficulty].name,
    ranked: ranked(difficultyRun),
    unchanged: unchangedDecisions(difficultyRun),
  }))

  return [
    ...header(run),
    '## Best and worst',
    '',
    ...tables.flatMap(({ name, ranked, unchanged }) => [
      `### ${name}`,
      '',
      `**${TOP} best**`,
      '',
      ...table(ranked.slice(0, TOP)),
      '',
      `**${TOP} worst, worst first**`,
      '',
      ...table(ranked.slice(-TOP).reverse()),
      '',
      ...(unchanged.length === 0
        ? []
        : [
            `Changed nothing at ${name}: ${unchanged.map((axis) => AXES[axis]).join(', ')}. With the other choices held, every seed played the same books whatever the value.`,
            '',
          ]),
    ]),
    '## All strategies',
    '',
    ...tables.flatMap(({ name, ranked }) => [
      `### ${name}`,
      '',
      ...table(ranked),
      '',
    ]),
  ].join('\n')
}

/** `-20%`, `base`, `+20%`. */
export function formatPriceChange(priceChange: number): string {
  if (priceChange === 0) return 'base'
  return `${priceChange > 0 ? '+' : ''}${priceChange}%`
}

/** `1,234` or `1,234.5`: a count, or the median of two. */
export function formatCount(count: number): string {
  const [whole = '', fraction] = String(count).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

function header(run: BalanceRun): string[] {
  const content = FOOD_TRUCK
  const start = content.startingDecisions
  const startingPrices = PRODUCTS.map(
    (product) =>
      `${content.products[product].name} ${formatDollars(start.pricesCents[product])}`,
  ).join(', ')
  const strategies = run.difficulties[0]?.strategies.length ?? 0
  const seeds = run.games === 1 ? 'seed 1' : `one of seeds 1 to ${run.games}`
  return [
    '# Balance report: phase 2',
    '',
    `Generated by \`npm run balance -- --years ${run.years} --games ${run.games}\`: do not edit by hand. The numbers go stale whenever the engine or the content changes; run the command again then.`,
    '',
    '## What each game plays',
    '',
    `Each game starts at one difficulty on ${seeds} and plays ${run.years * DAYS_PER_YEAR} days from May 1st, year 1, with one strategy in effect from day 0. A strategy sets:`,
    '',
    `- every price at ${PRICE_CHANGES.map(formatPriceChange).join(', ')} from the starting prices (${startingPrices}), rounded half up to the price step;`,
    `- the croissants bought each morning the truck opens: ${CROISSANTS_PER_DAY.join(', ')};`,
    `- the marketing budget, a day: ${MARKETING_DAILY.map(formatDollars).join(', ')};`,
    `- the days open, a week: ${DAYS_OPEN.join(' or ')}, where 6 closes on Monday.`,
    '',
    `Café and chocolat chaud keep their starting restock rules and the owner keeps the starting pay of ${formatDollars(start.ownerWeeklyPayCents)} a week. Each difficulty plays ${strategies} strategies × ${run.games} games.`,
    '',
    '## Columns',
    '',
    '- **#**: the rank by median cash at the end, highest first; ties go to the higher median net income, then to the strategy listed first in the grid.',
    '- **Median cash at end**, **Worst cash at end**: the Encaisse at the close of the last day, median and lowest over the seeds.',
    '- **Median net income**: the Bénéfice net over every day played, median over the seeds; negative is a Perte nette.',
    '- **Lowest cash**: the lowest Encaisse after any journal entry of any game. A day pays its purchases, and the 1st of the month its charges, before its sales come in, so this can be lower than the cash at any close.',
    '- **Below zero**: the share of games whose cash went below zero at any point, when the truck would have needed the bank.',
    '- **Spoilage**: units written off ÷ (units sold + units written off), every product together, median over the seeds.',
    '- **Lost to stockouts**, **Lost to prices**: visits over the whole game that bought nothing because what the customer wanted had sold out, or because a price was above what they pay; median over the seeds.',
    '- Customers lost to the line are not counted: the game has no line until #62 (P2-03).',
    '- For an even number of seeds, a median is the mean of the middle two, rounded half away from zero to the cent for money.',
    '',
  ]
}

function table(summaries: readonly RankedStrategy[]): string[] {
  return [
    row(COLUMNS.map(([label]) => label)),
    row(COLUMNS.map(([, align]) => (align === 'right' ? '---:' : '---'))),
    ...summaries.map((summary) => row(cells(summary))),
  ]
}

function cells(summary: RankedStrategy): string[] {
  const { strategy } = summary
  return [
    String(summary.rank),
    formatPriceChange(strategy.priceChange),
    String(strategy.croissantsPerDay),
    formatDollars(strategy.marketingDaily),
    String(strategy.daysOpen),
    formatDollars(summary.medianCashAtEnd),
    formatDollars(summary.worstCashAtEnd),
    formatDollars(summary.medianNetIncome),
    formatDollars(summary.lowestCash),
    `${Math.round((100 * summary.gamesBelowZero) / summary.games)}%`,
    `${(100 * summary.medianSpoilageRate).toFixed(1)}%`,
    formatCount(summary.medianLostToStockouts),
    formatCount(summary.medianLostToPrices),
  ]
}

function row(values: readonly string[]): string {
  return `| ${values.join(' | ')} |`
}

function spoilageRate({ unitsSold, unitsSpoiled }: GameResult): number {
  const units = unitsSold + unitsSpoiled
  return units === 0 ? 0 : unitsSpoiled / units
}

function middle(values: readonly number[]): [number, number] {
  if (values.length === 0) throw new RangeError('No values to take a median of')
  const sorted = [...values].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  const high = sorted[half] ?? 0
  const low = sorted.length % 2 === 0 ? (sorted[half - 1] ?? 0) : high
  return [low, high]
}
