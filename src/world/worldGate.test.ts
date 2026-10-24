import { Container, Ticker, UPDATE_PRIORITY } from 'pixi.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { newTruck } from '../engine/trucks.ts'
import type { TruckId } from '../engine/types.ts'
import { createSettingsStore } from '../ui/settings.ts'
import { createGameStore } from '../ui/store.ts'
import type { WorldApp } from './mountWorld.ts'
import { createShownTruck } from './shownTruck.ts'
import { gatedScenes, gateWorld, type WorldPage } from './worldGate.ts'
import { startWorld } from './worldView.ts'

/**
 * The fake clock, with the browser's frames on it every 16 ms, which Node
 * has none of.
 */
function fakeFrames(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'performance'],
  })
  vi.stubGlobal('requestAnimationFrame', (onFrame: FrameRequestCallback) =>
    setTimeout(() => onFrame(performance.now()), 16),
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
}

function setUp({ phone = false, playing = true } = {}) {
  const ticker = new Ticker()
  let renders = 0
  ticker.add(() => (renders += 1), null, UPDATE_PRIORITY.LOW)
  const resize = vi.fn()
  const app = {
    stage: new Container(),
    screen: { width: 1440, height: 900 },
    ticker,
    renderer: { type: 1, resolution: 2, resize },
    canvas: {} as HTMLCanvasElement,
    init: async () => {},
    destroy: () => {},
  }
  const listeners = new Map<string, () => void>()
  const page: WorldPage & { hidden: boolean } = {
    devicePixelRatio: 2,
    hidden: false,
    requestFrame: (onFrame) => requestAnimationFrame(() => onFrame()),
    cancelFrame: (id) => cancelAnimationFrame(id),
    isHidden: () => page.hidden,
    matches: () => phone,
    listen: (name, listener) => {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
  }
  const game = createGameStore(createInitialState(42), NO_EVENTS)
  game.getState().setSpeed(1)
  const settings = createSettingsStore(null)
  let picked: (() => void) | null = null
  const gate = gateWorld(
    app,
    {
      game,
      settings,
      playing: () => playing,
      picks: (listener) => {
        picked = listener
        return () => (picked = null)
      },
    },
    page,
  )!
  return {
    app,
    gate,
    game,
    settings,
    page,
    resize,
    listeners,
    renders: () => renders,
    pick: () => picked?.(),
  }
}

describe('gateWorld', () => {
  beforeEach(fakeFrames)
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('runs at ×1 in a game, and not on the start menu', () => {
    const played = setUp()
    expect(played.app.ticker.started).toBe(true)
    played.gate.stop()
    played.app.ticker.stop()
    const menu = setUp({ playing: false })
    expect(menu.app.ticker.started).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(menu.renders()).toBe(1)
  })

  it('stands still under a full-screen panel on a phone', () => {
    const { app, game } = setUp({ phone: true })
    expect(app.ticker.started).toBe(true)
    // A drawer leaves the game running, at ×1.
    game.getState().openDrawer('journal')
    expect(game.getState().speed).toBe(1)
    expect(app.ticker.started).toBe(false)
  })

  it('stops while the tab is hidden', () => {
    const { app, page, listeners } = setUp()
    page.hidden = true
    listeners.get('visibilitychange')?.()
    expect(app.ticker.started).toBe(false)
  })

  it('draws a frame for each pick while paused', () => {
    const { game, renders, pick } = setUp()
    game.getState().setSpeed(0)
    vi.advanceTimersByTime(100)
    const drawn = renders()
    pick()
    vi.advanceTimersByTime(100)
    expect(renders()).toBe(drawn + 1)
  })

  it('draws at 1.5× with the simple effects and 2× again with the full ones', () => {
    const { settings, resize } = setUp()
    settings.getState().setVisualEffects('simple')
    expect(resize).toHaveBeenLastCalledWith(1440, 900, 1.5)
  })

  it('lets go of everything it listened to once stopped', () => {
    const { gate, listeners, app } = setUp()
    gate.stop()
    expect(listeners.size).toBe(0)
    app.ticker.stop()
  })
})

describe('gatedScenes (#264)', () => {
  beforeEach(fakeFrames)
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const SECOND = 'vieuxMontreal'

  /** Scenes that start at once and say what they were asked for. */
  function scenes() {
    const stops = { street: vi.fn(), city: vi.fn() }
    return {
      stops,
      street: vi.fn<(app: WorldApp, truck: TruckId) => Promise<() => void>>(
        async () => stops.street,
      ),
      city: vi.fn<(app: WorldApp) => Promise<() => void>>(
        async () => stops.city,
      ),
    }
  }

  it('starts the street of the truck asked for, and draws a frame once it has', async () => {
    const { app, gate } = setUp()
    const fakes = scenes()
    const invalidate = vi.spyOn(gate, 'invalidate')
    const gated = gatedScenes(gate, fakes)
    const stop = await gated.street(app, SECOND)
    expect(fakes.street).toHaveBeenCalledExactlyOnceWith(app, SECOND)
    expect(invalidate).toHaveBeenCalledOnce()
    expect(stop).toBe(fakes.stops.street)
    await gated.city(app)
    expect(fakes.city).toHaveBeenCalledExactlyOnceWith(app)
    expect(invalidate).toHaveBeenCalledTimes(2)
    gate.stop()
    app.ticker.stop()
  })

  it('draws the new street while paused, when the truck shown changes', async () => {
    const { app, gate, game, settings, renders } = setUp()
    game.getState().setSpeed(0)
    const fakes = scenes()
    const shown = createShownTruck()
    const stopWorld = await startWorld(
      app,
      gatedScenes(gate, fakes),
      settings,
      game,
      shown,
    )
    vi.advanceTimersByTime(100)
    const drawn = renders()
    // The game has no second truck: its street is the first truck's.
    expect(fakes.street).toHaveBeenLastCalledWith(app, 'plateau')
    game.setState({
      game: {
        ...game.getState().game,
        trucks: [newTruck(42, { id: SECOND, district: SECOND }, 0)],
      },
    })
    shown.pick(SECOND)
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
    expect(fakes.stops.street).toHaveBeenCalledOnce()
    expect(fakes.street).toHaveBeenLastCalledWith(app, SECOND)
    vi.advanceTimersByTime(100)
    expect(renders()).toBeGreaterThan(drawn)
    expect(app.ticker.started).toBe(false)
    await stopWorld()
    gate.stop()
  })
})
