import {
  difficultyIdSchema,
  type DifficultyId,
  type ProductId,
} from '../../src/content/schema.ts'
import { FOOD_TRUCK } from '../../src/engine/day.ts'
import { DREAM, titleOf } from '../../src/engine/dream.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import type { Day } from '../../src/engine/types.ts'
import { formatDollars } from '../sim/cli.ts'
import {
  GROWTH_EVENTS,
  monthOf,
  playGrowthGame,
  withLetters,
  type GrowthGame,
  type GrowthStrategy,
} from './growth.ts'
import { CAREFUL, NAIVE, TRAP_AT, TRAP_MONTHS } from './growthReport.ts'
import {
  affordableMornings,
  levers,
  playBranch,
  reachSituation,
  type BranchGame,
  type Lever,
  type SituationId,
} from './levers.ts'
import {
  LETTERS,
  lastDayOf,
  playSensibleGame,
  playUntil,
  sensiblePolicy,
  startPlayer,
  summarize,
  type SensibleGame,
} from './sensible.ts'
import { strategyChanges } from './strategies.ts'
import { median } from './summary.ts'
import { BALANCE_JSON, getAt, perturb, type Tunable } from './tunables.ts'

// The audit of #298, `npm run balance -- --audit`: the games of the seven
// definitions of a fair chance of winning, the lever check and the
// sensitivity of every tunable, each played by a job a worker runs
// (auditWorker.ts), and what they add up to. The thresholds below are
// #298's definitions, as Étienne set them, not tunables of the game. No
// I/O: auditReport.ts writes the report and cli.ts the file.

/** Definition 1: the sensible player's survival over 2 years, at least. */
export const SURVIVAL: Readonly<Record<DifficultyId, number>> = {
  facile: 0.95,
  moyen: 0.85,
  difficile: 0.65,
}

/** Definition 2: games lost to the seed alone, at most. */
export const SEED_LOSSES = 0.05

/** Definition 3: the title each player reaches, by difficulty; null: none. */
export const BEST_TITLES: Readonly<Record<DifficultyId, string | null>> = {
  facile: 'Commerçant',
  moyen: null,
  difficile: 'Débrouillard',
}
export const SENSIBLE_TITLES: Readonly<Record<DifficultyId, string | null>> = {
  facile: null,
  moyen: 'Débrouillard',
  difficile: null,
}

/** Definition 4: a lever matters from this effect on net worth. */
export const MATTERS = 0.02
/** Definition 4: a setting dominates beyond this share of the games. */
export const DOMINATES = 0.8
/**
 * Net worth effects are a share of the baseline's median, or of this much
 * when that median is smaller, or not above zero, so a share never divides
 * by nothing.
 */
export const EFFECT_FLOOR: Cents = cents(1_000_000)

/** Definition 6: the plausible Quebec price of each product. */
export const PRICE_RANGES: Readonly<
  Partial<Record<ProductId, { readonly from: Cents; readonly to: Cents }>>
> = {
  cafe: { from: cents(250), to: cents(450) },
  chocolat: { from: cents(300), to: cents(500) },
  croissant: { from: cents(300), to: cents(500) },
}
/** Definition 6: « trop cher » above the range, times the baseline's, and a day. */
export const PRICED_OUT_FACTOR = 2
export const PRICED_OUT_MIN = 5

/** Sensitivity: how far each tunable moves, down and up. */
export const FACTORS: readonly number[] = [0.8, 1.2]
/** Sensitivity: a cliff moves survival by this many points or more. */
export const CLIFF = 0.1

/**
 * The careless player of definition 7, whose games go bankrupt so the
 * letters can be checked: prices 40 % above the start, 110 croissants a
 * day, $80 of marketing a day and the owner paid $1,000 a week, the
 * financing accepted.
 */
export const CARELESS = {
  priceChange: 40,
  croissantsPerDay: 110,
  marketingDaily: cents(8_000),
  daysOpen: 6,
  ownerWeeklyPay: cents(100_000),
} as const

/** The best strategy of #166's growth grid at `difficulty`. */
export function bestStrategy(difficulty: DifficultyId): GrowthStrategy {
  return {
    contracts: 'three',
    bakery: difficulty === 'facile' ? 'month4' : 'never',
    atTruck: false,
    dream: true,
    financing: 'refuse',
  }
}

/** The growth games' content with Mme Prudhomme's letters. */
export const LETTERED_GROWTH = withLetters(GROWTH_EVENTS)

/** Seeds 1 to `games`. */
export function seedsOf(games: number): number[] {
  return Array.from({ length: games }, (_, index) => index + 1)
}

// --- Definitions --------------------------------------------------------

/** What one worker plays for the definitions: one difficulty. */
export interface DefinitionsJob {
  readonly kind: 'audit-definitions'
  readonly difficulty: DifficultyId
  readonly games: number
  readonly months: number
}

/** A growth game, as the definitions read it. */
export interface GrowthDigest {
  readonly endedDay: Day | null
  readonly netWorthAtEnd: Cents
  readonly firstDayBelowZero: Day | null
  readonly emergencyLoans: number
  readonly warned: boolean
}

