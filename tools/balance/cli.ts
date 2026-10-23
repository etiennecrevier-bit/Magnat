import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { difficultyIdSchema } from '../../src/content/schema.ts'
import { DEFIS, DIFFICULTIES } from '../../src/engine/day.ts'
import { contractPolicy, eventPolicy, wholeNumber } from '../sim/cli.ts'
import {
  CONTRACT_POLICIES,
  EVENT_POLICIES,
  FINANCING_POLICIES,
  type ContractPolicy,
  type EventPolicy,
  type FinancingPolicy,
} from '../sim/simulate.ts'
import { TRUCK_STRATEGIES, type BakeryJob } from './bakery.ts'
import { formatBakeryReport } from './bakeryReport.ts'
import { CONTRACT_PLANS, type GrowthJob } from './growth.ts'
import { GROWTH_MARKERS, formatGrowthSection } from './growthReport.ts'
import { HIRING_ROLES, type HiringJob } from './hiring.ts'
import { formatHiringReport } from './hiringReport.ts'
import {
  DEFIS_MARKERS,
  formatDefiPercentileJson,
  formatDefisSection,
} from './defisReport.ts'
import { formatPercentileJson, formatPhase3Report } from './phase3.ts'
import {
  formatReport,
  sectionOf,
  withHandWritten,
  withSection,
} from './report.ts'
import {
  playAll,
  type DefisJob,
  type GridJob,
  type OwnersJob,
} from './threads.ts'

// `npm run balance`: parses the options, plays every strategy at every
// difficulty, each difficulty on its own worker thread, prints the progress
// and writes the report, keeping the hand-written part of the one it
// replaces. With `--percentiles`, plays the simulated owners instead and
// writes their percentile table and the phase-3 report; with `--defis`,
// plays each Défi, a few side by side, and writes their percentile table
// and the Défis section of the phase-3 report; with `--bakery`, plays the
// bakery against its twins at each difficulty and writes the phase-4
// report; with `--growth`, plays the growth strategies at each difficulty
// and writes their section of the phase-4 report; with `--hiring`, plays
// each candidate in each role against their twins at Moyen and writes the
// phase-5 report. The time each job took
// goes to the console only, so the same options always write the same
// files.

/** The grid of strategies, `docs/balance/phase-2.md`. */
export interface GridArgs {
  readonly mode: 'grid'
  readonly years: number
  readonly games: number
  /** How the event cards are answered. */
  readonly events: EventPolicy
  /** How the grocers' cards are answered; null for as the others. */
  readonly contracts: ContractPolicy | null
  /** How the financing's cards are answered (#159). */
  readonly financing: FinancingPolicy
  /** Absolute path of the report. */
  readonly out: string
}

/** The simulated owners, `--percentiles`. */
export interface PercentileArgs {
  readonly mode: 'percentiles'
  readonly years: number
  readonly games: number
  /** Absolute path of the report. */
  readonly out: string
  /** Absolute path of the percentile table. */
  readonly json: string
}

/** The Défis, `--defis`. */
export interface DefisArgs {
  readonly mode: 'defis'
  /** Games per Défi, by the owners and by the best strategy. */
  readonly games: number
  /** Seeds each strategy of the grid plays in the search for the best. */
  readonly search: number
  /** Absolute path of the report its section goes in. */
  readonly out: string
  /** Absolute path of the Défis' percentile table. */
  readonly json: string
}

/** The bakery, `--bakery`. */
export interface BakeryArgs {
  readonly mode: 'bakery'
  /** Seeds each difficulty, strategy, price set and oven plays. */
  readonly games: number
  /** Months each game plays. */
  readonly months: number
  /** Absolute path of the report. */
  readonly out: string
}

/** The growth strategies, `--growth`. */
export interface GrowthArgs {
  readonly mode: 'growth'
  /** Seeds each difficulty and strategy plays. */
  readonly games: number
  /** Months each game plays. */
  readonly months: number
  /** Absolute path of the report its section goes in. */
  readonly out: string
}

