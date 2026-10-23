import type { WorldView } from '../ui/settings.ts'

// When the world draws (#281). Pixi's ticker redraws every layer each frame
// at the screen's refresh rate, which keeps the computer's fan spinning even
// on the start menu or paused. The gate runs the ticker only while
// something moves on the screen, at most at the player's « Fluidité », and
// otherwise stops it and draws one frame each time something changes.

/** What decides whether the world moves. */
export interface FrameState {
  /** Whether the page is hidden, as in a background tab. */
  readonly hidden: boolean
  /** Whether a game is played: false on the start menu. */
  readonly playing: boolean
  /** Whether a panel or a drawer covers the whole screen, as on a phone. */
  readonly covered: boolean
  /** The game's speed: 0 paused. */
  readonly speed: number
  /** The street or the city. */
  readonly view: WorldView
}

/**
 * Whether the world moves and needs frames: a game shown, on a page that
 * shows, not under a full-screen panel; on the street, at a speed whose
 * customers walk (`walkingSpeeds`, ×1 and ×3: paused they freeze, and at
 * ×10 the street is empty, its tally changing only with the game), in the
 * city at any speed but paused.
 */
export function animating(
  state: FrameState,
  walkingSpeeds: readonly number[],
): boolean {
  if (state.hidden || !state.playing || state.covered) return false
  if (state.view === 'city') return state.speed > 0
  return walkingSpeeds.includes(state.speed)
}

/** The part of Pixi's ticker the gate drives. */
export interface GateTicker {
  maxFPS: number
  readonly started: boolean
  /** The time of the last frame, in ms; -1 before the first. */
  readonly lastTime: number
  start: () => void
  stop: () => void
  update: (currentTime?: number) => void
}

/** Where the gate asks for the browser's next frame: `window`, or a test's. */
export interface GateHost {
  requestFrame: (onFrame: () => void) => number
  cancelFrame: (id: number) => void
}

export interface FrameGate {
  /**
   * Something may have changed: the game, the settings, the screen, a pick,
   * the scene. Runs the ticker if the world moves, at `frameRate()`;
   * otherwise stops it and, on the browser's next frame, draws one: a whole
   * ticker frame, so the scene first takes in what changed, as a frame would
   * (the walkers cleared at ×10, the tally hidden on pause, the screen
   * refitted), then renders. Many changes before that frame draw it once.
   */
  invalidate: () => void
  /** Whether the ticker runs now. */
  running: () => boolean
  /** Stops listening and leaves the ticker running, as Pixi had it. */
  stop: () => void
}

/**
 * Starts gating `ticker` by `read()` (see `animating`), at most at
 * `frameRate()` frames a second, and gates it once at once.
 */
export function startFrameGate(
  ticker: GateTicker,
  read: () => FrameState,
  frameRate: () => number,
  walkingSpeeds: readonly number[],
  host: GateHost,
): FrameGate {
  let pending: number | null = null
  let stopped = false

  // One frame of the stopped ticker: every listener, the scene's and Pixi's
  // render, 1 ms after the last, so nothing that moves with time moves, and
  // with no frame rate cap to skip it.
  const drawOnce = () => {
    pending = null
    if (stopped || ticker.started) return
    const cap = ticker.maxFPS
    ticker.maxFPS = 0
    ticker.update(ticker.lastTime + 1)
    ticker.maxFPS = cap
  }

  const invalidate = () => {
    if (stopped) return
    ticker.maxFPS = frameRate()
    if (animating(read(), walkingSpeeds)) {
      if (pending !== null) host.cancelFrame(pending)
      pending = null
      ticker.start()
      return
    }
    ticker.stop()
    pending ??= host.requestFrame(drawOnce)
  }

  invalidate()
  return {
    invalidate,
    running: () => ticker.started,
    stop: () => {
      if (stopped) return
      stopped = true
      if (pending !== null) host.cancelFrame(pending)
      pending = null
      ticker.start()
    },
  }
}
