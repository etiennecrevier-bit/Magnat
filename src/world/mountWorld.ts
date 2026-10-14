import {
  Application,
  type ApplicationOptions,
  type DestroyOptions,
  type RendererDestroyOptions,
} from 'pixi.js'

/** The sky behind the street, from the art brief's palette. */
export const SKY_COLOR = '#CFE8F3'

/** The part of Pixi's `Application` the world mounts and unmounts. */
export interface WorldApp {
  readonly canvas: HTMLCanvasElement
  init: (options: Partial<ApplicationOptions>) => Promise<void>
  destroy: (
    rendererDestroyOptions: RendererDestroyOptions,
    options: DestroyOptions,
  ) => void
}

/**
 * The options the world starts Pixi with: the sky, on a canvas that fills
 * `view` and follows its resizes at the screen's pixel density.
 */
export function worldOptions(view: Window): Partial<ApplicationOptions> {
  return {
    background: SKY_COLOR,
    resizeTo: view,
    resolution: view.devicePixelRatio,
    autoDensity: true,
    antialias: true,
  }
}

/**
 * Starts a Pixi application and adds its canvas to `container` once it is
 * ready. Returns the function that takes it down, which does nothing the
 * second time.
 *
 * Pixi's `init()` is async and its `destroy()` throws until `init()` has
 * finished. So an unmount that comes first, as when React StrictMode unmounts
 * every effect once in development, waits for `init()`, then destroys the app
 * without ever adding its canvas. When `init()` fails, as with no WebGL or
 * WebGPU, the world stays blank and the panels work as before.
 */
export function mountWorld(
  container: Pick<HTMLElement, 'append'>,
  options: Partial<ApplicationOptions>,
  createApp: () => WorldApp = () => new Application(),
): () => void {
  const app = createApp()
  let ready = false
  let unmounted = false
  const destroy = () => app.destroy({ removeView: true }, { children: true })

  app.init(options).then(
    () => {
      ready = true
      if (unmounted) destroy()
      else container.append(app.canvas)
    },
    (error: unknown) => {
      console.warn(
        'The world could not start; the panels run without it.',
        error,
      )
    },
  )

  return () => {
    if (unmounted) return
    unmounted = true
    if (ready) destroy()
  }
}
