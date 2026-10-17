import {
  difficultyIdSchema,
  type DifficultyId,
} from '../../src/content/schema.ts'
import { GROCERS } from '../../src/engine/contracts.ts'
import { DIFFICULTIES, FOOD_TRUCK } from '../../src/engine/day.ts'
import { endOfMonth } from '../../src/engine/calendar.ts'
import { titleOf } from '../../src/engine/dream.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { STAFF } from '../../src/engine/staff.ts'
import { formatDollars } from '../sim/cli.ts'
import { AT_TRUCK_HIRE, BAKER_HIRE } from './bakery.ts'
import {
  BASE_TRUCK,
  GROWTH_STRATEGIES,
  contractReserve,
  duventWorth,
  monthOf,
  plannedGrocers,
  signingDay,
  strategyLabel,
  type GrowthGame,
  type GrowthRun,
  type GrowthStrategy,
  type GrowthStrategyRun,
} from './growth.ts'
import { formatCount, type SectionMarkers } from './report.ts'
import { WEEKDAYS } from './strategies.ts'
import { median, medianCents } from './summary.ts'

// Writes the growth section of docs/balance/phase-4.md, between two
// markers, from what `npm run balance -- --growth` played (#166). No I/O:
// cli.ts writes the file. The report is for developers, so it is in
// English.

/** A whole `--growth` run: every difficulty and contract plan played. */
export interface GrowthReportRun {
  readonly games: number
  readonly months: number
  /** One run per difficulty and contract plan, in any order. */
  readonly runs: readonly GrowthRun[]
}

/** The first line of the growth section. */
export const GROWTH_START =
  '<!-- npm run balance -- --growth writes this section. -->'

/** The last line of the growth section. */
export const GROWTH_END = '<!-- End of the growth section. -->'

/** Where the growth section starts and ends. */
export const GROWTH_MARKERS: SectionMarkers = {
  start: GROWTH_START,
  end: GROWTH_END,
}

/** The strategy #166 calls naive: three contracts at once, no reserve. */
export const NAIVE: GrowthStrategy = {
  contracts: 'three',
  bakery: 'never',
  atTruck: false,
  dream: false,
  financing: 'accept',
}

/**
 * The months, counting from 1, the naive strategy's first close below
 * zero falls in at the difficulties of `TRAP_AT`, in more than half of
 * its games; at the others, more than half of its games take an emergency
 * loan and none goes bankrupt.
 */
export const TRAP_MONTHS: readonly number[] = [2, 3]
export const TRAP_AT: readonly DifficultyId[] = ['moyen', 'difficile']

/**
 * The strategy #166 calls careful, under either financing policy: the
 * careful chain of contracts, and nothing else. None of its games closes
 * below zero, so none ever sees the financing's cards.
 */
export const CAREFUL: Omit<GrowthStrategy, 'financing'> = {
  contracts: 'careful',
  bakery: 'never',
  atTruck: false,
  dream: false,
}

/**
 * The title the best strategy's median net worth earns at the end, at
 * each difficulty; null where #166 sets none, and the report only shows
 * it. No game of any strategy may reach the last, « Magnat ».
 */
export const TITLE_TARGETS: Readonly<Record<DifficultyId, string | null>> = {
  facile: 'Commerçant',
  moyen: null,
  difficile: 'Débrouillard',
}

/**
 * The share of the games where Max Duvent's money was taken in which it
 * was worth taking (see `duventWorth`), at least `from` and at most `to`.
 */
export const DUVENT_WORTH = { from: 0.1, to: 0.5 } as const

/** The command that writes the section, with `run`'s options. */
export function growthCommand({ games, months }: GrowthReportRun): string {
  return `npm run balance -- --growth --games ${games} --months ${months}`
}

/** Whether a target holds at a difficulty, or does not apply there. */
export type Verdict = 'met' | 'missed' | 'n/a'

/** A target at one difficulty, measured. */
export interface GrowthCheck {
  readonly verdict: Verdict
  readonly measured: string
}

/** One target of #166, at every difficulty. */
export interface GrowthTarget {
  readonly target: string
  readonly checks: Readonly<Record<DifficultyId, GrowthCheck>>
}

