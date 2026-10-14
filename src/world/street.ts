import {
  Assets,
  type Texture,
  type Ticker,
  type UnresolvedAsset,
} from 'pixi.js'
import type { AssetManifest } from '../content/assets.ts'
import { gameStore, type GameStore } from '../ui/store.ts'
import { loadArt, type LoadTexture } from './art.ts'
import { TITLE_FONT_ASSET } from './fonts.ts'
import { fitScene } from './layout.ts'
import { ASSETS } from './manifest.ts'
import type { WorldApp } from './mountWorld.ts'
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

/**
 * Draws the street on `app`: loads the title font and the manifest's art,
 * builds the scene, fits it to the screen and shows the game in `store`,
 * redrawing it each time the game changes. It only reads the store. Returns
 * the function that takes the street down, which does nothing the second
 * time.
 *
 * A font or an image that fails to load warns and falls back to the system
 * font or the piece's placeholder, so the street still shows.
 */
export async function startStreet(
  app: Pick<WorldApp, 'stage' | 'screen' | 'ticker'>,
  store: GameStore = gameStore,
  loaders: StreetLoaders = PIXI_LOADERS,
  manifest: AssetManifest = ASSETS,
): Promise<() => void> {
  const [, textures] = await Promise.all([
    loadTitleFont(loaders.loadFont),
    loadArt(manifest, loaders.loadTexture),
  ])
  const scene = buildScene(manifest, textures, loaders.measureWidth)

  // The screen follows the window; each frame refits the scene if it moved.
  let fitted = { width: -1, height: -1 }
  const fit = () => {
    const { width, height } = app.screen
    if (width === fitted.width && height === fitted.height) return
    fitted = { width, height }
    const design = manifest.designSize
    const { scale, x, y } = fitScene(width, height, design.width, design.height)
    scene.root.scale.set(scale)
    scene.root.position.set(x, y)
  }
  const onFrame = (ticker: Ticker) => {
    fit()
    scene.animate(ticker.deltaMS)
  }

  scene.update(truckView(store.getState().game))
  fit()
  app.stage.addChild(scene.root)
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.game !== previous.game) scene.update(truckView(state.game))
  })
  app.ticker.add(onFrame)

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    unsubscribe()
    app.ticker.remove(onFrame)
    scene.root.removeFromParent()
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
