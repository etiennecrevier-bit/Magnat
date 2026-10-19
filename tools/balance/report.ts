import { DIFFICULTIES, ENERGY, FOOD_TRUCK } from '../../src/engine/day.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { MODIFIER_KINDS } from '../../src/engine/street.ts'
import { formatDollars } from '../sim/cli.ts'
import type { ContractPolicy, FinancingPolicy } from '../sim/simulate.ts'
import { DAYS_PER_YEAR, type BalanceRun, type DifficultyRun } from './play.ts'
import {
  CROISSANTS_PER_DAY,
  DAYS_OPEN,
  formatPriceChange,
  MARKETING_DAILY,
  OWNER_WEEKLY_PAY,
  PRICE_CHANGES,
  type Axis,
} from './strategies.ts'
import { median, ranked, type RankedStrategy } from './summary.ts'
import { designTargets, type RankedRun, type TargetCheck } from './targets.ts'

// Writes the report from the games summed up and ranked (summary.ts) and
// checked against the design targets (targets.ts), with no I/O. The report
// is for developers, so it is in English.

/** Strategies in each of the best and worst tables. */
export const TOP = 10

const AXES: Readonly<Record<Axis, string>> = {
  priceChange: 'prices',
  croissantsPerDay: 'croissants per day',
  marketingDaily: 'marketing budget',
  daysOpen: 'days open',
  ownerWeeklyPay: "owner's pay",
}

const COLUMNS: readonly (readonly [string, 'left' | 'right'])[] = [
  ['#', 'right'],
  ['Prices', 'left'],
  ['Croissants/day', 'right'],
  ['Marketing/day', 'right'],
  ['Days open', 'right'],
  ['Pay/week', 'right'],
  ['Median wealth at end', 'right'],
  ['Median cash at end', 'right'],
  ['Worst cash at end', 'right'],
  ['Median net income', 'right'],
  ['Personal cash at end', 'right'],
  ['Unpaid rents', 'right'],
  ['Lowest cash', 'right'],
  ['Below zero', 'right'],
  ['Average energy', 'right'],
  ['Days exhausted', 'right'],
  ['Botched', 'right'],
  ['Spoilage', 'right'],
  ['Lost to stockouts', 'right'],
  ['Lost to prices', 'right'],
  ['Lost to the line', 'right'],
  ['Emergency loans', 'right'],
  ['Share sales', 'right'],
]

/**
 * Where the hand-written part of the report starts. `npm run balance` keeps
 * everything from this line to the end of the file it writes over.
 */
export const HAND_WRITTEN =
  '<!-- Written by hand: npm run balance keeps everything below this line. -->'

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

/** How the report words each way the grocers' cards are answered. */
const CONTRACT_ANSWERS: Readonly<Record<ContractPolicy, string>> = {
  all: 'accepts every one, renewals included',
  none: 'refuses every one',
  first: "accepts the first grocer's, and its renewals, and refuses the others",
}

/** How the report words each way the financing's cards are answered. */
const FINANCING_ANSWERS: Readonly<Record<FinancingPolicy, string>> = {
  accept: "accepts them: the loan, and the investor's shares",
  refuse: 'refuses them',
}

/**
 * The whole report, in Markdown. A one-year run also checks the design
 * targets of #58, and a run with the event cards counts the days the street
 * was changed.
 */
