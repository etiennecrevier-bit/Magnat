import { createStore, useStore, type StoreApi } from 'zustand'
import type { EventContent } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { resolveEvent } from '../engine/events.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState, Profile } from '../engine/types.ts'

export const PAUSED = 0
/** A multiplier of 1 is, by definition, the pace pacing.json calls normal. */
export const NORMAL_SPEED = 1

/**
 * The panels: « Gérer le camion » and « Vos finances », which the top bar
 * opens, and the event card, which opens on its own when an event comes up.
 */
export type Panel = 'manage' | 'finances' | 'event'

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
  /**
   * The open panel; null while none is. While an event waits for the
   * player's choice, a panel is always open: the event card, or one that
   * was open when the event came up, until it closes.
   */
  panel: Panel | null
  /**
   * The game from just before the player's choice, while the event card
   * shows what it did; null otherwise.
   */
  eventBefore: GameState | null
  /** Ignored while a panel is open: the game stays paused. */
  setSpeed: (speed: number) => void
  /** Ignored while a panel is open: the game stays paused. */
  togglePause: () => void
  /**
   * Runs the engine's `tick()` `days` times, with the event cards on, then
   * notifies once. It stops on the morning an event comes up, opens the
   * event card and pauses, remembering the speed; with a panel already
   * open, that panel stays and the card opens when it closes. Does nothing
   * while an event waits for the player's choice, nor while the card shows
   * what the choice did, which the next day would blur.
   */
  advance: (days: number) => void
  /**
   * Opens `panel`: remembers the speed, even `PAUSED`, and pauses. Does
   * nothing if a panel is already open, so that panel and the speed it
   * remembered stay. The event card only opens on its own.
   */
  openPanel: (panel: Exclude<Panel, 'event'>) => void
  /**
   * Closes the panel and resumes at the speed it remembered. While an event
   * waits for the player's choice, the event card stays open, and any other
   * panel gives way to it, the game still paused.
   */
  closePanel: () => void
  /**
   * Plays the player's choice on the event waiting, through the engine's
   * `resolveEvent()`. The card stays open, and the game paused, to show
   * what the choice did until `closePanel()`. Does nothing when no event
   * waits, so a second press changes nothing.
   */
  chooseEvent: (choiceId: string) => void
  /**
   * Hands the player's change to the engine's `applyDecision()`, which
   * leaves it waiting for the next morning. Throws its RangeError if the
   * change breaks the content's limits.
   */
  decide: (change: DecisionChange) => void
  /**
   * Plays `game` from now on, new or loaded, at normal speed: paused on the
   * event card if an event waits for the player's choice.
   */
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

/**
 * The store's state for playing `game` from its start, at normal speed: on
 * the event card, paused, if an event waits for the player's choice.
 */
function playing(game: GameState) {
  const waiting = game.events.pending !== null
  return {
    game,
    speed: waiting ? PAUSED : NORMAL_SPEED,
    lastSpeed: NORMAL_SPEED,
    resumeSpeed: waiting ? NORMAL_SPEED : null,
    panel: waiting ? ('event' as const) : null,
    eventBefore: null,
  }
}

/**
 * A store playing `game`, whose days draw the event cards from `events`
 * and whose choices play them out.
 */
export function createGameStore(
  game: GameState = createInitialState(randomSeed()),
  events: EventContent = EVENTS,
): GameStore {
  return createStore<GameStoreState>()((set, get) => ({
    ...playing(game),
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
      const { game: start, speed, resumeSpeed, panel } = get()
      if (days <= 0 || start.events.pending !== null || panel === 'event') {
        return
      }
      let next = start
      for (let i = 0; i < days && next.events.pending === null; i += 1) {
        next = tick(
          next,
          FOOD_TRUCK,
          CUSTOMERS,
          DIFFICULTIES,
          PERSONAL,
          ENERGY,
          events,
        )
      }
      // P3-10 (#98): the weekly report goes first on a morning that brings
      // both. It is to open here, in the event card's place and with the
      // same resumeSpeed; closePanel() then opens the card.
      if (next.events.pending === null || resumeSpeed !== null) {
        set({ game: next })
      } else {
        set({ game: next, panel: 'event', resumeSpeed: speed, speed: PAUSED })
      }
    },
    openPanel: (panel) => {
      const { speed, resumeSpeed } = get()
      if (resumeSpeed !== null) return
      set({ resumeSpeed: speed, speed: PAUSED, panel })
    },
    closePanel: () => {
      const { resumeSpeed, panel, game: current } = get()
      if (resumeSpeed === null) return
      if (current.events.pending !== null) {
        if (panel !== 'event') set({ panel: 'event' })
        return
      }
      set({
        speed: resumeSpeed,
        resumeSpeed: null,
        panel: null,
        eventBefore: null,
      })
    },
    chooseEvent: (choiceId) => {
      const { game: current } = get()
      if (current.events.pending === null) return
      set({
        game: resolveEvent(current, choiceId, events),
        eventBefore: current,
      })
    },
    decide: (change) => set({ game: applyDecision(get().game, change) }),
    startGame: (next) => set(playing(next)),
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
