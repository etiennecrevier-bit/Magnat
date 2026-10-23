import {
  candidateIdSchema,
  type CandidateId,
  type DifficultyContent,
  type DifficultyId,
  type GrocerId,
  type StaffRoleId,
} from '../../src/content/schema.ts'
import { BAKERY_MEMO } from '../../src/engine/bakery.ts'
import { DIFFICULTIES } from '../../src/engine/day.ts'
import type { DecisionChange } from '../../src/engine/decisions.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { askingWage } from '../../src/engine/staff.ts'
import {
  TRUCK_STRATEGIES,
  playBakeryGame,
  truckChanges,
  type TruckStrategy,
} from './bakery.ts'
import { medianCents } from './summary.ts'

// The hiring run, `npm run balance -- --hiring` (#255): in each role, each
// candidate is hired on day 0 at the wage they ask, and their twin plays
// the same seed and the same business with nobody hired, so the gap between
// their Encaisse is what the employee, strength, weakness and wage
// together, made or cost. Each role's business below is the test grid of
// #255, not a tunable of the game. No I/O: cli.ts writes the report.

/** The roles the run hires for, in the content's order. */
export const HIRING_ROLES: readonly StaffRoleId[] = [
  'camion',
  'livreur',
  'boulanger',
]

/** The business a role's games and their twins run. */
export interface HiringBusiness {
  /** The truck, by its name in `TRUCK_STRATEGIES`. */
  readonly truck: TruckStrategy
  /**
   * Whether the bakery opens on day 0, its oven leased, making the truck's
   * croissants: the owner bakes them in the twin.
   */
  readonly bakery: boolean
}

function truck(name: string): TruckStrategy {
  const found = TRUCK_STRATEGIES.find((strategy) => strategy.name === name)
  if (found === undefined) throw new Error(`No truck strategy ${name}`)
  return found
}

/**
 * At the truck, the busy truck, where the line is long; delivering, the
 * busy truck with the two contracts of #157; baking, the truck making 150
 * croissants a day at a leased bakery, with the two contracts.
 */
export const HIRING_BUSINESSES: Readonly<Record<StaffRoleId, HiringBusiness>> =
  {
    camion: { truck: truck('busy'), bakery: false },
    livreur: {
      truck: {
        ...truck('busy'),
        contracts: ['marcheBioLogique', 'chezNormand'],
      },
      bakery: false,
    },
    boulanger: { truck: truck('150 a day, 2 contracts'), bakery: true },
  }

/** What one worker plays: one role's candidates and their twins. */
export interface HiringJob {
  readonly kind: 'hiring'
  readonly role: StaffRoleId
  readonly difficulty: DifficultyId
  readonly games: number
  readonly months: number
}

/** One game of the run, summed up. */
export interface HiringGame {
  /**
   * Encaisse at the close of the last month's last day, or of the day that
   * ended the game in bankruptcy.
   */
  readonly cash: Cents
  readonly bankrupt: boolean
  /** Days the employee was absent with work to do; 0 in a twin. */
  readonly absences: number
  /** Units botched at the truck, the owner's and the employee's. */
  readonly botched: number
  /** Croissants an employee baker threw away; 0 in a twin. */
  readonly wasted: number
}

/** One candidate's games in a role, seed 1 first. */
export interface HiringCell {
  readonly candidate: CandidateId
  /** The wage they ask, and are hired at. */
  readonly hourlyWage: Cents
  readonly games: readonly HiringGame[]
}

/** What a job played. */
export interface HiringRun {
  readonly role: StaffRoleId
  readonly difficulty: DifficultyId
  readonly games: number
  readonly months: number
  /** The games with nobody hired, seed 1 first. */
  readonly twins: readonly HiringGame[]
  /** Each candidate's games, in the content's order. */
  readonly cells: readonly HiringCell[]
}

/**
 * The changes in effect from day 0 of a game hiring `candidate` as `role`,
 * at the wage they ask, on top of the role's business, or of its twin with
 * `candidate` null. A bakery bakes the croissants the truck would buy.
 */
export function hiringChanges(
  role: StaffRoleId,
  candidate: CandidateId | null,
): DecisionChange[] {
  const business = HIRING_BUSINESSES[role]
  const { croissantsPerDay } = business.truck
  return [
    ...truckChanges(business.truck),
    ...(business.bakery
      ? ([
          { kind: 'openBakery', oven: 'louer' },
          { kind: 'croissantSource', source: 'fabriquer' },
          {
            kind: 'bake',
            rule: { kind: 'buyDaily', quantity: croissantsPerDay },
          },
        ] satisfies DecisionChange[])
      : []),
    ...(candidate === null
      ? []
      : [
          {
            kind: 'hire',
            role,
            candidate,
            hourlyWage: askingWage(candidate, role),
          } satisfies DecisionChange,
        ]),
  ]
}

/**
 * Plays seed `seed` at `difficulty` with `candidate` hired as `role` on day
 * 0, or nobody when null, for `months` months (see `playBakeryGame`), the
 * role's contracts signed that day and renewed, and sums it up.
 */