/** What a definitions job played, seed 1 first in each list. */
export interface DefinitionsRun {
  readonly difficulty: DifficultyId
  readonly games: number
  readonly months: number
  /** The sensible player, the other cards answered at random. */
  readonly sensible: readonly SensibleGame[]
  /** The same, every other card answered by its first choice. */
  readonly sensibleFirst: readonly SensibleGame[]
  readonly careless: readonly SensibleGame[]
  readonly best: readonly GrowthDigest[]
  readonly naive: readonly GrowthDigest[]
  readonly carefulAccept: readonly GrowthDigest[]
  readonly carefulRefuse: readonly GrowthDigest[]
}

function growthDigest(
  seed: number,
  difficulty: DifficultyId,
  strategy: GrowthStrategy,
  months: number,
): GrowthDigest {
  const { game, state } = playGrowthGame(
    seed,
    difficulty,
    strategy,
    months,
    strategy.financing,
    LETTERED_GROWTH,
  )
  return digestOf(game, state.events.history)
}

function digestOf(
  game: GrowthGame,
  history: readonly { readonly event: string; readonly day: Day }[],
): GrowthDigest {
  const end = game.endedDay
  const warned =
    end === null ||
    (game.firstDayBelowZero !== null &&
      game.firstDayBelowZero <= end &&
      LETTERS.every((letter) =>
        history.some(({ event, day }) => event === letter && day <= end),
      ))
  return {
    endedDay: end,
    netWorthAtEnd: game.netWorthAtEnd,
    firstDayBelowZero: game.firstDayBelowZero,
    emergencyLoans: game.emergencyLoans,
    warned,
  }
}

/** Plays `job`: every game the definitions read at one difficulty. */
export function runDefinitions({
  difficulty,
  games,
  months,
}: DefinitionsJob): DefinitionsRun {
  const seeds = seedsOf(games)
  const careless = (seed: number) =>
    summarize(
      playUntil(
        startPlayer(seed, difficulty, strategyChanges(CARELESS)),
        { ...sensiblePolicy(), restockMargin: null },
        lastDayOf(months),
      ),
    )
  return {
    difficulty,
    games,
    months,
    sensible: seeds.map(
      (seed) => playSensibleGame(seed, difficulty, months, 'random').game,
    ),
    sensibleFirst: seeds.map(
      (seed) => playSensibleGame(seed, difficulty, months, 'first').game,
    ),
    careless: seeds.map(careless),
    best: seeds.map((seed) =>
      growthDigest(seed, difficulty, bestStrategy(difficulty), months),
    ),
    naive: seeds.map((seed) => growthDigest(seed, difficulty, NAIVE, months)),
    carefulAccept: seeds.map((seed) =>
      growthDigest(
        seed,
        difficulty,
        { ...CAREFUL, financing: 'accept' },
        months,
      ),
    ),
    carefulRefuse: seeds.map((seed) =>
      growthDigest(
        seed,
        difficulty,
        { ...CAREFUL, financing: 'refuse' },
        months,
      ),
    ),
  }
}

// --- Levers -------------------------------------------------------------

/** What one worker plays for the lever check: a difficulty, a situation. */
export interface LeversJob {
  readonly kind: 'audit-levers'
  readonly difficulty: DifficultyId
  readonly situation: SituationId
  readonly games: number
  readonly months: number
}

/** A lever's games from one situation: each setting's, seed 1 first. */
export interface LeverCell {
  readonly lever: string
  readonly settings: readonly {
    readonly setting: string
    /** Null where the seed never reached the situation or could not decide. */
    readonly games: readonly (BranchGame | null)[]
  }[]
}

/** What a lever job played. */
export interface LeversRun {
  readonly difficulty: DifficultyId
  readonly situation: SituationId
  readonly games: number
  readonly months: number
  /** The levers swept from the situation, in the order of `levers()`. */
  readonly cells: readonly LeverCell[]
}

/** Plays `job`: every lever swept from its situation, on each seed. */
export function runLevers({
  difficulty,
  situation,
  games,
  months,
}: LeversJob): LeversRun {
  const swept = levers().filter((lever) => lever.situations.includes(situation))
  const byLever = swept.map((lever) =>
    lever.settings.map(() => [] as (BranchGame | null)[]),
  )
  for (const seed of seedsOf(games)) {
    const mornings =
      situation === 'affordable'
        ? affordableMornings(seed, difficulty, months)
        : null
    const shared =
      situation === 'affordable'
        ? null
        : reachSituation(situation, seed, difficulty)
    swept.forEach((lever, index) => {
      const from =
        mornings === null
          ? shared
          : lever.rung === undefined
            ? null
            : (mornings.get(lever.rung) ?? null)
      lever.settings.forEach((setting, each) => {
        byLever[index]?.[each]?.push(
          from === null ? null : playBranch(from, lever, setting, months),
        )
      })
    })
  }
  return {
    difficulty,
    situation,
    games,
    months,
    cells: swept.map((lever, index) => ({
      lever: lever.id,
      settings: lever.settings.map((setting, each) => ({
        setting: setting.id,
        games: byLever[index]?.[each] ?? [],
      })),
    })),
  }
}

