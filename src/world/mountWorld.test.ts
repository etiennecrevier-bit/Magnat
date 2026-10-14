import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SKY_COLOR,
  mountWorld,
  worldOptions,
  type WorldApp,
} from './mountWorld.ts'

/** A fake Pixi app whose `init()` the test settles. */
function createFakeApp() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const app = {
    canvas: {} as HTMLCanvasElement,
    init: vi.fn(
      () =>
        new Promise<void>((onResolve, onReject) => {
          resolve = onResolve
          reject = onReject
        }),
    ),
    destroy: vi.fn(),
  } satisfies WorldApp
  return {
    app,
    // Each settles init(), then lets mountWorld's callback run.
    resolveInit: async () => {
      resolve()
      await Promise.resolve()
    },
    rejectInit: async (error: unknown) => {
      reject(error)
      await Promise.resolve()
    },
  }
}

const OPTIONS = { background: SKY_COLOR }

describe('mountWorld', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts the app with the options and adds its canvas once it is ready', async () => {
    const { app, resolveInit } = createFakeApp()
    const container = { append: vi.fn() }

    mountWorld(container, OPTIONS, () => app)
    expect(app.init).toHaveBeenCalledWith(OPTIONS)
    expect(container.append).not.toHaveBeenCalled()

    await resolveInit()
    expect(container.append).toHaveBeenCalledExactlyOnceWith(app.canvas)
    expect(app.destroy).not.toHaveBeenCalled()
  })

  it('destroys the app and its canvas once on unmount', async () => {
    const { app, resolveInit } = createFakeApp()
    const unmount = mountWorld({ append: vi.fn() }, OPTIONS, () => app)
    await resolveInit()

    unmount()
    unmount()
    expect(app.destroy).toHaveBeenCalledExactlyOnceWith(
      { removeView: true },
      { children: true },
    )
  })

  it('waits for init to destroy an app unmounted before it was ready', async () => {
    const { app, resolveInit } = createFakeApp()
    const container = { append: vi.fn() }

    const unmount = mountWorld(container, OPTIONS, () => app)
    unmount()
    expect(app.destroy).not.toHaveBeenCalled()

    await resolveInit()
    unmount()
    expect(container.append).not.toHaveBeenCalled()
    expect(app.destroy).toHaveBeenCalledExactlyOnceWith(
      { removeView: true },
      { children: true },
    )
  })

  it('leaves the world blank when the app cannot start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { app, rejectInit } = createFakeApp()
    const container = { append: vi.fn() }
    const error = new Error('No WebGL')

    const unmount = mountWorld(container, OPTIONS, () => app)
    await rejectInit(error)
    unmount()

    expect(container.append).not.toHaveBeenCalled()
    expect(app.destroy).not.toHaveBeenCalled()
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
    })
  })
})
