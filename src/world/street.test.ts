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
  type Text,
  type Ticker,
  type ViewContainer,
} from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { ENERGY, EVENTS, FOOD_TRUCK } from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { applyDecision } from '../engine/decisions.ts'
import { next, seedRng } from '../engine/rng.ts'
import type { StreetModifier, Visit } from '../engine/types.ts'
import { createSettingsStore } from '../ui/settings.ts'
import { createGameStore, type GameStore } from '../ui/store.ts'
import type {
  EventContent,
  SegmentId,
  StreetChange,
} from '../content/schema.ts'
import { CROWD, type CrowdSettings } from './crowdSettings.ts'
import { placeCard, saying, type Box, type Point } from './customerCard.ts'
import { ASSETS, LINES } from './manifest.ts'
import { SEGMENT_ACCESSORY } from './people.ts'
import type { ShadowFilters } from './shadows.ts'
import { createPicker, NOBODY_THERE, type Picker } from './picker.ts'
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

    expect(picker.view()).toEqual({ live: true, open: null, said: '' })
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
    expect(picker.view()).toEqual({ live: true, open: null, said: '' })
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
    })
  })

  it('lets go of the picker when the street stops', async () => {
    const { app, store, picker, stop } = await pickingStreet()
    const { point } = playUntil(app, store, () => alone(app))
    picker.at(point)

    stop()

    expect(picker.view()).toEqual({ live: false, open: null, said: '' })
    expect(() => picker.at(point)).not.toThrow()
    expect(picker.over(point)).toBe(false)
    expect(picker.view().open).toBeNull()
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
      // The customers' shadows, like the street's, are opaque in it.
      expect(customerShadows(app, 'cast').length).toBeGreaterThan(0)
      for (const shadow of cast.children) expect(shadow.alpha).toBe(1)
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

/** The contact or cast shadows customers throw, on the ground. */
function customerShadows(
  app: ReturnType<typeof createFakeApp>,
  kind: 'cast' | 'contact',
): Container[] {
  return piece(app, 'layer:shadows')
    .getChildByLabel(kind)!
    .children.filter((s) => s.label === `${kind}:customer`)
}

/**
 * Where each shade fill under `part` and the lit fill drawn over it are
 * drawn on the stage, along x.
 */
function shading(part: Graphics): { shade: number; lit: number }[] {
  const xs = part.context.instructions
    .flatMap((i) => (i.action === 'fill' ? [i.data] : []))
    .map((data) => {
      const { shape, transform } = data.path.shapePath.shapePrimitives[0]!
      const box = shape.getBounds()
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      return part.toGlobal(transform ? transform.apply(centre) : centre).x
    })
  const pairs: { shade: number; lit: number }[] = []
  for (let i = 0; i + 1 < xs.length; i += 2) {
    pairs.push({ shade: xs[i]!, lit: xs[i + 1]! })
  }
  return pairs
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
        }
        for (const part of [
          shown.getChildByLabel('head'),
          shown.getChildByLabel('torso'),
          child.getChildByLabel('head'),
        ] as Graphics[]) {
          for (const { shade, lit } of shading(part)) {
            expect(lit).toBeLessThan(shade)
          }
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