/** One setting of a lever from one situation, summed up. */
export interface SettingSummary {
  readonly setting: string
  /** Games that reached the situation and could decide the setting. */
  readonly games: number
  readonly medianNetWorth: number | null
  readonly bankrupt: number
  /** Median « trop cher » a day, for a price lever. */
  readonly medianPricedOut: number | null
}

/** A lever from one situation at one difficulty. */
export interface SituationSummary {
  readonly situation: SituationId
  readonly settings: readonly SettingSummary[]
  /** (max − min median) ÷ the baseline's median (see `EFFECT_FLOOR`). */
  readonly effect: number | null
  /** The setting with the highest median, and its gain over the baseline. */
  readonly best: { readonly setting: string; readonly gain: number } | null
}

/** A lever at one difficulty, as definition 4 reads it. */
export interface LeverVerdict {
  readonly lever: string
  readonly label: string
  readonly difficulty: DifficultyId
  readonly baseline: string
  readonly action: boolean
  readonly situations: readonly SituationSummary[]
  /** The largest effect of any situation; null when none was played. */
  readonly effect: number | null
  /** Whether `effect` reaches `MATTERS`. */
  readonly matters: boolean
  /**
   * For an action lever, whether some setting beats the baseline by
   * `MATTERS` in some situation; null for other levers, and where none
   * was played.
   */
  readonly pays: boolean | null
  /** The setting strictly best in the largest share of the games. */
  readonly top: { readonly setting: string; readonly share: number } | null
  /** Games where one setting was strictly best, or several tied for best. */
  readonly decided: number
  /** Whether `top`'s share is above `DOMINATES`. */
  readonly dominates: boolean
}

/** `amount` as a share of `baseline`, floored (see `EFFECT_FLOOR`). */
export function shareOf(amount: number, baseline: number): number {
  return amount / Math.max(baseline, EFFECT_FLOOR)
}

/**
 * Definition 4 for each lever of `runs` at each difficulty: in each
 * situation, each setting's median net worth, the effect (max − min) and
 * the best setting's gain over the baseline, as a share of the baseline's
 * median (see `shareOf`). The lever matters when some situation's effect
 * reaches `MATTERS`. Pooling its situations and seeds, a game counts for a
 * setting when it is strictly best there; a game where the best are tied
 * counts for none, and one where every setting ties is not counted. The
 * lever is dominated by a setting that is strictly best in more than
 * `DOMINATES` of the counted games. Only games where every setting was
 * played count.
 */
export function leverVerdicts(
  runs: readonly LeversRun[],
  all: readonly Lever[] = levers(),
): LeverVerdict[] {
  return difficultyIdSchema.options.flatMap((difficulty) =>
    all.flatMap((lever): LeverVerdict[] => {
      const cells = runs
        .filter((run) => run.difficulty === difficulty)
        .flatMap(({ situation, cells: each }) =>
          each
            .filter((cell) => cell.lever === lever.id)
            .map((cell) => ({ situation, cell })),
        )
      if (cells.length === 0) return []
      const situations = cells.map(({ situation, cell }) =>
        situationSummary(situation, cell, lever),
      )
      const credits = new Map<string, number>()
      let decided = 0
      for (const { cell } of cells) {
        const seeds = cell.settings[0]?.games.length ?? 0
        for (let seed = 0; seed < seeds; seed += 1) {
          const worths = cell.settings.map(
            ({ games }) => games[seed]?.netWorth ?? null,
          )
          if (worths.some((worth) => worth === null)) continue
          const values = worths as number[]
          const best = Math.max(...values)
          const winners = cell.settings.filter((_, at) => values[at] === best)
          if (winners.length === values.length) continue
          decided += 1
          const [only] = winners
          if (winners.length === 1 && only !== undefined) {
            credits.set(only.setting, (credits.get(only.setting) ?? 0) + 1)
          }
        }
      }
      const [topSetting, topCount] = [...credits].reduce<
        [string, number] | [null, 0]
      >((most, entry) => (entry[1] > most[1] ? entry : most), [null, 0])
      const top =
        topSetting === null || decided === 0
          ? null
          : { setting: topSetting, share: topCount / decided }
      const effects = situations.flatMap(({ effect }) =>
        effect === null ? [] : [effect],
      )
      const effect = effects.length === 0 ? null : Math.max(...effects)
      const action = lever.action === true
      return [
        {
          lever: lever.id,
          label: lever.label,
          difficulty,
          baseline: lever.baseline,
          action,
          situations,
          effect,
          matters: effect !== null && effect >= MATTERS,
          pays:
            action && effect !== null
              ? situations.some(
                  ({ best }) =>
                    best !== null &&
                    best.setting !== lever.baseline &&
                    best.gain >= MATTERS,
                )
              : null,
          top,
          decided,
          dominates: top !== null && top.share > DOMINATES,
        },
      ]
    }),
  )
}