/** A strategy's games at a difficulty, ranked. */
export interface RankedStrategy extends GrowthStrategyRun {
  /** Its place, from 1. */
  readonly rank: number
  /** The median of its games' `netWorthAtEnd`. */
  readonly medianNetWorth: number
}

/** The place of `strategy` in `GROWTH_STRATEGIES`, from 0. */
export function gridIndex(strategy: GrowthStrategy): number {
  return GROWTH_STRATEGIES.findIndex((each) => sameStrategy(each, strategy))
}

/** Whether `a` and `b` are the same strategy. */
export function sameStrategy(
  a: Partial<GrowthStrategy>,
  b: Partial<GrowthStrategy>,
): boolean {
  return (
    a.contracts === b.contracts &&
    a.bakery === b.bakery &&
    a.atTruck === b.atTruck &&
    a.dream === b.dream &&
    a.financing === b.financing
  )
}

/** The strategies `run` played at `difficulty`, in the grid's order. */
export function strategiesAt(
  run: GrowthReportRun,
  difficulty: DifficultyId,
): GrowthStrategyRun[] {
  return run.runs
    .filter((each) => each.difficulty === difficulty)
    .flatMap(({ strategies }) => strategies)
    .sort((a, b) => gridIndex(a.strategy) - gridIndex(b.strategy))
}

/**
 * `strategies` ranked by the median net worth of their games at the end,
 * the highest first; a tie goes to the one first in the grid.
 */
export function rankStrategies(
  strategies: readonly GrowthStrategyRun[],
): RankedStrategy[] {
  return strategies
    .map((each) => ({
      ...each,
      medianNetWorth: median(each.games.map((game) => game.netWorthAtEnd)),
    }))
    .sort(
      (a, b) =>
        b.medianNetWorth - a.medianNetWorth ||
        gridIndex(a.strategy) - gridIndex(b.strategy),
    )
    .map((each, index) => ({ ...each, rank: index + 1 }))
}

/** #166's targets against `run`, at every difficulty. */
export function growthTargets(run: GrowthReportRun): GrowthTarget[] {
  const at = (check: (difficulty: DifficultyId) => GrowthCheck) =>
    Object.fromEntries(
      difficultyIdSchema.options.map((difficulty) => [
        difficulty,
        check(difficulty),
      ]),
    ) as Record<DifficultyId, GrowthCheck>
  const gamesOf = (
    difficulty: DifficultyId,
    strategy: Partial<GrowthStrategy>,
  ): GrowthGame[] =>
    strategiesAt(run, difficulty)
      .filter((each) =>
        sameStrategy(each.strategy, { ...each.strategy, ...strategy }),
      )
      .flatMap(({ games }) => games)
  return [
    {
      target: `The naive strategy (three contracts on day ${signingDay()}, nothing else): at ${TRAP_AT.map(difficultyName).join(' and ')}, more than half its games first close below zero in month ${TRAP_MONTHS.join(' or ')}; elsewhere, more than half take an emergency loan and none goes bankrupt`,
      checks: at((difficulty) =>
        naiveCheck(gamesOf(difficulty, NAIVE), TRAP_AT.includes(difficulty)),
      ),
    },
    {
      target:
        'The careful strategy (one contract at a time, with a reserve, nothing else) never closes below zero, the financing accepted or refused',
      checks: at((difficulty) =>
        carefulCheck(gamesOf(difficulty, CAREFUL), run.games),
      ),
    },
    {
      target: `The best strategy's median net worth at the end of month ${run.months} earns ${difficultyIdSchema.options
        .flatMap((difficulty) => {
          const title = TITLE_TARGETS[difficulty]
          return title === null
            ? []
            : [`« ${title} » at ${difficultyName(difficulty)}`]
        })
        .join(' and ')}`,
      checks: at((difficulty) =>
        titleCheck(
          rankStrategies(strategiesAt(run, difficulty)),
          TITLE_TARGETS[difficulty],
        ),
      ),
    },
    {
      target: `No game of any strategy reaches « Magnat » within ${run.months} months`,
      checks: at((difficulty) => {
        const games = strategiesAt(run, difficulty).flatMap(
          ({ games: played }) => played,
        )
        const crowned = games.filter(({ magnat }) => magnat).length
        return {
          verdict: games.length === 0 ? 'n/a' : verdict(crowned === 0),
          measured: `${formatCount(crowned)} of ${formatCount(games.length)} games`,
        }
      }),
    },
    {
      target: `Max Duvent's money is worth taking in ${percent(DUVENT_WORTH.from)} to ${percent(DUVENT_WORTH.to)} of the games that take it`,
      checks: at((difficulty) =>
        duventCheck(
          strategiesAt(run, difficulty).flatMap(({ games }) => games),
        ),
      ),
    },
  ]
}