export function formatReport(run: BalanceRun): string {
  const tables = run.difficulties.map((difficultyRun) => ({
    run: difficultyRun,
    name: DIFFICULTIES.difficulties[difficultyRun.difficulty].name,
    ranked: ranked(difficultyRun),
    unchanged: unchangedDecisions(difficultyRun),
  }))

  return [
    ...header(run),
    ...(run.years === 1 ? targets(tables) : []),
    ...((run.events ?? 'none') === 'none' ? [] : streetChanges(tables)),
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

/**
 * `report` with the hand-written part of `previous`, the report it writes
 * over, if any: from the line `HAND_WRITTEN` to the end, after a blank line.
 * `report` alone when `previous` is null or has no such line.
 */
export function withHandWritten(
  previous: string | null,
  report: string,
): string {
  const lines = previous?.split('\n') ?? []
  const start = lines.indexOf(HAND_WRITTEN)
  if (start === -1) return report
  return [report.trimEnd(), '', ...lines.slice(start)].join('\n')
}

/** The first and last lines of a section a run writes into a report. */
export interface SectionMarkers {
  readonly start: string
  readonly end: string
}

/**
 * The section of `text` from the line `markers.start` to the line
 * `markers.end`; null if it has none.
 */
export function sectionOf(
  text: string | null,
  markers: SectionMarkers,
): string | null {
  const lines = text?.split('\n') ?? []
  const start = lines.indexOf(markers.start)
  const end = lines.indexOf(markers.end, start)
  if (start === -1 || end === -1) return null
  return lines.slice(start, end + 1).join('\n')
}

/**
 * `text` with `section` in place of its section between `markers`; or, if
 * it has none, before its hand-written part, or at its end. `text` itself
 * when `section` is null; `section` alone when `text` is null.
 */
export function withSection(
  text: string | null,
  section: string | null,
  markers: SectionMarkers,
): string {
  if (section === null) return text ?? ''
  if (text === null) return `${section}\n`
  const lines = text.split('\n')
  const start = lines.indexOf(markers.start)
  const end = lines.indexOf(markers.end, start)
  if (start !== -1 && end !== -1) {
    return [...lines.slice(0, start), section, ...lines.slice(end + 1)].join(
      '\n',
    )
  }
  const handWritten = lines.indexOf(HAND_WRITTEN)
  if (handWritten !== -1) {
    const before = lines.slice(0, handWritten).join('\n').trimEnd()
    return [before, '', section, '', ...lines.slice(handWritten)].join('\n')
  }
  return `${text.trimEnd()}\n\n${section}\n`
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
  const events = run.events ?? 'none'
  const option = `${events === 'none' ? '' : ` --events ${events}`}${run.contracts === undefined ? '' : ` --contracts ${run.contracts}`}${run.financing === undefined ? '' : ` --financing ${run.financing}`}`
  return [
    '# Balance report: phase 2',
    '',
    `Generated by \`npm run balance -- --years ${run.years} --games ${run.games}${option}\`: do not edit by hand, except under the comment at the end that says so. The numbers go stale whenever the engine or the content changes; run the command again then.`,
    '',
    '## What each game plays',
    '',
    `Each game starts at one difficulty on ${seeds} and plays ${run.years * DAYS_PER_YEAR} days from May 1st, year 1, with one strategy in effect from day 0. A strategy sets:`,
    '',
    `- every price at ${PRICE_CHANGES.map(formatPriceChange).join(', ')} from the starting prices (${startingPrices}), rounded half up to the price step;`,
    `- the croissants bought each morning the truck opens: ${CROISSANTS_PER_DAY.join(', ')};`,
    `- the marketing budget, a day: ${MARKETING_DAILY.map(formatDollars).join(', ')};`,
    `- the days open, a week: ${DAYS_OPEN.join(', ')}, where 6 closes on Monday and 5 on Sunday and Monday;`,
    `- the owner's pay, a week: ${OWNER_WEEKLY_PAY.map(formatDollars).join(', ')}.`,
    '',
    `Café and chocolat chaud keep their starting restock rules. Each difficulty plays ${strategies} strategies × ${run.games} games.`,
    '',
    ...(events === 'none'
      ? []
      : [
          `The event cards come up, and the player answers each with ${events === 'first' ? 'its first choice' : 'a choice drawn at random, seeded from the game'}.`,
          '',
        ]),
    ...(run.contracts === undefined
      ? []
      : [
          events === 'none' && run.contracts === 'none'
            ? "No card comes up, not even the grocers': no contract is offered or signed."
            : `The grocers offer their contracts${events === 'none' ? ', their cards alone coming up,' : ''} and the player ${CONTRACT_ANSWERS[run.contracts]}.`,
          '',
        ]),
    ...(run.financing === undefined
      ? []
      : [
          `When the encaisse closes below zero, the engine brings Mme Prudhomme's emergency loan or Max Duvent's offer for shares (#159), whatever the other cards, and the player ${FINANCING_ANSWERS[run.financing]}.${run.financing === 'accept' ? " The wealth at the end leaves out the cash they bring in, which is not the owner's, and counts what they cost: the fee, the interest and the dividends. The last two columns show the strategies that needed them." : ''}`,
          '',
        ]),
    '## Columns',
    '',
    '- **#**: the rank by median wealth at the end, highest first; ties go to the fewer median unpaid rents, then to the higher median net income, then to the strategy listed first in the grid.',
    "- **Median wealth at end**: the Encaisse plus the owner's personal cash at the close of the last day, less what the emergency loans still owe and what the shares sold brought in, which are not the owner's, median over the seeds. The owner's pay moves money from one to the other, so it counts only through what it does to the owner.",
    '- **Median cash at end**, **Worst cash at end**: the Encaisse at the close of the last day, median and lowest over the seeds.',
    "- **Median net income**: the Bénéfice net over every day played, after the owner's pay, median over the seeds; negative is a Perte nette.",
    "- **Personal cash at end**: the owner's own cash, outside the books, at the close of the last day, median over the seeds.",
    "- **Unpaid rents**: the 1sts of the month whose rent left the owner's personal cash below zero, over every day played, median over the seeds.",
    '- **Lowest cash**: the lowest Encaisse after any journal entry of any game. A day pays its purchases, and the 1st of the month its charges, before its sales come in, so this can be lower than the cash at any close.',
    '- **Below zero**: the share of games whose cash went below zero at any point, when the truck would have needed the bank.',
    `- **Average energy**, **Days exhausted**: the owner's energy each morning, averaged over every day played, and the mornings it started below ${ENERGY.exhausted.below}, « Épuisé »; median over the seeds.`,
    '- **Botched**: units botched at the counter and made again, median over the seeds.',
    '- **Spoilage**: units written off ÷ (units sold + units written off), every product together, median over the seeds.',
    '- **Lost to stockouts**, **Lost to prices**, **Lost to the line**: visits over the whole game that bought nothing because what the customer wanted had sold out, because a price was above what they pay, or because the line was too long for them; median over the seeds.',
    "- **Emergency loans**, **Share sales**: the emergency loans taken from Mme Prudhomme and the rounds of shares sold to Max Duvent, summed over the strategy's games; 0 when their cards never came up or were refused.",
    '- For an even number of seeds, a median is the mean of the middle two, rounded half away from zero to the cent for money.',
    '',
  ]
}

/** The design targets of #58, one row each, a column per difficulty. */
function targets(
  tables: readonly (RankedRun & { readonly name: string })[],
): string[] {
  return [
    '## Design targets',
    '',
    'The targets of #58 for year 1, checked on this run: ✓ met, ✗ missed, n/a where a target does not apply to the difficulty or the run lacks the strategies it needs. A strategy beats another only by what it played: a tie that only the order of the grid breaks does not count.',
    '',
    row(['Target', ...tables.map(({ name }) => name)]),
    row(['---', ...tables.map(() => '---')]),
    ...designTargets(tables).map(({ target, checks }) =>
      row([target, ...checks.map(verdict)]),
    ),
    '',
  ]
}

/**
 * The days each kind of change to the street was in effect in a game,
 * median over every game of each difficulty, one row each.
 */
function streetChanges(
  tables: readonly { readonly run: DifficultyRun; readonly name: string }[],
): string[] {
  return [
    '## Street changes',
    '',
    'The days of a game each kind of change to the street was in effect, median over every game of the difficulty, whatever its strategy. A day counts once for a kind, however many changes of that kind it had.',
    '',
    row(['Change', ...tables.map(({ name }) => name)]),
    row(['---', ...tables.map(() => '---:')]),
    ...MODIFIER_KINDS.map((kind) =>
      row([
        kind,
        ...tables.map(({ run }) =>
          formatCount(
            median(
              run.strategies.flatMap(({ games }) =>
                games.map(({ modifierDays }) => modifierDays[kind]),
              ),
            ),
          ),
        ),
      ]),
    ),
    '',
  ]
}

function verdict({ met, measured }: TargetCheck): string {
  if (met === null) return 'n/a'
  return `${met ? '✓' : '✗'} ${measured}`
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
    formatDollars(strategy.ownerWeeklyPay),
    formatDollars(summary.medianWealth),
    formatDollars(summary.medianCashAtEnd),
    formatDollars(summary.worstCashAtEnd),
    formatDollars(summary.medianNetIncome),
    formatDollars(summary.medianPersonalCash),
    formatCount(summary.medianUnpaidRents),
    formatDollars(summary.lowestCash),
    `${Math.round((100 * summary.gamesBelowZero) / summary.games)}%`,
    summary.medianAverageEnergy.toFixed(1),
    formatCount(summary.medianDaysExhausted),
    formatCount(summary.medianBotched),
    `${(100 * summary.medianSpoilageRate).toFixed(1)}%`,
    formatCount(summary.medianLostToStockouts),
    formatCount(summary.medianLostToPrices),
    formatCount(summary.medianLostToLine),
    formatCount(summary.emergencyLoans),
    formatCount(summary.shareSales),
  ]
}

function row(values: readonly string[]): string {
  return `| ${values.join(' | ')} |`
}
