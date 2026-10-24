import type { TruckId } from '../engine/types.ts'
import {
  settingsStore,
  type SettingsStore,
  type WorldView,
} from '../ui/settings.ts'
import { gameStore, type GameStore } from '../ui/store.ts'
import type { WorldApp } from './mountWorld.ts'
import {
  SHOWN_TRUCK,
  shownTruckOf,
  type ShownTruckStore,
} from './shownTruck.ts'

/** Starts one scene on the app: returns the function that takes it down. */
export type StartScene = (app: WorldApp) => Promise<() => void>

/** Starts the street of the truck `truck` on the app (#264). */
export type StartStreet = (app: WorldApp, truck: TruckId) => Promise<() => void>

/** How each view of the world starts: the street of a truck and the city. */
export interface Scenes {
  readonly street: StartStreet
  readonly city: StartScene
}

/** What the world shows: the city, or the street of one truck. */
type Wanted =
  | { readonly view: 'city'; readonly key: 'city' }
  | { readonly view: 'street'; readonly key: string; readonly truck: TruckId }

/**
 * Draws the view of the world in `settings.worldView`, the city while «
 * Ville » is open and the street otherwise, and swaps to the other as soon
 * as it changes: it stops the scene that runs, then starts the other. The
 * street is that of the truck the world shows (see `shownTruckOf`), from
 * the game in `game` and the truck picked in `shown`; when that truck
 * changes, its street takes the place of the last, and no other change to
 * the game restarts it. A change while a scene is still starting waits for
 * it, then swaps, so only the last view asked for ever shows, and a scene
 * is never started twice at once.
 *
 * A scene that fails to start warns and leaves the world blank until the
 * view changes, and the other starts as usual; asking for it again tries
 * once more. Resolves once the first scene has started, or failed to.
 * Returns the function that takes the world down, which does nothing the
 * second time: it stops the scene that runs, and one still starting as
 * soon as it has. While one is, it returns a promise that settles once that
 * one is down too, which the app waits for before it is destroyed (see
 * `StartWorld`): a scene draws on the app until it stops.
 */
export async function startWorld(
  app: WorldApp,
  scenes: Scenes,
  settings: Pick<SettingsStore, 'getState' | 'subscribe'> = settingsStore,
  game: Pick<GameStore, 'getState' | 'subscribe'> = gameStore,
  shown: ShownTruckStore = SHOWN_TRUCK,
): Promise<() => Promise<void> | undefined> {
  const wantedNow = (): Wanted => {
    const view: WorldView = settings.getState().worldView
    if (view === 'city') return { view, key: 'city' }
    const truck = shownTruckOf(game.getState().game, shown.getState())
    return { view, key: `street:${truck}`, truck }
  }
  let wanted = wantedNow()
  let running: { readonly key: string; readonly stop: () => void } | null = null
  // The scene whose start failed, which is not tried again until picked.
  let failed: string | null = null
  let stopped = false
  let settling: Promise<void> | null = null

  const unsettled = () =>
    !stopped && running?.key !== wanted.key && failed !== wanted.key
  const settle = async () => {
    while (unsettled()) {
      running?.stop()
      running = null
      const scene = wanted
      try {
        const stop =
          scene.view === 'city'
            ? await scenes.city(app)
            : await scenes.street(app, scene.truck)
        if (stopped) stop()
        else running = { key: scene.key, stop }
      } catch (error) {
        console.warn(
          `The world could not draw ${scene.view === 'city' ? 'the city' : 'the street'}; the panels run without it.`,
          error,
        )
        failed = scene.key
      }
    }
  }
  const kick = (): Promise<void> => {
    if (settling === null) {
      settling = settle().finally(() => {
        settling = null
        // A pick between the last check and now.
        if (unsettled()) void kick()
      })
    }
    return settling
  }

  const follow = () => {
    const next = wantedNow()
    if (next.key === wanted.key) return
    wanted = next
    failed = null
    void kick()
  }
  const unsubscribe = [
    settings.subscribe(follow),
    game.subscribe(follow),
    shown.subscribe(follow),
  ]
  await kick()

  return () => {
    if (stopped) return undefined
    stopped = true
    for (const stop of unsubscribe) stop()
    running?.stop()
    running = null
    return settling ?? undefined
  }
}