function situationSummary(
  situation: SituationId,
  cell: LeverCell,
  lever: Lever,
): SituationSummary {
  const settings = cell.settings.map(({ setting, games }): SettingSummary => {
    const played = games.filter((game) => game !== null)
    return {
      setting,
      games: played.length,
      medianNetWorth:
        played.length === 0 ? null : median(played.map((g) => g.netWorth)),
      bankrupt: played.filter(({ bankrupt }) => bankrupt).length,
      medianPricedOut:
        lever.product === undefined || played.length === 0
          ? null
          : median(played.map(({ pricedOut }) => pricedOut)),
    }
  })
  const baseline = settings.find(({ setting }) => setting === lever.baseline)
  const medians = settings.flatMap(({ medianNetWorth }) =>
    medianNetWorth === null ? [] : [medianNetWorth],
  )
  if (
    baseline?.medianNetWorth === null ||
    baseline === undefined ||
    medians.length < 2
  ) {
    return { situation, settings, effect: null, best: null }
  }
  const base = baseline.medianNetWorth
  const top = settings.reduce<SettingSummary | null>(
    (most, each) =>
      each.medianNetWorth !== null &&
      (most?.medianNetWorth === null ||
        most === null ||
        each.medianNetWorth > most.medianNetWorth)
        ? each
        : most,
    null,
  )
  return {
    situation,
    settings,
    effect: shareOf(Math.max(...medians) - Math.min(...medians), base),
    best:
      top === null || top.medianNetWorth === null
        ? null
        : {
            setting: top.setting,
            gain: shareOf(top.medianNetWorth - base, base),
          },
  }
}

// --- Sensitivity --------------------------------------------------------

/** A change to one content file the worker makes before the game loads. */
export interface Edit {
  readonly path: readonly (string | number)[]
  readonly value: number
}

/** The policies the sensitivity plays. */
export type AuditPolicy = 'sensible' | 'best'

/** What one worker plays for the sensitivity: one tunable moved, or none. */
export interface SensitivityJob {
  readonly kind: 'audit-sensitivity'
  /** The tunable's file and label, `baseline` for the shipped content. */
  readonly label: string
  readonly file: string | null
  readonly edits: readonly Edit[]
  readonly factor: number
  readonly difficulties: readonly DifficultyId[]
  readonly policies: readonly AuditPolicy[]
  readonly games: number
  readonly months: number
}

/** A game of the sensitivity: net worth, bankrupt (1) or not, warned (1). */
export type Digest = readonly [netWorth: number, bankrupt: 0 | 1, warned: 0 | 1]

/** What a sensitivity job played. */
export interface SensitivityRun {
  readonly label: string
  readonly factor: number
  readonly games: number
  readonly months: number
  /** By difficulty, then policy: each game, seed 1 first. */
  readonly played: Readonly<
    Partial<
      Record<DifficultyId, Partial<Record<AuditPolicy, readonly Digest[]>>>
    >
  >
}

/** Plays `job`, with the content as the worker left it. */
export function runSensitivity(job: SensitivityJob): SensitivityRun {
  const seeds = seedsOf(job.games)
  const played: Partial<
    Record<DifficultyId, Partial<Record<AuditPolicy, readonly Digest[]>>>
  > = {}
  for (const difficulty of job.difficulties) {
    const policies: Partial<Record<AuditPolicy, readonly Digest[]>> = {}
    for (const policy of job.policies) {
      policies[policy] = seeds.map((seed): Digest => {
        if (policy === 'sensible') {
          const { game } = playSensibleGame(seed, difficulty, job.months)
          return [
            game.netWorthAtEnd,
            game.endedDay === null ? 0 : 1,
            game.warned ? 1 : 0,
          ]
        }
        const game = growthDigest(
          seed,
          difficulty,
          bestStrategy(difficulty),
          job.months,
        )
        return [
          game.netWorthAtEnd,
          game.endedDay === null ? 0 : 1,
          game.warned ? 1 : 0,
        ]
      })
    }
    played[difficulty] = policies
  }
  return {
    label: job.label,
    factor: job.factor,
    games: job.games,
    months: job.months,
    played,
  }
}

/** One policy at one difficulty, moved against the baseline. */
export interface Moved {
  readonly survival: number
  /** Points of survival gained, from −1 to 1. */
  readonly survivalDelta: number
  readonly medianNetWorth: number
  /** Median net worth gained, a share of the baseline's (see `shareOf`). */
  readonly netWorthDelta: number
  /** Whether every game ended exactly as the baseline's. */
  readonly same: boolean
}

/** The survival share of `digests`. */
export function survivalOf(digests: readonly Digest[]): number {
  return digests.length === 0
    ? 1
    : digests.filter(([, bankrupt]) => bankrupt === 0).length / digests.length
}

/** `moved` against `baseline`, game by game for `same`. */
export function compare(
  baseline: readonly Digest[],
  moved: readonly Digest[],
): Moved {
  const baseMedian = median(baseline.map(([worth]) => worth))
  const movedMedian = median(moved.map(([worth]) => worth))
  const survival = survivalOf(moved)
  return {
    survival,
    survivalDelta: survival - survivalOf(baseline),
    medianNetWorth: movedMedian,
    netWorthDelta: shareOf(movedMedian - baseMedian, baseMedian),
    same:
      baseline.length === moved.length &&
      baseline.every(
        ([worth, bankrupt], index) =>
          moved[index]?.[0] === worth && moved[index]?.[1] === bankrupt,
      ),
  }
}

