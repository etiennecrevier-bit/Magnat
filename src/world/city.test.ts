import {
  Container,
  Sprite,
  Text,
  Texture,
  type Filter,
  type Ticker,
} from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetManifest } from '../content/assets.ts'
import { createInitialState, startChallenge, tick } from '../engine/clock.ts'
import { startContract } from '../engine/contracts.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { wentTo } from '../engine/places.ts'
import type { Day, GameState } from '../engine/types.ts'
import { createSettingsStore } from '../ui/settings.ts'
import { createGameStore, type GameStore } from '../ui/store.ts'
import { startCity } from './city.ts'
import { createCityPicker, type CityLink } from './cityPicker.ts'
import { boxCorners } from './iso.ts'
import { fitCity } from './layout.ts'
import { ASSETS } from './manifest.ts'
import type { ShadowFilters } from './shadows.ts'
import type { StreetLoaders } from './street.ts'

const { city } = ASSETS
const { walkIns } = FOOD_TRUCK
const MS_PER_DAY = 4000

/** A Pixi app with a real stage, a screen the test resizes and a ticker it runs. */
function createFakeApp(width = 1440, height = 900) {
  const frames = new Set<(ticker: Ticker) => void>()
  return {
    stage: new Container(),
    screen: { width, height },
    renderer: { type: 1, resolution: 1, backBuffer: { useBackBuffer: false } },
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

function createLoaders(): StreetLoaders & { asked: ShadowFilters[] } {
  const asked: ShadowFilters[] = []
  return {
    loadFont: vi.fn(async () => undefined),
    loadTexture: vi.fn(async () => Texture.EMPTY),
    measureWidth: () => 40,
    makeFilters: (wanted) => {
      asked.push(wanted)
      return [{ ...wanted, destroy: () => {} }] as unknown as Filter[]
    },
    asked,
  }
}

function playedTo(state: GameState, day: Day): GameState {
  let game = state
  while (game.day < day) game = tick(game)
  return game
}

/** A Wednesday, open, the day before replayed, the owner off to the Caisse. */
function tripStore(): GameStore {
  const wednesday = playedTo(createInitialState(42), 2)
  return createGameStore(wentTo(wednesday, 'caisse'), NO_EVENTS)
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

/** The milliseconds at ×1 into the day replayed to reach `minute`. */
function msAt(minute: number): number {
  const { opensAtMinute: opens, closesAtMinute: closes } = walkIns
  return ((minute - opens) / (closes - opens)) * MS_PER_DAY
}

function find(app: ReturnType<typeof createFakeApp>, label: string): Container {
  const found = app.stage.getChildByLabel(label, true)
  if (found === null) throw new Error(`Nothing labelled ${label}`)
  return found
}

/**
 * The page's pixel on the middle of `id`'s lit wall, in a window of
 * `width` × `height`, the city framed beside « Ville ».
 */
function onWall(id: string, width = 1440, height = 900) {
  const { left, front, wall } = boxCorners(
    city.pieces.find((p) => p.id === id)!,
  )
  const fit = fitCity(width, height, city)
  return {
    x: fit.x + ((left[0] + front[0]) / 2) * fit.scale,
    y: fit.y + ((left[1] + front[1]) / 2 - wall / 2) * fit.scale,
  }
}

/** Starts the city on `app`, its people and clicks the test's own. */
async function start(
  app: ReturnType<typeof createFakeApp>,
  store: GameStore,
  options: {
    loaders?: StreetLoaders
    onOpen?: ((link: CityLink) => void) | null
    manifest?: AssetManifest
  } = {},
) {
  const picker = createCityPicker()
  const settings = createSettingsStore(null)
  const stop = await startCity(app, {
    store,
    loaders: options.loaders ?? createLoaders(),
    manifest: options.manifest,
    settings,
    picker,
    onOpen: () => options.onOpen ?? null,
  })
  return { stop, picker, settings }
}

describe('startCity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('draws the city, the atmosphere over it, then the trip’s words, fitted to the screen', async () => {
    const app = createFakeApp(1280, 800)
    await start(app, tripStore())
    expect(app.stage.children.map((layer) => layer.label)).toEqual([
      'city',
      'atmosphere',
      'labels',
    ])
    const [root, , labels] = app.stage.children
    const fit = fitCity(1280, 800, city)
    expect(root?.scale.x).toBeCloseTo(fit.scale)
    expect(root?.position).toMatchObject({ x: fit.x, y: fit.y })
    expect(labels?.scale.x).toBe(root?.scale.x)
    expect(labels?.position).toMatchObject({ x: root?.x, y: root?.y })
    expect(labels?.getChildByLabel('tripLabel')).not.toBeNull()
  })

  it('loads an image only a city piece names, and keeps the placeholder of one that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const texture = new Texture()
    const loaders = createLoaders()
    loaders.loadTexture = vi.fn(async (url: string) => {
      if (url.endsWith('dummy.png')) return texture
      throw new Error('404')
    })
    const manifest: AssetManifest = {
      ...ASSETS,
      city: {
        ...city,
        pieces: city.pieces.map((p) =>
          p.id === 'bank'
            ? { ...p, image: 'dummy.png' }
            : p.id === 'mill'
              ? { ...p, image: 'city/mill.png' }
              : { ...p, image: undefined },
        ),
      },
    }
    const app = createFakeApp()
    await start(app, tripStore(), { loaders, manifest })
    expect(loaders.loadTexture).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/dummy\.png$/),
    )
    const bank = find(app, 'bank').children[0] as Sprite
    expect(bank.texture).toBe(texture)
    expect(find(app, 'mill').children[0]?.label).toBe('placeholder')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('src/world/art/city/mill.png'),
    )
  })

  describe('through a trip with nobody at the truck, the game unchanged', () => {
    it('opens the hatch, shuts it while the owner is away, then opens it again', async () => {
      const app = createFakeApp()
      const store = tripStore()
      await start(app, store)
      const hatch = find(app, 'truck-hatch')
      const shutter = find(app, 'truck-shutter')
      const line = () =>
        find(app, 'layer:block').children.filter(
          (n) => n.label.startsWith('customer:') && n.visible,
        ).length
      const game = store.getState().game

      app.frame(msAt(595))
      expect(hatch.visible).toBe(true)
      expect(shutter.visible).toBe(false)
      expect(line()).toBeGreaterThan(0)
      const crew = find(app, 'crew')
      expect(
        crew.children.find((n) => n.label.startsWith('avatar:'))?.visible,
      ).toBe(true)

      app.frame(msAt(640) - msAt(595))
      expect(hatch.visible).toBe(false)
      expect(shutter.visible).toBe(true)
      expect(line()).toBe(0)
      expect(find(app, 'owner').visible).toBe(true)

      app.frame(msAt(700) - msAt(640))
      expect(hatch.visible).toBe(true)
      expect(shutter.visible).toBe(false)
      expect(find(app, 'owner').visible).toBe(false)
      expect(store.getState().game).toBe(game)
    })

    it('walks the owner on the sidewalks, drawn in front of the café, then of the Caisse at its door', async () => {
      const app = createFakeApp()
      await start(app, tripStore())
      const owner = find(app, 'owner')
      const z = (id: string) => find(app, id).zIndex

      // Past the café, at the reference's 720, 410, then at the door.
      const { caisse } = city.routes
      app.frame(msAt(600 + 25 * 0.1))
      expect(owner.visible).toBe(true)
      expect(owner.zIndex).toBeGreaterThan(z('cafe'))
      const door = caisse.at(-1)!
      app.frame(msAt(640) - msAt(600 + 25 * 0.1))
      expect(owner.position).toMatchObject({ x: door[0], y: door[1] })
      expect(owner.zIndex).toBeGreaterThan(z('bank'))
      // With the ring under their feet and the way's dot at the door.
      expect(find(app, 'ring').visible).toBe(true)
      expect(find(app, 'ring').position).toMatchObject({
        x: door[0],
        y: door[1],
      })
    })

    it('faces the owner the way they walk, there and back, lit from the left', async () => {
      const app = createFakeApp()
      await start(app, tripStore())
      const facing = () =>
        find(app, 'facings')
          .children.filter((n) => n.visible)
          .map((n) => n.label)
      // Along the avenue to the right, then back to the left.
      app.frame(msAt(612))
      expect(facing()).toEqual(['facesRight'])
      app.frame(msAt(670) - msAt(612))
      expect(facing()).toEqual(['facesLeft'])
      // Drawn turned, as the street's people, never flipped whole.
      expect(find(app, 'owner').scale.x).toBeCloseTo(city.figure.scale)
    })

    it('walks the owner with the avatar the player picked, and the new one when it changes', async () => {
      const app = createFakeApp()
      const store = tripStore()
      const as = (avatar: 'femme' | 'homme') => {
        const { game } = store.getState()
        store.setState({
          game: { ...game, profile: { ...game.profile, avatar } },
        })
      }
      as('femme')
      await start(app, store)
      /** Each facing, and whether it has the bun. */
      const buns = () =>
        find(app, 'facings').children.map((n) => [
          n.label,
          n.getChildByLabel('bun') !== null,
        ])
      const bust = () =>
        find(app, 'crew')
          .children.filter((n) => n.label.startsWith('avatar:'))
          .map((n) => n.label)
      expect(buns()).toEqual([
        ['facesRight', true],
        ['facesLeft', true],
      ])
      expect(bust()).toEqual(['avatar:femme'])

      // Facing left on the way back, then changed to homme: still left.
      app.frame(msAt(612))
      app.frame(msAt(670) - msAt(612))
      as('homme')
      expect(buns()).toEqual([
        ['facesRight', false],
        ['facesLeft', false],
      ])
      expect(bust()).toEqual(['avatar:homme'])
      expect(
        find(app, 'facings')
          .children.filter((n) => n.visible)
          .map((n) => n.label),
      ).toEqual(['facesLeft'])
    })
  })

  it('moves everyone three times faster at ×3, and freezes them paused', async () => {
    const app = createFakeApp()
    const store = tripStore()
    await start(app, store)
    const owner = find(app, 'owner')

    // At ×1, the owner is still serving after the first 600 ms.
    app.frame(msAt(600) / 3)
    expect(owner.visible).toBe(false)

    const slow = createFakeApp()
    const fast = tripStore()
    fast.getState().setSpeed(3)
    await start(slow, fast)
    slow.frame(msAt(612) / 3)
    const there = find(slow, 'owner')
    expect(there.visible).toBe(true)
    const position = { ...there.position }

    fast.getState().setSpeed(0)
    slow.frame(1000)
    expect(there.position).toMatchObject(position)
  })

  it('empties the line at ×10, as the street replays nobody', async () => {
    const app = createFakeApp()
    const store = tripStore()
    store.getState().setSpeed(10)
    await start(app, store)
    // At ×1 two stand in line at 9 h 55 (see above).
    app.frame(msAt(595) / 10)
    const inLine = find(app, 'layer:block').children.filter(
      (n) => n.label.startsWith('customer:') && n.visible,
    )
    expect(inLine).toEqual([])
  })

  it('starts the day again on a new day', async () => {
    const app = createFakeApp()
    const store = tripStore()
    await start(app, store)
    app.frame(msAt(640))
    expect(find(app, 'owner').visible).toBe(true)
    store.getState().advance(1)
    app.frame(16)
    expect(find(app, 'owner').visible).toBe(false)
    expect(find(app, 'truck-hatch').visible).toBe(true)
  })

  describe('a click', () => {
    it('reports what the building opens, and shows the pointer over it', async () => {
      const opened: CityLink[] = []
      const { picker } = await start(createFakeApp(), tripStore(), {
        onOpen: (link) => opened.push(link),
      })
      expect(picker.over(onWall('rent'))).toBe(true)
      expect(picker.over(onWall('tri1'))).toBe(false)
      picker.at(onWall('rent'))
      picker.at(onWall('chez-normand'))
      picker.at(onWall('bank'))
      picker.at(onWall('tri1'))
      expect(opened).toEqual(['fournil', { grocer: 'chezNormand' }, 'trip'])
    })

    it('finds the building on a window of another size', async () => {
      const opened: CityLink[] = []
      const app = createFakeApp(1280, 720)
      const { picker } = await start(app, tripStore(), {
        onOpen: (link) => opened.push(link),
      })
      // The same pixel as at 1440 × 900 is elsewhere in the city.
      picker.at(onWall('bank'))
      picker.at(onWall('rent', 1280, 720))
      expect(opened).toEqual(['fournil'])
    })

    it('opens no trip in a Défi, as the top bar hides « Aller à… »', async () => {
      const opened: CityLink[] = []
      const store = createGameStore(startChallenge('travauxSaintDenis', 42))
      const { picker } = await start(createFakeApp(), store, {
        onOpen: (link) => opened.push(link),
      })
      expect(picker.over(onWall('bank'))).toBe(false)
      picker.at(onWall('bank'))
      picker.at(onWall('rent'))
      expect(opened).toEqual(['fournil'])
    })

    it('opens nothing while the page cannot, as before a game starts', async () => {
      const { picker } = await start(createFakeApp(), tripStore(), {
        onOpen: null,
      })
      expect(picker.over(onWall('rent'))).toBe(false)
      expect(() => picker.at(onWall('rent'))).not.toThrow()
    })
  })

  it('draws the street’s people at the city’s scale, each with the reference’s two shadows', async () => {
    const app = createFakeApp()
    await start(app, tripStore())
    app.frame(msAt(595))
    const block = find(app, 'layer:block')
    const inLine = block.children.filter(
      (n) => n.label.startsWith('customer:') && n.visible,
    )
    expect(inLine.length).toBeGreaterThan(0)
    for (const one of inLine) {
      expect(one.scale.y).toBeCloseTo(city.figure.scale)
      // The street's customer, turned to face the truck up the sidewalk.
      expect(one.children[0]?.label).toBe('customer')
      expect(one.children[0]?.scale.x).toBe(-1)
      const own = (layer: Container) =>
        layer.children.filter((n) => n.label.endsWith(`:${one.label}`))
      const shadows = find(app, 'layer:shadows')
      expect(
        own(shadows).length +
          shadows.children.flatMap((group) => own(group)).length,
        one.label,
      ).toBe(2)
    }
    // Who serves shows only through the hatch's window, with no legs.
    const crew = find(app, 'crew')
    expect(crew.mask).toBe(crew.getChildByLabel('window'))
  })

  describe('the name over a building', () => {
    const over = onWall
    /** The name shown, its words and where its foot is, or null. */
    const shown = (app: ReturnType<typeof createFakeApp>) => {
      const name = find(app, 'labels').getChildByLabel('name')
      if (name === null) return null
      const words = name.getChildByLabel('text') as Text
      return { text: words.text, x: name.x, y: name.y }
    }
    /** Where a box's name goes: over the middle of its top. */
    const above = (id: string) => {
      const { left, right, back, wall } = boxCorners(
        city.pieces.find((p) => p.id === id)!,
      )
      return {
        x: (left[0] + right[0]) / 2,
        y: back[1] - wall - city.label.above,
      }
    }

    it('names the place, the shop or the bakery for rent under the pointer, over its top', async () => {
      const app = createFakeApp()
      const { picker } = await start(app, tripStore(), { onOpen: () => {} })
      picker.hover(over('bank'))
      expect(shown(app)).toEqual({
        text: 'La Caisse populaire',
        ...above('bank'),
      })
      picker.hover(over('silo'))
      expect(shown(app)?.text).toBe('La meunerie')
      picker.hover(over('chez-normand'))
      expect(shown(app)?.text).toBe('Épicerie Chez Normand')
      picker.hover(over('rent'))
      expect(shown(app)?.text).toBe('À louer')
    })

    it('names nothing over a triplex, a tree or the sky, and nothing once the pointer leaves', async () => {
      const app = createFakeApp()
      const { picker } = await start(app, tripStore(), { onOpen: () => {} })
      picker.hover(over('bank'))
      picker.hover(over('tri1'))
      expect(shown(app)).toBeNull()
      picker.hover(over('bank'))
      picker.hover({ x: 40, y: 40 })
      expect(shown(app)).toBeNull()
      picker.hover(over('bank'))
      picker.hover(null)
      expect(shown(app)).toBeNull()
    })

    it('tells the picker’s listeners when a name shows, changes or goes, not under a pointer that finds the same one', async () => {
      const app = createFakeApp()
      const { picker } = await start(app, tripStore(), { onOpen: () => {} })
      const heard = vi.fn()
      picker.subscribe(heard)
      picker.hover(over('bank'))
      expect(heard).toHaveBeenCalledTimes(1)
      // A pixel further on the same wall: the same name, where it was.
      const { x, y } = over('bank')
      picker.hover({ x: x + 1, y })
      expect(heard).toHaveBeenCalledTimes(1)
      picker.hover(over('silo'))
      expect(heard).toHaveBeenCalledTimes(2)
      picker.hover(over('tri1'))
      expect(heard).toHaveBeenCalledTimes(3)
      picker.hover(null)
      expect(heard).toHaveBeenCalledTimes(3)
    })

    it('names nothing while the page cannot open it, nor a trip in a Défi', async () => {
      const app = createFakeApp()
      const { picker } = await start(app, tripStore(), { onOpen: null })
      picker.hover(over('bank'))
      expect(shown(app)).toBeNull()
      const defi = createFakeApp()
      const store = createGameStore(startChallenge('travauxSaintDenis', 42))
      const started = await start(defi, store, { onOpen: () => {} })
      started.picker.hover(over('bank'))
      expect(shown(defi)).toBeNull()
      started.picker.hover(over('rent'))
      expect(shown(defi)?.text).toBe('À louer')
    })

    it('follows the game under a still pointer: « Le fournil » once the bakery runs', async () => {
      const app = createFakeApp()
      const store = tripStore()
      const { picker } = await start(app, store, { onOpen: () => {} })
      picker.hover(over('rent'))
      expect(shown(app)?.text).toBe('À louer')
      store
        .getState()
        .decide({ kind: 'openBakery', oven: 'louer' } satisfies DecisionChange)
      store.getState().advance(1)
      expect(shown(app)?.text).toBe('Le fournil')
    })

    it('finds the building again under a still pointer when the window changes size', async () => {
      const app = createFakeApp()
      const { picker } = await start(app, tripStore(), { onOpen: () => {} })
      app.frame()
      const point = over('bank')
      picker.hover(point)
      expect(shown(app)?.text).toBe('La Caisse populaire')
      // At 1280 × 720 the city is smaller: the same pixel is elsewhere in it.
      app.screen.width = 1280
      app.screen.height = 720
      app.frame()
      expect(shown(app)?.text).not.toBe('La Caisse populaire')
      picker.hover(over('bank', 1280, 720))
      expect(shown(app)?.text).toBe('La Caisse populaire')
    })

    it('takes the name down with the city, and a later city hears nothing of the old pointer', async () => {
      const app = createFakeApp()
      const { picker, stop } = await start(app, tripStore(), {
        onOpen: () => {},
      })
      picker.hover(over('bank'))
      const labels = find(app, 'labels')
      stop()
      expect(labels.destroyed).toBe(true)
      expect(() => picker.hover(over('bank'))).not.toThrow()
    })
  })

  it('follows the visual effects the player picks', async () => {
    const app = createFakeApp()
    const loaders = createLoaders()
    const { settings } = await start(app, tripStore(), { loaders })
    expect(app.renderer.backBuffer.useBackBuffer).toBe(true)
    settings.getState().setVisualEffects('simple')
    expect(app.renderer.backBuffer.useBackBuffer).toBe(false)
    expect(loaders.asked.at(-1)).toMatchObject({ blur: 0 })
    expect(find(app, 'grain').visible).toBe(false)
  })

  describe('the employees', () => {
    /** Who of `role` is drawn and stands where, in the order hired. */
    const standing = (app: ReturnType<typeof createFakeApp>, role: string) =>
      find(app, 'layer:block')
        .children.filter((n) => n.label.startsWith(`${role}:`) && n.visible)
        .map((n) => [n.x, n.y])

    /** The bakery open, and two employees hired in `role` on day 0. */
    const twoHired = (role: 'boulanger' | 'livreur') =>
      [
        { kind: 'hire', role, candidate: 'amelie' },
        { kind: 'hire', role, candidate: 'kevin' },
        { kind: 'openBakery', oven: 'louer' },
      ] satisfies DecisionChange[]

    const hiring = (changes: DecisionChange[]) =>
      changes.reduce(
        (game, change) => applyDecision(game, change),
        createInitialState(42),
      )

    it('draws each baker at the bakery, one a step after the other', async () => {
      const app = createFakeApp()
      const game = playedTo(hiring(twoHired('boulanger')), 1)
      await start(app, createGameStore(game, NO_EVENTS))
      app.frame()
      const { first, step } = city.bakers
      expect(standing(app, 'baker')).toEqual([
        first,
        [first[0] + step[0], first[1] + step[1]],
      ])
    })

    it('draws each deliverer by the van, and leaves one waiting while the other drives it', async () => {
      const app = createFakeApp()
      // A Monday with a delivery due, the contract signed the Tuesday before.
      const tuesday = playedTo(hiring(twoHired('livreur')), 1)
      const monday = playedTo(
        {
          ...tuesday,
          contracts: startContract(tuesday.contracts, 1, 'chezNormand'),
        },
        7,
      )
      await start(app, createGameStore(monday, NO_EVENTS))
      const { first, step } = city.deliveries.deliverers
      const { window } = city.deliveries

      app.frame()
      expect(standing(app, 'deliverer')).toEqual([
        first.bakery,
        [first.bakery[0] + step[0], first.bakery[1] + step[1]],
      ])
      app.frame(((window.from + window.to) / 2) * MS_PER_DAY)
      expect(find(app, 'van').visible).toBe(true)
      expect(standing(app, 'deliverer')).toEqual([first.bakery])
      app.frame((window.to - window.from) * MS_PER_DAY)
      expect(standing(app, 'deliverer')).toHaveLength(2)
    })
  })

  it('takes down what it set up when its start fails halfway, as on an app no longer there', async () => {
    const app = createFakeApp()
    const added = vi.spyOn(app.stage, 'addChild')
    app.ticker.add.mockImplementation(() => {
      throw new Error('No ticker')
    })
    const store = tripStore()
    const settings = createSettingsStore(null)
    const listening = { store: listeners(store), settings: listeners(settings) }
    const picker = createCityPicker()

    await expect(
      startCity(app, {
        store,
        loaders: createLoaders(),
        settings,
        picker,
        onOpen: () => () => {},
      }),
    ).rejects.toThrow('No ticker')
    const layers = added.mock.calls[0] as Container[]
    expect(layers.map((layer) => layer.label)).toEqual([
      'city',
      'atmosphere',
      'labels',
    ])
    expect(layers.every((layer) => layer.destroyed)).toBe(true)
    expect(app.stage.children).toEqual([])
    expect(listening.store()).toBe(0)
    expect(listening.settings()).toBe(0)
    expect(picker.over({ x: 1090, y: 470 })).toBe(false)
  })

  it('takes everything down when it stops, once', async () => {
    const app = createFakeApp()
    const opened: CityLink[] = []
    const { stop, picker, settings } = await start(app, tripStore(), {
      onOpen: (link) => opened.push(link),
    })
    stop()
    stop()
    expect(app.stage.children).toEqual([])
    expect(app.frames.size).toBe(0)
    expect(app.ticker.remove).toHaveBeenCalledTimes(1)
    picker.at({ x: 1090, y: 470 })
    expect(opened).toEqual([])
    expect(() => settings.getState().setVisualEffects('simple')).not.toThrow()
  })
})