function naiveCheck(games: readonly GrowthGame[], trap: boolean): GrowthCheck {
  if (games.length === 0) return { verdict: 'n/a', measured: 'not played' }
  if (trap) {
    const months = games.flatMap(({ firstDayBelowZero }) =>
      firstDayBelowZero === null ? [] : [monthOf(firstDayBelowZero)],
    )
    const trapped = months.filter((month) => TRAP_MONTHS.includes(month)).length
    return {
      verdict: verdict(2 * trapped > games.length),
      measured: `${trapped} of ${games.length} in month ${TRAP_MONTHS.join(' or ')}, median month ${months.length === 0 ? 'none' : oneDecimal(median(months))}`,
    }
  }
  const borrowed = games.filter(
    ({ emergencyLoans }) => emergencyLoans > 0,
  ).length
  const bankrupt = games.filter(({ endedDay }) => endedDay !== null).length
  return {
    verdict: verdict(2 * borrowed > games.length && bankrupt === 0),
    measured: `${borrowed} of ${games.length} take a loan, ${bankrupt} go bankrupt`,
  }
}

function carefulCheck(
  games: readonly GrowthGame[],
  seeds: number,
): GrowthCheck {
  if (games.length === 0) return { verdict: 'n/a', measured: 'not played' }
  const below = games.filter(
    ({ firstDayBelowZero }) => firstDayBelowZero !== null,
  ).length
  const days = plannedGrocers('careful').map((grocer) => {
    const signed = games.flatMap(({ signings }) =>
      signings.filter((signing) => signing.grocer === grocer),
    )
    return signed.length === 0
      ? 'never'
      : `day ${oneDecimal(median(signed.map(({ day }) => day)))}${signed.length < games.length ? ` (${signed.length} games)` : ''}`
  })
  return {
    verdict: verdict(below === 0),
    measured: `${below} of ${games.length} close below zero (${seeds} seeds, both policies); signs at the median on ${days.join(', ')}`,
  }
}

function titleCheck(
  ranked: readonly RankedStrategy[],
  title: string | null,
): GrowthCheck {
  const [best] = ranked
  if (best === undefined) return { verdict: 'n/a', measured: 'not played' }
  const netWorth = medianCents(best.games.map((game) => game.netWorthAtEnd))
  const earned = titleOf(netWorth)?.name ?? 'none'
  return {
    verdict: title === null ? 'n/a' : verdict(earned === title),
    measured: `« ${earned} », ${formatDollars(netWorth)} (${strategyLabel(best.strategy)})`,
  }
}

function duventCheck(games: readonly GrowthGame[]): GrowthCheck {
  const taken = games.flatMap((game) => {
    const worth = duventWorth(game)
    return worth === null ? [] : [worth]
  })
  if (taken.length === 0) {
    return { verdict: 'n/a', measured: 'he never came' }
  }
  const worth = taken.filter(Boolean).length
  const share = worth / taken.length
  return {
    verdict: verdict(share >= DUVENT_WORTH.from && share <= DUVENT_WORTH.to),
    measured: `${percent(share)}, ${worth} of ${taken.length}`,
  }
}

/**
 * The growth section: how the games were played, #166's targets, every
 * strategy ranked at each difficulty, and what Max Duvent was worth.
 */