/** The baseline's job: the shipped content, every difficulty and policy. */
export function baselineJob(games: number, months: number): SensitivityJob {
  return {
    kind: 'audit-sensitivity',
    label: 'baseline',
    file: null,
    edits: [],
    factor: 1,
    difficulties: difficultyIdSchema.options,
    policies: ['sensible', 'best'],
    games,
    months,
  }
}

/**
 * The policies that can read `tunable`: the sensible player's, and the
 * best strategy's unless the leaf is in an event card its games never see.
 */
export function policiesFor(tunable: Tunable): AuditPolicy[] {
  const [root, index] = tunable.path
  if (tunable.file === 'events.json' && root === 'events') {
    const card = getAt(BALANCE_JSON['events.json'], ['events', index ?? -1])
    const id = (card as { id?: unknown } | undefined)?.id
    if (!LETTERED_GROWTH.events.some((each) => each.id === id)) {
      return ['sensible']
    }
  }
  return ['sensible', 'best']
}

/** A tunable moved by a factor: its job, or why it cannot be played. */
export interface PlannedMove {
  readonly tunable: Tunable
  readonly factor: number
  readonly job: SensitivityJob | null
  readonly value: number | null
  readonly note: string
  readonly invalid: string | null
}

/** Every tunable not left out, moved by each of `FACTORS`. */
export function plannedMoves(
  tunables: readonly Tunable[],
  games: number,
  months: number,
): PlannedMove[] {
  return tunables
    .filter(({ excluded }) => excluded === null)
    .flatMap((tunable) =>
      FACTORS.map((factor): PlannedMove => {
        const json = BALANCE_JSON[tunable.file]
        const moved = perturb(json, tunable, factor)
        if (!moved.ok) {
          return {
            tunable,
            factor,
            job: null,
            value: null,
            note: '',
            invalid: moved.why,
          }
        }
        const edits = [tunable.path, ...tunable.shares].map((path) => ({
          path,
          value: getAt(moved.json, path) as number,
        }))
        return {
          tunable,
          factor,
          value: moved.value,
          note: moved.note,
          invalid: null,
          job: {
            kind: 'audit-sensitivity',
            label: `${tunable.file} ${tunable.label}`,
            file: tunable.file,
            edits,
            factor,
            difficulties:
              tunable.difficulty === null
                ? difficultyIdSchema.options
                : [tunable.difficulty],
            policies: policiesFor(tunable),
            games,
            months,
          },
        }
      }),
    )
}

/**
 * The sensitivity's rows: each tunable's moves of `moves`, in order, each
 * against `baseline`, from the run of the same tunable and factor.
 */
export function sensitivityRows(
  moves: readonly PlannedMove[],
  baseline: SensitivityRun,
  runs: readonly SensitivityRun[],
): SensitivityRow[] {
  const byKey = new Map(runs.map((run) => [`${run.label} ${run.factor}`, run]))
  const rows = new Map<string, { tunable: Tunable; directions: Direction[] }>()
  for (const move of moves) {
    const key = `${move.tunable.file} ${move.tunable.label}`
    const row = rows.get(key) ?? { tunable: move.tunable, directions: [] }
    const run =
      move.job === null
        ? undefined
        : byKey.get(`${move.job.label} ${move.factor}`)
    row.directions.push({
      factor: move.factor,
      value: move.value,
      note: move.note,
      invalid: move.invalid,
      moved: run === undefined ? {} : movedAgainst(baseline, run),
    })
    rows.set(key, row)
  }
  return [...rows.values()].map(({ tunable, directions }) =>
    flagged({
      label: tunable.label,
      file: tunable.file,
      row: tunable.row,
      value: tunable.value,
      difficulty: tunable.difficulty,
      actsOn: tunable.actsOn,
      directions,
    }),
  )
}

/** One direction a tunable moved in, played. */
export interface Direction {
  readonly factor: number
  /** The value played; null when it could not move (see `invalid`). */
  readonly value: number | null
  readonly note: string
  /** Why it could not move; null when it did. */
  readonly invalid: string | null
  readonly moved: Readonly<
    Partial<Record<DifficultyId, Partial<Record<AuditPolicy, Moved>>>>
  >
}

/** A tunable's sensitivity: each direction against the baseline. */
export interface SensitivityRow {
  readonly label: string
  readonly file: string
  readonly row: string
  readonly value: number
  readonly difficulty: DifficultyId | null
  readonly actsOn: string
  readonly directions: readonly Direction[]
  /** Whether it moved and no game ended otherwise in either direction. */
  readonly dead: boolean
  /** The difficulties where it moved survival by `CLIFF` or more. */
  readonly cliffs: readonly DifficultyId[]
}

/**
 * Each direction's games `moved` against `baseline`'s, at each difficulty
 * and policy both played.
 */
