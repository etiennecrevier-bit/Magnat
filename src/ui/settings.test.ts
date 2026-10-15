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
  it('start with the full visual effects, and the weekly report in full only at first', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: false,
    })
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
      openReportEveryWeek: false,
    })
    expect(createSettingsStore(storage).getState().visualEffects).toBe('simple')
  })

  it('keep « Ouvrir le bilan chaque semaine » in this browser', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setOpenReportEveryWeek(true)
    expect(JSON.parse(storage.items[SETTINGS_KEY]!)).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: true,
    })
    expect(createSettingsStore(storage).getState().openReportEveryWeek).toBe(
      true,
    )
  })

  it('keep each setting when the other changes, after a reload', () => {
    const storage = memory()
    createSettingsStore(storage).getState().setVisualEffects('simple')
    createSettingsStore(storage).getState().setOpenReportEveryWeek(true)
    expect(readSettings(storage)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: true,
    })

    createSettingsStore(storage).getState().setVisualEffects('full')
    expect(readSettings(storage)).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: true,
    })
    createSettingsStore(storage).getState().setOpenReportEveryWeek(false)
    expect(readSettings(storage)).toEqual({
      visualEffects: 'full',
      openReportEveryWeek: false,
    })
  })

  it('read the settings an older version kept, without the weekly report', () => {
    const storage = memory({
      [SETTINGS_KEY]: JSON.stringify({ visualEffects: 'simple' }),
    })
    expect(readSettings(storage)).toEqual({
      visualEffects: 'simple',
      openReportEveryWeek: false,
    })
  })

  it.each([
    [
      { visualEffects: 'ultra', openReportEveryWeek: true },
      { visualEffects: 'full', openReportEveryWeek: true },
    ],
    [
      { visualEffects: 'simple', openReportEveryWeek: 'oui' },
      { visualEffects: 'simple', openReportEveryWeek: false },
    ],
  ])('keep a valid setting beside an invalid one: %j', (stored, settings) => {
    const storage = memory({ [SETTINGS_KEY]: JSON.stringify(stored) })
    expect(readSettings(storage)).toEqual(settings)
  })

  it('tell those listening when the weekly report setting changes', () => {
    const store = createSettingsStore(memory())
    const heard: boolean[] = []
    store.subscribe((state) => heard.push(state.openReportEveryWeek))
    store.getState().setOpenReportEveryWeek(true)
    expect(heard).toEqual([true])
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
    expect(
      writeSettings(BLOCKED, {
        visualEffects: 'simple',
        openReportEveryWeek: true,
      }),
    ).toBe(false)
    const store = createSettingsStore(BLOCKED)
    store.getState().setVisualEffects('simple')
    store.getState().setOpenReportEveryWeek(true)
    expect(store.getState().visualEffects).toBe('simple')
    expect(store.getState().openReportEveryWeek).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('find no storage under Node, so the shared ones are the defaults', () => {
    expect(settingsStore.getState().visualEffects).toBe('full')
    expect(settingsStore.getState().openReportEveryWeek).toBe(false)
  })
})
