import { Container, Texture, type Filter, type Ticker } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { applyDecision } from '../engine/decisions.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { FIRST_TRUCK, newTruck, truckDecisionsOf } from '../engine/trucks.ts'
import { createSettingsStore, type WorldView } from '../ui/settings.ts'
import { createGameStore } from '../ui/store.ts'
import { startCity } from './city.ts'
import { createCityPicker } from './cityPicker.ts'
import { CROWD } from './crowdSettings.ts'
import { ASSETS } from './manifest.ts'
import { mountWorld, type WorldApp } from './mountWorld.ts'
import { createPicker } from './picker.ts'
import { createShownTruck } from './shownTruck.ts'
import { startStreet, type StreetLoaders } from './street.ts'
import { startWorld } from './worldView.ts'

/** A scene's start the test finishes when it wants, and its stop. */
interface Start {
  readonly view: WorldView
  readonly stop: ReturnType<typeof vi.fn>
  finish: () => Promise<void>
  fail: (error: Error) => Promise<void>
}

/** Scenes whose starts wait for the test, each recorded in order. */
function fakeScenes() {
  const starts: Start[] = []
  const scene = (view: WorldView) =>
    vi.fn(
      () =>
        new Promise<() => void>((resolve, reject) => {
          const stop = vi.fn()
          starts.push({
            view,
            stop,
            finish: async () => {
              resolve(stop)
              await flush()
            },
            fail: async (error) => {
              reject(error)
              await flush()
            },
          })
        }),
    )
  return { scenes: { street: scene('street'), city: scene('city') }, starts }
}

/** Lets every promise already settled run on. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

const APP = {} as WorldApp

function settingsOn(view: WorldView) {
  const settings = createSettingsStore(null)
  settings.getState().setWorldView(view)
  return settings
}

describe('startWorld', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts the view the player picked, and resolves once it has', async () => {
    const { scenes, starts } = fakeScenes()
    let started = false
    const world = startWorld(APP, scenes, settingsOn('city')).then((stop) => {
      started = true
      return stop
    })
    await flush()
    expect(starts.map((s) => s.view)).toEqual(['city'])
    expect(started).toBe(false)
    await starts[0]!.finish()
    expect(started).toBe(true)
    expect(scenes.city).toHaveBeenCalledWith(APP)
    await world
  })

  it('stops the scene that runs, then starts the other, when the player picks it', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    await world

    settings.getState().setWorldView('city')
    await flush()
    expect(starts[0]!.stop).toHaveBeenCalledTimes(1)
    expect(starts.map((s) => s.view)).toEqual(['street', 'city'])
    await starts[1]!.finish()
    expect(starts[1]!.stop).not.toHaveBeenCalled()
  })

  it('shows only the last pick made while the first scene starts', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await flush()
    settings.getState().setWorldView('city')
    settings.getState().setWorldView('street')
    await starts[0]!.finish()
    await world
    expect(starts.map((s) => s.view)).toEqual(['street'])
    expect(starts[0]!.stop).not.toHaveBeenCalled()
    expect(scenes.city).not.toHaveBeenCalled()
  })

  it('waits for a scene still starting, then swaps it for the last pick', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    await world

    settings.getState().setWorldView('city')
    await flush()
    // The city is still starting when the player goes back to the street.
    settings.getState().setWorldView('street')
    await flush()
    expect(starts.map((s) => s.view)).toEqual(['street', 'city'])
    await starts[1]!.finish()
    expect(starts[1]!.stop).toHaveBeenCalledTimes(1)
    expect(starts.map((s) => s.view)).toEqual(['street', 'city', 'street'])
    await starts[2]!.finish()
    expect(starts[2]!.stop).not.toHaveBeenCalled()
    expect(starts[0]!.stop).toHaveBeenCalledTimes(1)
  })

  it('takes down the scene that runs, once, and starts nothing after', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    const stop = await world
    // Nothing starting, the app can go at once.
    expect(stop()).toBeUndefined()
    expect(stop()).toBeUndefined()
    expect(starts[0]!.stop).toHaveBeenCalledTimes(1)
    settings.getState().setWorldView('city')
    await flush()
    expect(starts).toHaveLength(1)
  })

  it('takes down a scene still starting as soon as it has, and mounts no other', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    const stop = await world

    settings.getState().setWorldView('city')
    await flush()
    // The app waits until the city that is starting is down too.
    let down = false
    void stop()?.then(() => {
      down = true
    })
    expect(starts[0]!.stop).toHaveBeenCalledTimes(1)
    await flush()
    expect(down).toBe(false)
    await starts[1]!.finish()
    expect(starts[1]!.stop).toHaveBeenCalledTimes(1)
    expect(down).toBe(true)
    settings.getState().setWorldView('street')
    await flush()
    expect(starts).toHaveLength(2)
  })

  it('lets the app go once a scene still starting when taken down fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    const stop = await world
    settings.getState().setWorldView('city')
    await flush()
    const down = stop()
    await starts[1]!.fail(new Error('no city'))
    await expect(down).resolves.toBeUndefined()
  })

  it('leaves the world blank after a failed start, until the player picks a view', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('city')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.fail(new Error('no city'))
    await world
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not draw the city'),
      expect.any(Error),
    )
    expect(starts).toHaveLength(1)

    settings.getState().setWorldView('street')
    await flush()
    await starts[1]!.finish()
    expect(starts.map((s) => s.view)).toEqual(['city', 'street'])

    // Picking the city again tries once more.
    settings.getState().setWorldView('city')
    await flush()
    expect(starts[1]!.stop).toHaveBeenCalledTimes(1)
    await starts[2]!.finish()
    expect(starts.map((s) => s.view)).toEqual(['city', 'street', 'city'])
  })

  it('starts the last pick when the one starting before it fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    await world
    settings.getState().setWorldView('city')
    await flush()
    settings.getState().setWorldView('street')
    await starts[1]!.fail(new Error('no city'))
    expect(starts.map((s) => s.view)).toEqual(['street', 'city', 'street'])
    await starts[2]!.finish()
    expect(starts[2]!.stop).not.toHaveBeenCalled()
  })
})

/** Lets every callback waiting on a settled promise run, however many. */
const settle = () => new Promise<void>((done) => setTimeout(done, 0))

