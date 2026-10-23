import {
  BlendModePipe,
  Container,
  DOMAdapter,
  Graphics,
  RendererType,
  Sprite,
  Texture,
  TilingSprite,
  type Filter,
  type FilterInstruction,
  type InstructionSet,
  type Renderer,
  Text,
  Ticker,
  UPDATE_PRIORITY,
  type ViewContainer,
} from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { ENERGY, EVENTS, FOOD_TRUCK } from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { applyDecision } from '../engine/decisions.ts'
import { next, seedRng } from '../engine/rng.ts'
import type { DaySummary, StreetModifier, Visit } from '../engine/types.ts'
import { createSettingsStore } from '../ui/settings.ts'
import { createGameStore, type GameStore } from '../ui/store.ts'
import { todayNumbers } from '../ui/todayNumbers.ts'
import type {
  EventContent,
  SegmentId,
  StreetChange,
} from '../content/schema.ts'
import { ART_URLS } from './art.ts'
import { startCity } from './city.ts'
import {
  createCityPicker,
  worldPickChanges,
  type CityPicker,
} from './cityPicker.ts'
import { CROWD, type CrowdSettings } from './crowdSettings.ts'
import { placeCard, saying, type Box, type Point } from './customerCard.ts'
import { boxCorners } from './iso.ts'
import { fitCity } from './layout.ts'
import { ASSETS, LINES } from './manifest.ts'
import { SEGMENT_ACCESSORY } from './people.ts'
import { SPOT_HALF_RADIUS } from './noise.ts'
import { castGroupLabel, type ShadowFilters } from './shadows.ts'
import { createPicker, NO_MARKS, NOBODY_THERE, type Picker } from './picker.ts'
import { replayOf } from './replay.ts'
import { startStreet, type StreetCrowd, type StreetLoaders } from './street.ts'
import { spotAt, spotMark, spotsShown, type StreetLink } from './streetSpots.ts'
import { staffAtTruck, truckView } from './truckView.ts'
import { gatedScenes, gateWorld } from './worldGate.ts'
import { startWorld } from './worldView.ts'

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
  asked: ShadowFilters[]
} {
  // Pixi's filters need a canvas, which Node has none of: these only say
  // what they were asked for.
  const asked: ShadowFilters[] = []
  return {
    loadFont: vi.fn(async () => undefined),
    loadTexture: vi.fn(async () => Texture.EMPTY),
    measureWidth: () => 100,
    makeFilters: (wanted) => {
      asked.push(wanted)
      return [{ ...wanted, destroy: () => {} }] as unknown as Filter[]
    },
    asked,
  }
}

/**
 * A new game on day 0, a Monday, when the truck is closed, with no event
 * card to stop the days.
 */
function mondayStore(): GameStore {
  return createGameStore(createInitialState(42), NO_EVENTS)
}

