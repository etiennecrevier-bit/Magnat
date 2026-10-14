import { Container, Texture, type Text, type Ticker } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { next, seedRng } from '../engine/rng.ts'
import { createGameStore, type GameStore } from '../ui/store.ts'
import { CROWD, type CrowdSettings } from './crowdSettings.ts'
import { ASSETS } from './manifest.ts'
import { replayOf } from './replay.ts'
import { startStreet, type StreetCrowd, type StreetLoaders } from './street.ts'

/** A Pixi app with a real stage, a screen the test resizes and a ticker it runs. */
function createFakeApp(width = 1440, height = 900) {
  const frames = new Set<(ticker: Ticker) => void>()
  return {
    stage: new Container(),
    screen: { width, height },
    ticker: {
      add: vi.fn((onFrame: (ticker: Ticker) => void) => frames.add(onFrame)),
      remove: vi.fn((onFrame: (ticker: Ticker) => void) =>
        frames.delete(onFrame),
      ),
    },
    frames,
    /** Runs one frame, `deltaMS` after the last. */
    frame(deltaMS = 16) {
      for (const onFrame of frames) onFrame({ deltaMS } as Ticker)
    },
  }
}

function createLoaders(): StreetLoaders & {
  loadFont: ReturnType<typeof vi.fn>
} {
  return {
    loadFont: vi.fn(async () => undefined),
    loadTexture: vi.fn(async () => Texture.EMPTY),
    measureWidth: () => 100,
  }
}

/** A new game on day 0, a Monday, when the truck is closed. */
function mondayStore(): GameStore {
  return createGameStore(createInitialState(42))
}

function piece(app: ReturnType<typeof createFakeApp>, id: string): Container {
  const found = app.stage.getChildByLabel(id, true)
  if (found === null) throw new Error(`No piece ${id}`)
  return found
}

describe('startStreet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads Fredoka SemiBold under its own name, not the file name', async () => {
    const loaders = createLoaders()
    await startStreet(createFakeApp(), mondayStore(), loaders)
    expect(loaders.loadFont).toHaveBeenCalledExactlyOnceWith({
      alias: 'title-font',
      src: expect.stringMatching(/fredoka-latin-600-normal\.woff2$/),
      parser: 'web-font',
      data: { family: 'Fredoka', weights: ['600'] },
    })
  })

  it('draws the game on the stage, fitted to the screen', async () => {
    const app = createFakeApp(1280, 800)
    await startStreet(app, mondayStore(), createLoaders())

    const [root] = app.stage.children
    expect(app.stage.children).toHaveLength(1)
    expect(root?.label).toBe('street')
    expect(root?.scale.x).toBeCloseTo(1280 / 1440)
    expect(root?.scale.y).toBeCloseTo(1280 / 1440)
    expect(root?.position).toMatchObject({ x: 0, y: 0 })
    expect(piece(app, 'closed-sign').visible).toBe(true)
    expect(piece(app, 'awning').visible).toBe(false)
  })

  it('refits the scene on the frame after the screen changes size', async () => {
    const app = createFakeApp()
    await startStreet(app, mondayStore(), createLoaders())
    const root = app.stage.children[0]!

    app.screen.width = 1920
    app.frame()
    expect(root.scale.x).toBe(1)
    expect(root.position).toMatchObject({ x: 240, y: 0 })

    app.screen.height = 450
    app.frame()
    expect(root.scale.x).toBe(0.5)
    expect(root.position).toMatchObject({ x: 600, y: 0 })
  })

  it('opens the truck when the game moves on to Tuesday', async () => {
    const app = createFakeApp()
    const store = mondayStore()
    await startStreet(app, store, createLoaders())

    store.getState().advance(1)

    expect(piece(app, 'awning').visible).toBe(true)
    expect(piece(app, 'steam').visible).toBe(true)
    expect(piece(app, 'closed-sign').visible).toBe(false)
    expect(piece(app, 'croissants').children[0]?.visible).toBe(true)
  })

  it('writes the name of the game the start screen starts on the sign', async () => {
    const app = createFakeApp()
    const store = mondayStore()
    await startStreet(app, store, createLoaders())
    const name = () =>
      (piece(app, 'truck-sign').getChildByLabel('name') as Text).text
    expect(name()).toBe("Le P'tit Camion")

    store.getState().startGame(
      createInitialState(42, FOOD_TRUCK, {
        businessName: 'Chez Mimi',
        avatar: 'femme',
        difficulty: 'difficile',
      }),
    )

    expect(name()).toBe('Chez Mimi')
  })

  it('moves the steam on each frame', async () => {
    const app = createFakeApp()
    await startStreet(app, mondayStore(), createLoaders())
    const steam = piece(app, 'steam').children[0]!

    app.frame(ASSETS.steamPuff.periodMs / 2)
    expect(steam.y).toBeCloseTo(-ASSETS.steamPuff.rise / 2)
  })

  it('takes the street down once: no more game updates or frames', async () => {
    const app = createFakeApp()
    const store = mondayStore()
    const unsubscribe = vi.fn()
    const subscribe = store.subscribe
    vi.spyOn(store, 'subscribe').mockImplementation((listener) => {
      unsubscribe.mockImplementation(subscribe(listener))
      return unsubscribe
    })
    const stop = await startStreet(app, store, createLoaders())
    const root = app.stage.children[0]!
    const onFrame = app.ticker.add.mock.calls[0]?.[0]

    stop()
    stop()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(app.ticker.remove).toHaveBeenCalledExactlyOnceWith(onFrame)
    expect(app.frames.size).toBe(0)
    expect(app.stage.children).toHaveLength(0)
    expect(root.destroyed).toBe(true)
    expect(() => store.getState().advance(1)).not.toThrow()
  })

  it('draws placeholders in the system font when the font and art fail to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = createFakeApp()
    const loaders = {
      ...createLoaders(),
      loadFont: vi.fn(async () => Promise.reject(new Error('font'))),
      loadTexture: vi.fn(async () => Promise.reject<Texture>(new Error('png'))),
    }
    const manifest = {
      ...ASSETS,
      pieces: ASSETS.pieces.map((p) =>
        p.id === 'truck' ? { ...p, image: 'dummy.png' } : p,
      ),
    }

    await startStreet(app, mondayStore(), loaders, manifest)

    expect(warn).toHaveBeenCalledTimes(2)
    expect(piece(app, 'truck').children[0]?.label).toBe('placeholder')
    expect(app.stage.children).toHaveLength(1)
  })
})

