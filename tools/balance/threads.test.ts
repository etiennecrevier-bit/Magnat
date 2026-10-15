import { describe, expect, it, vi } from 'vitest'
import type { DifficultyId } from '../../src/content/schema.ts'
import { cents } from '../../src/engine/money.ts'
import { runBalance, type DifficultyRun } from './play.ts'
import type { Strategy } from './strategies.ts'
import {
  playAll,
  playInWorker,
  type Playing,
  type WorkerJob,
} from './threads.ts'

// Playing each difficulty on its own worker thread: that it plays what
// runBalance() plays, and that one failure stops every other thread.

const BASE: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(0),
  daysOpen: 6,
  ownerWeeklyPay: cents(70_000),
}
const strategies = [BASE, { ...BASE, daysOpen: 7 as const }]

/** A job that ends when the test says so, and a spy on its stop. */
function controlled() {
  let resolve: (run: DifficultyRun) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const run = new Promise<DifficultyRun>((done, fail) => {
    resolve = done
    reject = fail
  })
  const stop = vi.fn(() => Promise.resolve())
  return { playing: { run, stop } satisfies Playing, resolve, reject, stop }
}

function job(difficulty: DifficultyId): WorkerJob {
  return { years: 1, games: 1, difficulty }
}

function difficultyRun(difficulty: DifficultyId): DifficultyRun {
  return { difficulty, strategies: [] }
}

describe('playAll', () => {
  it('reports each difficulty as it ends, and resolves in the order of the jobs', async () => {
    const jobs = (['facile', 'moyen', 'difficile'] as const).map(job)
    const controls = jobs.map(() => controlled())
    const done: DifficultyId[] = []
    const all = playAll(
      jobs,
      ({ difficulty }) => done.push(difficulty),
      (played) =>
        controls[jobs.indexOf(played)]?.playing ?? controlled().playing,
    )
    controls[2]?.resolve(difficultyRun('difficile'))
    controls[0]?.resolve(difficultyRun('facile'))
    controls[1]?.resolve(difficultyRun('moyen'))
    expect((await all).map(({ difficulty }) => difficulty)).toEqual([
      'facile',
      'moyen',
      'difficile',
    ])
    expect(done).toEqual(['difficile', 'facile', 'moyen'])
    for (const { stop } of controls) expect(stop).toHaveBeenCalledOnce()
  })

  it('stops every other job on the first failure and rejects with it', async () => {
    const jobs = (['facile', 'moyen', 'difficile'] as const).map(job)
    const controls = jobs.map(() => controlled())
    const all = playAll(
      jobs,
      () => undefined,
      (played) =>
        controls[jobs.indexOf(played)]?.playing ?? controlled().playing,
    )
    controls[1]?.reject(new Error('Moyen broke'))
    await expect(all).rejects.toThrow('Moyen broke')
    // The others never ended, and were stopped.
    for (const { stop } of controls) expect(stop).toHaveBeenCalledOnce()
  })
})

describe('playInWorker', () => {
  it('plays on its thread what runBalance plays on this one', async () => {
    const { run, stop } = playInWorker({
      years: 1,
      games: 2,
      difficulty: 'difficile',
      strategies,
    })
    try {
      expect(await run).toEqual(
        runBalance({
          years: 1,
          games: 2,
          strategies,
          difficulties: ['difficile'],
        }).difficulties[0],
      )
    } finally {
      await stop()
    }
  }, 30_000)

  it('rejects with what the game throws on its thread', async () => {
    const { run, stop } = playInWorker({
      years: 1,
      games: 0,
      difficulty: 'moyen',
      strategies,
    })
    try {
      await expect(run).rejects.toThrow(
        'Games must be a whole number from 1: 0',
      )
    } finally {
      await stop()
    }
  }, 30_000)
})