export function formatGrowthSection(run: GrowthReportRun): string {
  const lines = [
    GROWTH_START,
    '',
    '## Growth (#166)',
    '',
    `Generated by \`${growthCommand(run)}\`, which writes only this section of the file; \`npm run balance -- --bakery\` keeps it. The numbers go stale whenever the engine or the content changes; run the command again then, and commit the file.`,
    '',
    '### What each game plays',
    '',
    ...playedText(run),
    '',
    '### Targets (#166)',
    '',
    row(['Target', ...difficultyIdSchema.options.map(difficultyName)]),
    row(['---', ...difficultyIdSchema.options.map(() => '---')]),
    ...growthTargets(run).map(({ target, checks }) =>
      row([
        target,
        ...difficultyIdSchema.options.map((difficulty) => {
          const { verdict: met, measured } = checks[difficulty]
          return `${VERDICTS[met]} ${measured}`
        }),
      ]),
    ),
    '',
    `The bakery's payback, #166's third target, is #157's, and \`npm run balance -- --bakery\` checks it above.`,
    '',
    '### Strategies by difficulty',
    '',
    `Ranked by the median net worth at the end, a tie to the strategy first in the grid. The title is the one that median earns. Lowest close is the median of each game's lowest Encaisse at a close; below zero counts the games that closed below zero at least once, and the month after it is the median of their first such month; loans, share sales and bankruptcies count every game's. Rungs is the median of the rungs of « Le rêve » bought.`,
    ...difficultyIdSchema.options.flatMap((difficulty) =>
      strategyTable(run, difficulty),
    ),
    '',
    '### Max Duvent',
    '',
    "Every game that accepts the financing and sees Max Duvent's offer, at every strategy, against its twin that refuses him and takes Mme Prudhomme's loan alone.",
    '',
    row([
      'Difficulty',
      'Games that took his money',
      'Worth taking',
      'Avoided a bankruptcy',
      'Ended with a higher net worth',
      'Bankrupt anyway',
    ]),
    row(['---', '---:', '---:', '---:', '---:', '---:']),
    ...difficultyIdSchema.options.map((difficulty) =>
      duventRow(
        difficulty,
        strategiesAt(run, difficulty).flatMap(({ games }) => games),
      ),
    ),
    '',
    GROWTH_END,
  ]
  return lines.join('\n')
}

function playedText(run: GrowthReportRun): string[] {
  const grocers = plannedGrocers('careful')
  const { croissant } = FOOD_TRUCK.products
  const baker = STAFF.roles[BAKER_HIRE.role]
  const employee = STAFF.roles[AT_TRUCK_HIRE.role]
  const bakeryDay = endOfMonth(0, 2) + 1
  return [
    `Each difficulty plays seeds 1 to ${run.games} with each of the ${GROWTH_STRATEGIES.length} strategies below, to the close of the last day of month ${run.months}, or to the close that ends the game in bankruptcy (#160). Every game runs the best truck of \`docs/balance/phase-2.md\`: the starting prices, ${BASE_TRUCK.croissantsPerDay} croissants a day, ${formatDollars(BASE_TRUCK.marketingDaily)} of marketing a day, open ${WEEKDAYS[BASE_TRUCK.daysOpen].length} days a week, the owner paid ${formatDollars(BASE_TRUCK.ownerWeeklyPay)} a week. Each strategy then sets five things:`,
    '',
    `- **Contracts**, signed from day ${signingDay()}, the first day a grocer offers one in \`src/content/events.json\`, at the terms of \`src/content/grocers.json\`, and renewed each time; the smallest grocer first: ${grocers.map((grocer) => `${GROCERS.grocers[grocer].name}, ${GROCERS.grocers[grocer].unitsPerWeek} a week`).join('; ')}. « none » signs none, « one » the first, « two » the first two at once, « three » all three at once, the naive growth of #166, and « careful » one at a time: the next once the grocer it signed last has paid for a first delivery and the morning's Encaisse holds a reserve of a week's croissants at ${formatDollars(croissant.unitCostCents)} for each week the first payment takes, and one more: ${grocers.map((grocer) => `${formatDollars(contractReserve(grocer))} for ${GROCERS.grocers[grocer].name}`).join(', ')}.`,
    `- **The bakery**: never, on day 0, or on the 1st of month 4, day ${bakeryDay}, in effect the next morning. A leased oven makes the truck's croissants and the deliveries', within its capacity, and a baker is hired, « ${baker.name} » at ${formatDollars(baker.hourlyWageCents.start)} an hour, ${baker.hoursPerWeek} h a week.`,
    `- **An employee at the truck**, hired on day 0 or not: « ${employee.name} » at ${formatDollars(employee.hourlyWageCents.start)} an hour, ${employee.hoursPerWeek} h a week.`,
    "- **« Le rêve »**, never, or as soon as affordable: each morning, before the day, the next personal rung when the owner's own cash covers it, then the next company rung when Encaisse does.",
    "- **The financing**: Mme Prudhomme's emergency loan and Max Duvent's shares both accepted, or both refused (#159).",
    '',
    `No other event card comes up. Each game that accepts the financing and sees Max Duvent's offer plays again with the same seed and strategy, taking the loan but refusing him: his money was worth taking when the game avoided a bankruptcy its twin had or, both ending alike, ends with the higher net worth. The net worth is the owner's (#161), at the close of the last day of month ${run.months} or of the day that ended the game; the titles are \`src/content/dream.json\`'s.`,
  ]
}