/** The hiring run, `--hiring` (#255). */
export interface HiringArgs {
  readonly mode: 'hiring'
  /** Seeds each role and candidate plays. */
  readonly games: number
  /** Months each game plays. */
  readonly months: number
  /** Absolute path of the report. */
  readonly out: string
}

export type BalanceArgs =
  GridArgs | PercentileArgs | DefisArgs | BakeryArgs | GrowthArgs | HiringArgs

function repoFile(path: string): string {
  return fileURLToPath(new URL(`../../${path}`, import.meta.url))
}

const DEFAULTS = {
  years: 1,
  games: 30,
  events: 'none' as EventPolicy,
  financing: 'accept' as FinancingPolicy,
  out: repoFile('docs/balance/phase-2.md'),
}

const PERCENTILE_DEFAULTS = {
  years: 2,
  games: 1000,
  out: repoFile('docs/balance/phase-3.md'),
  json: repoFile('src/content/percentiles.json'),
}

const DEFIS_DEFAULTS = {
  games: 1000,
  search: 100,
  out: repoFile('docs/balance/phase-3.md'),
  json: repoFile('src/content/defis-percentiles.json'),
}

const BAKERY_DEFAULTS = {
  games: 30,
  months: 24,
  out: repoFile('docs/balance/phase-4.md'),
}

const GROWTH_DEFAULTS = BAKERY_DEFAULTS

const HIRING_DEFAULTS = {
  games: 30,
  months: 12,
  out: repoFile('docs/balance/phase-5.md'),
}

export const USAGE = [
  `Usage: npm run balance -- [--years <n>] [--games <n>] [--events ${EVENT_POLICIES.join('|')}] [--contracts ${CONTRACT_POLICIES.join('|')}] [--financing ${FINANCING_POLICIES.join('|')}] [--out <file>]`,
  '       npm run balance -- --percentiles [--years <n>] [--games <n>] [--out <file>] [--json <file>]',
  '       npm run balance -- --defis [--games <n>] [--search <n>] [--out <file>] [--json <file>]',
  '       npm run balance -- --bakery [--games <n>] [--months <n>] [--out <file>]',
  '       npm run balance -- --growth [--games <n>] [--months <n>] [--out <file>]',
  '       npm run balance -- --hiring [--games <n>] [--months <n>] [--out <file>]',
].join('\n')

/**
 * Reads `--years` and `--games` (whole numbers from 1) and `--out`
 * (resolved from the current folder). Without `--percentiles`, also
 * `--events` (how the event cards are answered, by default `none`, so the
 * report stays the economy without events), `--contracts` (how the
 * grocers' cards are answered, by default as the others) and `--financing`
 * (how the cards of the emergency loan and the share sale are answered, by
 * default `accept`, so a strategy that runs out of cash borrows as a player
 * would); with it, `--json` (resolved the
 * same way), and other defaults. With `--defis`, `--games`, `--search` (a
 * whole number from 1), `--out` and `--json`, and defaults of their own.
 * With `--bakery`, `--growth` or `--hiring`, `--games`, `--months` (a
 * whole number from 1) and `--out`, and defaults of their own. Throws on
 * anything else,
 * including
 * positional arguments, `--events` with `--percentiles` or `--defis`, whose
 * owners always answer at random, `--contracts` or `--financing` with
 * either, `--years` or `--percentiles` with
 * `--defis`, `--search` without it, `--json` with neither, any other option
 * with `--bakery`, `--growth` or `--hiring`, and `--months` without one of
 * them.
 */
