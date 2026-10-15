import {
  Assets,
  type Texture,
  type Ticker,
  type UnresolvedAsset,
} from 'pixi.js'
import type { AssetManifest } from '../content/assets.ts'
import pacing from '../content/pacing.json'
import { ENERGY, FOOD_TRUCK } from '../engine/day.ts'
import {
  settingsStore,
  type SettingsStore,
  type VisualEffects,
} from '../ui/settings.ts'
import { gameStore, type GameStore } from '../ui/store.ts'
import { loadArt, type LoadTexture } from './art.ts'
import { createAtmosphere } from './atmosphere.ts'
import type { Span } from './crowd.ts'
import { CROWD, type CrowdSettings } from './crowdSettings.ts'
import { placeCard } from './customerCard.ts'
import { startCustomers } from './customers.ts'
import { TITLE_FONT_ASSET } from './fonts.ts'
import { fitScene } from './layout.ts'
import type { GameState } from '../engine/types.ts'
import { ASSETS, LINES } from './manifest.ts'
import type { WorldApp } from './mountWorld.ts'
import { PICKER, type Picker } from './picker.ts'
import { buildScene, type MeasureWidth } from './scene.ts'
import { filtersFor, type MakeFilters } from './shadows.ts'
import { truckView } from './truckView.ts'

/**
 * How the street loads what it draws: Pixi's `Assets`, or a test's fakes.
 * Pixi measures text and makes the shadows' filters in the browser only.
 */
export interface StreetLoaders {
  loadFont: (asset: UnresolvedAsset) => Promise<unknown>
  loadTexture: LoadTexture
  measureWidth?: MeasureWidth
  makeFilters?: MakeFilters
}

const PIXI_LOADERS: StreetLoaders = {
  loadFont: (asset) => Assets.load(asset),
  loadTexture: (url) => Assets.load<Texture>(url),
}

/** How the street's customers look and move, and their luck: a test's own. */
export interface StreetCrowd {
  readonly settings: CrowdSettings
  readonly random: () => number
}

const STREET_CROWD: StreetCrowd = { settings: CROWD, random: Math.random }

/** The settings the street reads: the visual effects the player picked. */
export type StreetSettings = Pick<SettingsStore, 'getState' | 'subscribe'>

/**
 * Draws the street on `app`: loads the title font and the manifest's art,
 * builds the scene, fits it to the screen and shows the game in `store`,
 * redrawing it each time the game changes. Each frame, the customers replay
 * the last day at the store's speed (see `startCustomers`). It only reads
 * the store. Returns the function that takes the street down, which does
 * nothing the second time.
 *
 * Over the whole street goes the atmosphere (see `createAtmosphere`), then
 * the tally, which shows numbers and so stays clear of its textures. The
 * visual effects follow `settings` as the player changes them: the simple
 * ones drop the grain, the painted unevenness and the shadows' soft edge,
 * and WebGL's back buffer, which only those blend with.
 *
 * It holds `picker` while it runs: the player picks a customer there, and
 * their card follows them on the page each frame, paused or not.
 *
 * A font or an image that fails to load warns and falls back to the system
 * font or the piece's placeholder, so the street still shows.
 */
