import { createStore, useStore, type StoreApi } from 'zustand'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState, Profile } from '../engine/types.ts'

export const PAUSED = 0
/** A multiplier of 1 is, by definition, the pace pacing.json calls normal. */
export const NORMAL_SPEED = 1

/** The panels the top bar opens: « Gérer le camion » and « Vos finances ». */
export type Panel = 'manage' | 'finances'

export interface GameStoreState {
  game: GameState
  /** Game speed multiplier; `PAUSED` stops time. */
  speed: number
  /** The last speed above `PAUSED`, which `togglePause` resumes at. */
  lastSpeed: number
  /**
   * The speed the game resumes at when the open panel closes; null while no
   * panel is open. A panel pauses the game for as long as it is open.
   */
  resumeSpeed: number | null
  /** The open panel; null while none is. */
  panel: Panel | null
  /** Ignored while a panel is open: the game stays paused. */
  setSpeed: (speed: number) => void
  /** Ignored while a panel is open: the game stays paused. */
  togglePause: () => void
  /** Runs the engine's `tick()` `days` times, then notifies once. */
  advance: (days: number) => void
  /**
   * Opens `panel`: remembers the speed, even `PAUSED`, and pauses. Does
   * nothing if a panel is already open, so that panel and the speed it
   * remembered stay.
   */
  openPanel: (panel: Panel) => void
  /** Closes the panel and resumes at the speed it remembered. */
  closePanel: () => void
  /**
   * Hands the player's change to the engine's `applyDecision()`, which
   * leaves it waiting for the next morning. Throws its RangeError if the
   * change breaks the content's limits.
   */
  decide: (change: DecisionChange) => void
  /** Plays `game` from now on, new or loaded, at normal speed. */
  startGame: (game: GameState) => void
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
 * A new game for `profile` on the seed `search` names (see
 * `seedFromSearch`), or on a random one when it names none or one the
 * engine rejects. Throws a RangeError if the engine rejects `profile`.
 */
export function newGame(
  search: string,
  profile: Profile = defaultProfile(),
): GameState {
  const seed = seedFromSearch(search)
  if (seed !== null) {
    try {
      return createInitialState(seed, FOOD_TRUCK, profile)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  }
  return createInitialState(randomSeed(), FOOD_TRUCK, profile)
}

export function createGameStore(
  game: GameState = createInitialState(randomSeed()),
): GameStore {
  return createStore<GameStoreState>()((set, get) => ({
    game,
    speed: NORMAL_SPEED,
    lastSpeed: NORMAL_SPEED,
    resumeSpeed: null,
    panel: null,
    setSpeed: (speed) => {
      if (get().resumeSpeed !== null) return
      set(speed > PAUSED ? { speed, lastSpeed: speed } : { speed })
    },
    togglePause: () => {
      const { speed, lastSpeed, resumeSpeed } = get()
      if (resumeSpeed !== null) return
      set({ speed: speed > PAUSED ? PAUSED : lastSpeed })
    },
    advance: (days) => {
      if (days <= 0) return
      let next = get().game
      for (let i = 0; i < days; i += 1) next = tick(next)
      set({ game: next })
    },
    openPanel: (panel) => {
      const { speed, resumeSpeed } = get()
      if (resumeSpeed !== null) return
      set({ resumeSpeed: speed, speed: PAUSED, panel })
    },
    closePanel: () => {
      const { resumeSpeed } = get()
      if (resumeSpeed === null) return
      set({ speed: resumeSpeed, resumeSpeed: null, panel: null })
    },
    decide: (change) => set({ game: applyDecision(get().game, change) }),
    startGame: (next) =>
      set({
        game: next,
        speed: NORMAL_SPEED,
        lastSpeed: NORMAL_SPEED,
        resumeSpeed: null,
        panel: null,
      }),
  }))
}

/**
 * The store the app runs on. Until the start screen hands it the game to
 * play, it holds a new game with the default profile, seeded from the page
 * address when it has a `?seed=`, for the world to draw behind the menu.
 * Tests build their own with `createGameStore`.
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
