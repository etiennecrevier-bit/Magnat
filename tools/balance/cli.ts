import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { difficultyIdSchema } from '../../src/content/schema.ts'
import { DIFFICULTIES } from '../../src/engine/day.ts'
import { wholeNumber } from '../sim/cli.ts'
import { formatReport, withHandWritten } from './report.ts'
import { playAll } from './threads.ts'

// `npm run balance`: parses the options, plays every strategy at every
// difficulty, each difficulty on its own worker thread, prints the progress
// and writes the report, keeping the hand-written part of the one it
// replaces. The time each difficulty took goes to the console only, so the
// same options always write the same file.

export interface BalanceArgs {
  readonly years: number
  readonly games: number
  /** Absolute path of the report. */
  readonly out: string
}

const DEFAULTS = {
  years: 1,
  games: 30,
  out: fileURLToPath(new URL('../../docs/balance/phase-2.md', import.meta.url)),
}

export const USAGE =
  'Usage: npm run balance -- [--years <n>] [--games <n>] [--out <file>]'

/**
 * Reads `--years` and `--games` (whole numbers from 1) and `--out` (resolved
 * from the current folder). Throws on anything else, including positional
 * arguments.
 */
export function parseBalanceArgs(argv: readonly string[]): BalanceArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      years: { type: 'string' },
      games: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  })
  return {
    years: wholeNumber('--years', values.years, DEFAULTS.years, 1),
    games: wholeNumber('--games', values.games, DEFAULTS.games, 1),
    out: resolve(values.out ?? DEFAULTS.out),
  }
}

/**
 * Runs `npm run balance` with `argv`, the options after `--`, and resolves
 * to the exit code: 1 with the usage on a bad option, 1 with the error when
 * a game throws. Each difficulty's progress line comes as it is done, timed
 * from the start, since they play side by side.
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
    const { years, games, out } = args
    const started = performance.now()
    const difficulties = await playAll(
      difficultyIdSchema.options.map((difficulty) => ({
        years,
        games,
        difficulty,
      })),
      ({ difficulty, strategies }) => {
        console.log(
          `${DIFFICULTIES.difficulties[difficulty].name}: ${strategies.length} strategies × ${games} games in ${seconds(performance.now() - started)}`,
        )
      },
    )

    const previous = existsSync(out) ? readFileSync(out, 'utf8') : null
    const report = formatReport({ years, games, difficulties })
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, withHandWritten(previous, report))
    console.log(`Wrote ${out} in ${seconds(performance.now() - started)}`)
    return 0
  } catch (error) {
    console.error(message(error))
    return 1
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} s`
}
