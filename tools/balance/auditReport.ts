import {
  difficultyIdSchema,
  type DifficultyId,
} from '../../src/content/schema.ts'
import { DIFFICULTIES } from '../../src/engine/day.ts'
import { cents } from '../../src/engine/money.ts'
import { formatDollars } from '../sim/cli.ts'
import {
  CLIFF,
  DOMINATES,
  EFFECT_FLOOR,
  FACTORS,
  MATTERS,
  bestStrategy,
  tornado,
  type DefinitionCheck,
  type Direction,
  type LeverVerdict,
  type SensitivityRow,
  type Verdict,
} from './audit.ts'
import { CALM_DAY, CRUNCH_MONTHS, SUMMER_DAY, levers } from './levers.ts'
import { HAND_WRITTEN, type SectionMarkers } from './report.ts'
import { RESTOCK_MARGIN } from './sensible.ts'
import { strategyLabel } from './growth.ts'
import type { FileClass, Tunable } from './tunables.ts'

// Writes docs/balance/audit-2026-10.md from what `npm run balance --
// --audit` played (#298), down to its hand-written part, which holds the
// findings and the changes. No I/O: cli.ts writes the file. The report is
// for developers, so it is in English.

/** The sensitivity section's first line. */
export const SENSITIVITY_START =
  '<!-- npm run balance -- --audit writes this section; --no-sensitivity keeps it. -->'

/** The sensitivity section's last line. */
export const SENSITIVITY_END = '<!-- End of the sensitivity section. -->'

export const SENSITIVITY_MARKERS: SectionMarkers = {
  start: SENSITIVITY_START,
  end: SENSITIVITY_END,
}

/** The rows each difficulty's tornado shows. */
export const TORNADO_ROWS = 40

/** Everything the report shows. */
export interface AuditReport {
  readonly games: number
  readonly months: number
  readonly files: readonly FileClass[]
  readonly tunables: readonly Tunable[]
  readonly definitions: readonly DefinitionCheck[]
  readonly levers: readonly LeverVerdict[]
  /** The sensitivity's rows; null when the section is kept as it was. */
  readonly sensitivity: readonly SensitivityRow[] | null
}

/** The command that writes the report, with its options. */
export function auditCommand({ games, months }: AuditReport): string {
  return `npm run balance -- --audit --games ${games} --months ${months}`
}

function difficultyName(difficulty: DifficultyId): string {
  return DIFFICULTIES.difficulties[difficulty].name
}

function mark(verdict: Verdict): string {
  return verdict === 'met' ? '✓' : verdict === 'missed' ? '✗' : 'n/a'
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|')
}

function percent(share: number): string {
  return `${Math.round(share * 100)} %`
}

function signed(share: number, digits = 1): string {
  const scale = 10 ** digits
  const rounded = Math.round(share * 100 * scale) / scale
  return `${rounded > 0 ? '+' : ''}${rounded} %`
}

function points(share: number): string {
  const rounded = Math.round(share * 100)
  return `${rounded > 0 ? '+' : ''}${rounded} pts`
}

function number(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(4)))
}

/**
 * The whole report, down to the hand-written line, with `keptSensitivity`
 * in place of the sensitivity section when the run did not play it.
 */
export function formatAuditReport(
  report: AuditReport,
  keptSensitivity: string | null = null,
): string {
  const sensitivity =
    report.sensitivity === null
      ? (keptSensitivity ??
        [
          SENSITIVITY_START,
          '',
          '## Sensitivity',
          '',
          'Not played yet: run `npm run balance -- --audit`.',
          '',
          SENSITIVITY_END,
        ].join('\n'))
      : formatSensitivity(report.sensitivity, report)
  return [
    '# Audit of the whole game, October 2026 (#298)',
    '',
    `Written by \`${auditCommand(report)}\`; the sensitivity section is played only without \`--no-sensitivity\`. Every game is deterministic: the same command writes the same file. Everything below the hand-written line is kept.`,
    '',
    ...howItPlays(report),
    '',
    '## Definitions',
    '',
    '| # | Definition | ' +
      difficultyIdSchema.options.map(difficultyName).join(' | ') +
      ' |',
    '| --- | --- | ' +
      difficultyIdSchema.options.map(() => '---').join(' | ') +
      ' |',
    ...report.definitions.map(
      ({ definition, text, checks }) =>
        `| ${definition} | ${cell(text)} | ` +
        difficultyIdSchema.options
          .map((difficulty) => {
            const { verdict, measured } = checks[difficulty]
            return `${mark(verdict)} ${cell(measured)}`
          })
          .join(' | ') +
        ' |',
    ),
    '',
    ...formatLevers(report.levers),
    '',
    sensitivity,
    '',
    ...formatFiles(report.files),
    '',
    ...formatInventory(report.tunables),
    '',
  ].join('\n')
}

