import { describe, expect, it } from 'vitest'
import type { DifficultyId } from '../../src/content/schema.ts'
import { cents } from '../../src/engine/money.ts'
import {
  CLIFF,
  EFFECT_FLOOR,
  LETTERED_GROWTH,
  SURVIVAL,
  baselineJob,
  checkDefinitions,
  compare,
  flagged,
  leverVerdicts,
  plannedMoves,
  policiesFor,
  runDefinitions,
  sensitivityRows,
  settingPrice,
  shareOf,
  survivalOf,
  titleFloorOf,
  tornado,
  type DefinitionsRun,
  type Digest,
  type GrowthDigest,
  type LeversRun,
  type SensitivityRun,
} from './audit.ts'
import type { BranchGame, Lever } from './levers.ts'
import type { SensibleGame } from './sensible.ts'
import { inventory } from './tunables.ts'

// The audit of #298 on small fixtures: definition 4's effect, payoff and
// dominance, the sensitivity's dead and cliff flags and tornado, the
// sensitivity's jobs, and definitions 1 to 7 on synthetic games.

function branch(netWorth: number, extra: Partial<BranchGame> = {}): BranchGame {
  return {
    netWorth: cents(netWorth),
    bankrupt: false,
    warned: true,
    pricedOut: 0,
    ...extra,
  }
}

const LEVER: Lever = {
  id: 'test',
  label: 'Test',
  situations: ['calm', 'summer'],
  baseline: 'base',
  settings: [{ id: 'base' }, { id: 'up' }, { id: 'down' }],
}

const ACTION: Lever = { ...LEVER, id: 'act', action: true }

/** A lever run at `difficulty` from `situation`, settings' net worths by seed. */
function run(
  difficulty: DifficultyId,
  situation: 'calm' | 'summer',
  games: Record<string, readonly (number | null)[]>,
  lever = LEVER,
): LeversRun {
  return {
    difficulty,
    situation,
    games: Object.values(games)[0]?.length ?? 0,
    months: 24,
    cells: [
      {
        lever: lever.id,
        settings: Object.entries(games).map(([setting, worths]) => ({
          setting,
          games: worths.map((worth) => (worth === null ? null : branch(worth))),
        })),
      },
    ],
  }
}

describe('leverVerdicts', () => {
  it('measures the effect when the baseline is best, and it pays nothing', () => {
    const [verdict] = leverVerdicts(
      [
        run(
          'moyen',
          'calm',
          {
            base: [10_000_000, 10_000_000],
            up: [7_000_000, 7_000_000],
            down: [6_000_000, 6_000_000],
          },
          ACTION,
        ),
      ],
      [ACTION],
    )
    expect(verdict?.effect).toBeCloseTo(0.4)
    expect(verdict?.matters).toBe(true)
    expect(verdict?.situations[0]?.best).toEqual({ setting: 'base', gain: 0 })
    expect(verdict?.pays).toBe(false)
    expect(verdict?.top).toEqual({ setting: 'base', share: 1 })
    expect(verdict?.dominates).toBe(true)
  })

  it('divides by the floor when the baseline is small, zero or negative', () => {
    expect(shareOf(100_000, -5_000_000)).toBeCloseTo(100_000 / EFFECT_FLOOR)
    expect(shareOf(100_000, 0)).toBeCloseTo(0.1)
    const [verdict] = leverVerdicts(
      [
        run('moyen', 'calm', {
          base: [-2_000_000],
          up: [-1_990_000],
          down: [-2_000_000],
        }),
      ],
      [LEVER],
    )
    expect(verdict?.effect).toBeCloseTo(10_000 / EFFECT_FLOOR)
    expect(verdict?.matters).toBe(false)
  })

  it('counts a tie for best for nobody, and a game where all tie not at all', () => {
    const [verdict] = leverVerdicts(
      [
        run('moyen', 'calm', {
          base: [5, 5, 9, 1],
          up: [5, 7, 9, 2],
          down: [5, 7, 1, 3],
        }),
      ],
      [LEVER],
    )
    // Seed 1: all tie, not counted. Seed 2: up and down tie, counted for
    // none. Seed 3: base and up tie. Seed 4: down alone.
    expect(verdict?.decided).toBe(3)
    expect(verdict?.top).toEqual({ setting: 'down', share: 1 / 3 })
    expect(verdict?.dominates).toBe(false)
  })

  it('pools situations, judges each difficulty apart, and skips missing games', () => {
    const verdicts = leverVerdicts(
      [
        run('facile', 'calm', { base: [1, 1], up: [3, 3], down: [2, 2] }),
        run('facile', 'summer', { base: [1, 1], up: [3, 3], down: [2, null] }),
        run('moyen', 'calm', { base: [3, 1], up: [1, 3], down: [2, 2] }),
      ],
      [LEVER],
    )
    const facile = verdicts.find(({ difficulty }) => difficulty === 'facile')
    const moyen = verdicts.find(({ difficulty }) => difficulty === 'moyen')
    expect(facile?.decided).toBe(3)
    expect(facile?.top).toEqual({ setting: 'up', share: 1 })
    expect(facile?.dominates).toBe(true)
    expect(facile?.situations.map(({ situation }) => situation)).toEqual([
      'calm',
      'summer',
    ])
    expect(moyen?.dominates).toBe(false)
    expect(verdicts.some(({ difficulty }) => difficulty === 'difficile')).toBe(
      false,
    )
  })

  it('has no effect where no setting was played', () => {
    const [verdict] = leverVerdicts(
      [run('moyen', 'calm', { base: [null], up: [null], down: [null] })],
      [LEVER],
    )
    expect(verdict?.effect).toBeNull()
    expect(verdict?.matters).toBe(false)
    expect(verdict?.top).toBeNull()
  })
})

