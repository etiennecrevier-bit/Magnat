import {
  Assets,
  type Texture,
  type Ticker,
  type UnresolvedAsset,
} from 'pixi.js'
import type { AssetManifest, Spot } from '../content/assets.ts'
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
import { placeCard, type Point } from './customerCard.ts'
import { startCustomers } from './customers.ts'
import { TITLE_FONT_ASSET } from './fonts.ts'
import { fitScene } from './layout.ts'
import type { GameState } from '../engine/types.ts'
import { ASSETS, LINES } from './manifest.ts'
import type { WorldApp } from './mountWorld.ts'
import { PICKER, type Picker } from './picker.ts'
import { buildScene, type MeasureWidth } from './scene.ts'
import { filtersFor, type MakeFilters } from './shadows.ts'
import {
  designPoint,
  legendShows,
  pagePoint,
  spotAt,
  spotMark,
  spotsShown,
  type StreetLink,
} from './streetSpots.ts'
import { setUpOrUndo } from './teardown.ts'
import { staffAtTruck, truckView } from './truckView.ts'

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

/** Pixi's loaders, which the city shares. */
export const PIXI_LOADERS: StreetLoaders = {
  loadFont: (asset) => Assets.load(asset),
  loadTexture: (url, resolution) =>
    Assets.load<Texture>(
      resolution === undefined ? url : { src: url, data: { resolution } },
    ),
}

/** How the street's customers look and move, and their luck: a test's own. */
export interface StreetCrowd {
  readonly settings: CrowdSettings
  readonly random: () => number
}

/** The crowd the street draws in the game: its settings, and real luck. */
export const STREET_CROWD: StreetCrowd = {
  settings: CROWD,
  random: Math.random,
}

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
 * Its spots (see `spotsShown`) open what they name: a press on one reports
 * its link to what `onOpen` returns at that press, unless a customer stands
 * there, who is picked instead. Each frame, the spot under the pointer is
 * marked on the page, with no customer over it, and so is the legend while
 * it shows (see `legendShows`). While `onOpen` returns null, as before a
 * game starts, the spots open and mark nothing, and the legend hides.
 *
 * A font or an image that fails to load warns and falls back to the system
 * font or the piece's placeholder, so the street still shows. A start that
 * fails once loaded, as on an app no longer there, takes down what it set
 * up before it throws.
 */
export async function startStreet(
  app: Pick<WorldApp, 'stage' | 'screen' | 'ticker' | 'renderer'>,
  store: GameStore = gameStore,
  loaders: StreetLoaders = PIXI_LOADERS,
  manifest: AssetManifest = ASSETS,
  people: StreetCrowd = STREET_CROWD,
  picker: Picker = PICKER,
  settings: StreetSettings = settingsStore,
  onOpen: () => ((link: StreetLink) => void) | null = () => null,
): Promise<() => void> {
  const [, textures] = await Promise.all([
    loadTitleFont(loaders.loadFont),
    loadArt(manifest.pieces, loaders.loadTexture, manifest.artResolution),
  ])
  return setUpOrUndo((undo) => {
    const scene = buildScene(
      manifest,
      textures,
      loaders.measureWidth,
      loaders.makeFilters ?? filtersFor(app.renderer?.type),
    )
    // Frees the textures the street made, and leaves the art's to Pixi's
    // Assets cache, which the next start reuses.
    undo(() => scene.destroy())
    const atmosphere = createAtmosphere(manifest.light, manifest.palette)
    undo(() => atmosphere.destroy())
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
    undo(() => customers.destroy())
    scene.root.addChild(customers.root)

    // The screen follows the window; each frame refits the scene if it moved.
    let fitted = { width: -1, height: -1, scale: 1, x: 0, y: 0 }
    // The part of the design on screen, where customers come and go.
    let span: Span = { left: 0, right: manifest.designSize.width }
    const fit = () => {
      const { width, height } = app.screen
      if (width === fitted.width && height === fitted.height) return
      const design = manifest.designSize
      const { scale, x, y } = fitScene(
        width,
        height,
        design.width,
        design.height,
      )
      fitted = { width, height, scale, x, y }
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
      if (backBuffer !== undefined) {
        backBuffer.useBackBuffer = effects === 'full'
      }
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
    // The spots shown today, and where the pointer is on the page.
    let spots: readonly Spot[] = []
    let pointer: Point | null = null
    /** The spot at `point` on the page that a press opens, if any. */
    const openingAt = (point: Point) =>
      onOpen() === null ? null : spotAt(spots, designPoint(point, fitted))
    const showMarks = () => {
      const opens = onOpen() !== null
      const spot =
        pointer === null || customers.isOver(pointer)
          ? null
          : openingAt(pointer)
      const { streetLegend: legend } = manifest
      const { game } = store.getState()
      const shows =
        opens &&
        legendShows(game, settings.getState().streetLegend, legend.days)
      connection.mark({
        spot: spot === null ? null : spotMark(spot, fitted),
        legend: shows
          ? { text: legend.text, at: pagePoint(legend, fitted) }
          : null,
      })
    }

    const connection = picker.connect({
      pickAt: (point) => {
        const open = onOpen()
        const spot = customers.isOver(point) ? null : openingAt(point)
        if (open !== null && spot !== null) {
          customers.unpick()
          // Its panel covers the street: the pointer is no longer over it.
          pointer = null
          open(spot.opens)
        } else {
          customers.pickAt(point)
        }
        showCard()
        showMarks()
      },
      isOver: (point) => customers.isOver(point) || openingAt(point) !== null,
      pickNext: () => {
        const found = customers.pickNext(span)
        showCard()
        return found
      },
      unpick: () => {
        customers.unpick()
        showCard()
      },
      hover: (point) => {
        pointer = point
        showMarks()
      },
    })
    undo(connection.disconnect)

    const onFrame = (ticker: Ticker) => {
      fit()
      scene.animate(ticker.deltaMS)
      customers.frame(ticker.deltaMS, store.getState().speed, span)
      // Where the cast shadows show through one texture, its pixels are the
      // screen's.
      scene.shadows.redraw(fitted.scale * (app.renderer?.resolution ?? 1))
      showCard()
      showMarks()
    }

    const show = (game: GameState) => {
      const view = truckView(game)
      scene.update(view)
      spots = spotsShown(manifest, {
        ...view,
        inChallenge: game.challenge !== null,
        staffAtTruck: staffAtTruck(game),
      })
      customers.onGame(game)
    }
    show(store.getState().game)
    showEffects(settings.getState().visualEffects)
    fit()
    showMarks()
    const layers = [scene.root, atmosphere.root, customers.labels]
    undo(() => {
      for (const layer of layers) layer.removeFromParent()
    })
    app.stage.addChild(...layers)
    undo(
      store.subscribe((state, previous) => {
        if (state.game !== previous.game) show(state.game)
      }),
    )
    undo(
      settings.subscribe((state, previous) => {
        if (state.visualEffects !== previous.visualEffects) {
          showEffects(state.visualEffects)
        }
      }),
    )
    app.ticker.add(onFrame)
    undo(() => app.ticker.remove(onFrame))
  })
}

/** Loads Fredoka, or warns and leaves the system font, as the city does too. */
export async function loadTitleFont(
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
