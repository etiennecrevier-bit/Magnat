import { deserialize, serialize } from '../engine/save.ts'
import type { GameState } from '../engine/types.ts'

// The game the browser keeps between visits, and the files the player
// exports and imports. Storage can throw on every access (private browsing,
// a full quota, a policy that blocks it), so each one is caught: a game
// that cannot be stored still plays, and export still works.

/** The localStorage key the autosave writes under. */
export const SAVE_KEY = 'magnat.sauvegarde'

/** The part of the Web Storage API the saves use. */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>

/** What the browser holds for the start screen to offer. */
export type StoredSave =
  /** No game was ever saved in this browser. */
  | { readonly status: 'none' }
  | { readonly status: 'found'; readonly game: GameState }
  /** A save is there but no longer loads, such as one of an older version. */
  | { readonly status: 'unreadable' }
  /** The browser blocks storage, so nothing can be read or written. */
  | { readonly status: 'unavailable' }

/** What reading an imported file gives: the game, or why it was rejected. */
export type ImportedSave =
  { readonly game: GameState } | { readonly error: string }

export const INVALID_SAVE_FILE =
  "Ce fichier n'est pas une sauvegarde valide de Magnat."

export const UNREADABLE_SAVE_FILE = "Ce fichier n'a pas pu être lu."

/** `window.localStorage`, or null when the browser blocks it. */
export function browserStorage(): SaveStorage | null {
  try {
    return window.localStorage
  } catch (error) {
    console.warn('Storage is blocked; the game will not be saved', error)
    return null
  }
}

/** Loads the game `storage` holds, if any; never throws. */
export function readStoredSave(storage: SaveStorage | null): StoredSave {
  if (storage === null) return { status: 'unavailable' }
  let text: string | null
  try {
    text = storage.getItem(SAVE_KEY)
  } catch (error) {
    console.warn('Could not read the saved game', error)
    return { status: 'unavailable' }
  }
  if (text === null) return { status: 'none' }
  try {
    return { status: 'found', game: deserialize(text) }
  } catch (error) {
    console.warn('The saved game does not load', error)
    return { status: 'unreadable' }
  }
}

/**
 * Saves `game` in `storage`, replacing the game it held. Returns whether it
 * did; never throws.
 */
export function writeStoredSave(
  storage: SaveStorage | null,
  game: GameState,
): boolean {
  return createSaveWriter(storage)(game)
}

/**
 * What one tab saves its game with: a call saves `game` and returns whether
 * it did; never throws. Pass `replaces` when the player started that game in
 * place of the one saved, as an import mid-game does.
 */
export type SaveWriter = (game: GameState, replaces?: boolean) => boolean

/**
 * The `SaveWriter` of one tab. Its first save, and the first after a call
 * that `replaces`, saves as `writeStoredSave` does: starting, continuing or
 * importing a game replaces the browser's save, whatever another tab saved.
 * Each other one saves over what another tab saved since only when that is
 * the same game, played no further. So of two tabs on one game, the one that
 * played it furthest keeps the save, whichever closes last, and a tab never
 * writes over a game another tab started, unless the player starts one in
 * it. A save that fails leaves the replacement to the next one.
 */
export function createSaveWriter(storage: SaveStorage | null): SaveWriter {
  let saved: string | null = null
  let replacing = true
  return (game, replaces = false) => {
    if (storage === null) return false
    replacing ||= replaces
    try {
      // Storage cleared since holds no game to keep.
      const stored = replacing ? null : storage.getItem(SAVE_KEY)
      if (stored !== null && stored !== saved && !isBehind(stored, game)) {
        console.warn('Another tab saved a game this one would set back')
        return false
      }
      const text = serialize(game)
      storage.setItem(SAVE_KEY, text)
      saved = text
      replacing = false
      return true
    } catch (error) {
      console.warn('Could not save the game', error)
      return false
    }
  }
}

/**
 * Whether the save `text` holds `game` as of a day no later than its own:
 * the same seed and player, no further on. A save that does not load, such
 * as one a newer version of the game wrote, is not.
 */
function isBehind(text: string, game: GameState): boolean {
  let stored: GameState
  try {
    stored = deserialize(text)
  } catch {
    return false
  }
  const { profile } = stored
  return (
    stored.seed === game.seed &&
    profile.businessName === game.profile.businessName &&
    profile.avatar === game.profile.avatar &&
    profile.difficulty === game.profile.difficulty &&
    stored.day <= game.day
  )
}

/**
 * Loads the game an exported file holds. A file `deserialize()` rejects
 * gives the French message « Réglages » shows; the reason goes to the
 * console.
 */
export function readImportedSave(text: string): ImportedSave {
  try {
    return { game: deserialize(text) }
  } catch (error) {
    console.warn('The imported file is not a saved game', error)
    return { error: INVALID_SAVE_FILE }
  }
}

/** Reads the file the player picked, then loads it as `readImportedSave`. */
export async function importSaveFile(
  file: Pick<Blob, 'text'>,
): Promise<ImportedSave> {
  let text: string
  try {
    text = await file.text()
  } catch (error) {
    console.warn('Could not read the imported file', error)
    return { error: UNREADABLE_SAVE_FILE }
  }
  return readImportedSave(text)
}

/**
 * The name an exported save downloads under: the business's name in plain
 * lowercase letters and digits, then the game day, such as
 * `magnat-le-ptit-camion-jour-42.json`.
 */
export function saveFileName(game: GameState): string {
  const slug = game.profile.businessName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `magnat-${slug === '' ? 'partie' : slug}-jour-${game.day}.json`
}

/** Downloads `game` as a save file « Importer une partie » loads. */
export function downloadSave(game: GameState, doc: Document = document): void {
  const url = URL.createObjectURL(
    new Blob([serialize(game)], { type: 'application/json' }),
  )
  const link = doc.createElement('a')
  link.href = url
  link.download = saveFileName(game)
  // Some browsers only follow a link that is on the page.
  doc.body.append(link)
  link.click()
  link.remove()
  // Once the download has started with it.
  setTimeout(() => URL.revokeObjectURL(url))
}
