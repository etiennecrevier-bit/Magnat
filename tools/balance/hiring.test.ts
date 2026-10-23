import { describe, expect, it } from 'vitest'
import { candidateIdSchema } from '../../src/content/schema.ts'
import { cents } from '../../src/engine/money.ts'
import { askingWage } from '../../src/engine/staff.ts'
import { truckChanges } from './bakery.ts'
import {
  HIRING_BUSINESSES,
  HIRING_ROLES,
  hiringChanges,
  hiringVerdict,
  medianGap,
  playHiringGame,
  runHiring,
  type HiringGame,
  type HiringRun,
} from './hiring.ts'

/** A game summed up with `cash` and nothing else. */
const at = (cash: number): HiringGame => ({
  cash: cents(cash),
  bankrupt: false,
  absences: 0,
  botched: 0,
  wasted: 0,
})

/** A run of `role` whose candidates' gaps over one twin at 0 are `gaps`. */
function run(role: HiringRun['role'], gaps: Record<string, number>): HiringRun {
  return {
    role,
    difficulty: 'moyen',
    games: 1,
    months: 1,
    twins: [at(0)],
    cells: candidateIdSchema.options.map((candidate) => ({
      candidate,
      hourlyWage: askingWage(candidate, role),
      games: [at(gaps[candidate] ?? -1000)],
    })),
  }
}

describe('the hiring businesses', () => {
  it('hire each candidate on day 0 at the wage they ask, on top of the twin', () => {
    for (const role of HIRING_ROLES) {
      const twin = hiringChanges(role, null)
      expect(hiringChanges(role, 'kevin')).toEqual([
        ...twin,
        {
          kind: 'hire',
          role,
          candidate: 'kevin',
          hourlyWage: askingWage('kevin', role),
        },
      ])
    }
    expect(hiringChanges('camion', null)).toEqual(
      truckChanges(HIRING_BUSINESSES.camion.truck),
    )
  })

  it('bakes at a leased bakery for the baker, and signs two contracts for the deliverer', () => {
    expect(HIRING_BUSINESSES.livreur.truck.contracts).toEqual([
      'marcheBioLogique',
      'chezNormand',
    ])
    expect(hiringChanges('boulanger', null)).toEqual(
      expect.arrayContaining([
        { kind: 'openBakery', oven: 'louer' },
        { kind: 'croissantSource', source: 'fabriquer' },
        { kind: 'bake', rule: { kind: 'buyDaily', quantity: 150 } },
      ]),
    )
    expect(HIRING_BUSINESSES.camion.bakery).toBe(false)
  })
})

describe('playHiringGame', () => {
  it('counts the days the employee was absent with work, and what the baker threw away', () => {
    const baker = playHiringGame(1, 'moyen', 'boulanger', 'nadia', 2)
    const twin = playHiringGame(1, 'moyen', 'boulanger', null, 2)
    expect(baker.wasted).toBeGreaterThan(0)
    expect(twin.wasted).toBe(0)
    expect(twin.absences).toBe(0)
    expect(baker.cash).not.toBe(twin.cash)
    // The same seed plays the same game.
    expect(playHiringGame(1, 'moyen', 'boulanger', 'nadia', 2)).toEqual(baker)
  })
})

describe('runHiring', () => {
  it('plays the twins, then every candidate, on the same seeds', () => {
    const played = runHiring({
      kind: 'hiring',
      role: 'livreur',
      difficulty: 'moyen',
      games: 2,
      months: 1,
    })
    expect(played.twins).toHaveLength(2)
    expect(played.cells.map(({ candidate }) => candidate)).toEqual(
      candidateIdSchema.options,
    )
    for (const cell of played.cells) {
      expect(cell.games).toHaveLength(2)
      expect(cell.hourlyWage).toBe(askingWage(cell.candidate, 'livreur'))
    }
    expect(played.twins[0]).toEqual(
      playHiringGame(1, 'moyen', 'livreur', null, 1),
    )
  })
})

describe('hiringVerdict', () => {
  it('reads the median gap over the twins', () => {
    const cell = {
      candidate: 'kevin' as const,
      hourlyWage: cents(1800),
      games: [at(100), at(300), at(-50)],
    }
    expect(medianGap(cell, [at(0), at(100), at(0)])).toBe(100)
  })

  it('finds the best of each role, ties all, and whoever is among them everywhere', () => {
    const verdict = hiringVerdict([
      run('camion', { kevin: 50, nadia: 50 }),
      run('livreur', { kevin: 10 }),
      run('boulanger', { kevin: 5, sophie: 5 }),
    ])
    expect(verdict.best).toEqual({
      camion: ['kevin', 'nadia'],
      livreur: ['kevin'],
      boulanger: ['kevin', 'sophie'],
    })
    expect(verdict.bestEverywhere).toEqual(['kevin'])
  })

  it('names the weakest by their best role, and whether they beat no hire there', () => {
    const runs = [
      run('camion', { kevin: 50, olivier: -400 }),
      run('livreur', { olivier: -300 }),
      run('boulanger', { olivier: -200 }),
    ]
    // Everyone else is at -1000 in two roles but at least as high
    // somewhere: Olivier's best, -200, is not the lowest best.
    const verdict = hiringVerdict(runs)
    expect(verdict.bestEverywhere).toEqual([])
    expect(verdict.weakest).toEqual({
      candidate: 'amelie',
      role: 'camion',
      gap: -1000,
    })
    expect(verdict.weakestBeatsNoHire).toBe(false)
    const fine = hiringVerdict(
      HIRING_ROLES.map((role) =>
        run(
          role,
          Object.fromEntries(
            candidateIdSchema.options.map((candidate, index) => [
              candidate,
              role === 'boulanger' ? index + 1 : -5,
            ]),
          ),
        ),
      ),
    )
    expect(fine.weakest).toEqual({
      candidate: 'amelie',
      role: 'boulanger',
      gap: 1,
    })
    expect(fine.weakestBeatsNoHire).toBe(true)
  })
})