function howItPlays({ games, months }: AuditReport): string[] {
  return [
    '## How the games play',
    '',
    `- **Sensible player** (definitions 1–3, the sensitivity): the starting prices, $30 of marketing a day, open 6 days a week, the owner paid $700 a week; each morning, croissants for the last open day's demand (sold and asked for after they sold out) × ${RESTOCK_MARGIN}, rounded up; a grocer's offer is accepted only when it is the careful chain's next one with its reserve on hand (#166), and no second one before month 2; renewals accepted; the emergency loan and Max Duvent accepted. Every event card of the content comes up, Mme Prudhomme's letters included, and the others are answered at random (definition 2: by their first choice), drawn from the seed and the day.`,
    `- **Best strategy** (definition 3, the sensitivity): #166's growth winner at each difficulty, played as \`--growth\` plays it, with Mme Prudhomme's letters added: ${difficultyIdSchema.options.map((difficulty) => `${difficultyName(difficulty)} ${strategyLabel(bestStrategy(difficulty))}`).join('; ')}.`,
    "- **Naive and careful players** (definition 5): #166's, played as `--growth` plays them, with the letters.",
    "- **Careless player** (definition 7): prices 40 % above the start, 110 croissants a day, $80 of marketing a day, the owner paid $1,000 a week, the financing accepted; its games go bankrupt, so the letters' check has games to read.",
    `- **Lever check** (definitions 4 and 6): each setting of a lever plays on from the same morning to the end of month ${months}, so the settings differ by that lever alone. Situations: calm, day ${CALM_DAY} (October 1 of year 1), every grocer refused until then; summer, day ${SUMMER_DAY} (June 1 of year 2), with the careful contracts; crunch, the morning after the naive player's first close below zero, every grocer signed on the first day one may, or after its lowest close of the first ${CRUNCH_MONTHS} months when it never goes below zero; affordable, for a rung of « Le rêve », the first morning the best strategy, buying nothing, has the cash for it and the rungs before it, at least three months before the end. A lever's setup (a bakery for the baker, a contract for the delivery person, the rungs before a rung) is decided in every setting alike. A lever matters when the gap between its settings' median net worth reaches ${percent(MATTERS)} of the baseline's median (or of ${formatDollars(EFFECT_FLOOR)} when that is smaller) in some situation. A game counts for a setting when it is strictly best there; tied best settings count for none, and a game where every setting ties is not counted; a setting dominates above ${percent(DOMINATES)} of the counted games, pooled over situations and seeds, at each difficulty.`,
    `- **Sensitivity**: each numeric leaf of the balance files is moved on its own by ${FACTORS.map((factor) => signed(factor - 1, 0)).join(' and ')}: whole numbers round half up, or move by one when that rounds back; probabilities stay within 0 and 1; a share of a whole (segment shares, an outcome's chances) moves and the others of its whole rescale to keep the sum; a value the game's loaders refuse is reported, not played. A leaf of one difficulty plays at that difficulty only, and a leaf of an event card the best strategy never sees plays the sensible player only. A tunable is dead when no game, of either policy, ended otherwise; a cliff moves survival by ${Math.round(CLIFF * 100)} points or more.`,
    `- ${games} seeds (1 to ${games}) per difficulty, ${months} months per game.`,
  ]
}