/** Counts the listeners `store` holds that have not let go yet. */
function listeners<L>(store: {
  subscribe: (listener: L) => () => void
}): () => number {
  const subscribe = store.subscribe
  let count = 0
  store.subscribe = (listener) => {
    count += 1
    const off = subscribe(listener)
    return () => {
      count -= 1
      off()
    }
  }
  return () => count
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

    const [root, atmosphere, labels] = app.stage.children
    expect(app.stage.children.map((layer) => layer.label)).toEqual([
      'street',
      'atmosphere',
      'labels',
    ])
    expect(root?.scale.x).toBeCloseTo(1280 / 1440)
    expect(root?.scale.y).toBeCloseTo(1280 / 1440)
    expect(root?.position).toMatchObject({ x: 0, y: 0 })
    // The tally goes over the atmosphere, where the street has it.
    expect(labels?.scale.x).toBe(root?.scale.x)
    expect(labels?.scale.y).toBe(root?.scale.y)
    expect(labels?.position).toMatchObject({ x: root?.x, y: root?.y })
    expect(labels?.getChildByLabel('tally')).not.toBeNull()
    expect(atmosphere?.position).toMatchObject({ x: 0, y: 0 })
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

  it("loads the street's SVG art at the manifest's resolution and draws it", async () => {
    const texture = new Texture()
    const loaders = {
      ...createLoaders(),
      loadTexture: vi.fn(async () => texture),
    }
    const app = createFakeApp()

    await startStreet(app, mondayStore(), loaders, ASSETS)

    expect(loaders.loadTexture).toHaveBeenCalledWith(
      ART_URLS.get('street/triplex-2.svg'),
      ASSETS.artResolution,
    )
    const triplex = piece(app, 'triplex-2').children[0] as Sprite
    expect(triplex.texture).toBe(texture)
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

    // The font, then each image once.
    const images = new Set(manifest.pieces.flatMap((p) => p.image ?? []))
    expect(warn).toHaveBeenCalledTimes(1 + images.size)
    expect(piece(app, 'truck').children[0]?.label).toBe('placeholder')
    expect(piece(app, 'triplex-2').children[0]?.label).toBe('placeholder')
    expect(app.stage.children).toHaveLength(3)
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

  it("hides the avatar's legs, outlines and all, behind the counter", async () => {
    const app = createFakeApp()
    await startStreet(
      app,
      wednesdayStore(),
      createLoaders(),
      ASSETS,
      busyCrowd(),
    )
    const counter = piece(app, 'counter')
    const { width, height } = ASSETS.pieces.find((p) => p.id === 'counter')!
    const left = counter.toGlobal({ x: 0, y: 0 })
    const bottom = counter.toGlobal({ x: width, y: height })
    const legs = piece(app, 'avatar:femme').getChildByLabel('legs')!
    const { minX, maxX, maxY } = legs.getBounds()
    expect(minX).toBeGreaterThanOrEqual(left.x)
    expect(maxX).toBeLessThanOrEqual(bottom.x)
    expect(maxY).toBeLessThanOrEqual(bottom.y)
    // The shirt comes down to the counter's top: no leg shows above it.
    const shirt = piece(app, 'avatar:femme').getChildByLabel('shirt', true)!
    expect(shirt.getBounds().maxY).toBeGreaterThanOrEqual(left.y)
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

  it('says nothing at x10 that contradicts « Hier » (#231)', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    store.getState().setSpeed(10)
    // Days on until one where visitors left without buying while no unit
    // ran out, as on #231's day: « 29 clients perdus », « Ventes perdues 0 ».
    const walkedOff = (day: DaySummary) =>
      day.visits.filter(
        ({ outcome }) => outcome !== 'bought' && outcome !== 'browsed',
      ).length
    for (let day = 0; day < 30; day += 1) {
      const { lastDay } = store.getState().game
      if (
        lastDay !== null &&
        walkedOff(lastDay) !== todayNumbers(lastDay).lostSales
      )
        break
      store.getState().advance(1)
    }
    app.frame(16)
    const { lastDay } = store.getState().game
    const numbers = todayNumbers(lastDay!)
    expect(walkedOff(lastDay!)).not.toBe(numbers.lostSales)

    // Every count the street shows by « Hier » is the one « Hier » shows.
    const tally = piece(app, 'tally')
    const shown = tally.visible
      ? tally.children
          .filter((c): c is Text => c instanceof Text && c.visible)
          .map(({ text }) => text)
      : []
    for (const text of shown.filter((t) => /perdu/.test(t))) {
      expect(text).toMatch(new RegExp(`^${numbers.lostSales}\\D`))
    }
    for (const text of shown.filter((t) => /servi/.test(t))) {
      expect(text).toMatch(new RegExp(`^${numbers.customersServed}\\D`))
    }
  })

  it('takes the x10 tally down when the game pauses (#231)', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    store.getState().setSpeed(10)
    play(app, store, 1000)
    const tally = piece(app, 'tally')
    expect(tally.visible).toBe(true)

    // Paused, the badge goes with the speed that showed it.
    store.getState().setSpeed(0)
    play(app, store, 1000)
    expect(tally.visible).toBe(false)
  })

  it.each([
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [1280, 720],
  ])(
    'shows the x10 tally whole, clear of the panels and the band, at %i × %i',
    async (width, height) => {
      const app = createFakeApp(width, height)
      const store = wednesdayStore()
      await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
      store.getState().setSpeed(10)
      app.frame(16)

      // A long screen such as « États financiers » runs the panels' card
      // down the whole window, 42rem wide and 1rem in from the left, and
      // La Presse-Citron's band is at least 2.75rem tall along the bottom
      // (WorldCanvas.css, Ticker.css): the tally must show beside them, or
      // « 49 clients servis » reads « 9 clients servis » (#131).
      const tally = piece(app, 'tally')
      expect(tally.visible).toBe(true)
      // The badge's card, which holds its numbers: Node has no canvas to
      // measure the text with.
      const card = tally.children.find((c) => c instanceof Graphics)!
      const { minX, minY, maxX, maxY } = card.getBounds()
      expect(minX).toBeGreaterThanOrEqual(16 + 42 * 16)
      expect(maxX).toBeLessThanOrEqual(width)
      expect(minY).toBeGreaterThanOrEqual(0)
      expect(maxY).toBeLessThanOrEqual(height - 2.75 * 16)
    },
  )

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

  it('hides the tally when a closed day begins at x10 and the game pauses', async () => {
    const app = createFakeApp()
    const store = wednesdayStore()
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    // Day 6, a Sunday, at x10: the tally counts Saturday's visits.
    store.getState().setSpeed(10)
    store.getState().advance(6 - store.getState().game.day)
    app.frame(16)
    const tally = piece(app, 'tally')
    expect(tally.visible).toBe(true)

    // Day 7, a Monday, when the truck is closed, begins; the game pauses
    // before the street draws another frame.
    store.getState().advance(1)
    store.getState().setSpeed(0)
    play(app, store, 1000)

    expect(piece(app, 'closed-sign').visible).toBe(true)
    expect(tally.visible).toBe(false)
  })

  it('shows no one on a closed day', async () => {
    const app = createFakeApp()
    const store = mondayStore()
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    expect(play(app, store, 10_000)).toBe(0)
    expect(piece(app, 'avatar:femme').visible).toBe(false)
  })

  it('takes down what it set up when its start fails halfway, as on an app no longer there', async () => {
    const app = createFakeApp()
    const added = vi.spyOn(app.stage, 'addChild')
    app.ticker.add.mockImplementation(() => {
      throw new Error('No ticker')
    })
    const store = wednesdayStore()
    const settings = createSettingsStore(null)
    const listening = { store: listeners(store), settings: listeners(settings) }
    const picker = createPicker()

    await expect(
      startStreet(
        app,
        store,
        createLoaders(),
        ASSETS,
        busyCrowd(),
        picker,
        settings,
      ),
    ).rejects.toThrow('No ticker')
    const layers = added.mock.calls[0] as Container[]
    expect(layers.map((layer) => layer.label)).toEqual([
      'street',
      'atmosphere',
      'labels',
    ])
    expect(layers.every((layer) => layer.destroyed)).toBe(true)
    expect(app.stage.children).toEqual([])
    expect(listening.store()).toBe(0)
    expect(listening.settings()).toBe(0)
    expect(picker.view().live).toBe(false)
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

/** The game in `store`, its owner waking up with `energy` this morning. */
function withEnergy(store: GameStore, energy: number): GameStore {
  store.setState({ game: { ...store.getState().game, energy } })
  return store
}

/**
 * `wednesdayStore(everyDay)` with the visits it replays changed by `change`,
 * as a day played by a worn-out owner would leave them.
 */
function visitsStore(
  change: (visit: Visit, index: number) => Visit,
  everyDay = true,
): GameStore {
  const store = wednesdayStore(everyDay)
  const { game } = store.getState()
  const lastDay = game.lastDay!
  store.setState({
    game: {
      ...game,
      lastDay: { ...lastDay, visits: lastDay.visits.map(change) },
    },
  })
  return store
}

/** A visit that ended `outcome`, with `botched` units thrown out. */
function ended(
  visit: Visit,
  outcome: Visit['outcome'],
  botched: number,
): Visit {
  const bought = {
    cafe: outcome === 'bought' ? 1 : 0,
    chocolat: 0,
    croissant: 0,
  }
  return { ...visit, outcome, bought, botched }
}

/** Plays frames of 16 ms, without moving the game on, until `found` holds. */
function frameUntil(
  app: ReturnType<typeof createFakeApp>,
  found: () => boolean,
  ms = 60_000,
): number {
  for (let t = 16; t <= ms; t += 16) {
    app.frame(16)
    if (found()) return t
  }
  throw new Error('Never found')
}

const { showMs, fadeMs } = CROWD.fatigue.spill
const SPILL_MS = showMs + fadeMs

describe("startStreet: the owner's fatigue", () => {
  it.each([
    { energy: 80, circles: false, slumped: false },
    { energy: 40, circles: false, slumped: false },
    { energy: 10, circles: true, slumped: true },
  ])(
    'shows an owner at $energy with circles $circles, slumped $slumped',
    async ({ energy, circles, slumped }) => {
      const app = createFakeApp()
      const store = withEnergy(wednesdayStore(true), energy)
      await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
      expect(piece(app, 'circles').visible).toBe(circles)
      expect(piece(app, 'upper').y > 0).toBe(slumped)
      expect(piece(app, 'face').rotation > 0).toBe(slumped)
      expect(piece(app, 'yawn').visible).toBe(false)
    },
  )

  it('follows the energy of each morning: rested again, the slump and circles go', async () => {
    const app = createFakeApp()
    const store = withEnergy(wednesdayStore(true), 10)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    frameUntil(app, () => piece(app, 'yawn').visible)

    withEnergy(store, 90)

    expect(piece(app, 'circles').visible).toBe(false)
    expect(piece(app, 'upper').y).toBe(0)
    expect(piece(app, 'face').rotation).toBe(0)
    expect(piece(app, 'yawn').visible).toBe(false)
    play(app, store, 20_000)
    expect(piece(app, 'yawn').visible).toBe(false)
  })

  it('yawns now and then when tired, never when rested', async () => {
    const tiredApp = createFakeApp()
    const tired = withEnergy(wednesdayStore(true), 40)
    await startStreet(tiredApp, tired, createLoaders(), ASSETS, busyCrowd())
    const { everyMs, jitterMs, lengthMs } = CROWD.fatigue.yawn
    const start = frameUntil(tiredApp, () => piece(tiredApp, 'yawn').visible)
    expect(start).toBeLessThanOrEqual(everyMs + jitterMs + 16)
    expect(piece(tiredApp, 'eyes').scale.y).toBeLessThan(1)
    const stop = frameUntil(tiredApp, () => !piece(tiredApp, 'yawn').visible)
    expect(stop).toBeCloseTo(lengthMs, -2)
    expect(piece(tiredApp, 'eyes').scale.y).toBe(1)

    const restedApp = createFakeApp()
    const rested = withEnergy(wednesdayStore(true), 80)
    await startStreet(restedApp, rested, createLoaders(), ASSETS, busyCrowd())
    play(restedApp, rested, 20_000, Number.POSITIVE_INFINITY, () => {
      expect(piece(restedApp, 'yawn').visible).toBe(false)
    })
  })

  it.each([
    { energy: 80, reach: CROWD.reachMs },
    { energy: 40, reach: CROWD.reachMs * CROWD.fatigue.reachMultiplier.tired },
    {
      energy: 10,
      reach: CROWD.reachMs * CROWD.fatigue.reachMultiplier.exhausted,
    },
  ])(
    'reaches across the counter in $reach ms at energy $energy',
    async ({ energy, reach }) => {
      const app = createFakeApp()
      const store = withEnergy(wednesdayStore(true), energy)
      await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
      frameUntil(app, () => arm(app).rotation > 0)
      // Each customer stays at the counter longer than any reach, so no new
      // reach starts before this one ends.
      let held = 16
      while (arm(app).rotation > 0) {
        app.frame(16)
        held += 16
      }
      expect(held).toBeGreaterThanOrEqual(reach)
      expect(held).toBeLessThan(reach + 32)
    },
  )

  it('freezes a yawn while paused, and keeps yawning at ×10 where no one walks', async () => {
    const app = createFakeApp()
    const store = withEnergy(wednesdayStore(true), 10)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    frameUntil(app, () => piece(app, 'yawn').visible)

    store.getState().setSpeed(0)
    play(app, store, 10_000, Number.POSITIVE_INFINITY, () => {
      expect(piece(app, 'yawn').visible).toBe(true)
    })

    store.getState().setSpeed(10)
    frameUntil(app, () => !piece(app, 'yawn').visible)
    frameUntil(app, () => piece(app, 'yawn').visible)
    expect(walkers(app)).toHaveLength(0)
    expect(arm(app).rotation).toBe(0)
  })
})

describe('startStreet: the spill', () => {
  it('stays off the counter while no unit is botched', async () => {
    const app = createFakeApp()
    const store = visitsStore((visit) => ({ ...visit, botched: 0 }))
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    const spill = piece(app, 'spill')
    expect(spill.parent).toBe(piece(app, 'layer:truck'))
    play(app, store, 30_000, 4000, () => {
      expect(spill.visible).toBe(false)
    })
  })

  it('spills on the day after an exhausted owner botched units', async () => {
    const store = mondayStore()
    store.setState({
      game: applyDecision(store.getState().game, {
        kind: 'daysOpen',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      }),
    })
    store.getState().advance(1)
    // Tuesday, played by an owner who woke up exhausted.
    withEnergy(store, 10).getState().advance(1)
    const { lastDay } = store.getState().game
    expect(lastDay?.botched).toBeGreaterThan(0)

    // The owner stays exhausted from day to day, so each day replayed has
    // botched units, among the few customers who walk on.
    const app = createFakeApp()
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    playUntil(app, store, () => (piece(app, 'spill').visible ? true : null))
    expect(store.getState().game.energy).toBeLessThan(ENERGY.exhausted.below)
  })

  it.each([
    { outcome: 'bought', botched: 1, spills: true },
    { outcome: 'soldOut', botched: 1, spills: true },
    { outcome: 'soldOut', botched: 0, spills: false },
  ] as const)(
    'spills for a customer who ended $outcome with $botched botched: $spills',
    async ({ outcome, botched, spills }) => {
      const app = createFakeApp()
      const store = visitsStore((visit) => ended(visit, outcome, botched))
      await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
      const spill = piece(app, 'spill')
      let reached = false
      let shown = false
      for (let t = 0; t < 30_000; t += 16) {
        app.frame(16)
        reached ||= walkers(app).length > 0 && arm(app).rotation > 0
        shown ||= spill.visible
      }
      expect(shown).toBe(spills)
      // The avatar reaches for every unit made, a botched one included.
      expect(reached).toBe(spills)
    },
  )

  it('sits on the counter, in front of it, and fades out after its time', async () => {
    const app = createFakeApp()
    // Only the first customer had a unit botched.
    const store = visitsStore((visit, i) =>
      ended(visit, 'bought', i === 0 ? 1 : 0),
    )
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    const spill = piece(app, 'spill')
    const truck = piece(app, 'layer:truck')
    expect(truck.getChildIndex(spill)).toBeGreaterThan(
      truck.getChildIndex(piece(app, 'counter')),
    )

    frameUntil(app, () => spill.visible)
    expect(spill.alpha).toBe(1)
    let t = 16
    while (t < showMs) {
      app.frame(16)
      t += 16
      expect(spill.alpha).toBe(1)
    }
    while (spill.visible) {
      app.frame(16)
      t += 16
      expect(spill.alpha).toBeLessThanOrEqual(1)
    }
    expect(t).toBeGreaterThanOrEqual(SPILL_MS)
    expect(t).toBeLessThan(SPILL_MS + 32)
  })

  it('freezes while paused, clears on a closed day, and goes with the street', async () => {
    const app = createFakeApp()
    const store = visitsStore((visit) => ended(visit, 'bought', 1), false)
    const stop = await startStreet(
      app,
      store,
      createLoaders(),
      ASSETS,
      busyCrowd(),
    )
    const spill = piece(app, 'spill')

    // Paused mid-fade: it stays as it is.
    frameUntil(app, () => spill.visible && spill.alpha < 1)
    store.getState().setSpeed(0)
    const alpha = spill.alpha
    play(app, store, 10_000, Number.POSITIVE_INFINITY, () => {
      expect(spill.visible).toBe(true)
      expect(spill.alpha).toBe(alpha)
    })

    // On to day 7, a Monday, when the truck is closed: it goes at once.
    store.getState().setSpeed(1)
    store.getState().advance(7 - store.getState().game.day)
    expect(piece(app, 'closed-sign').visible).toBe(true)
    expect(spill.visible).toBe(false)
    play(app, store, 10_000, Number.POSITIVE_INFINITY, () => {
      expect(spill.visible).toBe(false)
    })

    stop()
    expect(spill.destroyed).toBe(true)
  })

  it('clears at ×10, where no one walks', async () => {
    const app = createFakeApp()
    const store = visitsStore((visit) => ended(visit, 'bought', 1))
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    const spill = piece(app, 'spill')
    frameUntil(app, () => spill.visible)

    store.getState().setSpeed(10)
    app.frame(16)
    expect(spill.visible).toBe(false)
    expect(walkers(app)).toHaveLength(0)
  })
})

/** Anything a customer could drink from. */
const DRINKS = ['cup', 'mug']

/** Whether `node` shows: it and every parent up to `root`. */
function showsIn(root: Container, node: Container): boolean {
  for (let at: Container | null = node; at !== root; at = at.parent) {
    if (at === null || !at.visible) return false
  }
  return true
}

/** Whether `walker` holds something to drink, in the drawing that shows. */
function holdsDrink(walker: Container): boolean {
  const figure = figureOf(walker)
  return DRINKS.some((label) =>
    figure
      .getChildrenByLabel(label, true)
      .some((node) => showsIn(figure, node)),
  )
}

/** Whether `walker` is leaving the counter, their mood bubble showing. */
function leavesCounter(walker: Container): boolean {
  return walker.getChildByLabel('bubble')?.visible === true
}

/** Starts the day `store` replays over, rather than playing the next one. */
function replayAgain(store: GameStore): void {
  const { game } = store.getState()
  store.setState({ game: { ...game, lastDay: { ...game.lastDay! } } })
}

/**
 * Plays 30 s of the day `store` replays, over again every 4 s, and checks
 * every customer on each frame: none holds a drink before reaching the
 * counter. Returns the segments of those who left the counter holding a
 * drink, and of those who left without one.
 */
function drinksAtCounter(
  app: ReturnType<typeof createFakeApp>,
  store: GameStore,
): { withDrink: Set<SegmentId>; without: Set<SegmentId> } {
  const reached = new Set<Container>()
  const left = {
    withDrink: new Set<SegmentId>(),
    without: new Set<SegmentId>(),
  }
  for (let t = 16; t <= 30_000; t += 16) {
    app.frame(16)
    for (const walker of walkers(app)) {
      if (walker.x === CROWD.counterX) reached.add(walker)
      if (!reached.has(walker) && holdsDrink(walker)) {
        expect.fail(`A ${segmentOf(walker)} holds a drink before the counter`)
      }
      if (!leavesCounter(walker)) continue
      const segment = segmentOf(walker)
      if (holdsDrink(walker)) left.withDrink.add(segment)
      else left.without.add(segment)
    }
    if (t % 4000 < 16) replayAgain(store)
  }
  return left
}

const SEGMENTS = Object.keys(SEGMENT_ACCESSORY) as SegmentId[]

describe('startStreet: what customers carry', () => {
  it.each(['cafe', 'chocolat'] as const)(
    'hands one who bought a %s a cup at the counter, never before',
    async (drink) => {
      const app = createFakeApp()
      const store = visitsStore((visit, i) => ({
        ...ended(visit, 'bought', 0),
        segment: SEGMENTS[i % SEGMENTS.length]!,
        bought: {
          cafe: drink === 'cafe' ? 1 : 0,
          chocolat: drink === 'chocolat' ? 1 : 0,
          croissant: 0,
        },
      }))
      await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())

      const left = drinksAtCounter(app, store)
      expect([...left.withDrink].sort()).toEqual([...SEGMENTS].sort())
      expect([...left.without]).toEqual([])
    },
  )

  it('sends one who bought no drink away empty-handed', async () => {
    const app = createFakeApp()
    // Every other customer bought a croissant; the rest, nothing.
    const store = visitsStore((visit, i) => ({
      ...ended(visit, i % 2 === 0 ? 'bought' : 'tooExpensive', 0),
      segment: SEGMENTS[i % SEGMENTS.length]!,
      bought: { cafe: 0, chocolat: 0, croissant: i % 2 === 0 ? 1 : 0 },
    }))
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())

    const left = drinksAtCounter(app, store)
    expect([...left.without].sort()).toEqual([...SEGMENTS].sort())
    expect([...left.withDrink]).toEqual([])
  })
})

/** Whether `walker` holds marketing's flyer, in the drawing that shows. */
function holdsFlyer(walker: Container): boolean {
  const figure = figureOf(walker)
  return figure
    .getChildrenByLabel('flyer', true)
    .some((node) => showsIn(figure, node))
}

/**
 * Plays 30 s of the day `store` replays, over again every 4 s, and counts
 * the customers seen with a flyer before the counter, and those leaving
 * it with one, or with a drink.
 */
function flyersAtCounter(
  app: ReturnType<typeof createFakeApp>,
  store: GameStore,
): { before: number; leaving: number; drinks: number } {
  const seen = { before: new Set<Container>(), leaving: 0, drinks: 0 }
  for (let t = 16; t <= 30_000; t += 16) {
    app.frame(16)
    for (const walker of walkers(app)) {
      if (!leavesCounter(walker)) {
        if (holdsFlyer(walker)) seen.before.add(walker)
        continue
      }
      if (holdsFlyer(walker)) seen.leaving += 1
      if (holdsDrink(walker)) seen.drinks += 1
    }
    if (t % 4000 < 16) replayAgain(store)
  }
  return {
    before: seen.before.size,
    leaving: seen.leaving,
    drinks: seen.drinks,
  }
}

describe('startStreet: marketing’s flyer (#284)', () => {
  it('has those marketing brought hold its flyer up to the counter, a drink or a croissant bought', async () => {
    const app = createFakeApp()
    const store = visitsStore((visit, i) => ({
      ...ended(visit, 'bought', 0),
      segment: SEGMENTS[i % SEGMENTS.length]!,
      bought: { cafe: i % 2, chocolat: 0, croissant: 1 - (i % 2) },
      fromMarketing: true,
    }))
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    const seen = flyersAtCounter(app, store)
    expect(seen.before).toBeGreaterThan(0)
    expect(seen.leaving).toBe(0)
    // The café buyers still take their cup.
    expect(seen.drinks).toBeGreaterThan(0)
  })

  it('draws no flyer for anyone else, and the same people either way', async () => {
    const plain = createFakeApp()
    const tagged = createFakeApp()
    const change = (marketing: boolean) => (visit: Visit, i: number) => ({
      ...ended(visit, 'bought', 0),
      segment: SEGMENTS[i % SEGMENTS.length]!,
      ...(marketing ? { fromMarketing: true as const } : {}),
    })
    const plainStore = visitsStore(change(false))
    const taggedStore = visitsStore(change(true))
    await startStreet(plain, plainStore, createLoaders(), ASSETS, busyCrowd())
    await startStreet(tagged, taggedStore, createLoaders(), ASSETS, busyCrowd())
    for (let t = 16; t <= 10_000; t += 16) {
      plain.frame(16)
      tagged.frame(16)
      expect(walkers(plain).some(holdsFlyer)).toBe(false)
      expect(poses(tagged)).toEqual(poses(plain))
      expect(walkers(tagged).map(segmentOf)).toEqual(
        walkers(plain).map(segmentOf),
      )
    }
    expect(walkers(tagged).length).toBeGreaterThan(0)
  })
})

/** Where `node` is drawn on the stage, whose pixels are the page's. */
function boxOf(node: Container): Box {
  const { minX, minY, maxX, maxY } = node.getBounds()
  return { left: minX, top: minY, right: maxX, bottom: maxY }
}

function centreOf(box: Box): Point {
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
}

function figureOf(walker: Container): Container {
  const figure = walker.getChildByLabel('figure')
  if (figure === null) throw new Error('No figure')
  return figure
}

/** The drawing the figure shows: the one for the way the customer faces. */
function shownOf(walker: Container): Container {
  const shown = figureOf(walker).children.filter((c) => c.visible)
  if (shown.length !== 1) throw new Error(`${shown.length} drawings shown`)
  return shown[0]!
}

/** The segment a customer's accessory shows. */
function segmentOf(walker: Container): SegmentId {
  const figure = shownOf(walker)
  const segments = Object.keys(SEGMENT_ACCESSORY) as SegmentId[]
  const found = segments.find(
    (segment) => figure.getChildByLabel(SEGMENT_ACCESSORY[segment]) !== null,
  )
  if (found === undefined) throw new Error('No accessory')
  return found
}

function isPicked(walker: Container): boolean {
  return walker.getChildByLabel('pickMark')?.visible === true
}

/**
 * A customer, and the centre of `partOf` them, where no one else is drawn
 * within the pick's margin: a press there can only mean them.
 */
function alone(
  app: ReturnType<typeof createFakeApp>,
  partOf: (walker: Container) => Container | null = figureOf,
): { walker: Container; point: Point } | null {
  const all = walkers(app)
  const m = CROWD.pickMargin
  for (const walker of all) {
    const part = partOf(walker)
    if (part === null) continue
    const point = centreOf(boxOf(part))
    const crowded = all.some((other) => {
      if (other === walker) return false
      const box = boxOf(figureOf(other))
      return (
        point.x >= box.left - m &&
        point.x <= box.right + m &&
        point.y >= box.top - m &&
        point.y <= box.bottom + m
      )
    })
    if (!crowded) return { walker, point }
  }
  return null
}

/** Plays frames, a day every 4 s, until `found` finds something. */
function playUntil<T>(
  app: ReturnType<typeof createFakeApp>,
  store: GameStore,
  found: () => T | null,
): T {
  for (let t = 16; t <= 120_000; t += 16) {
    app.frame(16)
    if (t % 4000 < 16) store.getState().advance(1)
    const result = found()
    if (result !== null) return result
  }
  throw new Error('Never found')
}

/** Every line of `segment`, whatever their visit's ending. */
function linesOf(segment: SegmentId): string[] {
  return Object.values(LINES.segments[segment].lines).flat()
}

async function pickingStreet(width = 1440, height = 900) {
  const app = createFakeApp(width, height)
  const store = wednesdayStore(true)
  const picker = createPicker()
  const stop = await startStreet(
    app,
    store,
    createLoaders(),
    ASSETS,
    busyCrowd(),
    picker,
  )
  return { app, store, picker, stop }
}

function openCard(picker: Picker) {
  const { open } = picker.view()
  if (open === null) throw new Error('No card open')
  return open
}

describe('startStreet: picking a customer', () => {
  it("opens the card of the customer pressed, with a line of their segment's", async () => {
    const { app, store, picker } = await pickingStreet()
    const { walker, point } = playUntil(app, store, () => alone(app))

    picker.at(point)

    const { card, place } = openCard(picker)
    const segment = segmentOf(walker)
    expect(card.segment).toBe(segment)
    expect(card.name).toBe(LINES.segments[segment].name)
    expect(linesOf(segment)).toContain(card.line)
    expect(picker.view().said).toBe(saying(card))
    expect(isPicked(walker)).toBe(true)
    expect(walkers(app).filter(isPicked)).toHaveLength(1)
    expect(place).toEqual(
      placeCard(boxOf(figureOf(walker)), app.screen, CROWD.card),
    )
  })

  it('closes the card on a press on the street beside everyone', async () => {
    const { app, store, picker } = await pickingStreet()
    const { walker, point } = playUntil(app, store, () => alone(app))
    picker.at(point)

    picker.at({ x: 5, y: 5 })

    expect(picker.view()).toEqual({
      live: true,
      open: null,
      said: '',
      marks: NO_MARKS,
    })
    expect(isPicked(walker)).toBe(false)
  })

  it('shows the same line each time the same customer is picked', async () => {
    const { app, store, picker } = await pickingStreet()
    const { point } = playUntil(app, store, () => alone(app))
    store.getState().setSpeed(0)

    picker.at(point)
    const first = openCard(picker).card
    picker.close()
    expect(picker.view().open).toBeNull()
    picker.at(point)

    expect(openCard(picker).card).toBe(first)
  })

  it("picks by a left-facing customer's bag or child after the window resizes", async () => {
    const { app, store, picker } = await pickingStreet()
    app.screen.width = 1000
    app.screen.height = 700
    app.frame()
    const { walker, point } = playUntil(app, store, () =>
      alone(app, (w) =>
        figureOf(w).scale.x === -1
          ? (shownOf(w).getChildByLabel('child') ??
            shownOf(w).getChildByLabel('bag'))
          : null,
      ),
    )
    // Facing left, the bag and the child are drawn left of their feet:
    // a box taken facing right would miss them.
    const feet = walker.getGlobalPosition()
    expect(point.x).toBeLessThan(feet.x)
    expect(app.stage.children[0]!.scale.x).toBeCloseTo(1000 / 1440)

    picker.at(point)

    expect(isPicked(walker)).toBe(true)
    expect(openCard(picker).card.segment).toBe(segmentOf(walker))
  })

  it('flips the card left of a customer at the right edge of a phone, inside the page', async () => {
    // On a phone the panels' card spans the page, and the customer card
    // shows over it (see WorldCanvas.test.tsx); here it must stay on the page
    // and clear of its customer.
    const { app, store, picker } = await pickingStreet(360, 640)
    const { margin } = CROWD.card
    const atRightEdge = (w: Container) => {
      const box = boxOf(figureOf(w))
      return box.left > 300 && box.right < 360 ? figureOf(w) : null
    }
    const { walker, point } = playUntil(app, store, () =>
      alone(app, atRightEdge),
    )

    picker.at(point)

    const { place } = openCard(picker)
    const box = boxOf(figureOf(walker))
    expect(place.side).toBe('left')
    expect(place.left + place.width).toBeLessThanOrEqual(box.left)
    expect(place.left).toBeGreaterThanOrEqual(margin)
    expect(place.left + place.width).toBeLessThanOrEqual(360 - margin)
  })

  it('follows the customer, then closes once they walk off the screen', async () => {
    const { app, store, picker } = await pickingStreet()
    const { walker, point } = playUntil(app, store, () => alone(app))
    picker.at(point)
    const places = new Set<number>()

    let frames = 0
    while (picker.view().open !== null && frames < 4000) {
      play(app, store, 16)
      frames += 1
      const { open } = picker.view()
      if (open === null) break
      places.add(open.place.left)
      expect(open.place).toEqual(
        placeCard(boxOf(figureOf(walker)), app.screen, CROWD.card),
      )
    }

    expect(places.size).toBeGreaterThan(1)
    expect(picker.view()).toEqual({
      live: true,
      open: null,
      said: '',
      marks: NO_MARKS,
    })
    if (!walker.destroyed) {
      expect(isPicked(walker)).toBe(false)
      expect(walker.x < 0 || walker.x > ASSETS.designSize.width).toBe(true)
    }
  })

  it('closes the card when the street clears at x10', async () => {
    const { app, store, picker } = await pickingStreet()
    const { point } = playUntil(app, store, () => alone(app))
    picker.at(point)

    store.getState().setSpeed(10)
    app.frame(16)

    expect(picker.view().open).toBeNull()
  })

  it('keeps the card open while paused, and opens one at once', async () => {
    const { app, store, picker } = await pickingStreet()
    const { point } = playUntil(app, store, () => alone(app))
    store.getState().setSpeed(0)

    picker.at(point)
    const open = openCard(picker)
    play(app, store, 5000)

    expect(picker.view().open).toEqual(open)
  })

  it('cycles through the customers on screen from the keyboard, then back to the first', async () => {
    const { app, store, picker } = await pickingStreet()
    play(app, store, 12_000, 4000)
    store.getState().setSpeed(0)
    const shown = walkers(app).filter((w) => w.x >= 0 && w.x <= 1440)
    expect(shown.length).toBeGreaterThan(2)

    const order: Container[] = []
    for (let i = 0; i <= shown.length; i += 1) {
      picker.next()
      const picked = walkers(app).filter(isPicked)
      expect(picked).toHaveLength(1)
      order.push(picked[0]!)
      expect(picker.view().said).toBe(saying(openCard(picker).card))
    }

    expect(new Set(order.slice(0, -1)).size).toBe(shown.length)
    expect(order.at(-1)).toBe(order[0])
  })

  it('says no one is there when the street is empty', async () => {
    const app = createFakeApp()
    const store = mondayStore()
    const picker = createPicker()
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd(), picker)
    play(app, store, 1000)

    picker.next()

    expect(picker.view()).toEqual({
      live: true,
      open: null,
      said: NOBODY_THERE,
      marks: NO_MARKS,
    })
  })

  it('lets go of the picker when the street stops', async () => {
    const { app, store, picker, stop } = await pickingStreet()
    const { point } = playUntil(app, store, () => alone(app))
    picker.at(point)

    stop()

    expect(picker.view()).toEqual({
      live: false,
      open: null,
      said: '',
      marks: NO_MARKS,
    })
    expect(() => picker.at(point)).not.toThrow()
    expect(picker.over(point)).toBe(false)
    expect(picker.view().open).toBeNull()
  })
})

/** The design point at the middle of the manifest spot `id`. */
function middleOfSpot(id: string): Point {
  const spot = ASSETS.spots.find((s) => s.id === id)
  if (spot === undefined) throw new Error(`No spot ${id}`)
  return { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2 }
}

/**
 * A street whose spots report their links to `opened` while `opening` is
 * on, as in a game; on Wednesday, open, unless another store is given.
 */
async function spotStreet(store = wednesdayStore(true), width = 1440) {
  const app = createFakeApp(width, 900)
  const picker = createPicker()
  const settings = createSettingsStore(null)
  const opened: StreetLink[] = []
  const state = { opening: true }
  const stop = await startStreet(
    app,
    store,
    createLoaders(),
    ASSETS,
    busyCrowd(),
    picker,
    settings,
    () => (state.opening ? (link) => opened.push(link) : null),
  )
  return { app, store, picker, settings, opened, state, stop }
}

/** A customer whose figure's middle is over a spot, and that point. */
function customerOverSpot(
  app: ReturnType<typeof createFakeApp>,
  store: GameStore,
): { walker: Container; point: Point } {
  const { game } = store.getState()
  const spots = spotsShown(ASSETS, {
    ...truckView(game),
    inChallenge: false,
    staffAtTruck: staffAtTruck(game),
  })
  return playUntil(app, store, () => {
    for (const walker of walkers(app)) {
      const point = centreOf(boxOf(figureOf(walker)))
      if (spotAt(spots, point) !== null) return { walker, point }
    }
    return null
  })
}

describe('startStreet: the spots (#208)', () => {
  it('reports what each spot opens when pressed, and opens no card', async () => {
    // No one has walked in before the first frame.
    const { picker, opened } = await spotStreet()

    for (const id of ['menu', 'stocks', 'owner', 'city']) {
      picker.at(middleOfSpot(id))
    }

    expect(opened).toEqual([
      { dock: 'camion', tab: 'menu' },
      { dock: 'camion', tab: 'stocks' },
      { dock: 'camion', tab: 'schedule' },
      { dock: 'ville' },
    ])
    expect(picker.view().open).toBeNull()
  })

  it('draws the employee serving at the truck, whose spot opens « Équipe »', async () => {
    const store = mondayStore()
    store.setState({
      game: applyDecision(store.getState().game, {
        kind: 'hire',
        role: 'camion',
        candidate: 'amelie',
      }),
    })
    store.getState().advance(2)
    const { app, picker, opened } = await spotStreet(store)
    const employee = app.stage.getChildByLabel('employee', true)!
    expect(employee.visible).toBe(true)

    // Their spot holds them, as drawn.
    const spot = ASSETS.spots.find(({ id }) => id === 'employee')!
    const box = boxOf(employee)
    expect(box.left).toBeGreaterThanOrEqual(spot.x)
    expect(box.right).toBeLessThanOrEqual(spot.x + spot.width)
    expect(box.top).toBeGreaterThanOrEqual(spot.y)
    expect(box.bottom).toBeLessThanOrEqual(spot.y + spot.height)

    picker.at(middleOfSpot('employee'))
    expect(opened).toEqual([{ dock: 'equipe' }])
  })

  it('draws no employee, and opens nothing there, while none serves at the truck', async () => {
    const { app, picker, opened } = await spotStreet()
    expect(app.stage.getChildByLabel('employee', true)?.visible).toBe(false)
    picker.at(middleOfSpot('employee'))
    expect(opened).toEqual([])
  })

  it('points over a spot, and nowhere beside everyone', async () => {
    const { picker } = await spotStreet()
    expect(picker.over(middleOfSpot('menu'))).toBe(true)
    expect(picker.over({ x: 5, y: 5 })).toBe(false)
  })

  it('finds its spots where the scene is drawn after the window resizes', async () => {
    const { app, picker, opened } = await spotStreet(wednesdayStore(true), 1000)
    app.frame()
    const root = app.stage.children[0]!
    const { x, y } = middleOfSpot('stocks')
    const scale = root.scale.x
    picker.at({ x: root.x + x * scale, y: root.y + y * scale })
    // The design point itself is elsewhere on this page.
    picker.at({ x, y })
    expect(opened).toEqual([{ dock: 'camion', tab: 'stocks' }])
  })

  it('opens nothing, points nowhere and marks nothing while nothing opens links', async () => {
    const { app, picker, opened, state, settings, store } = await spotStreet()
    settings.getState().setStreetLegend({ seed: store.getState().game.seed })
    state.opening = false
    const menu = middleOfSpot('menu')

    picker.hover(menu)
    picker.at(menu)
    app.frame()

    expect(opened).toEqual([])
    expect(picker.over(menu)).toBe(false)
    expect(picker.view().marks).toEqual(NO_MARKS)
  })

  it('opens neither the chalkboard nor the owner on a closed day', async () => {
    const { picker, opened } = await spotStreet(mondayStore())
    picker.at(middleOfSpot('menu'))
    picker.at(middleOfSpot('owner'))
    picker.at(middleOfSpot('stocks'))
    expect(opened).toEqual([{ dock: 'camion', tab: 'stocks' }])
  })

  it('picks a customer standing over a spot, and opens nothing', async () => {
    const { app, store, picker, opened } = await spotStreet()
    const { walker, point } = customerOverSpot(app, store)
    store.getState().setSpeed(0)

    picker.at(point)

    expect(opened).toEqual([])
    expect(isPicked(walker)).toBe(true)
    expect(openCard(picker).card.segment).toBe(segmentOf(walker))
  })

  it('outlines the spot under the pointer, and nothing once it leaves', async () => {
    const { app, picker } = await spotStreet()
    const listener = vi.fn()
    picker.subscribe(listener)

    picker.hover(middleOfSpot('menu'))
    const menu = ASSETS.spots.find(({ id }) => id === 'menu')!
    const mark = spotMark(menu, { scale: 1, x: 0, y: 0 })
    expect(picker.view().marks.spot).toEqual(mark)
    // Each frame marks it again, which changes nothing.
    app.frame()
    app.frame()
    expect(listener).toHaveBeenCalledOnce()

    picker.hover({ x: 5, y: 5 })
    expect(picker.view().marks.spot).toBeNull()
    picker.hover(middleOfSpot('owner'))
    expect(picker.view().marks.spot?.below).toBe(true)
    picker.hover(null)
    expect(picker.view().marks.spot).toBeNull()
  })

  it('outlines no spot where a customer stands over it', async () => {
    const { app, store, picker } = await spotStreet()
    const { point } = customerOverSpot(app, store)
    store.getState().setSpeed(0)

    picker.hover(point)
    app.frame()

    expect(picker.view().marks.spot).toBeNull()
  })

  it('stops outlining a spot once pressed, as its panel covers the street', async () => {
    const { picker } = await spotStreet()
    picker.hover(middleOfSpot('menu'))
    picker.at(middleOfSpot('menu'))
    expect(picker.view().marks.spot).toBeNull()
  })

  it('shows the legend in the first game for its first three days only', async () => {
    const { app, store, picker, settings } = await spotStreet(mondayStore())
    const { seed } = store.getState().game
    app.frame()
    // Before the UI takes this game as the first, it does not show.
    expect(picker.view().marks.legend).toBeNull()

    settings.getState().setStreetLegend({ seed })
    const seen: (number | null)[] = []
    for (let day = 0; day <= 3; day += 1) {
      app.frame()
      expect(store.getState().game.day).toBe(day)
      seen.push(picker.view().marks.legend === null ? null : day)
      store.getState().advance(1)
    }
    expect(seen).toEqual([0, 1, 2, null])

    // Where it stands: its foot's centre, on the page.
    const fresh = await spotStreet(mondayStore())
    fresh.settings.getState().setStreetLegend({ seed })
    fresh.app.frame()
    expect(fresh.picker.view().marks.legend).toEqual({
      text: 'Cliquez sur la rue',
      at: { x: ASSETS.streetLegend.x, y: ASSETS.streetLegend.y },
    })
    fresh.settings.getState().setStreetLegend('done')
    fresh.app.frame()
    expect(fresh.picker.view().marks.legend).toBeNull()
  })
})

describe('startStreet: the light over the street', () => {
  function atmosphereOf(app: ReturnType<typeof createFakeApp>) {
    const layer = app.stage.getChildByLabel('atmosphere')!
    const part = <T extends Container>(label: string) =>
      layer.getChildByLabel(label) as T
    return {
      layer,
      glow: part<Sprite>('glow'),
      unevenness: part<Sprite>('unevenness'),
      vignette: part<Sprite>('vignette'),
      grain: part<TilingSprite>('grain'),
    }
  }

  it('covers the whole screen with the glow, the unevenness, the vignette and the grain', async () => {
    const app = createFakeApp(1280, 1000)
    await startStreet(app, mondayStore(), createLoaders())
    const { layer, glow, unevenness, vignette, grain } = atmosphereOf(app)
    expect(layer.children).toEqual([glow, unevenness, vignette, grain])
    for (const sprite of [glow, unevenness, vignette, grain]) {
      expect(sprite.width).toBeCloseTo(1280)
      expect(sprite.height).toBeCloseTo(1000)
      expect(sprite.visible).toBe(true)
    }
    expect(grain).toBeInstanceOf(TilingSprite)
    expect(grain.blendMode).toBe('overlay')
    expect(unevenness.blendMode).toBe('soft-light')
    expect(glow.blendMode).toBe('inherit')
    // Opaque: their textures hold the 40 % and the 30 % (see strayOf).
    expect(grain.alpha).toBe(1)
    expect(unevenness.alpha).toBe(1)
    expect(grain.texture.width).toBe(ASSETS.light.grain.size)
  })

  it('refits the atmosphere when the screen changes size', async () => {
    const app = createFakeApp()
    await startStreet(app, mondayStore(), createLoaders())
    app.screen.width = 1920
    app.screen.height = 1200
    app.frame()
    const { grain, vignette } = atmosphereOf(app)
    expect(grain.width).toBeCloseTo(1920)
    expect(vignette.height).toBeCloseTo(1200)
  })

  it('follows the visual effects the player picks, and stops when the street does', async () => {
    const app = createFakeApp()
    const settings = createSettingsStore(null)
    const loaders = createLoaders()
    const stop = await startStreet(
      app,
      mondayStore(),
      loaders,
      ASSETS,
      busyCrowd(),
      createPicker(),
      settings,
    )
    const { grain, unevenness, glow, vignette } = atmosphereOf(app)
    const cast = piece(app, 'layer:shadows').getChildByLabel('cast')!
    const { blur, opacity } = ASSETS.light.castShadow
    expect(loaders.asked).toEqual([{ blur, opacity }])

    settings.getState().setVisualEffects('simple')
    expect(grain.visible).toBe(false)
    expect(unevenness.visible).toBe(false)
    expect(glow.visible).toBe(true)
    expect(vignette.visible).toBe(true)
    expect(loaders.asked.at(-1)).toEqual({ blur: 0, opacity })
    expect(cast.filters).toEqual([
      expect.objectContaining({ blur: 0, opacity }),
    ])

    settings.getState().setVisualEffects('full')
    expect(grain.visible).toBe(true)
    expect(unevenness.visible).toBe(true)
    expect(cast.filters).toEqual([expect.objectContaining({ blur, opacity })])

    stop()
    expect(() => settings.getState().setVisualEffects('simple')).not.toThrow()
    expect(grain.destroyed).toBe(true)
  })

  it('draws to the back buffer only for the full effects, which blend with it', async () => {
    // Pixi starts without it (see worldOptions).
    const backBuffer = { useBackBuffer: false }
    const app = {
      ...createFakeApp(),
      renderer: { type: RendererType.WEBGL, backBuffer },
    }
    const settings = createSettingsStore(null)
    await startStreet(
      app,
      mondayStore(),
      createLoaders(),
      ASSETS,
      busyCrowd(),
      createPicker(),
      settings,
    )
    expect(backBuffer.useBackBuffer).toBe(true)
    settings.getState().setVisualEffects('simple')
    expect(backBuffer.useBackBuffer).toBe(false)
    settings.getState().setVisualEffects('full')
    expect(backBuffer.useBackBuffer).toBe(true)
  })

  it("blends the unevenness and the grain at the screen's pixels, the ones Pixi copies the street behind them at", async () => {
    // Pixi draws a sprite in an advanced blend mode through a filter: it
    // copies the street behind the sprite at the screen's pixels, draws the
    // sprite at the filter's, then reads both at the same place. Where the
    // two differ, as on a screen of two pixels per logical pixel, each blend
    // zooms the street from its top-left corner and the truck leaves the
    // screen (#110).
    const app = createFakeApp()
    await startStreet(app, mondayStore(), createLoaders())
    const { unevenness, grain } = atmosphereOf(app)
    for (const sprite of [unevenness, grain]) {
      const { resolution } = blendFilterOf(sprite)
      for (const screen of [1, 1.25, 2]) {
        expect(resolution === 'inherit' ? screen : resolution).toBe(screen)
      }
    }
  })

  it("shows the cast shadows through one texture, redrawn each frame at the screen's pixels, where Pixi's renderer cannot filter", async () => {
    // Its Canvas 2D renderer, where WebGL and WebGPU are missing, skips
    // filters; it never gets any. The scene is drawn at twice its design
    // size, on a screen of two pixels per logical pixel.
    const app = {
      ...createFakeApp(2880, 1800),
      renderer: { type: RendererType.CANVAS, resolution: 2 },
    }
    const loaders = { ...createLoaders(), makeFilters: undefined }
    const settings = createSettingsStore(null)
    const store = wednesdayStore(true)
    await startStreet(
      app,
      store,
      loaders,
      ASSETS,
      busyCrowd(),
      createPicker(),
      settings,
    )
    const cast = piece(app, 'layer:shadows').getChildByLabel('cast')!
    const group = cast.renderGroup!
    const redrawn = () => {
      expect(group.textureNeedsUpdate).toBe(true)
      expect(group.textureOptions.resolution).toBe(4)
      // As a render draws it.
      group.textureNeedsUpdate = false
    }

    for (const effects of ['full', 'simple'] as const) {
      settings.getState().setVisualEffects(effects)
      expect(play(app, store, 6000, 4000, redrawn)).toBeGreaterThan(0)
      expect(cast.isCachedAsTexture).toBe(true)
      expect(cast.alpha).toBe(ASSETS.light.castShadow.opacity)
      expect(cast.filters ?? []).toEqual([])
      for (const shadow of cast.children) expect(shadow.alpha).toBe(1)
      // The customers' long shadows, in a texture of their own at their
      // own opacity, opaque in it like the street's.
      const people = customerShadows(app, 'cast')
      expect(people.length).toBeGreaterThan(0)
      const group = people[0]!.parent!
      expect(group.isCachedAsTexture).toBe(true)
      expect(group.alpha).toBe(CROWD.figure.shadow.reach.opacity)
      expect(group.filters ?? []).toEqual([])
      for (const shadow of group.children) expect(shadow.alpha).toBe(1)
      expect(group.renderGroup!.textureOptions.resolution).toBe(4)
    }
  })

  it('starts with the simple effects when the player picked them', async () => {
    const app = createFakeApp()
    const settings = createSettingsStore(null)
    settings.getState().setVisualEffects('simple')
    const loaders = createLoaders()
    await startStreet(
      app,
      mondayStore(),
      loaders,
      ASSETS,
      busyCrowd(),
      createPicker(),
      settings,
    )
    expect(atmosphereOf(app).grain.visible).toBe(false)
    expect(loaders.asked.at(-1)?.blur).toBe(0)
  })
})

/**
 * The filter Pixi blends `sprite` through, made as its renderer makes it.
 * A filter's shaders read the screen's precision off a canvas, which Node
 * has none of: this one has no WebGL, so it reads the default.
 */
function blendFilterOf(sprite: ViewContainer): Filter {
  const renderer = {
    runners: { prerender: { add: () => {} } },
    renderPipes: { batch: { break: () => {} } },
  }
  const pipe = new BlendModePipe(renderer as unknown as Renderer)
  const instructions: FilterInstruction[] = []
  const adapter = DOMAdapter.get()
  DOMAdapter.set({
    ...adapter,
    createCanvas: () =>
      ({ getContext: () => null }) as unknown as HTMLCanvasElement,
  })
  try {
    pipe.prerender()
    pipe.pushBlendMode(sprite, sprite.blendMode, {
      add: (instruction: FilterInstruction) => instructions.push(instruction),
    } as unknown as InstructionSet)
  } finally {
    DOMAdapter.set(adapter)
  }
  const filter = instructions[0]?.filterEffect.filters[0]
  if (filter === undefined) {
    throw new Error(`Pixi does not blend ${sprite.blendMode} with a filter`)
  }
  return filter
}

/**
 * The contact or cast shadows customers throw, on the ground: their long
 * shadows go in the group at their own opacity.
 */
function customerShadows(
  app: ReturnType<typeof createFakeApp>,
  kind: 'cast' | 'contact',
): Container[] {
  const group =
    kind === 'cast' ? castGroupLabel(CROWD.figure.shadow.reach.opacity) : kind
  const found = piece(app, 'layer:shadows').getChildByLabel(group)
  return (found?.children ?? []).filter((s) => s.label === `${kind}:customer`)
}

/** The texture of the light over `part`: the last it fills with. */
function lightOf(part: Graphics): string | undefined {
  const fills = part.context.instructions.flatMap((i) =>
    i.action === 'fill' ? [i.data.style.texture] : [],
  )
  return fills.at(-1)?.label
}

/** The middle of a box on the stage. */
function middleOf(box: {
  minX: number
  maxX: number
  minY: number
  maxY: number
}): { x: number; y: number } {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}

/** A weekend crowd in which everyone comes with a child. */
function familyCrowd(): StreetCrowd {
  const crowd = busyCrowd(5)
  const looks = { ...crowd.settings.looks, familyChance: 1 }
  return { ...crowd, settings: { ...crowd.settings, looks } }
}

/** Sunday, replaying Saturday's visits, open every day. */
function sundayStore(): GameStore {
  const store = wednesdayStore(true)
  store.getState().advance(6 - store.getState().game.day)
  return store
}

describe('startStreet: the customers in the sun', () => {
  it("throws each customer's and child's shadows under their own feet, lit from the left as they turn", async () => {
    const app = createFakeApp()
    const store = sundayStore()
    await startStreet(app, store, createLoaders(), ASSETS, familyCrowd())
    const street = app.stage.children[0]!
    const { bob } = CROWD
    const facings = new Map<Container, Set<number>>()
    let checked = 0
    let lifted = false
    for (let t = 16; t <= 20_000; t += 16) {
      app.frame(16)
      const contacts = customerShadows(app, 'contact')
      const casts = customerShadows(app, 'cast')
      // One of each for every customer and every child.
      expect(contacts).toHaveLength(walkers(app).length * 2)
      expect(casts).toHaveLength(contacts.length)
      for (const walker of walkers(app)) {
        const figure = figureOf(walker)
        const shown = shownOf(walker)
        facings.set(
          walker,
          (facings.get(walker) ?? new Set()).add(figure.scale.x),
        )
        const child = shown.getChildByLabel('child')!
        const feet = [walker.x, walker.x + child.x * figure.scale.x]
        for (const x of feet) {
          const under = contacts.filter((s) => Math.abs(s.x - x) < 1e-6)
          expect(under).toHaveLength(1)
          // On the ground: the walker bobs above it, the shadow never does.
          const lift = under[0]!.y - walker.y
          expect(lift).toBeGreaterThanOrEqual(0)
          expect(lift).toBeLessThanOrEqual(bob.height + 1e-6)
          lifted ||= lift > 0.5
          const cast = casts.find((s) => Math.abs(s.x - x) < 1e-6)!
          expect(cast.y).toBe(under[0]!.y)
          // To the lower right, whichever way they face.
          const box = cast.getBounds()
          const foot = street.toGlobal({ x, y: cast.y })
          expect(box.maxX - foot.x).toBeGreaterThan(foot.x - box.minX)
          expect(box.maxY).toBeGreaterThan(foot.y)
          // Where the reference puts them, for their size: the long one
          // 26 right of the feet and 1 up for 60 across, the spot under
          // them 4 right and 1 down for 44 across its half-dark edge.
          const { feet, reach } = CROWD.figure.shadow
          const long = middleOf(box)
          const across = box.maxX - box.minX
          expect((long.x - foot.x) / across).toBeCloseTo(reach.dx / reach.width)
          expect((long.y - foot.y) / across).toBeCloseTo(reach.dy / reach.width)
          const spotBox = under[0]!.getBounds()
          const spot = middleOf(spotBox)
          const spotAcross = (spotBox.maxX - spotBox.minX) * SPOT_HALF_RADIUS
          expect((spot.x - foot.x) / spotAcross).toBeCloseTo(
            feet.dx / feet.width,
          )
          expect((spot.y - foot.y) / spotAcross).toBeCloseTo(
            feet.dy / feet.width,
          )
          expect(under[0]!.alpha).toBe(feet.opacity)
        }
        // Lit from the screen's left whichever way they face: the light on
        // the torso and the head comes from the side that shows there, and
        // the arm in shade hangs on the right.
        const sun = figure.scale.x === 1 ? 'left' : 'right'
        for (const person of [shown, child]) {
          expect(lightOf(person.getChildByLabel('torso') as Graphics)).toBe(
            `people:side:${sun}`,
          )
          expect(lightOf(person.getChildByLabel('head') as Graphics)).toBe(
            `people:round:${sun}`,
          )
          const near = person.getChildByLabel('nearArm')!.getBounds()
          const far = person.getChildByLabel('farArm')!.getBounds()
          expect(middleOf(near).x).toBeLessThan(middleOf(far).x)
        }
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect(lifted).toBe(true)
    // Some turned on the way, and stayed lit from the left.
    const turned = [...facings.values()].filter((seen) => seen.size === 2)
    expect(turned.length).toBeGreaterThan(0)
  })

  it("takes each customer's shadows away with them, and leaves the street's", async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    play(app, store, 12_000, 4000)
    expect(walkers(app).length).toBeGreaterThan(0)
    const before = customerShadows(app, 'contact')
    expect(before).toHaveLength(walkers(app).length)

    store.getState().setSpeed(10)
    app.frame(16)

    expect(walkers(app)).toHaveLength(0)
    expect(customerShadows(app, 'contact')).toHaveLength(0)
    expect(customerShadows(app, 'cast')).toHaveLength(0)
    expect(before.every((s) => s.destroyed)).toBe(true)
    const layer = piece(app, 'layer:shadows')
    expect(layer.getChildByLabel('contact')!.children.length).toBeGreaterThan(0)
  })
})

/** `store`'s game with a change to the street from today to `lastDay`. */
function changeStreet(
  store: GameStore,
  event: string,
  change: StreetChange,
  lastDay: number,
): void {
  const { game } = store.getState()
  const modifier: StreetModifier = {
    event,
    change,
    fromDay: game.day,
    lastDay,
  }
  store.setState({
    game: { ...game, events: { ...game.events, modifiers: [modifier] } },
  })
}

/** A heat wave from today to `lastDay`, as the canicule card makes one. */
function heatWave(store: GameStore, lastDay: number): void {
  changeStreet(
    store,
    'canicule',
    { kind: 'appeal', product: 'chocolat', factor: 0.3 },
    lastDay,
  )
}

/** The busy crowd, where everyone who comes in a heat wave fans themselves. */
function fanningCrowd(seed = 7): StreetCrowd {
  const { settings, random } = busyCrowd(seed)
  return {
    settings: { ...settings, fans: { ...settings.fans, chance: 1 } },
    random,
  }
}

/** A customer's fan, as drawn to face each way; none without one. */
function fansOf(walker: Container): Container[] {
  return ['facesRight', 'facesLeft'].flatMap(
    (label) =>
      walker.getChildByLabel(label, true)?.getChildByLabel('fan') ?? [],
  )
}

/** The customers on the street who hold a fan, shown or not. */
function fanners(app: ReturnType<typeof createFakeApp>): Container[] {
  return walkers(app).filter((walker) => fansOf(walker).length > 0)
}

describe('startStreet: a heat wave', () => {
  it('has those who come fan themselves, the fan swinging as time goes', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    heatWave(store, store.getState().game.day + 30)
    await startStreet(app, store, createLoaders(), ASSETS, fanningCrowd())
    play(app, store, 10_000, 4000)

    expect(walkers(app).length).toBeGreaterThan(0)
    expect(fanners(app)).toEqual(walkers(app))
    const fans = fanners(app).flatMap(fansOf)
    for (const fan of fans) expect(fan.visible).toBe(true)
    const { swing, periodMs } = CROWD.fans
    const before = fans.map((fan) => fan.rotation)
    for (const angle of before) {
      expect(Math.abs(angle)).toBeLessThanOrEqual(swing + 1e-9)
    }
    app.frame(periodMs / 4)
    expect(fans.map((fan) => fan.rotation)).not.toEqual(before)
  })

  it('freezes the fans while paused', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    heatWave(store, store.getState().game.day + 30)
    await startStreet(app, store, createLoaders(), ASSETS, fanningCrowd())
    play(app, store, 10_000, 4000)
    const fans = fanners(app).flatMap(fansOf)
    expect(fans.length).toBeGreaterThan(0)

    store.getState().setSpeed(0)
    const paused = fans.map((fan) => fan.rotation)
    play(app, store, 3000)
    expect(fans.map((fan) => fan.rotation)).toEqual(paused)
  })

  it('has only some fan themselves with the shipped settings', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    heatWave(store, store.getState().game.day + 30)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd(3))
    const seen = new Set<Container>()
    const fanning = new Set<Container>()
    play(app, store, 40_000, 4000, () => {
      for (const walker of walkers(app)) seen.add(walker)
      for (const walker of fanners(app)) fanning.add(walker)
    })
    expect(fanning.size).toBeGreaterThan(0)
    expect(fanning.size).toBeLessThan(seen.size)
  })

  it('has no one fan themselves without one', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    await startStreet(app, store, createLoaders(), ASSETS, fanningCrowd())
    play(app, store, 20_000, 4000, () => {
      expect(fanners(app)).toEqual([])
    })
    expect(walkers(app).length).toBeGreaterThan(0)
  })

  it('takes every fan away at once when it ends, paused or not, and gives none after', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    // Its last day is the day shown.
    heatWave(store, store.getState().game.day)
    await startStreet(app, store, createLoaders(), ASSETS, fanningCrowd())
    play(app, store, 10_000)
    const stayed = fanners(app)
    expect(stayed.length).toBeGreaterThan(0)
    expect(piece(app, 'heat-sky').visible).toBe(true)

    // The next day begins while the game is paused: no frame is drawn.
    store.getState().setSpeed(0)
    store.getState().advance(1)

    expect(piece(app, 'heat-sky').visible).toBe(false)
    expect(stayed.every((walker) => !walker.destroyed)).toBe(true)
    for (const fan of stayed.flatMap(fansOf)) expect(fan.visible).toBe(false)

    // Nor do they come back, on those still there or on anyone new.
    store.getState().setSpeed(1)
    let newcomers = 0
    play(app, store, 10_000, Number.POSITIVE_INFINITY, () => {
      for (const walker of walkers(app)) {
        if (!stayed.includes(walker)) newcomers += 1
        for (const fan of fansOf(walker)) expect(fan.visible).toBe(false)
      }
      expect(fanners(app).every((walker) => stayed.includes(walker))).toBe(true)
    })
    expect(newcomers).toBeGreaterThan(0)
  })
})

