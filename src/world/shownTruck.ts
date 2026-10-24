import { FIRST_TRUCK, hasTruck, ownerAtOf } from '../engine/trucks.ts'
import type { GameState, TruckId } from '../engine/types.ts'

// Which truck the world shows the street of (#264). The truck switcher
// (#265) picks one; until it does, or while the game lacks the truck
// picked, the world shows the truck the owner works at. The store is shared
// by the page and the world, as `CITY` and `PICKER` are, and never kept.

/** The truck the player picked to look at, if any. */
export interface ShownTruckStore {
  /** The truck picked; null while none is. */
  getState: () => TruckId | null
  /** Picks the truck `truck` to look at, or none. */
  pick: (truck: TruckId | null) => void
  /** Calls `listener` on each pick that changes it; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
}

export function createShownTruck(): ShownTruckStore {
  let picked: TruckId | null = null
  const listeners = new Set<() => void>()
  return {
    getState: () => picked,
    pick: (truck) => {
      if (truck === picked) return
      picked = truck
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** The page's and the world's. */
export const SHOWN_TRUCK: ShownTruckStore = createShownTruck()

/**
 * The truck whose street the world shows in `game`: `picked` when the game
 * has it, or else the truck the owner works at, the first one by default.
 */
export function shownTruckOf(game: GameState, picked: TruckId | null): TruckId {
  if (picked !== null && hasTruck(game, picked)) return picked
  const owner = ownerAtOf(game.decisions)
  return hasTruck(game, owner) ? owner : FIRST_TRUCK
}