function formatLevers(verdicts: readonly LeverVerdict[]): string[] {
  const lines = ['## Lever check', '']
  const order = levers().map(({ id }) => id)
  for (const difficulty of difficultyIdSchema.options) {
    const here = verdicts
      .filter((each) => each.difficulty === difficulty)
      .toSorted((a, b) => order.indexOf(a.lever) - order.indexOf(b.lever))
    if (here.length === 0) continue
    lines.push(
      `### ${difficultyName(difficulty)}`,
      '',
      '| Lever | Baseline | Effect | Best setting by situation (gain on the baseline) | Strictly best most often | Matters | No setting dominates | Pays |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...here.map((each) =>
        [
          '',
          cell(each.label),
          each.baseline,
          each.effect === null ? '–' : signed(each.effect).replace('+', ''),
          each.situations
            .map(({ situation, best }) =>
              best === null
                ? `${situation}: –`
                : `${situation}: ${best.setting} (${signed(best.gain)})`,
            )
            .join('; '),
          each.top === null
            ? '–'
            : `${each.top.setting}, ${percent(each.top.share)} of ${each.decided}`,
          each.effect === null ? '–' : each.matters ? '✓' : '✗',
          each.top === null ? '–' : each.dominates ? '✗' : '✓',
          each.pays === null ? '' : each.pays ? '✓' : '✗ never',
          '',
        ]
          .join(' | ')
          .trim(),
      ),
      '',
      '<details><summary>Median net worth of each setting</summary>',
      '',
      '| Lever | Situation | Settings: median net worth (games, bankrupt; « trop cher » a day) |',
      '| --- | --- | --- |',
      ...here.flatMap((each) =>
        each.situations.map(
          ({ situation, settings }) =>
            `| ${each.lever} | ${situation} | ${settings
              .map(
                ({
                  setting,
                  games,
                  medianNetWorth,
                  bankrupt,
                  medianPricedOut,
                }) =>
                  `${setting} ${medianNetWorth === null ? '–' : formatDollars(cents(Math.round(medianNetWorth)))} (${games}${bankrupt > 0 ? `, ${bankrupt} bankrupt` : ''}${medianPricedOut === null ? '' : `; ${medianPricedOut.toFixed(1)}`})`,
              )
              .join(', ')} |`,
        ),
      ),
      '',
      '</details>',
      '',
    )
  }
  return lines
}

function formatDirection(
  direction: Direction | undefined,
  difficulty: DifficultyId,
): string {
  if (direction === undefined) return '–'
  if (direction.invalid !== null)
    return cell(`not played: ${direction.invalid}`)
  const moved = direction.moved[difficulty] ?? {}
  const parts = (['sensible', 'best'] as const).flatMap((policy) => {
    const each = moved[policy]
    return each === undefined
      ? []
      : [
          `${policy} ${points(each.survivalDelta)}, ${signed(each.netWorthDelta)}`,
        ]
  })
  return `${number(direction.value ?? 0)}: ${parts.join(' · ')}${direction.note === '' ? '' : ` (${cell(direction.note)})`}`
}

