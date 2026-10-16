import { Worker } from 'node:worker_threads'
import type { DifficultyId } from '../../src/content/schema.ts'
import type { EventPolicy } from '../sim/simulate.ts'
import type { OwnersRun } from './owners.ts'
import type { BalanceOptions, DifficultyRun } from './play.ts'
import type { Strategy } from './strategies.ts'

// Plays each difficulty of a run on its own worker thread (worker.ts), so
// the three play side by side. Each difficulty plays the same games in the
// same order as runBalance() or runOwners() would, so the run is the same.

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
}

/** What one worker plays for `--percentiles`: one difficulty's owners. */
export interface OwnersJob {
  readonly kind: 'owners'
  readonly years: number
  readonly games: number
  readonly difficulty: DifficultyId
}

export type WorkerJob = GridJob | OwnersJob

/** What a worker posts back for `Job`. */
export type JobRun<Job extends WorkerJob> = Job extends OwnersJob
  ? OwnersRun
  : DifficultyRun

/** What `runBalance()` plays for `job`: its one difficulty. */
export function jobOptions({
  years,
  games,
  difficulty,
  strategies,
  events,
}: GridJob): BalanceOptions {
  return { years, games, strategies, events, difficulties: [difficulty] }
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
      reject(
        new Error(`The ${job.difficulty} worker stopped with code ${code}`),
      )
    })
  })
  return { run, stop: () => worker.terminate() }
}

/**
 * Plays every job with `play`, by default each on its own worker thread,
 * calling `onDone` as each difficulty is done, in whatever order they end.
 * Resolves to the runs in the order of `jobs`. On the first failure, stops
 * every other job and rejects with that failure.
 */
export async function playAll<Job extends WorkerJob>(
  jobs: readonly Job[],
  onDone: (run: JobRun<Job>) => void,
  play: (job: Job) => Playing<JobRun<Job>> = playInWorker,
): Promise<JobRun<Job>[]> {
  const playing = jobs.map(play)
  try {
    return await Promise.all(
      playing.map(({ run }) =>
        run.then((played) => {
          onDone(played)
          return played
        }),
      ),
    )
  } finally {
    await Promise.all(playing.map(({ stop }) => stop()))
  }
}