export function playHiringGame(
  seed: number,
  difficulty: DifficultyId,
  role: StaffRoleId,
  candidate: CandidateId | null,
  months: number,
  difficulties: DifficultyContent = DIFFICULTIES,
): HiringGame {
  let absences = 0
  let botched = 0
  const contracts: readonly GrocerId[] = HIRING_BUSINESSES[role].truck.contracts
  const { game, state } = playBakeryGame(
    seed,
    difficulty,
    hiringChanges(role, candidate),
    difficulties,
    months,
    contracts,
    ({ lastDay }) => {
      if (lastDay === null) return
      botched += lastDay.botched
      if (candidate !== null && lastDay.absent?.includes(candidate) === true) {
        absences += 1
      }
    },
  )
  const { ingredientCostCents } = difficulties.bakery[difficulty]
  const wasted = state.journal.entries
    .filter(({ memo }) => memo === BAKERY_MEMO.wasted)
    .reduce(
      (total, { lines }) =>
        total + (lines[0]?.debit ?? 0) / ingredientCostCents,
      0,
    )
  return {
    cash: game.cashAtMonthEnds.at(-1) ?? cents(0),
    bankrupt: game.endedDay !== null,
    absences,
    botched,
    wasted,
  }
}

/**
 * Plays `job`: the twins of seeds 1 to `games`, then each candidate on the
 * same seeds, in the content's order.
 */
export function runHiring(
  job: HiringJob,
  difficulties: DifficultyContent = DIFFICULTIES,
): HiringRun {
  const { role, difficulty, games, months } = job
  const seeds = Array.from({ length: games }, (_, index) => index + 1)
  const play = (candidate: CandidateId | null) =>
    seeds.map((seed) =>
      playHiringGame(seed, difficulty, role, candidate, months, difficulties),
    )
  return {
    role,
    difficulty,
    games,
    months,
    twins: play(null),
    cells: candidateIdSchema.options.map((candidate) => ({
      candidate,
      hourlyWage: askingWage(candidate, role),
      games: play(candidate),
    })),
  }
}

/**
 * The median, over the seeds, of `cell`'s Encaisse less its twin's: what
 * hiring them made, or cost when below zero.
 */
export function medianGap(
  cell: HiringCell,
  twins: readonly HiringGame[],
): Cents {
  return medianCents(
    cell.games.map(({ cash }, index) =>
      cents(cash - (twins[index]?.cash ?? 0)),
    ),
  )
}

/** What the run shows against the targets of #255's step 6. */
export interface HiringVerdict {
  /** Each role's best hires: those with the highest median gap, ties all. */
  readonly best: Readonly<Record<StaffRoleId, readonly CandidateId[]>>
  /** The candidates among the best in every role; none, for the target. */
  readonly bestEverywhere: readonly CandidateId[]
  /**
   * The weakest candidate: the one whose best role, by median gap, is the
   * worst; the first in the content's order on a tie.
   */
  readonly weakest: {
    readonly candidate: CandidateId
    readonly role: StaffRoleId
    readonly gap: Cents
  }
  /** Whether the weakest beats no hire in a role: a median gap above 0. */
  readonly weakestBeatsNoHire: boolean
}

/** Reads `runs`, one per role of `HIRING_ROLES`, against the targets. */
export function hiringVerdict(runs: readonly HiringRun[]): HiringVerdict {
  const gaps = new Map<CandidateId, Map<StaffRoleId, Cents>>()
  for (const run of runs) {
    for (const cell of run.cells) {
      const byRole = gaps.get(cell.candidate) ?? new Map<StaffRoleId, Cents>()
      byRole.set(run.role, medianGap(cell, run.twins))
      gaps.set(cell.candidate, byRole)
    }
  }
  const best = Object.fromEntries(
    runs.map(({ role, cells, twins }) => {
      const top = Math.max(...cells.map((cell) => medianGap(cell, twins)))
      return [
        role,
        cells
          .filter((cell) => medianGap(cell, twins) === top)
          .map(({ candidate }) => candidate),
      ]
    }),
  ) as Record<StaffRoleId, CandidateId[]>
  const bestEverywhere = candidateIdSchema.options.filter((candidate) =>
    runs.every(({ role }) => best[role].includes(candidate)),
  )
  let weakest: HiringVerdict['weakest'] | null = null
  for (const candidate of candidateIdSchema.options) {
    const byRole = gaps.get(candidate)
    if (byRole === undefined) continue
    let top: { role: StaffRoleId; gap: Cents } | null = null
    for (const [role, gap] of byRole) {
      if (top === null || gap > top.gap) top = { role, gap }
    }
    if (top !== null && (weakest === null || top.gap < weakest.gap)) {
      weakest = { candidate, ...top }
    }
  }
  if (weakest === null) throw new Error('No candidate was played')
  return {
    best,
    bestEverywhere,
    weakest,
    weakestBeatsNoHire: weakest.gap > 0,
  }
}
