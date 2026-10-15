import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  difficultyIdSchema,
  type DifficultyId,
} from '../../src/content/schema.ts'
import type { Cents } from '../../src/engine/money.ts'
import { defaultProfile } from '../../src/engine/profile.ts'
import { MODIFIER_KINDS } from '../../src/engine/street.ts'
import {
  EVENT_POLICIES,
  simulate,
  type EventPolicy,
  type SimulationResult,
} from './simulate.ts'

// `npm run sim`: parses the options, plays the game, prints one row per year
// and writes the full result to disk. The report is for developers, so it is
// in English.

export interface SimArgs {
  readonly days: number
  readonly seed: number
  readonly difficulty: DifficultyId
  /** How the event cards are answered. */
  readonly events: EventPolicy
  /** Absolute path of the folder the result goes to. */
  readonly out: string
}

const DEFAULTS = {
  days: 3650,
  seed: 42,
  difficulty: defaultProfile().difficulty,
  events: 'random' as EventPolicy,
  out: fileURLToPath(new URL('../../out', import.meta.url)),
}

export const USAGE = `Usage: npm run sim -- [--days <n>] [--seed <n>] [--difficulty ${difficultyIdSchema.options.join('|')}] [--events ${EVENT_POLICIES.join('|')}] [--out <folder>]`

/**
 * Reads `--days` (a whole number from 1), `--seed` (a whole number from 0),
 * `--difficulty` (a difficulty's id, by default the new game screen's),
 * `--events` (how the event cards are answered, by default `random`) and
 * `--out` (resolved from the current folder). Throws on anything else,
 * including positional arguments.
 */
export function parseSimArgs(argv: readonly string[]): SimArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      days: { type: 'string' },
      seed: { type: 'string' },
      difficulty: { type: 'string' },
      events: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  })
  return {
    days: wholeNumber('--days', values.days, DEFAULTS.days, 1),
    seed: wholeNumber('--seed', values.seed, DEFAULTS.seed, 0),
    difficulty: difficultyOf(values.difficulty),
    events: eventPolicy(values.events, DEFAULTS.events),
    out: resolve(values.out ?? DEFAULTS.out),
  }
}

/**
 * A header, one row per year, the days each kind of change to the street
 * was in effect and the journal hash.
 */
export function formatReport(result: SimulationResult): string[] {
  const header = [
    'Year',
    'Days',
    'Revenue',
    'Net income',
    'Cash at year end',
    'Units spoiled',
    'Lost sales',
  ]
  const rows = [
    header,
    ...result.years.map((year) => [
      String(year.year),
      `${year.fromDay}-${year.toDay}`,
      formatDollars(year.revenue),
      formatDollars(year.netIncome),
      formatDollars(year.cashAtYearEnd),
      String(year.unitsSpoiled),
      String(year.lostSales),
    ]),
  ]
  const widths = header.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  )
  return [
    `Seed ${result.seed}, ${result.days} days, difficulty ${result.difficulty}, events ${result.events}`,
    ...rows.map((row) =>
      row.map((cell, column) => cell.padStart(widths[column] ?? 0)).join('  '),
    ),
    `Street changes: ${MODIFIER_KINDS.map((kind) => `${kind} ${result.modifierDays[kind]} days`).join(', ')}`,
    `Journal sha256: ${result.journalHash}`,
  ]
}

/** `-$1,234.56`, worked out from the cents without floating point. */
export function formatDollars(amount: Cents): string {
  const abs = Math.abs(amount)
  const remainder = abs % 100
  const dollars = String((abs - remainder) / 100).replace(
    /\B(?=(\d{3})+$)/g,
    ',',
  )
  const sign = amount < 0 ? '-' : ''
  return `${sign}$${dollars}.${String(remainder).padStart(2, '0')}`
}

/**
 * Runs `npm run sim` with `argv`, the options after `--`, and returns the
 * exit code. Writes `sim-<seed>-<difficulty>.json` into the `--out` folder.
 */
export function main(argv: readonly string[]): number {
  try {
    const { days, seed, difficulty, events, out } = parseSimArgs(argv)
    const result = simulate(seed, days, difficulty, [], events)
    for (const line of formatReport(result)) console.log(line)

    mkdirSync(out, { recursive: true })
    const file = join(out, `sim-${seed}-${difficulty}.json`)
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`)
    console.log(`Wrote ${file}`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    return 1
  }
}

function difficultyOf(text: string | undefined): DifficultyId {
  if (text === undefined) return DEFAULTS.difficulty
  const known = difficultyIdSchema.options.find((id) => id === text)
  if (known === undefined) {
    throw new RangeError(
      `--difficulty must be one of ${difficultyIdSchema.options.join(', ')}: ${text}`,
    )
  }
  return known
}

/**
 * Reads `text`, the value of `--events`, as a policy, or `fallback` when the
 * option is absent. Throws a RangeError naming the option on anything else.
 */
export function eventPolicy(
  text: string | undefined,
  fallback: EventPolicy,
): EventPolicy {
  if (text === undefined) return fallback
  const known = EVENT_POLICIES.find((policy) => policy === text)
  if (known === undefined) {
    throw new RangeError(
      `--events must be one of ${EVENT_POLICIES.join(', ')}: ${text}`,
    )
  }
  return known
}

/**
 * Reads `text`, the value of `option`, as a whole number from `min`, or
 * `fallback` when the option is absent. Throws a RangeError naming the
 * option on anything else.
 */
export function wholeNumber(
  option: string,
  text: string | undefined,
  fallback: number,
  min: number,
): number {
  if (text === undefined) return fallback
  // Digits only, then a safe integer: Number() alone would accept "1e3" or
  // " 7", and round a long string of digits to another number or Infinity.
  const value = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < min) {
    throw new RangeError(
      `${option} must be a whole number from ${min}: ${text}`,
    )
  }
  return value
}
