import { createStore, useStore, type StoreApi } from 'zustand'
import type { EventContent } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { createInitialState, startChallenge, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { resolveEvent } from '../engine/events.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { Day, GameState, Profile, WeekReport } from '../engine/types.ts'
import { isChallengeOver } from './defis.ts'
import { settingsStore } from './settings.ts'
import { newWeekOf, opensFullReport } from './weeklyReport.ts'

export const PAUSED = 0
/** A multiplier of 1 is, by definition, the pace pacing.json calls normal. */
export const NORMAL_SPEED = 1

/**
 * The panels: « Gérer le camion », « Vos finances » and the Défi's, which
 * the top bar opens, the event card, which opens on its own when an event
 * comes up, the « Bilan de la semaine », which opens on its own on a Monday
 * morning or from the card that slides in, and the end of a Défi, which
 * opens on its own once the Défi is over and never closes.
 */
export type Panel =
  'manage' | 'finances' | 'defi' | 'event' | 'report' | 'defiEnd'

/** How the store shows the « Bilan de la semaine ». */
export interface WeeklyReportOptions {
  /** Whether the player wants the full report every week. */
  readonly everyWeek: () => boolean
}

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
  /**
   * Whether the full « Bilan de la semaine » waits for the panel open when
   * its Monday came to close, before any event card.
   */
  reportWaiting: boolean
  /**
   * The Monday of the week the card sliding in shows, `lastWeek`'s; null
   * when none shows. It hides while a panel is open.
   */
  slideIn: Day | null
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
   *
   * With the weekly report on, it also stops on the Monday morning a new
   * `lastWeek` comes. The full report opens in the event card's place, the
   * card following when it closes: for the first weeks of a game, when the
   * player wants it every week, and on a morning that brings an event,
   * which pauses the game anyway. Otherwise the card slides in (`slideIn`)
   * and the game goes on. Does nothing while the full report is open or
   * waits for a panel to close, since the next Monday would replace the
   * week it shows.
   *
   * In a Défi, it stops on the morning after the day that ends it, the
   * engine playing no day past that, and opens the end of the Défi in
   * place of that morning's report, pausing the game for good; with a
   * panel already open, it opens when that panel closes. Once the Défi is
   * over it does nothing.
   */
  advance: (days: number) => void
  /**
   * Opens `panel`: remembers the speed, even `PAUSED`, and pauses. Does
   * nothing if a panel is already open, so that panel and the speed it
   * remembered stay. The event card and the end of a Défi only open on
   * their own. The report takes the card sliding in away.
   */
  openPanel: (panel: Exclude<Panel, 'event' | 'defiEnd'>) => void
  /**
   * Closes the panel and resumes at the speed it remembered. Once the Défi
   * is over, its end opens, or stays, in place, and the game stays paused.
   * Otherwise the full report waiting opens first, then, while an event
   * waits for the player's choice, the event card, which stays open; the
   * game stays paused.
   */
  closePanel: () => void
  /** Takes the card sliding in away. */
  dismissSlideIn: () => void
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
   * event card if an event waits for the player's choice, and on the end of
   * the Défi if it is a Défi over.
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
 * The Défi `defiId` for `profile`'s business name and avatar, on the seed
 * `search` names, or on a random one, as `newGame` picks it. Throws a
 * RangeError if no Défi has the id, or if the engine rejects `profile`.
 */
export function newChallenge(
  search: string,
  defiId: string,
  profile: Profile = defaultProfile(),
): GameState {
  // Checked first, so the RangeError of a seed the engine rejects is the
  // only one that falls back to a random seed.
  defiById(DEFIS, defiId)
  const start = (seed: number) =>
    startChallenge(defiId, seed, FOOD_TRUCK, DEFIS, DIFFICULTIES, profile)
  const seed = seedFromSearch(search)
  if (seed !== null) {
    try {
      return start(seed)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  }
  return start(randomSeed())
}

/**
 * The panel a game opens on: the end of its Défi if it is a Défi over, the
 * event card if an event waits for the player's choice; null otherwise.
 */
function openingPanel(game: GameState): 'defiEnd' | 'event' | null {
  if (isChallengeOver(game)) return 'defiEnd'
  return game.events.pending !== null ? 'event' : null
}

/**
 * The store's state for playing `game` from its start, at normal speed: on
 * the end of the Défi or the event card, paused, if it opens on one (see
 * `openingPanel`). The weekly report of a game loaded on a Monday does not
 * show again.
 */
function playing(game: GameState) {
  const panel = openingPanel(game)
  const waiting = panel !== null
  return {
    game,
    speed: waiting ? PAUSED : NORMAL_SPEED,
    lastSpeed: NORMAL_SPEED,
    resumeSpeed: waiting ? NORMAL_SPEED : null,
    panel,
    eventBefore: null,
    reportWaiting: false,
    slideIn: null,
  }
}

/**
 * A store playing `game`, whose days draw the event cards from `events`
 * and whose choices play them out. With `weeklyReport`, it shows the
 * « Bilan de la semaine » on each Monday morning (see `advance`); without,
 * as for tests of other parts, the days run on.
 */
export function createGameStore(
  game: GameState = createInitialState(randomSeed()),
  events: EventContent = EVENTS,
  weeklyReport: WeeklyReportOptions | null = null,
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
      const { game: start, speed, resumeSpeed, panel, reportWaiting } = get()
      if (
        days <= 0 ||
        isChallengeOver(start) ||
        start.events.pending !== null ||
        panel === 'event' ||
        panel === 'report' ||
        reportWaiting
      ) {
        return
      }
      let next = start
      let week: WeekReport | null = null
      for (
        let i = 0;
        i < days &&
        next.events.pending === null &&
        week === null &&
        !isChallengeOver(next);
        i += 1
      ) {
        const before = next
        next = tick(
          next,
          FOOD_TRUCK,
          CUSTOMERS,
          DIFFICULTIES,
          PERSONAL,
          ENERGY,
          events,
        )
        if (weeklyReport !== null) week = newWeekOf(before, next)
      }
      // The end of the Défi has the numbers, so it takes the place of the
      // week's report, or of its card sliding in, that morning.
      if (isChallengeOver(next)) {
        set(
          resumeSpeed === null
            ? {
                game: next,
                panel: 'defiEnd',
                resumeSpeed: speed,
                speed: PAUSED,
                slideIn: null,
              }
            : { game: next, slideIn: null },
        )
        return
      }
      const eventComes = next.events.pending !== null
      // The weekly report goes first on a morning that brings both: it
      // opens in the event card's place, and closePanel() opens the card.
      const opens =
        week !== null &&
        (eventComes ||
          opensFullReport(week, weeklyReport?.everyWeek() ?? false))
      if (opens) {
        set(
          resumeSpeed === null
            ? {
                game: next,
                panel: 'report',
                resumeSpeed: speed,
                speed: PAUSED,
                slideIn: null,
              }
            : { game: next, reportWaiting: true, slideIn: null },
        )
      } else if (week !== null) {
        set({ game: next, slideIn: week.firstDay })
      } else if (!eventComes || resumeSpeed !== null) {
        set({ game: next })
      } else {
        set({ game: next, panel: 'event', resumeSpeed: speed, speed: PAUSED })
      }
    },
    openPanel: (panel) => {
      const { speed, resumeSpeed, slideIn } = get()
      if (resumeSpeed !== null) return
      set({
        resumeSpeed: speed,
        speed: PAUSED,
        panel,
        slideIn: panel === 'report' ? null : slideIn,
      })
    },
    closePanel: () => {
      const { resumeSpeed, panel, game: current, reportWaiting } = get()
      if (resumeSpeed === null) return
      if (isChallengeOver(current)) {
        if (panel !== 'defiEnd') {
          set({ panel: 'defiEnd', reportWaiting: false, eventBefore: null })
        }
        return
      }
      if (reportWaiting) {
        set({ panel: 'report', reportWaiting: false })
        return
      }
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
    dismissSlideIn: () => {
      if (get().slideIn !== null) set({ slideIn: null })
    },
    decide: (change) => set({ game: applyDecision(get().game, change) }),
    startGame: (next) => set(playing(next)),
  }))
}

/**
 * The store the app runs on, with the weekly report as the player's
 * settings say. Until the start screen hands it the game to play, it holds
 * a new game with the default profile, seeded from the page address when
 * it has a `?seed=`, for the world to draw behind the menu. Tests build
 * their own with `createGameStore`.
 */
export const gameStore = createGameStore(
  newGame(typeof window === 'undefined' ? '' : window.location.search),
  EVENTS,
  { everyWeek: () => settingsStore.getState().openReportEveryWeek },
)

/**
 * Reads the app store. Select one field per call: a selector that builds a
 * new object re-renders on every change.
 */
export function useGame<T>(selector: (state: GameStoreState) => T): T {
  return useStore(gameStore, selector)
}
