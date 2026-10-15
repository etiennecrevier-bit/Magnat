import { Container } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SKY_COLOR,
  mountWorld,
  worldOptions,
  type WorldApp,
} from './mountWorld.ts'

/** A promise and the functions that settle it, for the test to call. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** Lets every callback waiting on a settled promise run. */
const settle = () => new Promise<void>((done) => setTimeout(done, 0))

/** A fake Pixi app whose `init()` and drawing the test settles. */
function createFakeWorld() {
  const init = deferred<void>()
  const started = deferred<() => void>()
  const calls: string[] = []
  const app = {
    canvas: {} as HTMLCanvasElement,
    stage: new Container(),
    screen: { width: 1440, height: 900 },
    ticker: { add: vi.fn(), remove: vi.fn() },
    init: vi.fn(() => init.promise),
    destroy: vi.fn(() => {
      calls.push('destroy')
    }),
  } satisfies WorldApp
  const stop = vi.fn(() => {
    calls.push('stop')
  })
  const start = vi.fn(() => started.promise)
  const container = { append: vi.fn() }
  return {
    app,
    start,
    stop,
    container,
    calls,
    mount: () => mountWorld(container, OPTIONS, start, () => app),
    resolveInit: async () => {
      init.resolve()
      await settle()
    },
    rejectInit: async (error: unknown) => {
      init.reject(error)
      await settle()
    },
    resolveStart: async () => {
      started.resolve(stop)
      await settle()
    },
    rejectStart: async (error: unknown) => {
      started.reject(error)
      await settle()
    },
  }
}

const OPTIONS = { background: SKY_COLOR }
const DESTROY_ARGS = [{ removeView: true }, { children: true }]

describe('mountWorld', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts the app, draws on it, then adds its canvas', async () => {
    const world = createFakeWorld()

    world.mount()
    expect(world.app.init).toHaveBeenCalledWith(OPTIONS)
    expect(world.start).not.toHaveBeenCalled()

    await world.resolveInit()
    expect(world.start).toHaveBeenCalledExactlyOnceWith(world.app)
    expect(world.container.append).not.toHaveBeenCalled()

    await world.resolveStart()
    expect(world.container.append).toHaveBeenCalledExactlyOnceWith(
      world.app.canvas,
    )
    expect(world.stop).not.toHaveBeenCalled()
    expect(world.app.destroy).not.toHaveBeenCalled()
  })

  it('stops the drawing, then destroys the app, once on unmount', async () => {
    const world = createFakeWorld()
    const unmount = world.mount()
    await world.resolveInit()
    await world.resolveStart()

    unmount()
    unmount()
    expect(world.calls).toEqual(['stop', 'destroy'])
    expect(world.app.destroy).toHaveBeenCalledExactlyOnceWith(...DESTROY_ARGS)
  })

  it('waits for init to destroy an app unmounted before it was ready, without drawing on it', async () => {
    const world = createFakeWorld()

    const unmount = world.mount()
    unmount()
    expect(world.app.destroy).not.toHaveBeenCalled()

    await world.resolveInit()
    unmount()
    expect(world.start).not.toHaveBeenCalled()
    expect(world.container.append).not.toHaveBeenCalled()
    expect(world.app.destroy).toHaveBeenCalledExactlyOnceWith(...DESTROY_ARGS)
  })

  it('waits for the drawing to take down an app unmounted while it drew', async () => {
    const world = createFakeWorld()

    const unmount = world.mount()
    await world.resolveInit()
    unmount()
    expect(world.calls).toEqual([])

    await world.resolveStart()
    unmount()
    expect(world.container.append).not.toHaveBeenCalled()
    expect(world.calls).toEqual(['stop', 'destroy'])
  })

  it('leaves the world blank when the app cannot start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const world = createFakeWorld()
    const error = new Error('No WebGL')

    const unmount = world.mount()
    await world.rejectInit(error)
    unmount()

    expect(world.start).not.toHaveBeenCalled()
    expect(world.container.append).not.toHaveBeenCalled()
    expect(world.app.destroy).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), error)
  })

  it('destroys the app and leaves the world blank when the drawing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const world = createFakeWorld()
    const error = new Error('Broken manifest')

    const unmount = world.mount()
    await world.resolveInit()
    await world.rejectStart(error)
    unmount()

    expect(world.container.append).not.toHaveBeenCalled()
    expect(world.app.destroy).toHaveBeenCalledExactlyOnceWith(...DESTROY_ARGS)
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.any(String), error)
  })
})

describe('worldOptions', () => {
  it('paints the sky on a canvas that follows the window at its pixel density', () => {
    const view = { devicePixelRatio: 2 } as Window
    expect(worldOptions(view)).toEqual({
      background: '#CFE8F3',
      resizeTo: view,
      resolution: 2,
      autoDensity: true,
      antialias: true,
      useBackBuffer: false,
    })
  })

  it('starts WebGL without its back buffer, so its canvas antialiases', () => {
    // Pixi antialiases the WebGL canvas only without the back buffer; the
    // street turns that on for the full visual effects, which blend with it.
    const options = worldOptions({ devicePixelRatio: 1 } as Window)
    expect(options.antialias).toBe(true)
    expect(options.useBackBuffer).toBe(false)
  })
})