export function parseBalanceArgs(argv: readonly string[]): BalanceArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      percentiles: { type: 'boolean' },
      defis: { type: 'boolean' },
      bakery: { type: 'boolean' },
      growth: { type: 'boolean' },
      hiring: { type: 'boolean' },
      years: { type: 'string' },
      months: { type: 'string' },
      search: { type: 'string' },
      games: { type: 'string' },
      events: { type: 'string' },
      contracts: { type: 'string' },
      financing: { type: 'string' },
      out: { type: 'string' },
      json: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.hiring === true) {
    for (const [option, value] of [
      ['--percentiles', values.percentiles],
      ['--defis', values.defis],
      ['--bakery', values.bakery],
      ['--growth', values.growth],
      ['--years', values.years],
      ['--search', values.search],
      ['--events', values.events],
      ['--contracts', values.contracts],
      ['--financing', values.financing],
      ['--json', values.json],
    ] as const) {
      if (value !== undefined) {
        throw new RangeError(`${option} does not go with --hiring`)
      }
    }
    const defaults = HIRING_DEFAULTS
    return {
      mode: 'hiring',
      games: wholeNumber('--games', values.games, defaults.games, 1),
      months: wholeNumber('--months', values.months, defaults.months, 1),
      out: resolve(values.out ?? defaults.out),
    }
  }
  if (values.growth === true) {
    for (const [option, value] of [
      ['--percentiles', values.percentiles],
      ['--defis', values.defis],
      ['--bakery', values.bakery],
      ['--years', values.years],
      ['--search', values.search],
      ['--events', values.events],
      ['--contracts', values.contracts],
      ['--financing', values.financing],
      ['--json', values.json],
    ] as const) {
      if (value !== undefined) {
        throw new RangeError(`${option} does not go with --growth`)
      }
    }
    const defaults = GROWTH_DEFAULTS
    return {
      mode: 'growth',
      games: wholeNumber('--games', values.games, defaults.games, 1),
      months: wholeNumber('--months', values.months, defaults.months, 1),
      out: resolve(values.out ?? defaults.out),
    }
  }
  if (values.bakery === true) {
    for (const [option, value] of [
      ['--percentiles', values.percentiles],
      ['--defis', values.defis],
      ['--years', values.years],
      ['--search', values.search],
      ['--events', values.events],
      ['--contracts', values.contracts],
      ['--financing', values.financing],
      ['--json', values.json],
    ] as const) {
      if (value !== undefined) {
        throw new RangeError(`${option} does not go with --bakery`)
      }
    }
    const defaults = BAKERY_DEFAULTS
    return {
      mode: 'bakery',
      games: wholeNumber('--games', values.games, defaults.games, 1),
      months: wholeNumber('--months', values.months, defaults.months, 1),
      out: resolve(values.out ?? defaults.out),
    }
  }
  if (values.months !== undefined) {
    throw new RangeError(
      '--months goes only with --bakery, --growth or --hiring',
    )
  }
  if (values.defis === true) {
    for (const [option, value] of [
      ['--percentiles', values.percentiles],
      ['--years', values.years],
      ['--events', values.events],
      ['--contracts', values.contracts],
      ['--financing', values.financing],
    ] as const) {
      if (value !== undefined) {
        throw new RangeError(`${option} does not go with --defis`)
      }
    }
    const defaults = DEFIS_DEFAULTS
    return {
      mode: 'defis',
      games: wholeNumber('--games', values.games, defaults.games, 1),
      search: wholeNumber('--search', values.search, defaults.search, 1),
      out: resolve(values.out ?? defaults.out),
      json: resolve(values.json ?? defaults.json),
    }
  }
  if (values.search !== undefined) {
    throw new RangeError('--search goes only with --defis')
  }
  if (values.percentiles === true) {
    for (const [option, value] of [
      ['--events', values.events],
      ['--contracts', values.contracts],
      ['--financing', values.financing],
    ] as const) {
      if (value !== undefined) {
        throw new RangeError(
          `${option} does not go with --percentiles: the owners answer at random`,
        )
      }
    }
    const defaults = PERCENTILE_DEFAULTS
    return {
      mode: 'percentiles',
      years: wholeNumber('--years', values.years, defaults.years, 1),
      games: wholeNumber('--games', values.games, defaults.games, 1),
      out: resolve(values.out ?? defaults.out),
      json: resolve(values.json ?? defaults.json),
    }
  }
  if (values.json !== undefined) {
    throw new RangeError('--json goes only with --percentiles or --defis')
  }
  return {
    mode: 'grid',
    years: wholeNumber('--years', values.years, DEFAULTS.years, 1),
    games: wholeNumber('--games', values.games, DEFAULTS.games, 1),
    events: eventPolicy(values.events, DEFAULTS.events),
    contracts: contractPolicy(values.contracts),
    financing: financingPolicy(values.financing, DEFAULTS.financing),
    out: resolve(values.out ?? DEFAULTS.out),
  }
}