describe('the sensitivity', () => {
  const base: Digest[] = [
    [100, 0, 1],
    [200, 0, 1],
    [300, 1, 1],
  ]

  it('compares survival and the median, game by game for sameness', () => {
    expect(survivalOf(base)).toBeCloseTo(2 / 3)
    expect(compare(base, base)).toMatchObject({ survivalDelta: 0, same: true })
    const moved = compare(base, [
      [100, 0, 1],
      [200, 0, 1],
      [300, 0, 1],
    ])
    expect(moved.survivalDelta).toBeCloseTo(1 / 3)
    expect(moved.same).toBe(false)
    expect(moved.netWorthDelta).toBe(0)
  })

  const runOf = (
    label: string,
    factor: number,
    digests: Digest[],
  ): SensitivityRun => ({
    label,
    factor,
    games: digests.length,
    months: 24,
    played: { moyen: { sensible: digests } },
  })

  it('flags a dead tunable and a cliff, and ranks the tornado', () => {
    const tunables = inventory().slice(0, 2)
    const moves = tunables.flatMap((tunable) =>
      [0.8, 1.2].map((factor) => ({
        tunable,
        factor,
        value: tunable.value * factor,
        note: '',
        invalid: null,
        job: {
          ...baselineJob(3, 24),
          label: `${tunable.file} ${tunable.label}`,
          factor,
        },
      })),
    )
    const [first, second] = tunables
    if (first === undefined || second === undefined) throw new Error('tunables')
    const baseline = runOf('baseline', 1, base)
    const runs = [
      runOf(`${first.file} ${first.label}`, 0.8, base),
      runOf(`${first.file} ${first.label}`, 1.2, base),
      runOf(`${second.file} ${second.label}`, 0.8, [
        [100, 1, 1],
        [200, 1, 1],
        [300, 1, 1],
      ]),
      runOf(`${second.file} ${second.label}`, 1.2, base),
    ]
    const rows = sensitivityRows(moves, baseline, runs)
    expect(rows.map(({ dead }) => dead)).toEqual([true, false])
    expect(rows[1]?.cliffs).toEqual(['moyen'])
    expect(tornado(rows, 'moyen').map(({ label }) => label)).toEqual([
      second.label,
      first.label,
    ])
    expect(tornado(rows, 'facile')).toEqual([])
    expect(CLIFF).toBe(0.1)
  })

  it('is not dead when it never played', () => {
    const row = flagged({
      label: 'x',
      file: 'energy.json',
      row: 'x',
      value: 1,
      difficulty: null,
      actsOn: '',
      directions: [
        { factor: 0.8, value: null, note: '', invalid: 'no', moved: {} },
      ],
    })
    expect(row.dead).toBe(false)
  })

  it("plans one job per move, at the tunable's own difficulty, with its shares", () => {
    const moves = plannedMoves(inventory(), 2, 1)
    const cash = moves.find(
      ({ tunable }) => tunable.label === 'difficulties.moyen.startingCashCents',
    )
    expect(cash?.job?.difficulties).toEqual(['moyen'])
    expect(cash?.job?.edits).toEqual([
      { path: ['difficulties', 'moyen', 'startingCashCents'], value: 800_000 },
    ])
    expect(moves.some(({ tunable }) => tunable.excluded !== null)).toBe(false)
    const share = moves.find(({ tunable }) =>
      tunable.label.endsWith('semaine.segmentShares.chic'),
    )
    expect(share?.job?.edits).toHaveLength(4)
    const refused = moves.find(
      ({ tunable, factor }) =>
        tunable.label === 'walkIns.opensAtMinute' && factor === 1.2,
    )
    expect(refused?.job).toBeNull()
    expect(refused?.invalid).toContain('the loaders refuse')
  })

  it('plays an event card the best strategy never sees for the sensible player only', () => {
    const cards = inventory().filter(({ file }) => file === 'events.json')
    const essai = cards.find(({ label }) =>
      label.startsWith('events[grosseCommande]'),
    )
    const loan = cards.find(({ label }) =>
      label.startsWith('events[pretUrgence]'),
    )
    const pacing = cards.find(({ label }) => label === 'pacing.firstDay')
    if (essai === undefined || loan === undefined || pacing === undefined) {
      throw new Error('cards')
    }
    expect(LETTERED_GROWTH.events.some(({ id }) => id === 'pretUrgence')).toBe(
      true,
    )
    expect(policiesFor(essai)).toEqual(['sensible'])
    expect(policiesFor(loan)).toEqual(['sensible', 'best'])
    expect(policiesFor(pacing)).toEqual(['sensible', 'best'])
  })
})