describe('startStreet: a day the street closes the truck', () => {
  it('closes the truck as on a day off, with no avatar and no one replayed', async () => {
    const app = createFakeApp()
    const store = wednesdayStore(true)
    const { day } = store.getState().game
    changeStreet(store, 'chalet', { kind: 'closed' }, day)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())

    expect(piece(app, 'closed-sign').visible).toBe(true)
    expect(piece(app, 'awning').visible).toBe(false)
    expect(piece(app, 'avatar:femme').visible).toBe(false)
    expect(play(app, store, 10_000)).toBe(0)

    store.getState().advance(1)
    expect(piece(app, 'awning').visible).toBe(true)
    expect(piece(app, 'avatar:femme').visible).toBe(true)
  })

  it('takes the tally down at once when a choice closes the truck on the day shown', async () => {
    const app = createFakeApp()
    // Only the construction card, which comes up on the next morning.
    const cones = EVENTS.events.find(({ id }) => id === 'conesOrange')!
    const deck: EventContent = {
      ...EVENTS,
      pacing: { firstDay: 0, minDaysBetween: 1, dailyChance: 1 },
      events: [{ ...cones, conditions: {} }],
    }
    const store = createGameStore(wednesdayStore(true).getState().game, deck)
    await startStreet(app, store, createLoaders(), ASSETS, busyCrowd())
    store.getState().setSpeed(10)
    app.frame(16)
    const tally = piece(app, 'tally')
    expect(tally.visible).toBe(true)

    // The card pauses the game on the next morning, the tally still up.
    store.getState().advance(1)
    const { game, speed } = store.getState()
    expect(game.events.pending?.event).toBe('conesOrange')
    expect(speed).toBe(0)
    expect(piece(app, 'closed-sign').visible).toBe(false)
    expect(tally.visible).toBe(true)

    // A week off closes the truck from today, the day shown.
    store.getState().chooseEvent('vacances')
    expect(store.getState().game.day).toBe(game.day)
    expect(store.getState().game.lastDay).toBe(game.lastDay)
    expect(piece(app, 'closed-sign').visible).toBe(true)
    expect(piece(app, 'avatar:femme').visible).toBe(false)
    expect(tally.visible).toBe(false)

    // It stays down once the game goes on at x10, and no one comes at x1.
    store.getState().closePanel()
    expect(store.getState().speed).toBe(10)
    play(app, store, 1000, Number.POSITIVE_INFINITY, () => {
      expect(tally.visible).toBe(false)
    })
    store.getState().setSpeed(1)
    expect(play(app, store, 10_000)).toBe(0)
    expect(tally.visible).toBe(false)
  })
})

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