export function movedAgainst(
  baseline: SensitivityRun,
  run: SensitivityRun,
): Direction['moved'] {
  const moved: Partial<
    Record<DifficultyId, Partial<Record<AuditPolicy, Moved>>>
  > = {}
  for (const difficulty of difficultyIdSchema.options) {
    const policies = run.played[difficulty]
    if (policies === undefined) continue
    const each: Partial<Record<AuditPolicy, Moved>> = {}
    for (const policy of ['sensible', 'best'] as const) {
      const games = policies[policy]
      const base = baseline.played[difficulty]?.[policy]
      if (games !== undefined && base !== undefined) {
        each[policy] = compare(base, games)
      }
    }
    moved[difficulty] = each
  }
  return moved
}

/** `row`'s dead and cliff flags, from its directions. */
export function flagged(
  row: Omit<SensitivityRow, 'dead' | 'cliffs'>,
): SensitivityRow {
  const played = row.directions.filter(({ invalid }) => invalid === null)
  const comparisons = played.flatMap(({ moved }) =>
    Object.values(moved).flatMap((policies) => Object.values(policies)),
  )
  const cliffs = difficultyIdSchema.options.filter((difficulty) =>
    played.some(({ moved }) =>
      Object.values(moved[difficulty] ?? {}).some(
        ({ survivalDelta }) => Math.abs(survivalDelta) >= CLIFF - 1e-9,
      ),
    ),
  )
  return {
    ...row,
    dead: comparisons.length > 0 && comparisons.every(({ same }) => same),
    cliffs,
  }
}

/** How far `row` moves things at `difficulty`: survival, then net worth. */
export function impactAt(
  row: SensitivityRow,
  difficulty: DifficultyId,
): { readonly survival: number; readonly netWorth: number } | null {
  const moves = row.directions.flatMap(({ moved }) =>
    Object.values(moved[difficulty] ?? {}),
  )
  if (moves.length === 0) return null
  return {
    survival: Math.max(
      ...moves.map(({ survivalDelta }) => Math.abs(survivalDelta)),
    ),
    netWorth: Math.max(
      ...moves.map(({ netWorthDelta }) => Math.abs(netWorthDelta)),
    ),
  }
}

/**
 * The tornado at `difficulty`: the rows played there, the one that moves
 * survival most first, then net worth, then in the inventory's order.
 */
export function tornado(
  rows: readonly SensitivityRow[],
  difficulty: DifficultyId,
): SensitivityRow[] {
  return rows
    .map((row, index) => ({ row, index, impact: impactAt(row, difficulty) }))
    .filter(({ impact }) => impact !== null)
    .toSorted(
      (a, b) =>
        (b.impact?.survival ?? 0) - (a.impact?.survival ?? 0) ||
        (b.impact?.netWorth ?? 0) - (a.impact?.netWorth ?? 0) ||
        a.index - b.index,
    )
    .map(({ row }) => row)
}

// --- Definitions --------------------------------------------------------

/** Whether a definition holds at a difficulty, or does not apply there. */
export type Verdict = 'met' | 'missed' | 'n/a'

export interface Check {
  readonly verdict: Verdict
  readonly measured: string
}

/** One of #298's definitions, at every difficulty. */
export interface DefinitionCheck {
  readonly definition: number
  readonly text: string
  readonly checks: Readonly<Record<DifficultyId, Check>>
}

/** Everything the definitions read. */
export interface AuditResults {
  readonly definitions: readonly DefinitionsRun[]
  readonly levers: readonly LeversRun[]
  /** The sensitivity's runs, the baseline's included; empty when kept. */
  readonly sensitivity: readonly SensitivityRun[]
}

function verdict(holds: boolean): Verdict {
  return holds ? 'met' : 'missed'
}

function percent(share: number): string {
  return `${Math.round(share * 100)} %`
}

function titleName(worth: number): string {
  return titleOf(cents(Math.round(worth)))?.name ?? 'none'
}