function sensible(extra: Partial<SensibleGame> = {}): SensibleGame {
  return {
    seed: 1,
    difficulty: 'moyen',
    endedDay: null,
    netWorthAtEnd: cents(5_000_000),
    firstDayBelowZero: null,
    lowestClose: cents(0),
    letters: [],
    emergencyLoans: 0,
    shareSales: 0,
    signings: [],
    warned: true,
    ...extra,
  }
}

function growth(extra: Partial<GrowthDigest> = {}): GrowthDigest {
  return {
    endedDay: null,
    netWorthAtEnd: cents(30_000_000),
    firstDayBelowZero: null,
    emergencyLoans: 0,
    warned: true,
    ...extra,
  }
}

function definitionsRun(
  difficulty: DifficultyId,
  extra: Partial<DefinitionsRun> = {},
): DefinitionsRun {
  const twenty = <T>(make: () => T) => Array.from({ length: 20 }, make)
  return {
    difficulty,
    games: 20,
    months: 24,
    sensible: twenty(() => sensible()),
    sensibleFirst: twenty(() => sensible()),
    careless: twenty(() =>
      sensible({ endedDay: 300, firstDayBelowZero: 60, warned: true }),
    ),
    best: twenty(() => growth()),
    naive: twenty(() => growth({ firstDayBelowZero: 40, emergencyLoans: 1 })),
    carefulAccept: twenty(() => growth()),
    carefulRefuse: twenty(() => growth()),
    ...extra,
  }
}