/**
 * Reads `text`, the value of `--financing`, as a policy, or `fallback` when
 * the option is absent. Throws a RangeError naming the option otherwise.
 */
export function financingPolicy(
  text: string | undefined,
  fallback: FinancingPolicy,
): FinancingPolicy {
  if (text === undefined) return fallback
  const known = FINANCING_POLICIES.find((policy) => policy === text)
  if (known === undefined) {
    throw new RangeError(
      `--financing must be one of ${FINANCING_POLICIES.join(', ')}: ${text}`,
    )
  }
  return known
}

/**
 * Runs `npm run balance` with `argv`, the options after `--`, and resolves
 * to the exit code: 1 with the usage on a bad option, 1 with the error when
 * a game throws. Each job's progress line comes as it is done, timed from
 * the start, since they play side by side.
 */
export async function main(argv: readonly string[]): Promise<number> {
  let args: BalanceArgs
  try {
    args = parseBalanceArgs(argv)
  } catch (error) {
    console.error(message(error))
    console.error(USAGE)
    return 1
  }

  try {
    const started = performance.now()
    switch (args.mode) {
      case 'percentiles':
        await writePercentiles(args, started)
        break
      case 'defis':
        await writeDefis(args, started)
        break
      case 'grid':
        await writeGrid(args, started)
        break
      case 'bakery':
        await writeBakery(args, started)
        break
      case 'growth':
        await writeGrowth(args, started)
        break
      case 'hiring':
        await writeHiring(args, started)
        break
    }
    return 0
  } catch (error) {
    console.error(message(error))
    return 1
  }
}

async function writeGrid(
  { years, games, events, contracts, financing, out }: GridArgs,
  started: number,
): Promise<void> {
  const policy = contracts === null ? { financing } : { contracts, financing }
  const difficulties = await playAll(
    difficultyIdSchema.options.map((difficulty): GridJob => ({
      kind: 'grid',
      years,
      games,
      difficulty,
      events,
      ...policy,
    })),
    ({ difficulty, strategies }) => {
      console.log(
        `${DIFFICULTIES.difficulties[difficulty].name}: ${strategies.length} strategies × ${games} games in ${seconds(performance.now() - started)}`,
      )
    },
  )
  writeReport(
    out,
    formatReport({ years, games, events, ...policy, difficulties }),
  )
  console.log(`Wrote ${out} in ${seconds(performance.now() - started)}`)
}

async function writePercentiles(
  { years, games, out, json }: PercentileArgs,
  started: number,
): Promise<void> {
  const difficulties = await playAll(
    difficultyIdSchema.options.map((difficulty): OwnersJob => ({
      kind: 'owners',
      years,
      games,
      difficulty,
    })),
    ({ difficulty }) => {
      console.log(
        `${DIFFICULTIES.difficulties[difficulty].name}: ${games} owners in ${seconds(performance.now() - started)}`,
      )
    },
  )
  const run = { years, games, difficulties }
  const table = await formatPercentileJson(run)
  mkdirSync(dirname(json), { recursive: true })
  writeFileSync(json, table)
  const previous = readPrevious(out)
  writeFile(
    out,
    withHandWritten(
      previous,
      withSection(
        formatPhase3Report(run),
        sectionOf(previous, DEFIS_MARKERS),
        DEFIS_MARKERS,
      ),
    ),
  )
  console.log(
    `Wrote ${json} and ${out} in ${seconds(performance.now() - started)}`,
  )
}

