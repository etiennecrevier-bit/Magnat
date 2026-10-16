import { describe, expect, it, vi } from 'vitest'
import type { DifficultyId } from '../../src/content/schema.ts'
import { cents } from '../../src/engine/money.ts'
import { runOwners } from './owners.ts'
import { runBalance, type DifficultyRun } from './play.ts'
import type { Strategy } from './strategies.ts'
import { runDefi } from './defis.ts'
import {
  jobLabel,
  jobOptions,
  MAX_WORKERS,
  playAll,
  playInWorker,
  type GridJob,
  type Playing,
} from './threads.ts'

// Playing each job on its own worker thread: that it plays what
// runBalance(), runOwners() or runDefi() plays, a few at once, and that one
// failure stops every other thread.

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

function job(difficulty: DifficultyId): GridJob {
  return { kind: 'grid', years: 1, games: 1, difficulty }
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

describe('playAll with a limit', () => {
  const difficulties = ['facile', 'moyen', 'difficile', 'facile'] as const
  const jobs = difficulties.map(job)

  function play(controls: ReturnType<typeof controlled>[]) {
    const started: number[] = []
    return {
      started,
      play: (played: GridJob) => {
        const index = jobs.indexOf(played)
        started.push(index)
        return controls[index]?.playing ?? controlled().playing
      },
    }
  }

  it('starts at most the limit at once, the next as one ends, and resolves in the order of the jobs', async () => {
    const controls = jobs.map(() => controlled())
    const { started, play: start } = play(controls)
    const all = playAll(jobs, () => undefined, start, 2)
    expect(started).toEqual([0, 1])
    controls[1]?.resolve(difficultyRun('moyen'))
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]))
    controls[2]?.resolve(difficultyRun('difficile'))
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]))
    controls[3]?.resolve(difficultyRun('facile'))
    controls[0]?.resolve(difficultyRun('facile'))
    expect((await all).map(({ difficulty }) => difficulty)).toEqual(
      difficulties,
    )
    for (const { stop } of controls) expect(stop).toHaveBeenCalledOnce()
  })

  it('on a failure, stops the jobs running and starts none of those waiting', async () => {
    const controls = jobs.map(() => controlled())
    const { started, play: start } = play(controls)
    const all = playAll(jobs, () => undefined, start, 2)
    controls[0]?.reject(new Error('Facile broke'))
    await expect(all).rejects.toThrow('Facile broke')
    expect(started).toEqual([0, 1])
    expect(controls[0]?.stop).toHaveBeenCalledOnce()
    expect(controls[1]?.stop).toHaveBeenCalledOnce()
    expect(controls[2]?.stop).not.toHaveBeenCalled()
    expect(controls[3]?.stop).not.toHaveBeenCalled()
  })

  it('on a job that cannot start, stops the jobs running and starts none of those waiting', async () => {
    const controls = jobs.map(() => controlled())
    const { started, play: start } = play(controls)
    const all = playAll(
      jobs,
      () => undefined,
      (played) => {
        const playing = start(played)
        if (played === jobs[1]) throw new Error('No thread for moyen')
        return playing
      },
      2,
    )
    await expect(all).rejects.toThrow('No thread for moyen')
    controls[0]?.resolve(difficultyRun('facile'))
    await new Promise<void>((done) => setTimeout(done, 0))
    expect(started).toEqual([0, 1])
    expect(controls[0]?.stop).toHaveBeenCalledOnce()
    expect(controls[2]?.stop).not.toHaveBeenCalled()
    expect(controls[3]?.stop).not.toHaveBeenCalled()
  })

  it('shares the machine: 3 at once by default, and at least 1', async () => {
    expect(MAX_WORKERS).toBe(3)
    await expect(playAll(jobs, () => undefined, undefined, 0)).rejects.toThrow(
      'Limit must be a whole number from 1: 0',
    )
  })
})

describe('jobLabel', () => {
  it('names the difficulty, the Défi, or the difficulty and the strategy', () => {
    expect(jobLabel(job('moyen'))).toBe('moyen')
    expect(
      jobLabel({ kind: 'defis', defi: 'moisSansConge', games: 1, search: 1 }),
    ).toBe('moisSansConge')
    expect(
      jobLabel({
        kind: 'bakery',
        difficulty: 'facile',
        strategy: 'busy',
        games: 1,
        months: 1,
      }),
    ).toBe('facile busy')
  })
})

describe('jobOptions', () => {
  it("is what runBalance plays for the job's one difficulty, its events policy included", () => {
    expect(
      jobOptions({
        kind: 'grid',
        years: 2,
        games: 3,
        difficulty: 'moyen',
        strategies,
        events: 'random',
      }),
    ).toEqual({
      years: 2,
      games: 3,
      strategies,
      events: 'random',
      difficulties: ['moyen'],
    })
    expect(jobOptions(job('facile'))).toEqual({
      years: 1,
      games: 1,
      strategies: undefined,
      events: undefined,
      difficulties: ['facile'],
    })
  })
})

describe('playInWorker', () => {
  it('plays on its thread what runBalance plays on this one', async () => {
    const { run, stop } = playInWorker({
      kind: 'grid',
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

  it('plays the owners on its thread as runOwners plays them on this one', async () => {
    const { run, stop } = playInWorker({
      kind: 'owners',
      years: 1,
      games: 1,
      difficulty: 'moyen',
    })
    try {
      expect(await run).toEqual(
        runOwners({ years: 1, games: 1, difficulty: 'moyen' }),
      )
    } finally {
      await stop()
    }
  }, 30_000)

  it('plays a Défi on its thread as runDefi plays it on this one', async () => {
    const job = {
      kind: 'defis',
      defi: 'semaineDesMilleDollars',
      games: 2,
      search: 1,
    } as const
    const { run, stop } = playInWorker(job)
    try {
      expect(await run).toEqual(runDefi(job))
    } finally {
      await stop()
    }
  }, 30_000)

  it('rejects with what the game throws on its thread', async () => {
    const { run, stop } = playInWorker({
      kind: 'grid',
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
