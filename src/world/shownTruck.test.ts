import { describe, expect, it, vi } from 'vitest'
import { applyDecision } from '../engine/decisions.ts'
import { createInitialState } from '../engine/clock.ts'
import { FIRST_TRUCK, newTruck, truckDecisionsOf } from '../engine/trucks.ts'
import type { GameState } from '../engine/types.ts'
import { createShownTruck, shownTruckOf } from './shownTruck.ts'

const SECOND = 'vieuxMontreal'

/** A new game with Vieux-Montréal's truck. */
function twoTrucks(): GameState {
  const state = createInitialState(42)
  return {
    ...state,
    trucks: [newTruck(42, { id: SECOND, district: SECOND }, 0)],
    decisions: {
      ...state.decisions,
      trucks: { [SECOND]: truckDecisionsOf(state.decisions, FIRST_TRUCK) },
    },
  }
}

describe('shownTruckOf (#264)', () => {
  it('shows the truck picked while the game has it', () => {
    expect(shownTruckOf(twoTrucks(), SECOND)).toBe(SECOND)
    expect(shownTruckOf(twoTrucks(), FIRST_TRUCK)).toBe(FIRST_TRUCK)
  })

  it('shows the truck the owner works at with none picked, or one the game lacks', () => {
    const game = twoTrucks()
    expect(shownTruckOf(game, null)).toBe(FIRST_TRUCK)
    expect(shownTruckOf(createInitialState(42), SECOND)).toBe(FIRST_TRUCK)
    const moved = {
      ...game,
      decisions: { ...game.decisions, ownerAt: SECOND },
    }
    expect(shownTruckOf(moved, null)).toBe(SECOND)
    expect(shownTruckOf(moved, 'nowhere')).toBe(SECOND)
  })

  it("follows the owner's truck only from the morning they move", () => {
    const moving = applyDecision(twoTrucks(), {
      kind: 'ownerAt',
      truck: SECOND,
    })
    expect(shownTruckOf(moving, null)).toBe(FIRST_TRUCK)
  })
})

describe('createShownTruck', () => {
  it('holds the truck picked and tells each change', () => {
    const shown = createShownTruck()
    const listener = vi.fn()
    const off = shown.subscribe(listener)
    expect(shown.getState()).toBeNull()
    shown.pick(SECOND)
    expect(shown.getState()).toBe(SECOND)
    shown.pick(SECOND)
    expect(listener).toHaveBeenCalledOnce()
    shown.pick(null)
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    shown.pick(FIRST_TRUCK)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
