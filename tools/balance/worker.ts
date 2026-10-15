import { parentPort, workerData } from 'node:worker_threads'
import { runBalance } from './play.ts'
import type { WorkerJob } from './threads.ts'

// One worker thread of `npm run balance`: plays one difficulty of the run
// and posts its DifficultyRun back. What it throws ends the thread with an
// error the main thread reads.

const { years, games, difficulty, strategies } = workerData as WorkerJob
const [run] = runBalance({
  years,
  games,
  strategies,
  difficulties: [difficulty],
}).difficulties
parentPort?.postMessage(run)
