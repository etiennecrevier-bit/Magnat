import { parentPort, workerData } from 'node:worker_threads'
import { runBakery } from './bakery.ts'
import { runDefi } from './defis.ts'
import { runGrowth } from './growth.ts'
import { runOwners } from './owners.ts'
import { runBalance } from './play.ts'
import { jobOptions, type WorkerJob } from './threads.ts'

// One worker thread of `npm run balance`: plays one difficulty of the run,
// the grid's or the owners', one Défi, one difficulty and truck strategy
// of the bakery's run, or one difficulty and contract plan of the growth
// run, and posts what it played back.
// What it throws ends the thread with an error the main thread reads.

const job = workerData as WorkerJob
parentPort?.postMessage(play(job))

function play(job: WorkerJob): unknown {
  switch (job.kind) {
    case 'defis':
      return runDefi(job)
    case 'owners':
      return runOwners(job)
    case 'grid':
      return runBalance(jobOptions(job)).difficulties[0]
    case 'bakery':
      return runBakery(job)
    case 'growth':
      return runGrowth(job)
  }
}