/** A `random` the test can replay: the engine's generator from `seed`. */
function seeded(seed: number): () => number {
  let state = seedRng(seed)
  return () => {
    const [value, after] = next(state)
    state = after
    return value
  }
}

/** The shipped crowd, keeping every visit so the street fills fast. */
function busyCrowd(seed = 7): StreetCrowd {
  const speeds: CrowdSettings['speeds'] = {
    1: { ...CROWD.speeds[1]!, keepChance: 1 },
    3: { ...CROWD.speeds[3]!, keepChance: 1 },
  }
  return { settings: { ...CROWD, speeds }, random: seeded(seed) }
}

/**
 * Day 2, a Wednesday: open, replaying Tuesday's visits. With `everyDay`,
 * the truck opens every day from Tuesday on, so each next day replays one.
 */
function wednesdayStore(everyDay = false): GameStore {
  const store = mondayStore()
  if (everyDay) {
    const { game } = store.getState()
    store.setState({
      game: applyDecision(game, {
        kind: 'daysOpen',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      }),
    })
  }
  store.getState().advance(2)
  return store
}

const CAP_AT_1 = CROWD.speeds[1]!.maxOnScreen
const CAP_AT_3 = CROWD.speeds[3]!.maxOnScreen

function customersLayer(app: ReturnType<typeof createFakeApp>): Container {
  return piece(app, 'customers')
}

/** The customers drawn on the street. */
function walkers(app: ReturnType<typeof createFakeApp>): Container[] {
  return customersLayer(app).children.filter((c) => c.label === 'customer')
}

/** Where each customer is drawn, and whether their bubble shows. */
function poses(app: ReturnType<typeof createFakeApp>) {
  return walkers(app).map((c) => ({
    x: c.x,
    y: c.y,
    facing: c.getChildByLabel('figure')?.scale.x,
    bubble: c.getChildByLabel('bubble')?.visible,
  }))
}

function arm(app: ReturnType<typeof createFakeApp>): Container {
  return piece(app, 'arm')
}

/**
 * Runs `ms` of frames of 16 ms, moving the game on a day every `dayMs`
 * (never, by default), and returns the most customers seen at once.
 */
function play(
  app: ReturnType<typeof createFakeApp>,
  store: GameStore,
  ms: number,
  dayMs = Number.POSITIVE_INFINITY,
  onFrame: () => void = () => {},
): number {
  let most = 0
  for (let t = 16; t <= ms; t += 16) {
    app.frame(16)
    onFrame()
    most = Math.max(most, walkers(app).length)
    if (t % dayMs < 16) store.getState().advance(1)
  }
  return most
}

