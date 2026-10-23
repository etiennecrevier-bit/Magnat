import { parentPort, workerData } from 'node:worker_threads'
import bakeryJson from '../../src/content/bakery.json'
import difficultyJson from '../../src/content/difficulty.json'
import districtsJson from '../../src/content/districts.json'
import dreamJson from '../../src/content/dream.json'
import energyJson from '../../src/content/energy.json'
import eventsJson from '../../src/content/events.json'
import financingJson from '../../src/content/financing.json'
import foodTruckJson from '../../src/content/foodtruck.json'
import grocersJson from '../../src/content/grocers.json'
import personalJson from '../../src/content/personal.json'
import placesJson from '../../src/content/places.json'
import segmentsJson from '../../src/content/segments.json'
import staffJson from '../../src/content/staff.json'
import type { AuditJob } from './threads.ts'

// One worker thread of `npm run balance -- --audit` (#298). For the
// sensitivity, it moves one tunable in the content files before anything
// reads them: the engine parses each file once, when its modules load, so
// this file imports nothing but the files themselves until the edits are
// made, then loads the audit, which loads the engine, and plays the job.
// The other audit jobs play the content as shipped. What it throws ends
// the thread with an error the main thread reads.

const FILES: Readonly<Record<string, unknown>> = {
  'bakery.json': bakeryJson,
  'difficulty.json': difficultyJson,
  'districts.json': districtsJson,
  'dream.json': dreamJson,
  'energy.json': energyJson,
  'events.json': eventsJson,
  'financing.json': financingJson,
  'foodtruck.json': foodTruckJson,
  'grocers.json': grocersJson,
  'personal.json': personalJson,
  'places.json': placesJson,
  'segments.json': segmentsJson,
  'staff.json': staffJson,
}

const job = workerData as AuditJob
if (job.kind === 'audit-sensitivity' && job.file !== null) {
  const json = FILES[job.file]
  if (json === undefined) throw new RangeError(`No content file ${job.file}`)
  for (const { path, value } of job.edits) {
    const parent = path
      .slice(0, -1)
      .reduce<unknown>(
        (at, key) => (at as Record<string | number, unknown>)[key],
        json,
      ) as Record<string | number, unknown>
    const last = path.at(-1)
    if (last === undefined || typeof parent[last] !== 'number') {
      throw new RangeError(`No number at ${path.join('.')} of ${job.file}`)
    }
    parent[last] = value
  }
}
const audit = await import('./audit.ts')
parentPort?.postMessage(
  job.kind === 'audit-definitions'
    ? audit.runDefinitions(job)
    : job.kind === 'audit-levers'
      ? audit.runLevers(job)
      : audit.runSensitivity(job),
)