/**
 * A Pixi app with a real stage and Pixi's own ticker, on the fake clock,
 * whose renders are counted as Pixi's app adds its render: last in each
 * frame. `rendered` holds what each render saw, from `look`.
 */
function createGatedApp<T>(look: (stage: Container) => T) {
  const stage = new Container()
  const ticker = new Ticker()
  const rendered: T[] = []
  ticker.add(() => rendered.push(look(stage)), null, UPDATE_PRIORITY.LOW)
  const app = {
    stage,
    screen: { width: 1440, height: 900 },
    ticker,
    renderer: { type: RendererType.WEBGL, resolution: 2, resize: vi.fn() },
    canvas: {} as HTMLCanvasElement,
    init: async () => {},
    destroy: () => {},
  }
  return {
    app,
    rendered,
    shape: app as unknown as ReturnType<typeof createFakeApp>,
  }
}

/** A page on the fake clock, whose resizes and visibility the test sets. */
function createPage() {
  const listeners = new Map<string, Set<() => void>>()
  const page = {
    devicePixelRatio: 2,
    hidden: false,
    requestFrame: (onFrame: () => void) =>
      requestAnimationFrame(() => onFrame()),
    cancelFrame: (id: number) => cancelAnimationFrame(id),
    isHidden: () => page.hidden,
    matches: () => false,
    listen: (name: string, listener: () => void) => {
      const set = listeners.get(name) ?? new Set()
      set.add(listener)
      listeners.set(name, set)
      return () => set.delete(listener)
    },
    fire: (name: string) => {
      for (const listener of listeners.get(name) ?? []) listener()
    },
  }
  return page
}