function formatSensitivity(
  rows: readonly SensitivityRow[],
  report: AuditReport,
): string {
  const lines = [
    SENSITIVITY_START,
    '',
    '## Sensitivity',
    '',
    `Each cell: the value played, then each policy's survival change in points and median net worth change, against the shipped content (${report.games} seeds, ${report.months} months).`,
    '',
  ]
  for (const difficulty of difficultyIdSchema.options) {
    const ranked = tornado(rows, difficulty)
    lines.push(
      `### Tornado, ${difficultyName(difficulty)}`,
      '',
      `${ranked.length} tunables played here; the ${Math.min(TORNADO_ROWS, ranked.length)} that move survival, then net worth, most.`,
      '',
      '| # | File | Tunable | Value | −20 % | +20 % | Flags |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...ranked.slice(0, TORNADO_ROWS).map((row, index) => {
        const [down, up] = [row.directions[0], row.directions[1]]
        const flags = [
          row.cliffs.includes(difficulty) ? 'cliff' : '',
          row.dead ? 'dead' : '',
        ]
          .filter((flag) => flag !== '')
          .join(', ')
        return `| ${index + 1} | ${row.file} | ${cell(row.label)} | ${number(row.value)} | ${formatDirection(down, difficulty)} | ${formatDirection(up, difficulty)} | ${flags} |`
      }),
      '',
    )
  }
  const cliffs = rows.filter(({ cliffs }) => cliffs.length > 0)
  lines.push(
    '### Cliffs',
    '',
    cliffs.length === 0
      ? `No tunable moves survival by ${Math.round(CLIFF * 100)} points at ±20 %.`
      : `${cliffs.length} tunables move survival by ${Math.round(CLIFF * 100)} points or more at ±20 %:`,
    '',
    ...cliffs.map(
      (row) =>
        `- ${row.file} \`${row.label}\` (${number(row.value)}), at ${row.cliffs.map(difficultyName).join(', ')}: ${row.directions
          .map((direction) =>
            formatDirection(direction, row.cliffs[0] ?? 'moyen'),
          )
          .join('; ')}`,
    ),
    '',
  )
  const dead = rows.filter(({ dead }) => dead)
  const byFile = new Map<string, string[]>()
  for (const row of dead) {
    byFile.set(row.file, [...(byFile.get(row.file) ?? []), row.label])
  }
  lines.push(
    '### Dead',
    '',
    `${dead.length} tunables moved and no game of either policy ended otherwise: inactive under these policies, which may be the policies' doing (a starting decision they change, a card or district they never see) rather than the engine's.`,
    '',
    '<details><summary>The dead tunables, by file</summary>',
    '',
    ...[...byFile].flatMap(([file, labels]) => [
      `- **${file}** (${labels.length}): ${labels.map((label) => `\`${label}\``).join(', ')}`,
    ]),
    '',
    '</details>',
    '',
  )
  const unmoved = rows.filter(({ directions }) =>
    directions.some(({ invalid }) => invalid !== null),
  )
  lines.push(
    '### Not played',
    '',
    `${unmoved.length} tunables could not move one way or both:`,
    '',
    '<details><summary>Why</summary>',
    '',
    ...unmoved.map(
      (row) =>
        `- ${row.file} \`${row.label}\` (${number(row.value)}): ${row.directions
          .flatMap(({ factor, invalid }) =>
            invalid === null ? [] : [`${signed(factor - 1, 0)} ${invalid}`],
          )
          .join('; ')}`,
    ),
    '',
    '</details>',
    '',
    SENSITIVITY_END,
  )
  return lines.join('\n')
}

function formatFiles(files: readonly FileClass[]): string[] {
  return [
    '## Content files',
    '',
    '| File | Treated as |',
    '| --- | --- |',
    ...files.map(
      (file) =>
        `| ${file.file} | ${file.kind === 'balance' ? 'balance: every number in the inventory' : file.kind === 'excluded' ? cell(`left out: ${file.why}`) : 'unknown'} |`,
    ),
  ]
}

function formatInventory(tunables: readonly Tunable[]): string[] {
  const rows = new Map<string, Tunable[]>()
  for (const tunable of tunables) {
    const key = `${tunable.file} ${tunable.row}`
    rows.set(key, [...(rows.get(key) ?? []), tunable])
  }
  return [
    '## Inventory',
    '',
    `Every numeric leaf of the balance files, ${tunables.length} in all, ${rows.size} rows once a value of each difficulty shares one. Event amounts are scaled at each difficulty by events.json's \`scaling\`; the values here are the content's.`,
    '',
    '| File | Key | ' +
      difficultyIdSchema.options.map(difficultyName).join(' | ') +
      ' | Acts on | Moved |',
    '| --- | --- | ' +
      difficultyIdSchema.options.map(() => '---').join(' | ') +
      ' | --- | --- |',
    ...[...rows.values()].map((group) => {
      const [first] = group
      if (first === undefined) return ''
      const values = difficultyIdSchema.options.map((difficulty) => {
        const at =
          group.find((each) => each.difficulty === difficulty) ??
          group.find((each) => each.difficulty === null)
        return at === undefined ? '–' : number(at.value)
      })
      return `| ${first.file} | ${cell(first.row)} | ${values.join(' | ')} | ${cell(first.actsOn)} | ${first.excluded === null ? '±20 %' : cell(`no: ${first.excluded}`)} |`
    }),
  ]
}

/** The report's hand-written part, for a first run. */
export function handWrittenStart(): string {
  return [
    HAND_WRITTEN,
    '',
    '## Findings',
    '',
    '## Changes',
    '',
    '| File | Key | Before | After | Why |',
    '| --- | --- | --- | --- | --- |',
    '',
  ].join('\n')
}