function strategyTable(
  run: GrowthReportRun,
  difficulty: DifficultyId,
): string[] {
  const ranked = rankStrategies(strategiesAt(run, difficulty))
  return [
    '',
    `#### ${difficultyName(difficulty)}`,
    '',
    row([
      '#',
      'Contracts',
      'Bakery',
      'Employee',
      'Dream',
      'Financing',
      'Title',
      'Median net worth',
      'Worst net worth',
      'Lowest close',
      'Below zero',
      'First month below zero',
      'Loans',
      'Share sales',
      'Bankrupt',
      'Rungs',
    ]),
    row([
      '---:',
      '---',
      '---',
      '---',
      '---',
      '---',
      '---',
      '---:',
      '---:',
      '---:',
      '---:',
      '---:',
      '---:',
      '---:',
      '---:',
      '---:',
    ]),
    ...ranked.map(strategyRow),
  ]
}

function strategyRow({ rank, strategy, games }: RankedStrategy): string {
  const netWorths = games.map(({ netWorthAtEnd }) => netWorthAtEnd)
  const middle = medianCents(netWorths)
  const firstMonths = games.flatMap(({ firstDayBelowZero }) =>
    firstDayBelowZero === null ? [] : [monthOf(firstDayBelowZero)],
  )
  const total = (count: (game: GrowthGame) => number) =>
    formatCount(games.reduce((sum, game) => sum + count(game), 0))
  return row([
    String(rank),
    strategy.contracts,
    strategy.bakery,
    strategy.atTruck ? 'yes' : 'no',
    strategy.dream ? 'yes' : 'no',
    strategy.financing,
    titleOf(middle)?.name ?? 'none',
    formatDollars(middle),
    formatDollars(minimum(netWorths)),
    formatDollars(medianCents(games.map(({ lowestClose }) => lowestClose))),
    `${firstMonths.length} of ${games.length}`,
    firstMonths.length === 0 ? '-' : formatCount(median(firstMonths)),
    total(({ emergencyLoans }) => emergencyLoans),
    total(({ shareSales }) => shareSales),
    total(({ endedDay }) => (endedDay === null ? 0 : 1)),
    formatCount(median(games.map(({ rungsBought }) => rungsBought))),
  ])
}

function duventRow(
  difficulty: DifficultyId,
  games: readonly GrowthGame[],
): string {
  const taken = games.filter(({ withoutDuvent }) => withoutDuvent !== null)
  const worth = taken.filter((game) => duventWorth(game) === true)
  const avoided = taken.filter(
    ({ endedDay, withoutDuvent }) =>
      endedDay === null && withoutDuvent?.endedDay !== null,
  ).length
  const anyway = taken.filter(({ endedDay }) => endedDay !== null).length
  return row([
    difficultyName(difficulty),
    formatCount(taken.length),
    taken.length === 0
      ? 'n/a'
      : `${percent(worth.length / taken.length)}, ${worth.length}`,
    formatCount(avoided),
    formatCount(worth.length - avoided),
    formatCount(anyway),
  ])
}

const VERDICTS: Readonly<Record<Verdict, string>> = {
  met: '✓',
  missed: '✗',
  'n/a': 'n/a',
}

function verdict(met: boolean): Verdict {
  return met ? 'met' : 'missed'
}

function difficultyName(difficulty: DifficultyId): string {
  return DIFFICULTIES.difficulties[difficulty].name
}

function minimum(values: readonly Cents[]): Cents {
  return cents(Math.min(...values))
}

/** `12%`, from a share. */
function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

function oneDecimal(value: number): string {
  return value.toFixed(1)
}

function row(values: readonly string[]): string {
  return `| ${values.join(' | ')} |`
}
