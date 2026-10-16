import { createStore, type StoreApi } from 'zustand'
import { medalSchema, type Medal } from '../content/schema.ts'

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

/**
 * How often the « Bilan » comes once the first weeks of a game are over:
 * every Monday (`week`), or on the 1st of each month (`month`).
 */
export type ReportCadence = 'week' | 'month'

export const REPORT_CADENCES: readonly ReportCadence[] = ['week', 'month']

/** What the player sets. */
export interface Settings {
  readonly visualEffects: VisualEffects
  /**
   * Whether the « Bilan » opens in full each time it comes, every week or
   * every month, not only for the first weeks of a game.
   */
  readonly openReportEveryWeek: boolean
  /** How often the « Bilan » comes after the first weeks of a game. */
  readonly reportCadence: ReportCadence
  /** The best medal won in each Défi, by its id, in any game. */
  readonly bestMedals: Readonly<Record<string, Medal>>
  /**
   * Whether the screens are folded down to a strip, leaving the street the
   * room. Set from the screens themselves, not in « Réglages ».
   */
  readonly screensFolded: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  visualEffects: 'full',
  openReportEveryWeek: false,
  reportCadence: 'week',
  bestMedals: {},
  screensFolded: false,
}

/** The localStorage key the settings are kept under. */
export const SETTINGS_KEY = 'magnat.reglages'

/** The part of the Web Storage API the settings use. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The settings and the way to change them. */
export interface SettingsState extends Settings {
  setVisualEffects: (visualEffects: VisualEffects) => void
  setOpenReportEveryWeek: (openReportEveryWeek: boolean) => void
  setReportCadence: (reportCadence: ReportCadence) => void
  setScreensFolded: (screensFolded: boolean) => void
  /**
   * Keeps `medal` as the best won in the Défi `defiId` unless a better one,
   * or the same, already is.
   */
  recordMedal: (defiId: string, medal: Medal) => void
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
  const {
    visualEffects,
    openReportEveryWeek,
    reportCadence,
    bestMedals,
    screensFolded,
  } = stored as Record<string, unknown>
  return {
    visualEffects: VISUAL_EFFECTS.includes(visualEffects as VisualEffects)
      ? (visualEffects as VisualEffects)
      : DEFAULT_SETTINGS.visualEffects,
    openReportEveryWeek:
      typeof openReportEveryWeek === 'boolean'
        ? openReportEveryWeek
        : DEFAULT_SETTINGS.openReportEveryWeek,
    reportCadence: REPORT_CADENCES.includes(reportCadence as ReportCadence)
      ? (reportCadence as ReportCadence)
      : DEFAULT_SETTINGS.reportCadence,
    bestMedals: readMedals(bestMedals),
    screensFolded:
      typeof screensFolded === 'boolean'
        ? screensFolded
        : DEFAULT_SETTINGS.screensFolded,
  }
}

/** The medals of `stored` that are medals; none unless it is an object. */
function readMedals(stored: unknown): Readonly<Record<string, Medal>> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return DEFAULT_SETTINGS.bestMedals
  }
  return Object.fromEntries(
    Object.entries(stored).filter(([, medal]) =>
      medalSchema.options.includes(medal as Medal),
    ),
  ) as Record<string, Medal>
}

/** The better of two medals: « Or » before « Argent » before « Bronze ». */
export function betterMedal(a: Medal, b: Medal): Medal {
  const { options } = medalSchema
  return options.indexOf(a) <= options.indexOf(b) ? a : b
}

/** The better medal of `a` and `b` in each Défi either holds one for. */
export function mergeMedals(
  a: Readonly<Record<string, Medal>>,
  b: Readonly<Record<string, Medal>>,
): Readonly<Record<string, Medal>> {
  const merged: Record<string, Medal> = { ...a }
  for (const [defiId, medal] of Object.entries(b)) {
    const kept = merged[defiId]
    merged[defiId] = kept === undefined ? medal : betterMedal(kept, medal)
  }
  return merged
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
 * with every setting, so changing one keeps the others. Another tab may
 * have kept medals since this one read them, so each write keeps the better
 * of the stored and this tab's medal in each Défi: no tab loses one.
 */
export function createSettingsStore(
  storage: SettingsStorage | null,
): SettingsStore {
  return createStore<SettingsState>()((set, get) => {
    const change = (settings: Partial<Settings>) => {
      const bestMedals = mergeMedals(
        readSettings(storage).bestMedals,
        settings.bestMedals ?? get().bestMedals,
      )
      set({ ...settings, bestMedals })
      const {
        visualEffects,
        openReportEveryWeek,
        reportCadence,
        screensFolded,
      } = get()
      writeSettings(storage, {
        visualEffects,
        openReportEveryWeek,
        reportCadence,
        bestMedals,
        screensFolded,
      })
    }
    return {
      ...readSettings(storage),
      setVisualEffects: (visualEffects) => change({ visualEffects }),
      setOpenReportEveryWeek: (openReportEveryWeek) =>
        change({ openReportEveryWeek }),
      setReportCadence: (reportCadence) => change({ reportCadence }),
      setScreensFolded: (screensFolded) => change({ screensFolded }),
      recordMedal: (defiId, medal) => {
        const { bestMedals } = get()
        const best = bestMedals[defiId]
        if (best !== undefined && betterMedal(best, medal) === best) return
        change({ bestMedals: { ...bestMedals, [defiId]: medal } })
      },
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
