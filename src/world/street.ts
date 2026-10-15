import {
  Assets,
  type Texture,
  type Ticker,
  type UnresolvedAsset,
} from 'pixi.js'
import type { AssetManifest } from '../content/assets.ts'
import pacing from '../content/pacing.json'
import { ENERGY, FOOD_TRUCK } from '../engine/day.ts'
import { gameStore, type GameStore } from '../ui/store.ts'
import { loadArt, type LoadTexture } from './art.ts'
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
import { truckView } from './truckView.ts'

/** How the street loads what it draws: Pixi's `Assets`, or a test's fakes. */
export interface StreetLoaders {
  loadFont: (asset: UnresolvedAsset) => Promise<unknown>
  loadTexture: LoadTexture
  measureWidth?: MeasureWidth
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

/**
 * Draws the street on `app`: loads the title font and the manifest's art,
 * builds the scene, fits it to the screen and shows the game in `store`,
 * redrawing it each time the game changes. Each frame, the customers replay
 * the last day at the store's speed (see `startCustomers`). It only reads
 * the store. Returns the function that takes the street down, which does
 * nothing the second time.
 *
 * It holds `picker` while it runs: the player picks a customer there, and
 * their card follows them on the page each frame, paused or not.
 *
 * A font or an image that fails to load warns and falls back to the system
 * font or the piece's placeholder, so the street still shows.
 */
export async function startStreet(
  app: Pick<WorldApp, 'stage' | 'screen' | 'ticker'>,
  store: GameStore = gameStore,
  loaders: StreetLoaders = PIXI_LOADERS,
  manifest: AssetManifest = ASSETS,
  people: StreetCrowd = STREET_CROWD,
  picker: Picker = PICKER,
): Promise<() => void> {
  const [, textures] = await Promise.all([
    loadTitleFont(loaders.loadFont),
    loadArt(manifest, loaders.loadTexture),
  ])
  const scene = buildScene(manifest, textures, loaders.measureWidth)
  const customers = startCustomers({
    street: scene.root,
    manifest,
    crowd: people.settings,
    walkIns: FOOD_TRUCK.walkIns,
    msPerDay: pacing.msPerDayAtNormalSpeed,
    lines: LINES,
    energy: ENERGY,
    random: people.random,
  })
  scene.root.addChild(customers.root)

  // The screen follows the window; each frame refits the scene if it moved.
  let fitted = { width: -1, height: -1 }
  // The part of the design on screen, where customers come and go.
  let span: Span = { left: 0, right: manifest.designSize.width }
  const fit = () => {
    const { width, height } = app.screen
    if (width === fitted.width && height === fitted.height) return
    fitted = { width, height }
    const design = manifest.designSize
    const { scale, x, y } = fitScene(width, height, design.width, design.height)
    scene.root.scale.set(scale)
    scene.root.position.set(x, y)
    span = { left: -x / scale, right: (width - x) / scale }
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
    showCard()
  }

  const show = (game: GameState) => {
    scene.update(truckView(game))
    customers.onGame(game)
  }
  show(store.getState().game)
  fit()
  app.stage.addChild(scene.root)
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.game !== previous.game) show(state.game)
  })
  app.ticker.add(onFrame)

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    unsubscribe()
    app.ticker.remove(onFrame)
    connection.disconnect()
    scene.root.removeFromParent()
    customers.destroy()
    // Leaves the textures to Pixi's Assets cache, which the next start reuses.
    scene.root.destroy({ children: true })
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
