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

/**
 * The `seed` parameter of a page address's query string, such as
 * `?seed=42`, so a game can be replayed with `npm run sim -- --seed 42`.
 * Digits only, as for the sim's `--seed`: `Number()` alone would accept
 * "1e3" or " 7", and round a long string of digits to another number. Null
 * when the parameter is missing or not a safe whole number.
 */
export function seedFromSearch(search: string): number | null {
  const text = new URLSearchParams(search).get('seed')
  if (text === null || !/^\d+$/.test(text)) return null
  const seed = Number(text)
  return Number.isSafeInteger(seed) ? seed : null
}

/**
 * A new game on the seed `search` names (see `seedFromSearch`), or on a
 * random one when it names none or one the engine rejects.
 */
export function newGame(search: string): GameState {
  const seed = seedFromSearch(search)
  if (seed !== null) {
    try {
      return createInitialState(seed)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  }
  return createInitialState(randomSeed())
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

/**
 * The store the app runs on, seeded from the page address when it has a
 * `?seed=`. Tests build their own with `createGameStore`.
 */
export const gameStore = createGameStore(
  newGame(typeof window === 'undefined' ? '' : window.location.search),
)

/**
 * Reads the app store. Select one field per call: a selector that builds a
 * new object re-renders on every change.
 */
export function useGame<T>(selector: (state: GameStoreState) => T): T {
  return useStore(gameStore, selector)
}
