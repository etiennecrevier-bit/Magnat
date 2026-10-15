import { createStore, type StoreApi } from 'zustand'

// The player's settings, kept in this browser between games. Storage can
// throw on every access, as with the saves (see saves.ts), so each one is
// caught: a setting that cannot be stored still applies until the page
// reloads.

/**
 * How much the world draws over the street: « Complets » with the grain,
 * the painted unevenness and the soft shadow edges, or « Simples » without
 * them, for slower computers.
 */
export type VisualEffects = 'full' | 'simple'

export const VISUAL_EFFECTS: readonly VisualEffects[] = ['full', 'simple']

/** What the player sets. */
export interface Settings {
  readonly visualEffects: VisualEffects
  /**
   * Whether the « Bilan de la semaine » opens in full every week, not only
   * for the first weeks of a game.
   */
  readonly openReportEveryWeek: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  visualEffects: 'full',
  openReportEveryWeek: false,
}

/** The localStorage key the settings are kept under. */
export const SETTINGS_KEY = 'magnat.reglages'

/** The part of the Web Storage API the settings use. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The settings and the way to change them. */
export interface SettingsState extends Settings {
  setVisualEffects: (visualEffects: VisualEffects) => void
  setOpenReportEveryWeek: (openReportEveryWeek: boolean) => void
}

export type SettingsStore = StoreApi<SettingsState>

/**
 * The settings `storage` holds, each on its own: the default for one it
 * does not hold or holds in a form this version does not know, as in the
 * settings an older version kept. Never throws.
 */
export function readSettings(storage: SettingsStorage | null): Settings {
  if (storage === null) return DEFAULT_SETTINGS
  let text: string | null
  try {
    text = storage.getItem(SETTINGS_KEY)
  } catch (error) {
    console.warn('Could not read the settings', error)
    return DEFAULT_SETTINGS
  }
  if (text === null) return DEFAULT_SETTINGS
  let stored: unknown
  try {
    stored = JSON.parse(text)
  } catch {
    return DEFAULT_SETTINGS
  }
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS
  const { visualEffects, openReportEveryWeek } = stored as Record<
    string,
    unknown
  >
  return {
    visualEffects: VISUAL_EFFECTS.includes(visualEffects as VisualEffects)
      ? (visualEffects as VisualEffects)
      : DEFAULT_SETTINGS.visualEffects,
    openReportEveryWeek:
      typeof openReportEveryWeek === 'boolean'
        ? openReportEveryWeek
        : DEFAULT_SETTINGS.openReportEveryWeek,
  }
}

/** Keeps `settings` in `storage`. Returns whether it did; never throws. */
export function writeSettings(
  storage: SettingsStorage | null,
  settings: Settings,
): boolean {
  if (storage === null) return false
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch (error) {
    console.warn('Could not keep the settings', error)
    return false
  }
}

/**
 * A settings store that starts from `storage` and writes each change to it,
 * with every setting, so changing one keeps the others.
 */
export function createSettingsStore(
  storage: SettingsStorage | null,
): SettingsStore {
  return createStore<SettingsState>()((set, get) => {
    const change = (settings: Partial<Settings>) => {
      set(settings)
      const { visualEffects, openReportEveryWeek } = get()
      writeSettings(storage, { visualEffects, openReportEveryWeek })
    }
    return {
      ...readSettings(storage),
      setVisualEffects: (visualEffects) => change({ visualEffects }),
      setOpenReportEveryWeek: (openReportEveryWeek) =>
        change({ openReportEveryWeek }),
    }
  })
}

/**
 * `window.localStorage`, or null when there is none, as in tests under
 * Node, or when the browser blocks it.
 */
function settingsStorage(): SettingsStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The settings of this browser, which the world also reads. */
export const settingsStore: SettingsStore =
  createSettingsStore(settingsStorage())
