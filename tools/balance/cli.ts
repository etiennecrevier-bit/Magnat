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
  type ContractPolicy,
  type EventPolicy,
} from '../sim/simulate.ts'
import { TRUCK_STRATEGIES, type BakeryJob } from './bakery.ts'
import { formatBakeryReport } from './bakeryReport.ts'
import {
  defisSection,
  formatDefiPercentileJson,
  formatDefisSection,
  withDefisSection,
} from './defisReport.ts'
import { formatPercentileJson, formatPhase3Report } from './phase3.ts'
import { formatReport, withHandWritten } from './report.ts'
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
// report. The time each job took goes to the console only, so the same
// options always write the same files.

/** The grid of strategies, `docs/balance/phase-2.md`. */
export interface GridArgs {
  readonly mode: 'grid'
  readonly years: number
  readonly games: number
  /** How the event cards are answered. */
  readonly events: EventPolicy
  /** How the grocers' cards are answered; null for as the others. */
  readonly contracts: ContractPolicy | null
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

export type BalanceArgs = GridArgs | PercentileArgs | DefisArgs | BakeryArgs

function repoFile(path: string): string {
  return fileURLToPath(new URL(`../../${path}`, import.meta.url))
}

const DEFAULTS = {
  years: 1,
  games: 30,
  events: 'none' as EventPolicy,
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

export const USAGE = [
  `Usage: npm run balance -- [--years <n>] [--games <n>] [--events ${EVENT_POLICIES.join('|')}] [--contracts ${CONTRACT_POLICIES.join('|')}] [--out <file>]`,
  '       npm run balance -- --percentiles [--years <n>] [--games <n>] [--out <file>] [--json <file>]',
  '       npm run balance -- --defis [--games <n>] [--search <n>] [--out <file>] [--json <file>]',
  '       npm run balance -- --bakery [--games <n>] [--months <n>] [--out <file>]',
].join('\n')

/**
 * Reads `--years` and `--games` (whole numbers from 1) and `--out`
 * (resolved from the current folder). Without `--percentiles`, also
 * `--events` (how the event cards are answered, by default `none`, so the
 * report stays the economy without events) and `--contracts` (how the
 * grocers' cards are answered, by default as the others); with it, `--json` (resolved the
 * same way), and other defaults. With `--defis`, `--games`, `--search` (a
 * whole number from 1), `--out` and `--json`, and defaults of their own.
 * With `--bakery`, `--games`, `--months` (a whole number from 1) and
 * `--out`, and defaults of their own. Throws on anything else, including
 * positional arguments, `--events` with `--percentiles` or `--defis`, whose
 * owners always answer at random, `--contracts` with either, `--years` or `--percentiles` with
 * `--defis`, `--search` without it, `--json` with neither, any other option
 * with `--bakery`, and `--months` without it.
 */
export function parseBalanceArgs(argv: readonly string[]): BalanceArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      percentiles: { type: 'boolean' },
      defis: { type: 'boolean' },
      bakery: { type: 'boolean' },
      years: { type: 'string' },
      months: { type: 'string' },
      search: { type: 'string' },
      games: { type: 'string' },
      events: { type: 'string' },
      contracts: { type: 'string' },
      out: { type: 'string' },
      json: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.bakery === true) {
    for (const [option, value] of [
      ['--percentiles', values.percentiles],
      ['--defis', values.defis],
      ['--years', values.years],
      ['--search', values.search],
      ['--events', values.events],
      ['--contracts', values.contracts],
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
    throw new RangeError('--months goes only with --bakery')
  }
  if (values.defis === true) {
    for (const [option, value] of [
      ['--percentiles', values.percentiles],
      ['--years', values.years],
      ['--events', values.events],
      ['--contracts', values.contracts],
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
    out: resolve(values.out ?? DEFAULTS.out),
  }
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
    }
    return 0
  } catch (error) {
    console.error(message(error))
    return 1
  }
}

async function writeGrid(
  { years, games, events, contracts, out }: GridArgs,
  started: number,
): Promise<void> {
  const policy = contracts === null ? {} : { contracts }
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
      withDefisSection(formatPhase3Report(run), defisSection(previous)),
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
  writeFile(out, withDefisSection(readPrevious(out), formatDefisSection(run)))
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
  writeReport(out, formatBakeryReport({ games, months, runs }))
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
