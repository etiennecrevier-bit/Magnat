import { Worker } from 'node:worker_threads'
import type { DifficultyId } from '../../src/content/schema.ts'
import type { DifficultyRun } from './play.ts'
import type { Strategy } from './strategies.ts'

// Plays each difficulty of a run on its own worker thread (worker.ts), so
// the three play side by side. Each difficulty plays the same games in the
// same order as runBalance() would, so the run is the same.

/** What one worker plays: one difficulty of the run. */
export interface WorkerJob {
  readonly years: number
  readonly games: number
  readonly difficulty: DifficultyId
  /** By default the whole grid. */
  readonly strategies?: readonly Strategy[]
}

/** A difficulty being played, and how to stop it. */
export interface Playing {
  /** Rejects with what the worker threw, or if it stops before posting. */
  readonly run: Promise<DifficultyRun>
  /** Stops the worker; harmless once it is done. */
  readonly stop: () => Promise<unknown>
}

const WORKER = new URL('./worker.ts', import.meta.url)

/**
 * Starts a worker thread that plays `job`. The thread loads the TypeScript
 * through tsx, as `npm run balance` does, whatever the parent runs under.
 */
export function playInWorker(job: WorkerJob): Playing {
  const worker = new Worker(WORKER, {
    workerData: job,
    execArgv: ['--import', 'tsx'],
  })
  const run = new Promise<DifficultyRun>((resolve, reject) => {
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
export async function playAll(
  jobs: readonly WorkerJob[],
  onDone: (run: DifficultyRun) => void,
  play: (job: WorkerJob) => Playing = playInWorker,
): Promise<DifficultyRun[]> {
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
