import { createStore, useStore, type StoreApi } from 'zustand'
import { createInitialState, tick } from '../engine/clock.ts'
import type { GameState } from '../engine/types.ts'

export const PAUSED = 0
/** A multiplier of 1 is, by definition, the pace pacing.json calls normal. */
export const NORMAL_SPEED = 1

export interface GameStoreState {
  game: GameState
  /** Game speed multiplier; `PAUSED` stops time. */
  speed: number
  /** The last speed above `PAUSED`, which `togglePause` resumes at. */
  lastSpeed: number
  setSpeed: (speed: number) => void
  togglePause: () => void
  /** Runs the engine's `tick()` `days` times, then notifies once. */
  advance: (days: number) => void
}

export type GameStore = StoreApi<GameStoreState>

/** Fresh luck for each new game; only the engine has to be deterministic. */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}

export function createGameStore(
  game: GameState = createInitialState(randomSeed()),
): GameStore {
  return createStore<GameStoreState>()((set, get) => ({
    game,
    speed: NORMAL_SPEED,
    lastSpeed: NORMAL_SPEED,
    setSpeed: (speed) =>
      set(speed > PAUSED ? { speed, lastSpeed: speed } : { speed }),
    togglePause: () => {
      const { speed, lastSpeed } = get()
      set({ speed: speed > PAUSED ? PAUSED : lastSpeed })
    },
    advance: (days) => {
      if (days <= 0) return
      let next = get().game
      for (let i = 0; i < days; i += 1) next = tick(next)
      set({ game: next })
    },
  }))
}

/** The store the app runs on. Tests build their own with `createGameStore`. */
export const gameStore = createGameStore()

/**
 * Reads the app store. Select one field per call: a selector that builds a
 * new object re-renders on every change.
 */
export function useGame<T>(selector: (state: GameStoreState) => T): T {
  return useStore(gameStore, selector)
}