/** #298's definitions 1 to 7 against `results`, at every difficulty. */
export function checkDefinitions(
  results: AuditResults,
  verdicts: readonly LeverVerdict[] = leverVerdicts(results.levers),
  floors: (name: string) => number = titleFloorOf,
): DefinitionCheck[] {
  const at = (
    check: (difficulty: DifficultyId, run: DefinitionsRun) => Check,
  ): Record<DifficultyId, Check> =>
    Object.fromEntries(
      difficultyIdSchema.options.map((difficulty) => {
        const run = results.definitions.find(
          (each) => each.difficulty === difficulty,
        )
        return [
          difficulty,
          run === undefined
            ? { verdict: 'n/a', measured: 'not played' }
            : check(difficulty, run),
        ]
      }),
    ) as Record<DifficultyId, Check>
  return [
    {
      definition: 1,
      text: `A sensible player survives 2 years: ${difficultyIdSchema.options.map((d) => `${percent(SURVIVAL[d])} at ${d}`).join(', ')}, the cards answered at random`,
      checks: at((difficulty, run) => {
        const survival = survivalOf(run.sensible.map(sensibleDigest))
        return {
          verdict: verdict(survival >= SURVIVAL[difficulty] - 1e-9),
          measured: `${percent(survival)} of ${run.sensible.length}, ${loansOf(run.sensible)}`,
        }
      }),
    },
    {
      definition: 2,
      text: `Bad luck alone doesn't kill: the same decisions, every card answered by its first choice, lose at most ${percent(SEED_LOSSES)} of the games`,
      checks: at((_, run) => {
        const lost = run.sensibleFirst.filter(
          ({ endedDay }) => endedDay !== null,
        ).length
        return {
          verdict: verdict(
            lost <= SEED_LOSSES * run.sensibleFirst.length + 1e-9,
          ),
          measured: `${lost} of ${run.sensibleFirst.length} bankrupt`,
        }
      }),
    },
    {
      definition: 3,
      text: 'Progress is reachable: the best strategy reaches « Commerçant » at facile and « Débrouillard » at difficile, the sensible one « Débrouillard » at moyen, at the median after 2 years',
      checks: at((difficulty, run) => {
        const best = median(run.best.map(({ netWorthAtEnd }) => netWorthAtEnd))
        const sensible = median(
          run.sensible.map(({ netWorthAtEnd }) => netWorthAtEnd),
        )
        const wantBest = BEST_TITLES[difficulty]
        const wantSensible = SENSIBLE_TITLES[difficulty]
        const holds =
          (wantBest === null || best >= floors(wantBest)) &&
          (wantSensible === null || sensible >= floors(wantSensible))
        return {
          verdict:
            wantBest === null && wantSensible === null ? 'n/a' : verdict(holds),
          measured: `best « ${titleName(best)} » ${formatDollars(cents(Math.round(best)))}, sensible « ${titleName(sensible)} » ${formatDollars(cents(Math.round(sensible)))}`,
        }
      }),
    },
    {
      definition: 4,
      text: `Every lever matters (${percent(MATTERS)} of net worth in some situation) and no setting is strictly best in more than ${percent(DOMINATES)} of the games`,
      checks: at((difficulty, run) => {
        const here = verdicts.filter((each) => each.difficulty === difficulty)
        if (here.length === 0) return { verdict: 'n/a', measured: 'not played' }
        const unreachable = here.filter(({ effect }) => effect === null)
        const idle = here.filter(
          ({ matters, effect }) => !matters && effect !== null,
        )
        const dominated = here.filter(({ dominates }) => dominates)
        const unpaid = here.filter(({ pays }) => pays === false)
        return {
          verdict: verdict(idle.length === 0 && dominated.length === 0),
          measured: [
            `${here.length - idle.length - unreachable.length} of ${here.length} matter`,
            unreachable.length === 0
              ? null
              : `not reached in ${run.months} months: ${unreachable.map(({ lever }) => lever).join(', ')}`,
            idle.length === 0
              ? null
              : `idle: ${idle.map(({ lever }) => lever).join(', ')}`,
            dominated.length === 0
              ? null
              : `dominated: ${dominated.map(({ lever, top }) => `${lever} (${top?.setting} ${percent(top?.share ?? 0)})`).join(', ')}`,
            unpaid.length === 0
              ? null
              : `never pays: ${unpaid.map(({ lever }) => lever).join(', ')}`,
          ]
            .filter((part) => part !== null)
            .join('; '),
        }
      }),
    },
    {
      definition: 5,
      text: `The cash trap stays (#166): the naive player first closes below zero in month ${TRAP_MONTHS.join(' or ')} in more than half its games at ${TRAP_AT.join(' and ')}, takes a loan in more than half and never goes bankrupt elsewhere; the careful one never closes below zero`,
      checks: at((difficulty, run) => {
        const careful = [...run.carefulAccept, ...run.carefulRefuse]
        const below = careful.filter(
          ({ firstDayBelowZero }) => firstDayBelowZero !== null,
        ).length
        let naive: { holds: boolean; measured: string }
        if (TRAP_AT.includes(difficulty)) {
          const trapped = run.naive.filter(
            ({ firstDayBelowZero }) =>
              firstDayBelowZero !== null &&
              TRAP_MONTHS.includes(monthOf(firstDayBelowZero)),
          ).length
          naive = {
            holds: 2 * trapped > run.naive.length,
            measured: `naive: ${trapped} of ${run.naive.length} in month ${TRAP_MONTHS.join(' or ')}`,
          }
        } else {
          const borrowed = run.naive.filter(
            ({ emergencyLoans }) => emergencyLoans > 0,
          ).length
          const bankrupt = run.naive.filter(
            ({ endedDay }) => endedDay !== null,
          ).length
          naive = {
            holds: 2 * borrowed > run.naive.length && bankrupt === 0,
            measured: `naive: ${borrowed} of ${run.naive.length} take a loan, ${bankrupt} bankrupt`,
          }
        }
        return {
          verdict: verdict(naive.holds && below === 0),
          measured: `${naive.measured}; careful: ${below} of ${careful.length} below zero`,
        }
      }),
    },
    {
      definition: 6,
      text: `Prices make sense: the best price of each product, calm and summer, lies in ${Object.entries(
        PRICE_RANGES,
      )
        .map(
          ([product, range]) =>
            `${product} ${formatDollars(range.from)}–${formatDollars(range.to)}`,
        )
        .join(
          ', ',
        )}; above it, « trop cher » a day is at least ${PRICED_OUT_FACTOR}× the start price's and ${PRICED_OUT_MIN}`,
      checks: at((difficulty) => priceCheck(verdicts, difficulty)),
    },
    {
      definition: 7,
      text: "Warnings come first: every bankrupt game of the audit closed below zero and had Mme Prudhomme's three letters before its end",
      checks: at((difficulty, run) => {
        const flags = warnings(results, difficulty, run)
        const bankrupt = flags.length
        const unwarned = flags.filter((warned) => !warned).length
        return {
          verdict: bankrupt === 0 ? 'n/a' : verdict(unwarned === 0),
          measured: `${unwarned} of ${bankrupt} bankrupt games without them`,
        }
      }),
    },
  ]
}