async function writeDefis(
  { games, search, out, json }: DefisArgs,
  started: number,
): Promise<void> {
  const defis = await playAll(
    DEFIS.defis.map(({ id }): DefisJob => ({
      kind: 'defis',
      defi: id,
      games,
      search,
    })),
    ({ defi }) => {
      console.log(
        `${defi}: ${games} owners, the best of the grid on ${search} seeds, in ${seconds(performance.now() - started)}`,
      )
    },
  )
  const run = { games, search, defis }
  const table = await formatDefiPercentileJson(run)
  mkdirSync(dirname(json), { recursive: true })
  writeFileSync(json, table)
  writeFile(
    out,
    withSection(readPrevious(out), formatDefisSection(run), DEFIS_MARKERS),
  )
  console.log(
    `Wrote ${json} and ${out} in ${seconds(performance.now() - started)}`,
  )
}

async function writeBakery(
  { games, months, out }: BakeryArgs,
  started: number,
): Promise<void> {
  const runs = await playAll(
    difficultyIdSchema.options.flatMap((difficulty) =>
      TRUCK_STRATEGIES.map(({ name }): BakeryJob => ({
        kind: 'bakery',
        difficulty,
        strategy: name,
        games,
        months,
      })),
    ),
    ({ difficulty, strategy, cells }) => {
      console.log(
        `${DIFFICULTIES.difficulties[difficulty].name}, ${strategy}: ${cells.length} bakeries × ${games} games and their twins in ${seconds(performance.now() - started)}`,
      )
    },
  )
  const previous = readPrevious(out)
  writeFile(
    out,
    withHandWritten(
      previous,
      withSection(
        formatBakeryReport({ games, months, runs }),
        sectionOf(previous, GROWTH_MARKERS),
        GROWTH_MARKERS,
      ),
    ),
  )
  console.log(`Wrote ${out} in ${seconds(performance.now() - started)}`)
}

async function writeGrowth(
  { games, months, out }: GrowthArgs,
  started: number,
): Promise<void> {
  const runs = await playAll(
    difficultyIdSchema.options.flatMap((difficulty) =>
      CONTRACT_PLANS.map((contracts): GrowthJob => ({
        kind: 'growth',
        difficulty,
        contracts,
        games,
        months,
      })),
    ),
    ({ difficulty, contracts, strategies }) => {
      console.log(
        `${DIFFICULTIES.difficulties[difficulty].name}, contracts ${contracts}: ${strategies.length} strategies × ${games} games in ${seconds(performance.now() - started)}`,
      )
    },
  )
  writeFile(
    out,
    withSection(
      readPrevious(out),
      formatGrowthSection({ games, months, runs }),
      GROWTH_MARKERS,
    ),
  )
  console.log(`Wrote ${out} in ${seconds(performance.now() - started)}`)
}

async function writeHiring(
  { games, months, out }: HiringArgs,
  started: number,
): Promise<void> {
  const runs = await playAll(
    HIRING_ROLES.map((role): HiringJob => ({
      kind: 'hiring',
      role,
      difficulty: 'moyen',
      games,
      months,
    })),
    ({ role, cells }) => {
      console.log(
        `${role}: ${cells.length} candidates × ${games} games and their twins in ${seconds(performance.now() - started)}`,
      )
    },
  )
  writeReport(out, formatHiringReport({ games, months, runs }))
  console.log(`Wrote ${out} in ${seconds(performance.now() - started)}`)
}

/** Writes `report` to `out`, keeping the hand-written part already there. */
function writeReport(out: string, report: string): void {
  writeFile(out, withHandWritten(readPrevious(out), report))
}

function readPrevious(out: string): string | null {
  return existsSync(out) ? readFileSync(out, 'utf8') : null
}

function writeFile(out: string, text: string): void {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} s`
}