describe('checkDefinitions', () => {
  const definitions = (['facile', 'moyen', 'difficile'] as const).map((d) =>
    definitionsRun(d),
  )
  const verdict = (
    checks: ReturnType<typeof checkDefinitions>,
    definition: number,
    difficulty: DifficultyId,
  ) =>
    checks.find((each) => each.definition === definition)?.checks[difficulty]
      .verdict

  it('holds definitions 1, 2, 3, 5 and 7 on fair games', () => {
    const checks = checkDefinitions({
      definitions,
      levers: [],
      sensitivity: [],
    })
    for (const definition of [1, 2, 5, 7]) {
      for (const difficulty of ['facile', 'moyen', 'difficile'] as const) {
        expect(
          verdict(checks, definition, difficulty),
          `${definition} ${difficulty}`,
        ).toBe('met')
      }
    }
    expect(verdict(checks, 3, 'moyen')).toBe('met')
    expect(verdict(checks, 4, 'moyen')).toBe('n/a')
    expect(verdict(checks, 6, 'moyen')).toBe('n/a')
  })

  it("misses definition 1 below the difficulty's survival, and 2 above 5 %", () => {
    const lost = (count: number) =>
      Array.from({ length: 20 }, (_, index) =>
        sensible(
          index < count ? { endedDay: 400, firstDayBelowZero: 100 } : {},
        ),
      )
    const checks = checkDefinitions({
      definitions: [
        definitionsRun('facile', { sensible: lost(1), sensibleFirst: lost(2) }),
        definitionsRun('difficile', {
          sensible: lost(8),
          sensibleFirst: lost(1),
        }),
      ],
      levers: [],
      sensitivity: [],
    })
    expect(SURVIVAL.facile).toBe(0.95)
    expect(verdict(checks, 1, 'facile')).toBe('met')
    expect(verdict(checks, 2, 'facile')).toBe('missed')
    expect(verdict(checks, 1, 'difficile')).toBe('missed')
    expect(verdict(checks, 2, 'difficile')).toBe('met')
    expect(verdict(checks, 1, 'moyen')).toBe('n/a')
  })

  it('reads the titles from the content', () => {
    expect(titleFloorOf('Débrouillard')).toBe(2_500_000)
    expect(titleFloorOf('Commerçant')).toBe(10_000_000)
    expect(titleFloorOf('Personne')).toBe(Number.POSITIVE_INFINITY)
    const poor = checkDefinitions({
      definitions: [
        definitionsRun('facile', {
          best: Array.from({ length: 20 }, () =>
            growth({ netWorthAtEnd: cents(9_000_000) }),
          ),
        }),
      ],
      levers: [],
      sensitivity: [],
    })
    expect(verdict(poor, 3, 'facile')).toBe('missed')
  })

  it('misses definition 5 when the trap does not catch, or the careful player falls in', () => {
    const checks = checkDefinitions({
      definitions: [
        definitionsRun('moyen', {
          naive: Array.from({ length: 20 }, () =>
            growth({ firstDayBelowZero: 200 }),
          ),
        }),
        definitionsRun('facile', {
          carefulRefuse: [growth({ firstDayBelowZero: 100 })],
        }),
        definitionsRun('difficile', {
          naive: Array.from({ length: 20 }, () =>
            growth({ firstDayBelowZero: 45 }),
          ),
        }),
      ],
      levers: [],
      sensitivity: [],
    })
    expect(verdict(checks, 5, 'moyen')).toBe('missed')
    expect(verdict(checks, 5, 'facile')).toBe('missed')
    expect(verdict(checks, 5, 'difficile')).toBe('met')
  })

  it('reads every bankrupt game for definition 7, and has nothing to say without one', () => {
    const unwarnedLever: LeversRun = {
      difficulty: 'moyen',
      situation: 'calm',
      games: 1,
      months: 24,
      cells: [
        {
          lever: 'test',
          settings: [
            {
              setting: 'base',
              games: [branch(0, { bankrupt: true, warned: false })],
            },
          ],
        },
      ],
    }
    const unwarnedSensitivity: SensitivityRun = {
      label: 'x',
      factor: 1.2,
      games: 1,
      months: 24,
      played: { facile: { sensible: [[0, 1, 0]] } },
    }
    const quiet = definitionsRun('difficile', {
      careless: Array.from({ length: 20 }, () => sensible()),
    })
    const checks = checkDefinitions({
      definitions: [...definitions.slice(0, 2), quiet],
      levers: [unwarnedLever],
      sensitivity: [unwarnedSensitivity],
    })
    expect(verdict(checks, 7, 'moyen')).toBe('missed')
    expect(verdict(checks, 7, 'facile')).toBe('missed')
    expect(verdict(checks, 7, 'difficile')).toBe('n/a')
  })

  it('reads a price setting as its price', () => {
    expect(settingPrice('cafe', 'start')).toBe(325)
    expect(settingPrice('cafe', '450')).toBe(450)
  })
})

describe('runDefinitions', () => {
  it('plays each player on each seed', () => {
    const played = runDefinitions({
      kind: 'audit-definitions',
      difficulty: 'moyen',
      games: 1,
      months: 1,
    })
    for (const games of [
      played.sensible,
      played.sensibleFirst,
      played.careless,
      played.best,
      played.naive,
      played.carefulAccept,
      played.carefulRefuse,
    ]) {
      expect(games).toHaveLength(1)
    }
  })
})
