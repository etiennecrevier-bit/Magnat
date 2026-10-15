import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { cents } from '../../src/engine/money.ts'
import { formatDollars, formatReport, parseSimArgs, USAGE } from './cli.ts'
import { simulate, type SimulationResult } from './simulate.ts'

// `npm run sim`: its options, its report, and the real command run in a
// child process the way npm runs it.

const root = fileURLToPath(new URL('../..', import.meta.url))

describe('parseSimArgs', () => {
  it("defaults to ten years of seed 42 at the new game screen's difficulty, written to out/", () => {
    expect(parseSimArgs([])).toEqual({
      days: 3650,
      seed: 42,
      difficulty: 'moyen',
      out: join(root, 'out'),
    })
  })

  it('reads every option, the out folder from the current one', () => {
    expect(
      parseSimArgs([
        '--days',
        '40',
        '--seed=0',
        '--difficulty',
        'difficile',
        '--out',
        'tmp/sims',
      ]),
    ).toEqual({
      days: 40,
      seed: 0,
      difficulty: 'difficile',
      out: resolve('tmp/sims'),
    })
  })

  it.each(['facile', 'moyen', 'difficile'])('reads the difficulty %s', (id) => {
    expect(parseSimArgs([`--difficulty=${id}`]).difficulty).toBe(id)
  })

  it.each(['', 'Moyen', 'extreme', ' facile'])(
    'rejects the difficulty %j',
    (text) => {
      expect(() => parseSimArgs(['--difficulty', text])).toThrow(
        `--difficulty must be one of facile, moyen, difficile: ${text}`,
      )
    },
  )

  it.each(
    [
      ['--days', '0'],
      ['--days', '1.5'],
      ['--days', 'abc'],
      ['--days', '1e3'],
      ['--days', ' 7'],
      ['--days='],
      ['--days=-1'],
      ['--seed=-1'],
      ['--seed', '0x2a'],
    ].map((argv) => [argv]),
  )('rejects %j', (argv) => {
    expect(() => parseSimArgs(argv)).toThrow(RangeError)
  })

  it('rejects numbers too long to read exactly', () => {
    // Number() rounds these to 2^53 and to Infinity.
    for (const text of ['9007199254740993', '9'.repeat(400)]) {
      expect(() => parseSimArgs(['--days', text])).toThrow(RangeError)
      expect(() => parseSimArgs(['--seed', text])).toThrow(RangeError)
    }
  })

  // node:util's parseArgs turns these down before any number is read.
  it.each([[['--years', '3']], [['40']], [['--days']], [['--seed', '-1']]])(
    'rejects %j',
    (argv) => {
      expect(() => parseSimArgs(argv)).toThrow()
    },
  )
})

describe('formatDollars', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [-5, '-$0.05'],
    [99, '$0.99'],
    [-100, '-$1.00'],
    [123_456, '$1,234.56'],
    [100_000_000, '$1,000,000.00'],
    [-123_456_789, '-$1,234,567.89'],
    [Number.MAX_SAFE_INTEGER, '$90,071,992,547,409.91'],
  ])('formats %i cents as %s', (amount, text) => {
    expect(formatDollars(cents(amount))).toBe(text)
  })
})

describe('formatReport', () => {
  it('prints a header, one aligned row per year and the hash', () => {
    const result: SimulationResult = {
      seed: 7,
      difficulty: 'facile',
      days: 400,
      journalHash: 'ab'.repeat(32),
      years: [
        {
          year: 1,
          fromDay: 0,
          toDay: 364,
          revenue: cents(14_335_750),
          netIncome: cents(-5),
          cashAtYearEnd: cents(100_000_000),
          unitsSpoiled: 5940,
          lostSales: 299,
        },
        {
          year: 2,
          fromDay: 365,
          toDay: 399,
          revenue: cents(0),
          netIncome: cents(-123_456),
          cashAtYearEnd: cents(99),
          unitsSpoiled: 0,
          lostSales: 12,
        },
      ],
      daySummaries: [],
      journal: [],
      owner: { morningEnergy: [], personalCash: cents(0), unpaidRents: [] },
    }
    expect(formatReport(result)).toEqual([
      'Seed 7, 400 days, difficulty facile',
      'Year     Days      Revenue  Net income  Cash at year end  Units spoiled  Lost sales',
      '   1    0-364  $143,357.50      -$0.05     $1,000,000.00           5940         299',
      '   2  365-399        $0.00  -$1,234.56             $0.99              0          12',
      `Journal sha256: ${'ab'.repeat(32)}`,
    ])
  })
})

describe('npm run sim', () => {
  const out = mkdtempSync(join(tmpdir(), 'magnat-sim-'))
  afterAll(() => {
    rmSync(out, { recursive: true, force: true })
  })

  // What `tsx tools/sim/run.ts` does, without the .bin shim, so it runs on
  // every platform.
  function sim(...argv: string[]) {
    return spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tools/sim/run.ts', ...argv],
      { cwd: root, encoding: 'utf8' },
    )
  }

  it('prints the report and writes the result, as played in this process', () => {
    const { status, stdout, stderr } = sim(
      '--days',
      '40',
      '--seed',
      '7',
      '--difficulty',
      'facile',
      '--out',
      out,
    )
    const file = join(out, 'sim-7-facile.json')
    const expected = simulate(7, 40, 'facile')
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout.trimEnd().split('\n')).toEqual([
      ...formatReport(expected),
      `Wrote ${file}`,
    ])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(expected)),
    )
  }, 30_000)

  it('exits with 1 and the usage on a bad option, writing nothing', () => {
    const { status, stdout, stderr } = sim(
      '--days',
      'abc',
      '--seed',
      '8',
      '--out',
      out,
    )
    expect(status).toBe(1)
    expect(stdout).toBe('')
    expect(stderr.trimEnd().split('\n')).toEqual([
      '--days must be a whole number from 1: abc',
      USAGE,
    ])
    expect(existsSync(join(out, 'sim-8-moyen.json'))).toBe(false)
  }, 30_000)
})