export async function startStreet(
  app: Pick<WorldApp, 'stage' | 'screen' | 'ticker' | 'renderer'>,
  store: GameStore = gameStore,
  loaders: StreetLoaders = PIXI_LOADERS,
  manifest: AssetManifest = ASSETS,
  people: StreetCrowd = STREET_CROWD,
  picker: Picker = PICKER,
  settings: StreetSettings = settingsStore,
): Promise<() => void> {
  const [, textures] = await Promise.all([
    loadTitleFont(loaders.loadFont),
    loadArt(manifest, loaders.loadTexture),
  ])
  const scene = buildScene(
    manifest,
    textures,
    loaders.measureWidth,
    loaders.makeFilters ?? filtersFor(app.renderer?.type),
  )
  const atmosphere = createAtmosphere(manifest.light, manifest.palette)
  const customers = startCustomers({
    street: scene.root,
    style: scene.style,
    shadows: scene.shadows,
    crowd: people.settings,
    walkIns: FOOD_TRUCK.walkIns,
    msPerDay: pacing.msPerDayAtNormalSpeed,
    lines: LINES,
    energy: ENERGY,
    random: people.random,
  })
  scene.root.addChild(customers.root)

  // The screen follows the window; each frame refits the scene if it moved.
  let fitted = { width: -1, height: -1, scale: 1 }
  // The part of the design on screen, where customers come and go.
  let span: Span = { left: 0, right: manifest.designSize.width }
  const fit = () => {
    const { width, height } = app.screen
    if (width === fitted.width && height === fitted.height) return
    const design = manifest.designSize
    const { scale, x, y } = fitScene(width, height, design.width, design.height)
    fitted = { width, height, scale }
    for (const layer of [scene.root, customers.labels]) {
      layer.scale.set(scale)
      layer.position.set(x, y)
    }
    atmosphere.fit(width, height)
    span = { left: -x / scale, right: (width - x) / scale }
  }
  const showEffects = (effects: VisualEffects) => {
    scene.setEffects(effects)
    atmosphere.setEffects(effects)
    // Only the grain and the unevenness blend with the back buffer, which
    // costs a copy of the screen each frame. Both it and the canvas, which
    // Pixi starts without it, antialias.
    const backBuffer = app.renderer?.backBuffer
    if (backBuffer !== undefined) backBuffer.useBackBuffer = effects === 'full'
  }

  // The canvas fills the page from its top-left corner, so the stage's
  // pixels are the page's.
  const showCard = () => {
    const picked = customers.picked()
    connection.show(
      picked === null
        ? null
        : {
            card: picked.card,
            place: placeCard(picked.box, app.screen, people.settings.card),
          },
    )
  }
  const connection = picker.connect({
    pickAt: (point) => {
      customers.pickAt(point)
      showCard()
    },
    isOver: (point) => customers.isOver(point),
    pickNext: () => {
      const found = customers.pickNext(span)
      showCard()
      return found
    },
    unpick: () => {
      customers.unpick()
      showCard()
    },
  })

  const onFrame = (ticker: Ticker) => {
    fit()
    scene.animate(ticker.deltaMS)
    customers.frame(ticker.deltaMS, store.getState().speed, span)
    // Where the cast shadows show through one texture, its pixels are the
    // screen's.
    scene.shadows.redraw(fitted.scale * (app.renderer?.resolution ?? 1))
    showCard()
  }

  const show = (game: GameState) => {
    scene.update(truckView(game))
    customers.onGame(game)
  }
  show(store.getState().game)
  showEffects(settings.getState().visualEffects)
  fit()
  app.stage.addChild(scene.root, atmosphere.root, customers.labels)
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.game !== previous.game) show(state.game)
  })
  const unsubscribeSettings = settings.subscribe((state, previous) => {
    if (state.visualEffects !== previous.visualEffects) {
      showEffects(state.visualEffects)
    }
  })
  app.ticker.add(onFrame)

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    unsubscribe()
    unsubscribeSettings()
    app.ticker.remove(onFrame)
    connection.disconnect()
    for (const layer of [scene.root, atmosphere.root, customers.labels]) {
      layer.removeFromParent()
    }
    customers.destroy()
    atmosphere.destroy()
    // Frees the textures the street made, and leaves the art's to Pixi's
    // Assets cache, which the next start reuses.
    scene.destroy()
  }
}

async function loadTitleFont(
  loadFont: StreetLoaders['loadFont'],
): Promise<void> {
  try {
    await loadFont(TITLE_FONT_ASSET)
  } catch (error) {
    console.warn(
      'The title font could not load; the world writes with the system font.',
      error,
    )
  }
}
