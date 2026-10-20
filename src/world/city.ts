import type { Ticker } from 'pixi.js'
import type { AssetManifest } from '../content/assets.ts'
import pacing from '../content/pacing.json'
import { FOOD_TRUCK } from '../engine/day.ts'
import type { GameState } from '../engine/types.ts'
import {
  settingsStore,
  type SettingsStore,
  type VisualEffects,
} from '../ui/settings.ts'
import { gameStore, PAUSED, type GameStore } from '../ui/store.ts'
import { loadArt } from './art.ts'
import { createAtmosphere } from './atmosphere.ts'
import { createCityPeople } from './cityPeople.ts'
import { CITY, type CityLink, type CityPicker } from './cityPicker.ts'
import { buildCityScene, type CityHit } from './cityScene.ts'
import { actorsAt, cityView, lineAt, type CityView } from './cityView.ts'
import { CROWD } from './crowdSettings.ts'
import type { Point } from './customerCard.ts'
import { fitScene } from './layout.ts'
import { ASSETS } from './manifest.ts'
import type { WorldApp } from './mountWorld.ts'
import { createDayClock, replayOf, type Replay } from './replay.ts'
import { filtersFor } from './shadows.ts'
import { loadTitleFont, PIXI_LOADERS, type StreetLoaders } from './street.ts'
import { setUpOrUndo } from './teardown.ts'

/** What the city reads, draws with and reports to; tests pass their own. */
export interface CityOptions {
  readonly store?: GameStore
  readonly loaders?: StreetLoaders
  readonly manifest?: AssetManifest
  readonly settings?: Pick<SettingsStore, 'getState' | 'subscribe'>
  readonly picker?: CityPicker
  /**
   * What opens a building's link on the page, asked at each press: null
   * while nothing can, as before a game starts, when no building opens
   * anything.
   */
  readonly onOpen?: () => ((link: CityLink) => void) | null
}

/**
 * Draws the city on `app` (#165), as `startStreet` draws the street: loads
 * the title font and the city's art, builds the scene, fits it to the
 * screen and shows the game in the store, again each time the game changes.
 * Over it go the atmosphere, then the trip's words. It only reads the store.
 *
 * The day replays on the street's clock: a day lasts `msPerDayAtNormalSpeed`
 * at ×1, from the opening to the close, and starts again on a new day, so
 * pausing freezes everyone and ×3 moves them three times faster. Each frame
 * puts the owner, the employees, the line and the van where they are at that
 * minute (see `actorsAt`), and opens or closes the truck's hatch with it.
 *
 * It holds `picker` while it runs: a press on a building that opens
 * something reports its link to `onOpen`, which the page opens, and the
 * pointer shows over it. A trip's link only while trips can be made, as
 * the top bar shows « Aller à… ».
 *
 * Returns the function that takes the city down, which does nothing the
 * second time. A font or an image that fails to load warns and falls back,
 * as on the street. A start that fails once loaded, as on an app no longer
 * there, takes down what it set up before it throws.
 */
export async function startCity(
  app: Pick<WorldApp, 'stage' | 'screen' | 'ticker' | 'renderer'>,
  options: CityOptions = {},
): Promise<() => void> {
  const {
    store = gameStore,
    loaders = PIXI_LOADERS,
    manifest = ASSETS,
    settings = settingsStore,
    picker = CITY,
    onOpen = () => null,
  } = options
  const { city } = manifest
  const [, textures] = await Promise.all([
    loadTitleFont(loaders.loadFont),
    loadArt(city.pieces, loaders.loadTexture, manifest.artResolution),
  ])
  return setUpOrUndo((undo) => {
    const scene = buildCityScene(
      manifest,
      textures,
      loaders.measureWidth,
      loaders.makeFilters ?? filtersFor(app.renderer?.type),
    )
    undo(() => scene.destroy())
    const atmosphere = createAtmosphere(manifest.light, manifest.palette)
    undo(() => atmosphere.destroy())
    const people = createCityPeople(scene, city)
    undo(() => people.destroy())
    const clock = createDayClock(pacing.msPerDayAtNormalSpeed)
    const { walkIns } = FOOD_TRUCK

    let fitted = { width: -1, height: -1, scale: 1, x: 0, y: 0 }
    const fit = () => {
      const { width, height } = app.screen
      if (width === fitted.width && height === fitted.height) return
      const design = city.designSize
      const { scale, x, y } = fitScene(
        width,
        height,
        design.width,
        design.height,
      )
      fitted = { width, height, scale, x, y }
      for (const layer of [scene.root, people.labels]) {
        layer.scale.set(scale)
        layer.position.set(x, y)
      }
      atmosphere.fit(width, height)
    }
    const showEffects = (effects: VisualEffects) => {
      scene.setEffects(effects)
      atmosphere.setEffects(effects)
      const backBuffer = app.renderer?.backBuffer
      if (backBuffer !== undefined) {
        backBuffer.useBackBuffer = effects === 'full'
      }
    }

    let view: CityView
    let replay: Replay | null
    const show = (game: GameState) => {
      view = cityView(game)
      replay = replayOf(game)
      clock.follow(game)
      scene.update(view)
      people.show(view, game.profile.avatar)
    }

    const onFrame = (ticker: Ticker) => {
      fit()
      const { speed, lastSpeed } = store.getState()
      const progress = clock.elapse(ticker.deltaMS, speed)
      const actors = actorsAt(view, progress, walkIns, city.deliveries.window)
      scene.showTruck(actors.truckOpen)
      const minute =
        walkIns.opensAtMinute +
        progress * (walkIns.closesAtMinute - walkIns.opensAtMinute)
      const inLine = lineAt(
        replay,
        minute,
        actors.truckOpen,
        city.truck.line,
        // At ×10 the street replays nobody, nor does the city's line;
        // paused, it keeps the line of the speed it paused at.
        CROWD.speeds[speed === PAUSED ? lastSpeed : speed] !== undefined,
      )
      people.frame(actors, inLine)
      scene.shadows.redraw(fitted.scale * (app.renderer?.resolution ?? 1))
    }

    /** The link of the building drawn at `point` on the page, if it opens. */
    const linkAt = (point: Point): CityLink | null => {
      if (onOpen() === null) return null
      const hit = scene.linkAt([
        (point.x - fitted.x) / fitted.scale,
        (point.y - fitted.y) / fitted.scale,
      ])
      return hit === null ? null : linkOf(hit, view)
    }
    undo(
      picker.connect({
        openAt: (point) => {
          const link = linkAt(point)
          if (link !== null) onOpen()?.(link)
        },
        isOver: (point) => linkAt(point) !== null,
      }),
    )

    show(store.getState().game)
    showEffects(settings.getState().visualEffects)
    fit()
    const layers = [scene.root, atmosphere.root, people.labels]
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

/**
 * What a building reports: its grocer for a grocer's shop, else its
 * `opens`, or null for a trip none can make.
 */
function linkOf({ opens, grocer }: CityHit, view: CityView): CityLink | null {
  if (opens === 'contracts' && grocer !== undefined) return { grocer }
  if (typeof opens === 'string') return opens
  return view.trips ? 'trip' : null
}