/**
 * A Pixi app that is gone once destroyed, as Pixi's is: its stage destroyed,
 * then it, the ticker and the renderer unset. It notes what the stage still
 * held then.
 */
function createDestroyableApp() {
  const frames = new Set<(ticker: Ticker) => void>()
  const app = {
    canvas: {} as HTMLCanvasElement,
    stage: new Container() as Container | null,
    screen: { width: 1440, height: 900 },
    renderer: {
      type: 1,
      resolution: 1,
      backBuffer: { useBackBuffer: false },
    } as WorldApp['renderer'] | null,
    ticker: {
      add: (onFrame: (ticker: Ticker) => void) => frames.add(onFrame),
      remove: (onFrame: (ticker: Ticker) => void) => frames.delete(onFrame),
    } as WorldApp['ticker'] | null,
    init: vi.fn(async () => {}),
    destroy: vi.fn(() => {
      app.leftOnStage = app.stage?.children.map((layer) => layer.label) ?? []
      app.stage?.destroy({ children: true })
      app.stage = null
      app.ticker = null
      app.renderer = null
    }),
    frames,
    leftOnStage: null as string[] | null,
  }
  return app
}

/**
 * The street and the city, as `WorldCanvas` starts them, under `mountWorld`
 * on an app that is gone once destroyed. Each title font they load waits
 * for the test.
 */
function realWorld(view: WorldView) {
  const warn = vi.spyOn(console, 'warn')
  const app = createDestroyableApp()
  const fonts: (() => void)[] = []
  const loaders: StreetLoaders = {
    loadFont: () => new Promise<void>((resolve) => fonts.push(resolve)),
    loadTexture: async () => Texture.EMPTY,
    measureWidth: () => 40,
    makeFilters: (wanted) =>
      [{ ...wanted, destroy: () => {} }] as unknown as Filter[],
  }
  const store = createGameStore(createInitialState(42), NO_EVENTS)
  const settings = settingsOn(view)
  const street = createPicker()
  const city = createCityPicker()
  const unmount = mountWorld(
    { append: vi.fn() },
    {},
    (world) =>
      startWorld(
        world,
        {
          street: (scene) =>
            startStreet(
              scene,
              store,
              loaders,
              ASSETS,
              { settings: CROWD, random: () => 0.5 },
              street,
              settings,
            ),
          city: (scene) =>
            startCity(scene, {
              store,
              loaders,
              settings,
              picker: city,
              onOpen: () => () => {},
            }),
        },
        settings,
      ),
    () => app as unknown as WorldApp,
  )
  return {
    app,
    settings,
    street,
    city,
    unmount,
    warn,
    /** Lets the title font asked for `n`th, from 0, load, and the start go on. */
    loadFont: async (n: number) => {
      await settle()
      fonts[n]!()
      await settle()
    },
  }
}

