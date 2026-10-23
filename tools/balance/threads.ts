import { Worker } from 'node:worker_threads'
import type { DifficultyId } from '../../src/content/schema.ts'
import type {
  ContractPolicy,
  EventPolicy,
  FinancingPolicy,
} from '../sim/simulate.ts'
import type { BakeryJob, BakeryRun } from './bakery.ts'
import type { DefiRun } from './defis.ts'
import type { GrowthJob, GrowthRun } from './growth.ts'
import type { HiringJob, HiringRun } from './hiring.ts'
import type { OwnersRun } from './owners.ts'
import type { BalanceOptions, DifficultyRun } from './play.ts'
import type { Strategy } from './strategies.ts'

// Plays each difficulty of a run, each Défi, each difficulty and truck
// strategy of the bakery's run, each difficulty and contract plan of the
// growth run, or each role of the hiring run, on its own worker thread
// (worker.ts), a few side by side. Each job plays the same games in the
// same order as runBalance(), runOwners(), runDefi(), runBakery(),
// runGrowth() or runHiring() would, so the run is the same.

/** Worker threads at once at most: the machine is shared. */
export const MAX_WORKERS = 3

/** What one worker plays for the grid: one difficulty of the run. */
export interface GridJob {
  readonly kind: 'grid'
  readonly years: number
  readonly games: number
  readonly difficulty: DifficultyId
  /** By default the whole grid. */
  readonly strategies?: readonly Strategy[]
  /** How the event cards are answered; by default none come up. */
  readonly events?: EventPolicy
  /** How the grocers' cards are answered; by default as the others. */
  readonly contracts?: ContractPolicy
  /** How the financing's cards are answered; by default as the others. */
  readonly financing?: FinancingPolicy
}

/** What one worker plays for `--percentiles`: one difficulty's owners. */
export interface OwnersJob {
  readonly kind: 'owners'
  readonly years: number
  readonly games: number
  readonly difficulty: DifficultyId
}

/** What one worker plays for `--defis`: one Défi (see `runDefi`). */
export interface DefisJob {
  readonly kind: 'defis'
  readonly defi: string
  readonly games: number
  readonly search: number
}

export type WorkerJob =
  GridJob | OwnersJob | DefisJob | BakeryJob | GrowthJob | HiringJob

/** What a worker posts back for `Job`. */
export type JobRun<Job extends WorkerJob> = Job extends DefisJob
  ? DefiRun
  : Job extends OwnersJob
    ? OwnersRun
    : Job extends BakeryJob
      ? BakeryRun
      : Job extends GrowthJob
        ? GrowthRun
        : Job extends HiringJob
          ? HiringRun
          : DifficultyRun

/**
 * What `job` plays, for its error messages: a difficulty, a Défi, or a
 * difficulty and a truck strategy or a contract plan.
 */
export function jobLabel(job: WorkerJob): string {
  switch (job.kind) {
    case 'defis':
      return job.defi
    case 'bakery':
      return `${job.difficulty} ${job.strategy}`
    case 'growth':
      return `${job.difficulty} contracts ${job.contracts}`
    case 'hiring':
      return `${job.difficulty} hiring ${job.role}`
    default:
      return job.difficulty
  }
}

/** What `runBalance()` plays for `job`: its one difficulty. */
export function jobOptions({
  years,
  games,
  difficulty,
  strategies,
  events,
  contracts,
  financing,
}: GridJob): BalanceOptions {
  return {
    years,
    games,
    strategies,
    events,
    contracts,
    financing,
    difficulties: [difficulty],
  }
}

/** A difficulty being played, and how to stop it. */
export interface Playing<Run = DifficultyRun> {
  /** Rejects with what the worker threw, or if it stops before posting. */
  readonly run: Promise<Run>
  /** Stops the worker; harmless once it is done. */
  readonly stop: () => Promise<unknown>
}

const WORKER = new URL('./worker.ts', import.meta.url)

/**
 * Starts a worker thread that plays `job`. The thread loads the TypeScript
 * through tsx, as `npm run balance` does, whatever the parent runs under.
 */
export function playInWorker<Job extends WorkerJob>(
  job: Job,
): Playing<JobRun<Job>> {
  const worker = new Worker(WORKER, {
    workerData: job,
    execArgv: ['--import', 'tsx'],
  })
  const run = new Promise<JobRun<Job>>((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
    // After a message or an error, the promise is settled and this is a
    // no-op.
    worker.once('exit', (code) => {
      reject(new Error(`The ${jobLabel(job)} worker stopped with code ${code}`))
    })
  })
  return { run, stop: () => worker.terminate() }
}

/**
 * Plays every job with `play`, by default each on its own worker thread,
 * `limit` at once at most, starting the next in the order of `jobs` as one
 * ends, and calling `onDone` as each is done, in whatever order they end.
 * Resolves to the runs in the order of `jobs`. On the first failure, stops
 * every job started, starts no other, and rejects with that failure.
 */
export async function playAll<Job extends WorkerJob>(
  jobs: readonly Job[],
  onDone: (run: JobRun<Job>) => void,
  play: (job: Job) => Playing<JobRun<Job>> = playInWorker,
  limit: number = MAX_WORKERS,
): Promise<JobRun<Job>[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`Limit must be a whole number from 1: ${limit}`)
  }
  const runs: JobRun<Job>[] = []
  const started: Playing<JobRun<Job>>[] = []
  let failed = false
  let next = 0
  const lane = async (): Promise<void> => {
    while (!failed && next < jobs.length) {
      const index = next
      next += 1
      const job = jobs[index]
      if (job === undefined) return
      try {
        // Inside the try: a worker that cannot start fails the whole run too.
        const playing = play(job)
        started.push(playing)
        const played = await playing.run
        runs[index] = played
        onDone(played)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(limit, jobs.length) }, lane),
    )
    return runs
  } finally {
    await Promise.all(started.map(({ stop }) => stop()))
  }
}
