import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { parseBalanceArgs, USAGE } from './cli.ts'
import { DEFIS_END, DEFIS_START } from './defisReport.ts'
import { HAND_WRITTEN } from './report.ts'

// `npm run balance`: its options, and the real command run in a child
// process the way npm runs it.

const root = fileURLToPath(new URL('../..', import.meta.url))

describe('parseBalanceArgs', () => {
  it('defaults to one year of 30 games, written to docs/balance/phase-2.md', () => {
    expect(parseBalanceArgs([])).toEqual({
      mode: 'grid',
      years: 1,
      games: 30,
      events: 'none',
      out: join(root, 'docs', 'balance', 'phase-2.md'),
    })
  })

  it('reads every option, the out file from the current folder', () => {
    expect(
      parseBalanceArgs([
        '--years',
        '2',
        '--games=5',
        '--events',
        'random',
        '--out',
        'tmp/b.md',
      ]),
    ).toEqual({
      mode: 'grid',
      years: 2,
      games: 5,
      events: 'random',
      out: resolve('tmp/b.md'),
    })
  })

  it('defaults --percentiles to 1000 games of two years, written to phase-3.md and percentiles.json', () => {
    expect(parseBalanceArgs(['--percentiles'])).toEqual({
      mode: 'percentiles',
      years: 2,
      games: 1000,
      out: join(root, 'docs', 'balance', 'phase-3.md'),
      json: join(root, 'src', 'content', 'percentiles.json'),
    })
  })

  it('reads every option of --percentiles, the files from the current folder', () => {
    expect(
      parseBalanceArgs([
        '--games=200',
        '--percentiles',
        '--years',
        '1',
        '--out',
        'tmp/p.md',
        '--json',
        'tmp/p.json',
      ]),
    ).toEqual({
      mode: 'percentiles',
      years: 1,
      games: 200,
      out: resolve('tmp/p.md'),
      json: resolve('tmp/p.json'),
    })
  })

  it('rejects --events with --percentiles, and --json without it', () => {
    expect(() =>
      parseBalanceArgs(['--percentiles', '--events', 'random']),
    ).toThrow('--events does not go with --percentiles')
    expect(() => parseBalanceArgs(['--json', 'p.json'])).toThrow(
      '--json goes only with --percentiles or --defis',
    )
  })

  it('defaults --defis to 1000 games and a search on 100 seeds, written to phase-3.md and defis-percentiles.json', () => {
    expect(parseBalanceArgs(['--defis'])).toEqual({
      mode: 'defis',
      games: 1000,
      search: 100,
      out: join(root, 'docs', 'balance', 'phase-3.md'),
      json: join(root, 'src', 'content', 'defis-percentiles.json'),
    })
  })

  it('reads every option of --defis, the files from the current folder', () => {
    expect(
      parseBalanceArgs([
        '--search=30',
        '--defis',
        '--games',
        '200',
        '--out',
        'tmp/d.md',
        '--json',
        'tmp/d.json',
      ]),
    ).toEqual({
      mode: 'defis',
      games: 200,
      search: 30,
      out: resolve('tmp/d.md'),
      json: resolve('tmp/d.json'),
    })
  })

  it('rejects --percentiles, --years and --events with --defis, and --search without it', () => {
    expect(() => parseBalanceArgs(['--defis', '--percentiles'])).toThrow(
      '--percentiles does not go with --defis',
    )
    expect(() => parseBalanceArgs(['--defis', '--years', '1'])).toThrow(
      '--years does not go with --defis',
    )
    expect(() => parseBalanceArgs(['--defis', '--events', 'random'])).toThrow(
      '--events does not go with --defis',
    )
    expect(() => parseBalanceArgs(['--search', '3'])).toThrow(
      '--search goes only with --defis',
    )
    expect(() => parseBalanceArgs(['--percentiles', '--search', '3'])).toThrow(
      '--search goes only with --defis',
    )
    expect(() => parseBalanceArgs(['--defis', '--search', '0'])).toThrow(
      '--search must be a whole number from 1: 0',
    )
  })

  it.each(['first', 'random', 'none'])('reads the events policy %s', (id) => {
    expect(parseBalanceArgs([`--events=${id}`])).toMatchObject({
      mode: 'grid',
      events: id,
    })
  })

  it.each(['', 'all', 'Random'])('rejects the events policy %j', (text) => {
    expect(() => parseBalanceArgs(['--events', text])).toThrow(
      `--events must be one of first, random, none: ${text}`,
    )
  })

  it.each(
    [
      ['--years', '0'],
      ['--years', '1.5'],
      ['--games', '0'],
      ['--games', 'abc'],
      ['--games', '1e3'],
      ['--games='],
      ['--games=-1'],
    ].map((argv) => [argv]),
  )('rejects %j', (argv) => {
    expect(() => parseBalanceArgs(argv)).toThrow(RangeError)
  })

  // node:util's parseArgs turns these down before any number is read.
  it.each([[['--days', '3']], [['30']], [['--games']]])(
    'rejects %j',
    (argv) => {
      expect(() => parseBalanceArgs(argv)).toThrow()
    },
  )
})

