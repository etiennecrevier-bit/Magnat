import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  readSettings,
  SETTINGS_KEY,
  settingsStore,
  writeSettings,
  type SettingsStorage,
} from './settings.ts'

/** A storage holding `items`, which the test can read back. */
function memory(items: Record<string, string> = {}): SettingsStorage & {
  items: Record<string, string>
} {
  return {
    items,
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

/** A storage that throws on every access, as a blocked one does. */
const BLOCKED: SettingsStorage = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the settings', () => {
  it('start with the full visual effects', () => {
    expect(DEFAULT_SETTINGS).toEqual({ visualEffects: 'full' })
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(readSettings(memory())).toEqual(DEFAULT_SETTINGS)
    expect(createSettingsStore(null).getState().visualEffects).toBe('full')
  })

  it('keep the effects the player picks in this browser, under magnat.reglages', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setVisualEffects('simple')
    expect(SETTINGS_KEY).toBe('magnat.reglages')
    expect(JSON.parse(storage.items[SETTINGS_KEY]!)).toEqual({
      visualEffects: 'simple',
    })
    expect(createSettingsStore(storage).getState().visualEffects).toBe('simple')
  })

  it('tell those listening when the effects change', () => {
    const store = createSettingsStore(memory())
    const heard: string[] = []
    store.subscribe((state) => heard.push(state.visualEffects))
    store.getState().setVisualEffects('simple')
    expect(heard).toEqual(['simple'])
  })

  it.each([
    ['not JSON', '{'],
    ['an unknown setting', JSON.stringify({ visualEffects: 'ultra' })],
    ['not an object', JSON.stringify('simple')],
    ['null', 'null'],
  ])('fall back to the defaults when the stored ones are %s', (_, text) => {
    expect(readSettings(memory({ [SETTINGS_KEY]: text }))).toEqual(
      DEFAULT_SETTINGS,
    )
  })

  it('still apply when the browser blocks storage, and never throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(readSettings(BLOCKED)).toEqual(DEFAULT_SETTINGS)
    expect(writeSettings(BLOCKED, { visualEffects: 'simple' })).toBe(false)
    const store = createSettingsStore(BLOCKED)
    store.getState().setVisualEffects('simple')
    expect(store.getState().visualEffects).toBe('simple')
    expect(warn).toHaveBeenCalled()
  })

  it('find no storage under Node, so the shared ones start full', () => {
    expect(settingsStore.getState().visualEffects).toBe('full')
  })
})
