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
}

export const DEFAULT_SETTINGS: Settings = { visualEffects: 'full' }

/** The localStorage key the settings are kept under. */
export const SETTINGS_KEY = 'magnat.reglages'

/** The part of the Web Storage API the settings use. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The settings and the way to change them. */
export interface SettingsState extends Settings {
  setVisualEffects: (visualEffects: VisualEffects) => void
}

export type SettingsStore = StoreApi<SettingsState>

/**
 * The settings `storage` holds, or the defaults for any it does not hold
 * or holds in a form this version does not know; never throws.
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
  try {
    const stored: unknown = JSON.parse(text)
    const visualEffects =
      typeof stored === 'object' && stored !== null && 'visualEffects' in stored
        ? stored.visualEffects
        : undefined
    return VISUAL_EFFECTS.includes(visualEffects as VisualEffects)
      ? { visualEffects: visualEffects as VisualEffects }
      : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
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

/** A settings store that starts from `storage` and writes each change to it. */
export function createSettingsStore(
  storage: SettingsStorage | null,
): SettingsStore {
  return createStore<SettingsState>()((set) => ({
    ...readSettings(storage),
    setVisualEffects: (visualEffects) => {
      set({ visualEffects })
      writeSettings(storage, { visualEffects })
    },
  }))
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
