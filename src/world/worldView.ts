import {
  settingsStore,
  type SettingsStore,
  type WorldView,
} from '../ui/settings.ts'
import type { WorldApp } from './mountWorld.ts'

/** Starts one scene on the app: returns the function that takes it down. */
export type StartScene = (app: WorldApp) => Promise<() => void>

/** How each view of the world starts: the street and the city. */
export type Scenes = Readonly<Record<WorldView, StartScene>>

/**
 * Draws the view of the world the player picked in the top bar, « La rue »
 * or « La ville » (`settings.worldView`), and swaps to the other as soon as
 * they pick it: it stops the scene that runs, then starts the other. A pick
 * while a scene is still starting waits for it, then swaps, so only the
 * last pick ever shows, and a scene is never started twice at once.
 *
 * A scene that fails to start warns and leaves the world blank until the
 * player picks another view, which starts as usual; picking it again tries
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
): Promise<() => Promise<void> | undefined> {
  let wanted = settings.getState().worldView
  let running: { readonly view: WorldView; readonly stop: () => void } | null =
    null
  // The view whose start failed, which is not tried again until picked.
  let failed: WorldView | null = null
  let stopped = false
  let settling: Promise<void> | null = null

  const unsettled = () =>
    !stopped && running?.view !== wanted && failed !== wanted
  const settle = async () => {
    while (unsettled()) {
      running?.stop()
      running = null
      const view = wanted
      try {
        const stop = await scenes[view](app)
        if (stopped) stop()
        else running = { view, stop }
      } catch (error) {
        console.warn(
          `The world could not draw ${view === 'city' ? 'the city' : 'the street'}; the panels run without it.`,
          error,
        )
        failed = view
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

  const unsubscribe = settings.subscribe((state) => {
    if (state.worldView === wanted) return
    wanted = state.worldView
    failed = null
    void kick()
  })
  await kick()

  return () => {
    if (stopped) return undefined
    stopped = true
    unsubscribe()
    running?.stop()
    running = null
    return settling ?? undefined
  }
}