describe('startWorld, its real scenes under mountWorld', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // On the city, over the mill, which opens « Aller à… ».
  const MILL = { x: 1090, y: 470 }

  it('destroys the app only once the city still starting has started and stopped', async () => {
    const world = realWorld('street')
    await world.loadFont(0)
    expect(world.street.view().live).toBe(true)

    world.settings.getState().setWorldView('city')
    await settle()
    expect(world.street.view().live).toBe(false)
    // The city waits for its font when the page takes the world down.
    world.unmount()
    await settle()
    expect(world.app.destroy).not.toHaveBeenCalled()

    await world.loadFont(1)
    expect(world.warn).not.toHaveBeenCalled()
    expect(world.app.destroy).toHaveBeenCalledTimes(1)
    expect(world.app.leftOnStage).toEqual([])
    expect(world.app.frames.size).toBe(0)
    expect(world.city.over(MILL)).toBe(false)
  })

  it('destroys the app only once the street still starting has started and stopped', async () => {
    const world = realWorld('city')
    await world.loadFont(0)
    expect(world.city.over(MILL)).toBe(true)

    world.settings.getState().setWorldView('street')
    await settle()
    expect(world.city.over(MILL)).toBe(false)
    world.unmount()
    await settle()
    expect(world.app.destroy).not.toHaveBeenCalled()

    await world.loadFont(1)
    expect(world.warn).not.toHaveBeenCalled()
    expect(world.app.destroy).toHaveBeenCalledTimes(1)
    expect(world.app.leftOnStage).toEqual([])
    expect(world.app.frames.size).toBe(0)
    expect(world.street.view().live).toBe(false)
  })
})

describe('startWorld: the street of the truck shown (#264)', () => {
  const SECOND = 'vieuxMontreal'

  /** A new game with Vieux-Montréal's truck, the owner at the first. */
  function twoTrucks() {
    const state = createInitialState(42)
    return {
      ...state,
      trucks: [newTruck(42, { id: SECOND, district: SECOND }, 0)],
      decisions: {
        ...state.decisions,
        trucks: { [SECOND]: truckDecisionsOf(state.decisions, FIRST_TRUCK) },
      },
    }
  }

  async function started(view: WorldView = 'street') {
    const { scenes, starts } = fakeScenes()
    const game = createGameStore(twoTrucks(), NO_EVENTS)
    const shown = createShownTruck()
    const settings = settingsOn(view)
    const world = startWorld(APP, scenes, settings, game, shown)
    await flush()
    await starts[0]!.finish()
    const stop = await world
    return { scenes, starts, game, shown, settings, stop }
  }

  it("starts the street of the owner's truck, with none picked", async () => {
    const { scenes, starts } = await started()
    expect(starts.map((s) => s.view)).toEqual(['street'])
    expect(scenes.street).toHaveBeenCalledExactlyOnceWith(APP, FIRST_TRUCK)
  })

  it('swaps the street for the truck picked, and back', async () => {
    const { scenes, starts, shown } = await started()
    shown.pick(SECOND)
    await flush()
    expect(starts[0]!.stop).toHaveBeenCalledOnce()
    expect(scenes.street).toHaveBeenLastCalledWith(APP, SECOND)
    await starts[1]!.finish()
    // A truck the game lacks shows the owner's again.
    shown.pick('nowhere')
    await flush()
    expect(starts[1]!.stop).toHaveBeenCalledOnce()
    expect(scenes.street).toHaveBeenLastCalledWith(APP, FIRST_TRUCK)
    expect(starts).toHaveLength(3)
  })

  it('keeps its street through the game’s other changes', async () => {
    const { scenes, starts, game } = await started()
    game.getState().advance(3)
    game.getState().setSpeed(3)
    await flush()
    expect(starts).toHaveLength(1)
    expect(scenes.street).toHaveBeenCalledOnce()
    expect(starts[0]!.stop).not.toHaveBeenCalled()
  })

  it('follows the owner to the other truck the morning they move there', async () => {
    const { scenes, starts, game } = await started()
    game.setState({
      game: applyDecision(game.getState().game, {
        kind: 'ownerAt',
        truck: SECOND,
      }),
    })
    await flush()
    expect(starts).toHaveLength(1)
    game.getState().advance(1)
    await flush()
    expect(scenes.street).toHaveBeenLastCalledWith(APP, SECOND)
  })

  it('keeps the city while a truck is picked, then opens that truck’s street', async () => {
    const { scenes, starts, shown, settings } = await started('city')
    shown.pick(SECOND)
    await flush()
    expect(starts.map((s) => s.view)).toEqual(['city'])
    settings.getState().setWorldView('street')
    await flush()
    expect(starts[0]!.stop).toHaveBeenCalledOnce()
    expect(scenes.street).toHaveBeenCalledExactlyOnceWith(APP, SECOND)
  })

  it('lets go of the game and the truck picked once down', async () => {
    const { starts, shown, game, stop } = await started()
    await stop()
    shown.pick(SECOND)
    game.getState().advance(1)
    await flush()
    expect(starts).toHaveLength(1)
  })
})
