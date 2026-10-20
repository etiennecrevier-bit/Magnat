import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSettingsStore, type WorldView } from '../ui/settings.ts'
import type { WorldApp } from './mountWorld.ts'
import { startWorld } from './worldView.ts'

/** A scene's start the test finishes when it wants, and its stop. */
interface Start {
  readonly view: WorldView
  readonly stop: ReturnType<typeof vi.fn>
  finish: () => Promise<void>
  fail: (error: Error) => Promise<void>
}

/** Scenes whose starts wait for the test, each recorded in order. */
function fakeScenes() {
  const starts: Start[] = []
  const scene = (view: WorldView) =>
    vi.fn(
      () =>
        new Promise<() => void>((resolve, reject) => {
          const stop = vi.fn()
          starts.push({
            view,
            stop,
            finish: async () => {
              resolve(stop)
              await flush()
            },
            fail: async (error) => {
              reject(error)
              await flush()
            },
          })
        }),
    )
  return { scenes: { street: scene('street'), city: scene('city') }, starts }
}

/** Lets every promise already settled run on. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

const APP = {} as WorldApp

function settingsOn(view: WorldView) {
  const settings = createSettingsStore(null)
  settings.getState().setWorldView(view)
  return settings
}

describe('startWorld', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts the view the player picked, and resolves once it has', async () => {
    const { scenes, starts } = fakeScenes()
    let started = false
    const world = startWorld(APP, scenes, settingsOn('city')).then((stop) => {
      started = true
      return stop
    })
    await flush()
    expect(starts.map((s) => s.view)).toEqual(['city'])
    expect(started).toBe(false)
    await starts[0]!.finish()
    expect(started).toBe(true)
    expect(scenes.city).toHaveBeenCalledWith(APP)
    await world
  })

  it('stops the scene that runs, then starts the other, when the player picks it', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    await world

    settings.getState().setWorldView('city')
    await flush()
    expect(starts[0]!.stop).toHaveBeenCalledTimes(1)
    expect(starts.map((s) => s.view)).toEqual(['street', 'city'])
    await starts[1]!.finish()
    expect(starts[1]!.stop).not.toHaveBeenCalled()
  })

  it('shows only the last pick made while the first scene starts', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await flush()
    settings.getState().setWorldView('city')
    settings.getState().setWorldView('street')
    await starts[0]!.finish()
    await world
    expect(starts.map((s) => s.view)).toEqual(['street'])
    expect(starts[0]!.stop).not.toHaveBeenCalled()
    expect(scenes.city).not.toHaveBeenCalled()
  })

  it('waits for a scene still starting, then swaps it for the last pick', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    await world

    settings.getState().setWorldView('city')
    await flush()
    // The city is still starting when the player goes back to the street.
    settings.getState().setWorldView('street')
    await flush()
    expect(starts.map((s) => s.view)).toEqual(['street', 'city'])
    await starts[1]!.finish()
    expect(starts[1]!.stop).toHaveBeenCalledTimes(1)
    expect(starts.map((s) => s.view)).toEqual(['street', 'city', 'street'])
    await starts[2]!.finish()
    expect(starts[2]!.stop).not.toHaveBeenCalled()
    expect(starts[0]!.stop).toHaveBeenCalledTimes(1)
  })

  it('takes down the scene that runs, once, and starts nothing after', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    const stop = await world
    stop()
    stop()
    expect(starts[0]!.stop).toHaveBeenCalledTimes(1)
    settings.getState().setWorldView('city')
    await flush()
    expect(starts).toHaveLength(1)
  })

  it('takes down a scene still starting as soon as it has, and mounts no other', async () => {
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    const stop = await world

    settings.getState().setWorldView('city')
    await flush()
    stop()
    expect(starts[0]!.stop).toHaveBeenCalledTimes(1)
    await starts[1]!.finish()
    expect(starts[1]!.stop).toHaveBeenCalledTimes(1)
    settings.getState().setWorldView('street')
    await flush()
    expect(starts).toHaveLength(2)
  })

  it('leaves the world blank after a failed start, until the player picks a view', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('city')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.fail(new Error('no city'))
    await world
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not draw the city'),
      expect.any(Error),
    )
    expect(starts).toHaveLength(1)

    settings.getState().setWorldView('street')
    await flush()
    await starts[1]!.finish()
    expect(starts.map((s) => s.view)).toEqual(['city', 'street'])

    // Picking the city again tries once more.
    settings.getState().setWorldView('city')
    await flush()
    expect(starts[1]!.stop).toHaveBeenCalledTimes(1)
    await starts[2]!.finish()
    expect(starts.map((s) => s.view)).toEqual(['city', 'street', 'city'])
  })

  it('starts the last pick when the one starting before it fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scenes, starts } = fakeScenes()
    const settings = settingsOn('street')
    const world = startWorld(APP, scenes, settings)
    await starts[0]!.finish()
    await world
    settings.getState().setWorldView('city')
    await flush()
    settings.getState().setWorldView('street')
    await starts[1]!.fail(new Error('no city'))
    expect(starts.map((s) => s.view)).toEqual(['street', 'city', 'street'])
    await starts[2]!.finish()
    expect(starts[2]!.stop).not.toHaveBeenCalled()
  })
})