describe('npm run balance', () => {
  const out = mkdtempSync(join(tmpdir(), 'magnat-balance-'))
  afterAll(() => {
    rmSync(out, { recursive: true, force: true })
  })

  // What `tsx tools/balance/run.ts` does, without the .bin shim, so it runs
  // on every platform.
  function balance(...argv: string[]) {
    return spawnSync(
      process.execPath,
      ['--import', 'tsx', 'tools/balance/run.ts', ...argv],
      { cwd: root, encoding: 'utf8' },
    )
  }

  it('plays the whole grid at each difficulty and writes the report, keeping its hand-written part', () => {
    const file = join(out, 'nested', 'report.md')
    const tail = [HAND_WRITTEN, '', '## Before and after', '', 'Mine.', '']
    mkdirSync(join(out, 'nested'))
    writeFileSync(file, ['# Old report', '', ...tail].join('\n'))
    const { status, stdout, stderr } = balance('--games', '1', '--out', file)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    const progress = stdout.trimEnd().split('\n')
    expect(progress).toHaveLength(4)
    // The difficulties play side by side, so they end in any order.
    expect(
      progress
        .slice(0, 3)
        .map((line) => line.split(':')[0])
        .sort(),
    ).toEqual(['Difficile', 'Facile', 'Moyen'])
    for (const line of progress.slice(0, 3)) {
      expect(line).toMatch(
        /^(Facile|Moyen|Difficile): 324 strategies × 1 games in \d+\.\d s$/,
      )
    }
    expect(progress[3]).toMatch(/ in \d+\.\d s$/)
    expect(progress[3]?.replace(/ in \d+\.\d s$/, '')).toBe(`Wrote ${file}`)

    const report = readFileSync(file, 'utf8')
    expect(report).toMatch(
      /^# Balance report: phase 2\n\nGenerated by `npm run balance -- --years 1 --games 1`/,
    )
    const headings = report.split('\n').filter((line) => line.startsWith('#'))
    expect(headings).toEqual([
      '# Balance report: phase 2',
      '## What each game plays',
      '## Columns',
      '## Design targets',
      '## Best and worst',
      '### Facile',
      '### Moyen',
      '### Difficile',
      '## All strategies',
      '### Facile',
      '### Moyen',
      '### Difficile',
      '## Before and after',
    ])
    // 10 best, 10 worst and all 324 at each difficulty.
    const rows = report.split('\n').filter((line) => /^\| \d+ \|/.test(line))
    expect(rows).toHaveLength(3 * (10 + 10 + 324))
    // The difficulties in their own order, whichever ended first.
    expect(report.indexOf('### Facile')).toBeLessThan(
      report.indexOf('### Moyen'),
    )
    expect(report.indexOf('### Moyen')).toBeLessThan(
      report.indexOf('### Difficile'),
    )
    expect(report.endsWith(`\n\n${tail.join('\n')}`)).toBe(true)
    expect(report).not.toContain('# Old report')
  }, 90_000)

  it('exits with 1 and the usage on a bad option, writing nothing', () => {
    const file = join(out, 'bad.md')
    const { status, stdout, stderr } = balance('--games', '0', '--out', file)
    expect(status).toBe(1)
    expect(stdout).toBe('')
    expect(stderr.trimEnd().split('\n')).toEqual([
      '--games must be a whole number from 1: 0',
      ...USAGE.split('\n'),
    ])
    expect(existsSync(file)).toBe(false)
  }, 30_000)

  it('with --percentiles, writes the same table and report from the same seeds, keeping the Défis section and the hand-written part', () => {
    const defis = [DEFIS_START, '', '## Défis', '', 'Played.', '', DEFIS_END]
    const tail = [HAND_WRITTEN, '', '## Tuning', '', 'Mine.', '']
    const files = ['first', 'second'].map((name) => {
      const json = join(out, name, 'percentiles.json')
      const report = join(out, name, 'phase-3.md')
      mkdirSync(join(out, name))
      writeFileSync(
        report,
        ['# Old report', '', ...defis, '', ...tail].join('\n'),
      )
      const { status, stdout, stderr } = balance(
        '--percentiles',
        '--games',
        '2',
        '--years',
        '1',
        '--json',
        json,
        '--out',
        report,
      )
      expect(stderr).toBe('')
      expect(status).toBe(0)
      const progress = stdout.trimEnd().split('\n')
      expect(progress).toHaveLength(4)
      for (const line of progress.slice(0, 3)) {
        expect(line).toMatch(
          /^(Facile|Moyen|Difficile): 2 owners in \d+\.\d s$/,
        )
      }
      expect(progress[3]?.replace(/ in \d+\.\d s$/, '')).toBe(
        `Wrote ${json} and ${report}`,
      )
      return [readFileSync(json, 'utf8'), readFileSync(report, 'utf8')]
    })
    expect(files[1]).toEqual(files[0])
    const [table = '', report = ''] = files[0] ?? []
    expect(JSON.parse(table)).toMatchObject({
      games: 2,
      percentiles: [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95],
    })
    expect(report).toMatch(
      /^# Balance report: phase 3\n\nGenerated by `npm run balance -- --percentiles --years 1 --games 2`/,
    )
    expect(
      report.endsWith(`\n\n${defis.join('\n')}\n\n${tail.join('\n')}`),
    ).toBe(true)
    expect(report).not.toContain('# Old report')
  }, 90_000)

  it('with --defis, writes the same table and section from the same seeds, keeping the rest of the report', () => {
    const head = ['# Balance report: phase 3', '', 'Generated.', '']
    const tail = [HAND_WRITTEN, '', '## Tuning', '', 'Mine.', '']
    const files = ['defis-first', 'defis-second'].map((name) => {
      const json = join(out, name, 'defis-percentiles.json')
      const report = join(out, name, 'phase-3.md')
      mkdirSync(join(out, name))
      writeFileSync(
        report,
        [...head, DEFIS_START, 'Old.', DEFIS_END, '', ...tail].join('\n'),
      )
      const { status, stdout, stderr } = balance(
        '--defis',
        '--games',
        '2',
        '--search',
        '1',
        '--json',
        json,
        '--out',
        report,
      )
      expect(stderr).toBe('')
      expect(status).toBe(0)
      const progress = stdout.trimEnd().split('\n')
      expect(progress).toHaveLength(7)
      for (const line of progress.slice(0, 6)) {
        expect(line).toMatch(
          /^[a-zA-Z0-9]+: 2 owners, the best of the grid on 1 seeds, in \d+\.\d s$/,
        )
      }
      expect(progress[6]?.replace(/ in \d+\.\d s$/, '')).toBe(
        `Wrote ${json} and ${report}`,
      )
      return [readFileSync(json, 'utf8'), readFileSync(report, 'utf8')]
    })
    expect(files[1]).toEqual(files[0])
    const [table = '', report = ''] = files[0] ?? []
    expect(JSON.parse(table)).toMatchObject({ games: 2 })
    expect(
      report.startsWith(`${head.join('\n')}\n${DEFIS_START}\n\n## Défis\n`),
    ).toBe(true)
    expect(report).toContain(
      'Generated by `npm run balance -- --defis --games 2 --search 1`',
    )
    expect(report.endsWith(`${DEFIS_END}\n\n${tail.join('\n')}`)).toBe(true)
    expect(report).not.toContain('Old.')
  }, 120_000)
})
