import { Container, Texture, type Text, type Ticker } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { createGameStore, type GameStore } from '../ui/store.ts'
import { ASSETS } from './manifest.ts'
import { startStreet, type StreetLoaders } from './street.ts'

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