describe('startStreet: the customers', () => {
  it('stands the avatar behind the counter on an open day', async () => {
    const app = createFakeApp()
    await startStreet(
      app,
      wednesdayStore(),
      createLoaders(),
      ASSETS,
      busyCrowd(),
    )
    const truck = piece(app, 'layer:truck')
    const avatar = piece(app, 'avatar:femme')
    expect(avatar.visible).toBe(true)
    expect(truck.getChildIndex(avatar)).toBe(
      truck.getChildIndex(piece(app, 'counter')) - 1,
    )
  })

  it('brings customers on at x1, up to the cap and never more, across days', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())

    const most = play(app, store, 30_000, 4000, () => {
      expect(walkers(app).length).toBeLessThanOrEqual(CAP_AT_1)
    })
    expect(most).toBe(CAP_AT_1)
  })

  it('shows customers arriving with the shipped settings', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, {
      settings: CROWD,
      random: seeded(3),
    })
    const most = play(app, store, 30_000, 4000, () => {
      expect(walkers(app).length).toBeLessThanOrEqual(CAP_AT_1)
    })
    expect(most).toBeGreaterThan(2)
  })

  it('freezes customers, bubbles and the serving arm while paused', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    // Stop on a frame where the arm is mid-reach and a bubble shows.
    let caught = false
    for (let t = 0; t < 60_000 && !caught; t += 16) {
      app.frame(16)
      if (t % 4000 < 16) store.getState().advance(1)
      caught =
        arm(app).rotation > 0 && poses(app).some((p) => p.bubble === true)
    }
    expect(caught).toBe(true)
    store.getState().setSpeed(0)
    const before = { poses: poses(app), arm: arm(app).rotation }
    const game = store.getState().game

    play(app, store, 10_000)

    expect(poses(app)).toEqual(before.poses)
    expect(arm(app).rotation).toBe(before.arm)
    expect(store.getState().game).toBe(game)
  })

  it('goes from x1 to x3 to pause to x10 and back to x1', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    play(app, store, 20_000, 4000)
    expect(walkers(app)).toHaveLength(CAP_AT_1)

    // x3: no one new comes until fewer than its cap are on screen.
    store.getState().setSpeed(3)
    let count = walkers(app).length
    play(app, store, 20_000, 4000 / 3, () => {
      const now = walkers(app).length
      if (count >= CAP_AT_3) expect(now).toBeLessThanOrEqual(count)
      else expect(now).toBeLessThanOrEqual(CAP_AT_3)
      count = now
    })
    expect(count).toBeLessThanOrEqual(CAP_AT_3)
    expect(count).toBeGreaterThan(0)

    // Pause: nothing moves.
    store.getState().setSpeed(0)
    const paused = poses(app)
    play(app, store, 5000)
    expect(poses(app)).toEqual(paused)

    // x10: no one walks; the tally counts the day replayed.
    store.getState().setSpeed(10)
    app.frame(16)
    expect(walkers(app)).toHaveLength(0)
    const tally = piece(app, 'tally')
    expect(tally.visible).toBe(true)
    const replay = replayOf(store.getState().game)!
    expect((tally.getChildByLabel('served') as Text).text).toBe(
      `${replay.served} clients servis`,
    )
    expect((tally.getChildByLabel('lost') as Text).text).toBe(
      `${replay.lost} clients perdus`,
    )
    expect(arm(app).rotation).toBe(0)

    // Back to x1: the tally goes and customers come again.
    store.getState().setSpeed(1)
    const most = play(app, store, 12_000, 4000)
    expect(tally.visible).toBe(false)
    expect(most).toBeGreaterThan(0)
  })

  it('updates the tally with each new day at x10', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    store.getState().setSpeed(10)
    store.getState().advance(1)
    app.frame(16)
    const served = (piece(app, 'tally').getChildByLabel('served') as Text).text
    expect(served).toBe(
      `${replayOf(store.getState().game)!.served} clients servis`,
    )
  })

  it('sends everyone away without buying when the truck closes', async () => {
    const app = createFakeApp()
    const store = wednesdayStore()
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    // Days 3 to 6, Wednesday to Sunday, all open.
    play(app, store, 18_000, 4000)
    expect(store.getState().game.day).toBe(6)
    expect(walkers(app).length).toBeGreaterThan(0)

    // On to day 7, a Monday, when the truck is closed.
    store.getState().advance(7 - store.getState().game.day)
    expect(piece(app, 'closed-sign').visible).toBe(true)
    expect(piece(app, 'avatar:femme').visible).toBe(false)
    expect(arm(app).rotation).toBe(0)

    // Those still waiting walk off with no bubble; no one new comes.
    const waiting = walkers(app).filter(
      (c) => c.getChildByLabel('bubble')?.visible === false,
    )
    expect(waiting.length).toBeGreaterThan(0)
    let most = walkers(app).length
    play(app, store, 30_000, Number.POSITIVE_INFINITY, () => {
      const now = walkers(app).length
      expect(now).toBeLessThanOrEqual(most)
      most = now
      for (const c of waiting) {
        if (!c.destroyed) {
          expect(c.getChildByLabel('bubble')?.visible).toBe(false)
        }
      }
      expect(arm(app).rotation).toBe(0)
    })
    expect(walkers(app)).toHaveLength(0)

    store.getState().setSpeed(10)
    app.frame(16)
    expect(piece(app, 'tally').visible).toBe(false)
  })

  it('shows no one on a closed day', async () => {
    const app = createFakeApp()
    const store = mondayStore()
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    expect(play(app, store, 10_000)).toBe(0)
    expect(piece(app, 'avatar:femme').visible).toBe(false)
  })

  it('takes the customers, the avatar and the tally down with the street', async () => {
    const app = createFakeApp()
    const store = wednesdayStore()
    const stop = await startStreet(
      app,
      store,
      createLoaders(),
      ASSETS,
      busyCrowd(),
    )
    play(app, store, 10_000, 4000)
    const layer = customersLayer(app)
    const avatar = piece(app, 'avatar:femme')

    stop()

    expect(app.stage.children).toHaveLength(0)
    expect(layer.destroyed).toBe(true)
    expect(avatar.destroyed).toBe(true)
    expect(app.frames.size).toBe(0)
  })
})