/** The floor of the title named `name`; infinite for no title. */
export function titleFloorOf(name: string): number {
  return (
    DREAM.titles.find((title) => title.name === name)?.netWorthCents ??
    Number.POSITIVE_INFINITY
  )
}

function sensibleDigest(game: SensibleGame): Digest {
  return [
    game.netWorthAtEnd,
    game.endedDay === null ? 0 : 1,
    game.warned ? 1 : 0,
  ]
}

function loansOf(games: readonly SensibleGame[]): string {
  const borrowed = games.filter(
    ({ emergencyLoans }) => emergencyLoans > 0,
  ).length
  return `${borrowed} took a loan`
}

/** Each bankrupt game's warned flag at `difficulty`, over every run. */
function warnings(
  results: AuditResults,
  difficulty: DifficultyId,
  run: DefinitionsRun,
): boolean[] {
  const fromDefinitions = [
    ...[run.sensible, run.sensibleFirst, run.careless].flatMap((games) =>
      games
        .filter(({ endedDay }) => endedDay !== null)
        .map(({ warned }) => warned),
    ),
    ...[run.best, run.naive, run.carefulAccept, run.carefulRefuse].flatMap(
      (games) =>
        games
          .filter(({ endedDay }) => endedDay !== null)
          .map(({ warned }) => warned),
    ),
  ]
  const fromLevers = results.levers
    .filter((each) => each.difficulty === difficulty)
    .flatMap(({ cells }) =>
      cells.flatMap(({ settings }) =>
        settings.flatMap(({ games }) =>
          games.flatMap((game) =>
            game === null || !game.bankrupt ? [] : [game.warned],
          ),
        ),
      ),
    )
  const fromSensitivity = results.sensitivity.flatMap(({ played }) =>
    Object.values(played[difficulty] ?? {}).flatMap((games) =>
      games
        .filter(([, bankrupt]) => bankrupt === 1)
        .map(([, , warned]) => warned === 1),
    ),
  )
  return [...fromDefinitions, ...fromLevers, ...fromSensitivity]
}

/** The price a price lever's setting plays. */
export function settingPrice(product: ProductId, setting: string): Cents {
  return setting === 'start'
    ? FOOD_TRUCK.startingDecisions.pricesCents[product]
    : cents(Number(setting))
}

function priceCheck(
  verdicts: readonly LeverVerdict[],
  difficulty: DifficultyId,
): Check {
  const parts: string[] = []
  let holds = true
  let played = false
  for (const [product, range] of Object.entries(PRICE_RANGES) as [
    ProductId,
    { from: Cents; to: Cents },
  ][]) {
    const lever = verdicts.find(
      (each) =>
        each.difficulty === difficulty && each.lever === `price-${product}`,
    )
    if (lever === undefined) continue
    played = true
    const looked = lever.situations.filter(({ situation }) =>
      ['calm', 'summer'].includes(situation),
    )
    const bests = looked.flatMap(({ best }) =>
      best === null ? [] : [settingPrice(product, best.setting)],
    )
    const inRange = bests.every(
      (price) => price >= range.from && price <= range.to,
    )
    const above = looked.flatMap(({ settings }) => {
      const base =
        settings.find(({ setting }) => setting === 'start')?.medianPricedOut ??
        null
      return settings
        .filter(({ setting }) => settingPrice(product, setting) > range.to)
        .map(({ medianPricedOut }) => ({ base, priced: medianPricedOut }))
    })
    const seen = above.every(
      ({ base, priced }) =>
        base !== null &&
        priced !== null &&
        priced >= PRICED_OUT_FACTOR * base &&
        priced >= PRICED_OUT_MIN,
    )
    holds &&= inRange && seen
    const lowest = Math.min(
      ...above.map(({ priced }) => priced ?? Number.POSITIVE_INFINITY),
    )
    parts.push(
      `${product} best ${bests.map(formatDollars).join(' / ')}${inRange ? '' : ' (out of range)'}, above: ≥ ${Number.isFinite(lowest) ? lowest.toFixed(1) : '–'} trop cher a day${seen ? '' : ' (too few)'}`,
    )
  }
  return played
    ? { verdict: verdict(holds), measured: parts.join('; ') }
    : { verdict: 'n/a', measured: 'not played' }
}
