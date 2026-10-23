import type { SettingsStore, VisualEffects } from '../ui/settings.ts'
import type { GameStore } from '../ui/store.ts'
import { CROWD } from './crowdSettings.ts'
import {
  startFrameGate,
  type FrameGate,
  type GateHost,
  type GateTicker,
} from './frameGate.ts'
import { worldResolution, type WorldApp } from './mountWorld.ts'
import type { Scenes } from './worldView.ts'

// The frame gate (frameGate.ts) wired to the page: the game and the
// settings, the window's size and visibility, the phone's full-screen
// panels, the player's picks and whether a game is played.

/** The speeds whose customers walk on the street: ×1 and ×3. */
const WALKING_SPEEDS = Object.keys(CROWD.speeds).map(Number)

/** Where a panel or a drawer takes the whole screen (DockFrame.css). */
const PHONE = '(max-width: 699px)'

/** The browser around the world, injectable so tests can fake it. */
export interface WorldPage extends GateHost {
  readonly devicePixelRatio: number
  isHidden: () => boolean
  /** Whether `query` matches now. */
  matches: (query: string) => boolean
  /** Calls `listener` on each event of `name` on the window or document. */
  listen: (
    name: 'resize' | 'visibilitychange' | 'phone',
    listener: () => void,
  ) => () => void
}

/** The page of the browser, read only when called. */
export const BROWSER_PAGE: WorldPage = {
  get devicePixelRatio() {
    return window.devicePixelRatio
  },
  requestFrame: (onFrame) => window.requestAnimationFrame(onFrame),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
  isHidden: () => document.hidden,
  matches: (query) => window.matchMedia?.(query).matches ?? false,
  listen: (name, listener) => {
    if (name === 'visibilitychange') {
      document.addEventListener(name, listener)
      return () => document.removeEventListener(name, listener)
    }
    if (name === 'phone') {
      const list = window.matchMedia?.(PHONE)
      list?.addEventListener('change', listener)
      return () => list?.removeEventListener('change', listener)
    }
    window.addEventListener(name, listener)
    return () => window.removeEventListener(name, listener)
  },
}

/** Whether `ticker` has what the gate drives: Pixi's has, a test's may not. */
function gateable(ticker: WorldApp['ticker']): GateTicker | null {
  const { start, stop, update } = ticker as Partial<GateTicker>
  return typeof start === 'function' &&
    typeof stop === 'function' &&
    typeof update === 'function'
    ? (ticker as unknown as GateTicker)
    : null
}

/** What the world's gate listens to. */
export interface WorldSignals {
  readonly game: GameStore
  readonly settings: Pick<SettingsStore, 'getState' | 'subscribe'>
  /** Whether a game is played: false on the start menu. */
  readonly playing: () => boolean
  /**
   * Calls `listener` each time the player picks or points on the street, or
   * points at a building of the city.
   */
  readonly picks: (listener: () => void) => () => void
}

/**
 * Gates `app`'s frames (see `startFrameGate`) by the game's speed and
 * whether it is played, the view, the page's visibility and a full-screen
 * panel on a phone, at the player's « Fluidité ». Draws a frame on each
 * change of the game or the settings, on a resize and on each pick. Sets
 * the canvas's resolution when the visual effects change (see
 * `worldResolution`), and lets Pixi's pointer events go, which the world
 * does not use. Returns the gate, whose `stop` also stops listening;
 * null for an app whose ticker cannot be gated.
 */
export function gateWorld(
  app: WorldApp,
  signals: WorldSignals,
  page: WorldPage = BROWSER_PAGE,
): FrameGate | null {
  const ticker = gateable(app.ticker)
  if (ticker === null) return null
  // The world takes the player's presses from the page (see
  // `listenForPicks`), never through Pixi's events, whose ticker asks the
  // browser for every frame to follow the pointer: they are let go.
  const events = (
    app.renderer as { events?: { setTargetElement?: (el: null) => void } }
  )?.events
  events?.setTargetElement?.(null)
  const { game, settings } = signals
  const gate = startFrameGate(
    ticker,
    () => {
      const { speed, panel, drawer } = game.getState()
      return {
        hidden: page.isHidden(),
        playing: signals.playing(),
        covered: page.matches(PHONE) && (panel !== null || drawer !== null),
        speed,
        view: settings.getState().worldView,
      }
    },
    () => settings.getState().frameRate,
    WALKING_SPEEDS,
    page,
  )
  const { invalidate } = gate
  const resolve = (effects: VisualEffects) => {
    const renderer = app.renderer as
      | (WorldApp['renderer'] & {
          resize?: (width: number, height: number, resolution: number) => void
        })
      | undefined
    const resolution = worldResolution(page.devicePixelRatio, effects)
    if (renderer?.resize === undefined || renderer.resolution === resolution) {
      return
    }
    renderer.resize(app.screen.width, app.screen.height, resolution)
  }
  const stops = [
    game.subscribe(invalidate),
    settings.subscribe((state, previous) => {
      if (state.visualEffects !== previous.visualEffects) {
        resolve(state.visualEffects)
      }
      invalidate()
    }),
    signals.picks(invalidate),
    page.listen('resize', invalidate),
    page.listen('visibilitychange', invalidate),
    page.listen('phone', invalidate),
  ]
  return {
    ...gate,
    stop: () => {
      for (const stop of stops) stop()
      gate.stop()
    },
  }
}

/**
 * `scenes`, each drawing a frame through `gate` as soon as it has started,
 * so a scene that starts while nothing moves, as after its art loaded or
 * when « Ville » opens paused, shows at once.
 */
export function gatedScenes(gate: FrameGate | null, scenes: Scenes): Scenes {
  if (gate === null) return scenes
  const shown =
    (start: Scenes['street']): Scenes['street'] =>
    async (app) => {
      const stop = await start(app)
      gate.invalidate()
      return stop
    }
  return { street: shown(scenes.street), city: shown(scenes.city) }
}
