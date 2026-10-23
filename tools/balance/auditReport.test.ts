import { describe, expect, it } from 'vitest'
import { flagged, type DefinitionCheck, type LeverVerdict } from './audit.ts'
import {
  SENSITIVITY_END,
  SENSITIVITY_START,
  TORNADO_ROWS,
  auditCommand,
  formatAuditReport,
  handWrittenStart,
  type AuditReport,
} from './auditReport.ts'
import { HAND_WRITTEN } from './report.ts'
import { classifyFiles, inventory } from './tunables.ts'

// The audit's report (#298): its sections, the sensitivity kept when the
// run does not play it, and the hand-written part a first run starts.

const CHECK: DefinitionCheck = {
  definition: 1,
  text: 'A | sensible player survives',
  checks: {
    facile: { verdict: 'met', measured: '100 %' },
    moyen: { verdict: 'missed', measured: '80 %' },
    difficile: { verdict: 'n/a', measured: 'not played' },
  },
}

const VERDICT: LeverVerdict = {
  lever: 'marketing',
  label: 'Marketing a day',
  difficulty: 'moyen',
  baseline: '30',
  action: false,
  situations: [
    {
      situation: 'calm',
      settings: [
        {
          setting: '0',
          games: 2,
          medianNetWorth: 100,
          bankrupt: 0,
          medianPricedOut: null,
        },
        {
          setting: '30',
          games: 2,
          medianNetWorth: 200,
          bankrupt: 1,
          medianPricedOut: null,
        },
      ],
      matched: 2,
      effect: 0.5,
      best: { setting: '30', gain: 0 },
    },
  ],
  effect: 0.5,
  matters: true,
  pays: null,
  top: { setting: '30', share: 1 },
  decided: 2,
  dominates: true,
}

const tunables = inventory()

function report(extra: Partial<AuditReport> = {}): AuditReport {
  const [first, second] = tunables
  return {
    games: 2,
    months: 24,
    files: classifyFiles(['energy.json', 'display.json']),
    tunables,
    definitions: [CHECK],
    levers: [VERDICT],
    sensitivity: [first, second].map((tunable, index) =>
      flagged({
        label: tunable?.label ?? '',
        file: tunable?.file ?? '',
        row: tunable?.row ?? '',
        value: tunable?.value ?? 0,
        difficulty: null,
        actsOn: '',
        directions: [0.8, 1.2].map((factor) => ({
          factor,
          value: (tunable?.value ?? 0) * factor,
          note: '',
          invalid: index === 1 && factor === 1.2 ? 'refused' : null,
          moved: {
            moyen: {
              sensible: {
                survival: 1,
                survivalDelta: index === 0 ? -0.2 : 0,
                medianNetWorth: 0,
                netWorthDelta: 0.01,
                same: index === 1,
              },
            },
          },
        })),
      }),
    ),
    tunableFilter: null,
    ...extra,
  }
}

describe('formatAuditReport', () => {
  const text = formatAuditReport(report())
  const headings = text.split('\n').filter((line) => line.startsWith('#'))

  it('writes the definitions, the levers, the sensitivity, the files and the inventory', () => {
    expect(headings).toEqual([
      '# Audit of the whole game, October 2026 (#298)',
      '## How the games play',
      '## Definitions',
      '## Lever check',
      '### Moyen',
      '## Sensitivity',
      '### Tornado, Facile',
      '### Tornado, Moyen',
      '### Tornado, Difficile',
      '### Cliffs',
      '### Dead',
      '### Not played',
      '## Content files',
      '## Inventory',
    ])
    expect(text).toContain(auditCommand(report()))
    expect(text).toContain(
      '| 1 | A \\| sensible player survives | ✓ 100 % | ✗ 80 % | n/a not played |',
    )
    expect(text).toContain(
      '| Marketing a day | 30 | 50 % | calm: 30 (0 %) | 30, 100 % of 2 | ✓ | ✗ |',
    )
    expect(text).toContain(
      '| marketing | calm | 2 | 0 $1.00 (2), 30 $2.00 (2, 1 bankrupt) |',
    )
    expect(text).toContain(
      '| energy.json | balance: every number in the inventory |',
    )
    expect(text).toContain(
      '| display.json | left out: UI: how numbers and screens are laid out |',
    )
  })

  it('ranks the tornado, flags the cliff and the dead, and says why a move was not played', () => {
    const moyen = text.slice(
      text.indexOf('### Tornado, Moyen'),
      text.indexOf('### Tornado, Difficile'),
    )
    const rows = moyen.split('\n').filter((line) => /^\| \d+ \|/.test(line))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('sensible -20 pts, +1 %')
    expect(rows[0]).toContain('cliff')
    expect(rows[1]).toContain('dead')
    expect(rows[1]).toContain('not played: refused')
    expect(TORNADO_ROWS).toBe(40)
  })

  it('folds the difficulties of a leaf into one inventory row', () => {
    const rows = text
      .split('\n')
      .filter((line) => line.includes('difficulties.*.startingCashCents'))
    expect(rows).toEqual([
      '| difficulty.json | difficulties.*.startingCashCents | 1500000 | 1000000 | 500000 | Encaisse at the start | ±20 % |',
    ])
    expect(text).toContain(
      "| foodtruck.json | ownerPayWeekday | 5 | 5 | 5 | the owner's pay day | no: a weekday |",
    )
  })

  it('keeps the sensitivity section given when the run did not play it', () => {
    const kept = [SENSITIVITY_START, 'Old tornado.', SENSITIVITY_END].join('\n')
    const without = formatAuditReport(report({ sensitivity: null }), kept)
    expect(without).toContain(`\n${kept}\n`)
    expect(formatAuditReport(report({ sensitivity: null }))).toContain(
      'Not played yet',
    )
  })

  it('names the command that played the report and its sensitivity', () => {
    const only = report({ tunableFilter: 'startingCashCents' })
    const filtered =
      'npm run balance -- --audit --games 2 --months 24 --tunables "startingCashCents"'
    expect(auditCommand(only)).toBe(filtered)
    const text = formatAuditReport(only)
    expect(text).toContain(`Written by \`${filtered}\``)
    expect(text).toContain(
      `Played by \`${filtered}\`: only the tunables whose label holds « startingCashCents »`,
    )
    expect(auditCommand(report({ sensitivity: null }))).toBe(
      'npm run balance -- --audit --games 2 --months 24 --no-sensitivity',
    )
    expect(auditCommand(report())).toBe(
      'npm run balance -- --audit --games 2 --months 24',
    )
  })

  it('is the same text for the same results', () => {
    expect(formatAuditReport(report())).toBe(text)
  })
})

describe('handWrittenStart', () => {
  it('starts the findings and the changes table under the hand-written line', () => {
    const lines = handWrittenStart().split('\n')
    expect(lines[0]).toBe(HAND_WRITTEN)
    expect(lines).toContain('## Findings')
    expect(lines).toContain('| File | Key | Before | After | Why |')
  })
})
