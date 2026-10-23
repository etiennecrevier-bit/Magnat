import {
  Application,
  type ApplicationOptions,
  type Container,
  type DestroyOptions,
  type RendererDestroyOptions,
  type Ticker,
} from 'pixi.js'
import { DISPLAY } from '../content/display.ts'
import type { VisualEffects } from '../ui/settings.ts'
import { ASSETS } from './manifest.ts'

/** The sky behind the street, from the manifest's palette. */
export const SKY_COLOR = ASSETS.palette.sky

/** The part of Pixi's `Application` the world mounts, draws on and unmounts. */
export interface WorldApp {
  readonly canvas: HTMLCanvasElement
  readonly stage: Container
  /**
   * Which renderer Pixi picked: WebGL, WebGPU or Canvas 2D (`RendererType`),
   * its pixels per logical pixel, and WebGL's back buffer, which the world
   * turns on only when something blends with it.
   */
  readonly renderer?: {
    readonly type: number
    readonly resolution?: number
    readonly backBuffer?: { useBackBuffer: boolean }
  }
  /** The canvas size, in the logical pixels the stage is drawn in. */
  readonly screen: { readonly width: number; readonly height: number }
  readonly ticker: {
    add: (onFrame: (ticker: Ticker) => void) => unknown
    remove: (onFrame: (ticker: Ticker) => void) => unknown
  }
  init: (options: Partial<ApplicationOptions>) => Promise<void>
  destroy: (
    rendererDestroyOptions: RendererDestroyOptions,
    options: DestroyOptions,
  ) => void
}

/**
 * Draws on an app once it is ready. Returns the function that takes the
 * drawing down, which `mountWorld` calls before destroying the app. While
 * some of the drawing is still starting, as a scene the player just picked,
 * it returns a promise that settles once that is down too: the app is
 * destroyed only then, so nothing ever draws on a destroyed app.
 */
export type StartWorld = (app: WorldApp) => Promise<() => void | Promise<void>>

/**
 * The pixels per logical pixel the world draws at on a screen of
 * `devicePixelRatio` (#281): the screen's, but at most the content's
 * `maxResolution`, and its `simpleResolution` with the simple effects.
 */
export function worldResolution(
  devicePixelRatio: number,
  effects: VisualEffects,
): number {
  const most =
    effects === 'simple' ? DISPLAY.simpleResolution : DISPLAY.maxResolution
  return Math.min(devicePixelRatio, most)
}

/**
 * The options the world starts Pixi with: the sky, on an antialiased canvas
 * that fills `view` and follows its resizes at the screen's pixel density,
 * capped for `effects` (see `worldResolution`).
 * WebGL starts without its back buffer, since Pixi antialiases the canvas
 * only then; the street turns it on for the overlay and soft light of the
 * full visual effects (see atmosphere.ts), and it antialiases as well.
 */
export function worldOptions(
  view: Window,
  effects: VisualEffects = 'full',
): Partial<ApplicationOptions> {
  return {
    background: SKY_COLOR,
    resizeTo: view,
    resolution: worldResolution(view.devicePixelRatio, effects),
    autoDensity: true,
    antialias: true,
    useBackBuffer: false,
  }
}

/**
 * Starts a Pixi application, draws on it with `start`, then adds its canvas
 * to `container`. Returns the function that takes it down: it stops the
 * drawing, then destroys the app once the drawing is down, a part of it
 * still starting too (see `StartWorld`), and does nothing the second time.
 *
 * Pixi's `init()` is async and its `destroy()` throws until `init()` has
 * finished. So an unmount that comes first, as when React StrictMode unmounts
 * every effect once in development, waits for `init()` and any `start` under
 * way, then takes the app down without ever adding its canvas. When `init()`
 * fails, as with no WebGL or WebGPU, or `start` fails, the world stays blank
 * and the panels work as before.
 */
export function mountWorld(
  container: Pick<HTMLElement, 'append'>,
  options: Partial<ApplicationOptions>,
  start: StartWorld,
  createApp: () => WorldApp = () => new Application(),
): () => void {
  const app = createApp()
  let unmounted = false
  let takeDown: (() => void) | null = null
  const destroy = () => app.destroy({ removeView: true }, { children: true })

  const mount = async () => {
    try {
      await app.init(options)
    } catch (error) {
      console.warn(
        'The world could not start; the panels run without it.',
        error,
      )
      return
    }
    if (unmounted) {
      destroy()
      return
    }

    let stop: () => void | Promise<void>
    try {
      stop = await start(app)
    } catch (error) {
      console.warn(
        'The world could not draw; the panels run without it.',
        error,
      )
      destroy()
      return
    }
    takeDown = () => {
      const down = stop()
      if (down === undefined) destroy()
      else void down.finally(destroy)
    }
    if (unmounted) takeDown()
    else container.append(app.canvas)
  }
  void mount()

  return () => {
    if (unmounted) return
    unmounted = true
    takeDown?.()
  }
}