describe('startStreet behind the frame gate (#281)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /**
   * The street, gated as the game gates it, on Wednesday at `speed`. With
   * `city`, « Ville » shows the real city, whose buildings `city` names;
   * else an empty one.
   */
  async function gatedStreet(speed: number, city?: CityPicker) {
    fakeFrames()
    const store = wednesdayStore(true)
    store.getState().setSpeed(speed)
    const settings = createSettingsStore(null)
    const picker = createPicker()
    const page = createPage()
    const { app, rendered, shape } = createGatedApp((stage) => ({
      walkers: stage
        .getChildByLabel('customers', true)
        ?.children.filter((c) => c.label === 'customer').length,
      tally: stage.getChildByLabel('tally', true)?.visible,
      scale: stage.getChildByLabel('street')?.scale.x,
      city: stage.getChildByLabel('city', true) !== null,
      name: (
        stage.children
          .find((layer) => layer.label === 'labels')
          ?.getChildByLabel('name')
          ?.getChildByLabel('text') as Text | null | undefined
      )?.text,
    }))
    const gate = gateWorld(
      app,
      {
        game: store,
        settings,
        playing: () => true,
        // As WorldCanvas has it.
        picks: worldPickChanges(picker, city ?? createCityPicker()),
      },
      page,
    )!
    const stopWorld = await startWorld(
      app,
      gatedScenes(gate, {
        street: (scene) =>
          startStreet(
            scene,
            store,
            createLoaders(),
            ASSETS,
            busyCrowd(),
            picker,
            settings,
          ),
        city: async (scene) => {
          if (city !== undefined) {
            return startCity(scene, {
              store,
              loaders: createLoaders(),
              settings,
              picker: city,
              onOpen: () => () => {},
            })
          }
          const empty = new Container({ label: 'city' })
          scene.stage.addChild(empty)
          return () => empty.destroy()
        },
      }),
      settings,
    )
    const stop = () => {
      gate.stop()
      void stopWorld()
      app.ticker.stop()
    }
    return { app, store, settings, page, gate, rendered, shape, stop }
  }

  it('clears the walkers and shows the tally in the one frame it draws at ×10', async () => {
    const { app, store, rendered, stop } = await gatedStreet(1)
    for (let t = 0; t < 12_000; t += 4000) {
      vi.advanceTimersByTime(4000)
      store.getState().advance(1)
    }
    expect(app.ticker.started).toBe(true)
    expect(rendered.at(-1)?.walkers).toBeGreaterThan(0)

    store.getState().setSpeed(10)
    expect(app.ticker.started).toBe(false)
    vi.advanceTimersByTime(100)
    const drawn = rendered.length
    expect(rendered.at(-1)).toMatchObject({ walkers: 0, tally: true })
    vi.advanceTimersByTime(5000)
    expect(rendered).toHaveLength(drawn)
    stop()
  })

  it('takes the tally down in the one frame it draws on pause', async () => {
    const { store, rendered, stop } = await gatedStreet(10)
    vi.advanceTimersByTime(100)
    expect(rendered.at(-1)?.tally).toBe(true)
    store.getState().setSpeed(0)
    vi.advanceTimersByTime(100)
    expect(rendered.at(-1)?.tally).toBe(false)
    const drawn = rendered.length
    vi.advanceTimersByTime(5000)
    expect(rendered).toHaveLength(drawn)
    stop()
  })

  it('draws a new day at ×10, once', async () => {
    const { store, rendered, stop } = await gatedStreet(10)
    vi.advanceTimersByTime(100)
    const drawn = rendered.length
    store.getState().advance(1)
    vi.advanceTimersByTime(100)
    expect(rendered).toHaveLength(drawn + 1)
    stop()
  })

  it('refits the street to a resized window while paused', async () => {
    const { app, page, rendered, stop } = await gatedStreet(0)
    vi.advanceTimersByTime(100)
    const before = rendered.at(-1)?.scale
    app.screen.width = 900
    app.screen.height = 600
    page.fire('resize')
    vi.advanceTimersByTime(100)
    expect(rendered.at(-1)?.scale).not.toBe(before)
    stop()
  })

  it('shows the city as soon as it starts while paused, then the street again', async () => {
    const { settings, rendered, stop } = await gatedStreet(0)
    vi.advanceTimersByTime(100)
    settings.getState().setWorldView('city')
    await vi.advanceTimersByTimeAsync(100)
    expect(rendered.at(-1)?.city).toBe(true)
    settings.getState().setWorldView('street')
    await vi.advanceTimersByTimeAsync(100)
    expect(rendered.at(-1)).toMatchObject({ city: false, tally: false })
    expect(rendered.at(-1)?.scale).toBeGreaterThan(0)
    stop()
  })

  it('draws the name of the building under the pointer in the paused city, once, and its going', async () => {
    const picker = createCityPicker()
    const { settings, rendered, stop } = await gatedStreet(0, picker)
    settings.getState().setWorldView('city')
    await vi.advanceTimersByTimeAsync(100)
    expect(rendered.at(-1)).toMatchObject({ city: true, name: undefined })
    /** The page's pixel on the middle of `id`'s lit wall. */
    const over = (id: string) => {
      const { left, front, wall } = boxCorners(
        ASSETS.city.pieces.find((p) => p.id === id)!,
      )
      const fit = fitCity(1440, 900, ASSETS.city)
      return {
        x: fit.x + ((left[0] + front[0]) / 2) * fit.scale,
        y: fit.y + ((left[1] + front[1]) / 2 - wall / 2) * fit.scale,
      }
    }
    let drawn = rendered.length
    picker.hover(over('rent'))
    vi.advanceTimersByTime(100)
    expect(rendered).toHaveLength(drawn + 1)
    expect(rendered.at(-1)?.name).toBe('À louer')
    // The pointer moves on the same wall: nothing to draw.
    drawn = rendered.length
    const { x, y } = over('rent')
    picker.hover({ x: x + 1, y })
    vi.advanceTimersByTime(100)
    expect(rendered).toHaveLength(drawn)
    picker.hover(over('bank'))
    vi.advanceTimersByTime(100)
    expect(rendered).toHaveLength(drawn + 1)
    expect(rendered.at(-1)?.name).toBe('La Caisse populaire')
    picker.hover(null)
    vi.advanceTimersByTime(100)
    expect(rendered).toHaveLength(drawn + 2)
    expect(rendered.at(-1)?.name).toBeUndefined()
    drawn = rendered.length
    vi.advanceTimersByTime(5000)
    expect(rendered).toHaveLength(drawn)
    stop()
  })

  it('draws at most 30 frames a second while customers walk, 60 when picked', async () => {
    const { settings, rendered, stop } = await gatedStreet(1)
    vi.advanceTimersByTime(1000)
    const first = rendered.length
    vi.advanceTimersByTime(1000)
    expect(rendered.length - first).toBeLessThanOrEqual(31)
    settings.getState().setFrameRate(60)
    const second = rendered.length
    vi.advanceTimersByTime(1000)
    expect(rendered.length - second).toBeGreaterThan(40)
    stop()
  })
})

describe('startStreet: its backdrop drawn once (#281)', () => {
  it('draws the layers under the shadows once, then again only on a new day or a resize', async () => {
    const app = createFakeApp()
    const render = vi.fn()
    const baking = {
      ...app,
      renderer: { type: RendererType.WEBGL, resolution: 1, render },
    }
    const store = wednesdayStore(true)
    await startStreet(baking, store, createLoaders(), ASSETS, busyCrowd())
    app.frame()
    app.frame()
    expect(render).toHaveBeenCalledOnce()
    expect(app.stage.children[0]?.label).toBe('backdrop')
    for (const id of ['sky', 'far', 'buildings', 'sidewalk', 'street']) {
      expect(piece(app, `layer:${id}`).renderable).toBe(false)
    }
    expect(piece(app, 'layer:shadows').renderable).toBe(true)

    store.getState().advance(1)
    app.frame()
    expect(render).toHaveBeenCalledTimes(2)
    app.screen.width = 1000
    app.frame()
    expect(render).toHaveBeenCalledTimes(3)
  })
})
