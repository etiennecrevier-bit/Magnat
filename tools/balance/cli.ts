import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DIFFICULTIES } from '../../src/engine/day.ts'
import { wholeNumber } from '../sim/cli.ts'
import { runBalance } from './play.ts'
import { formatReport } from './report.ts'

// `npm run balance`: parses the options, plays every strategy at every
// difficulty, prints the progress and writes the report. The time each
// difficulty took goes to the console only, so the same options always
// write the same file.

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
 * Runs `npm run balance` with `argv`, the options after `--`, and returns
 * the exit code.
 */
export function main(argv: readonly string[]): number {
  try {
    const { years, games, out } = parseBalanceArgs(argv)
    const started = performance.now()
    let lap = started
    const run = runBalance({
      years,
      games,
      onProgress: ({ difficulty, strategies }) => {
        const now = performance.now()
        console.log(
          `${DIFFICULTIES.difficulties[difficulty].name}: ${strategies.length} strategies × ${games} games in ${seconds(now - lap)}`,
        )
        lap = now
      },
    })

    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, formatReport(run))
    console.log(`Wrote ${out} in ${seconds(performance.now() - started)}`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    return 1
  }
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} s`
}
