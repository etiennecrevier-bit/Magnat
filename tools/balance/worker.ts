import { parentPort, workerData } from 'node:worker_threads'
import { runOwners } from './owners.ts'
import { runBalance } from './play.ts'
import { jobOptions, type WorkerJob } from './threads.ts'

// One worker thread of `npm run balance`: plays one difficulty of the run,
// the grid's or the owners', and posts what it played back. What it throws
// ends the thread with an error the main thread reads.

const job = workerData as WorkerJob
parentPort?.postMessage(
  job.kind === 'owners'
    ? runOwners(job)
    : runBalance(jobOptions(job)).difficulties[0],
)
