import type { GameState } from '../engine/types.ts'
import { importSaveFile, type ImportedSave, type StoredSave } from './saves.ts'

// Reading an imported file takes a while, and meanwhile the player may pick
// another file, continue the saved game or open the new game form. A read
// that finishes after that must not start its game over the one the player
// chose, so every start, and every way out of the menu, drops the read in
// progress.

/** The files the start menu imports, of which only the latest one counts. */
export interface SaveImports {
  /**
   * Reads `file` as `importSaveFile` does. Resolves to null when a later
   * read, or `cancel()`, superseded it before it finished.
   */
  read: (file: Pick<Blob, 'text'>) => Promise<ImportedSave | null>
  /** Drops the read in progress, if any. Later reads still count. */
  cancel: () => void
}

export function createSaveImports(
  load: (file: Pick<Blob, 'text'>) => Promise<ImportedSave> = importSaveFile,
): SaveImports {
  let latest = 0
  return {
    read: async (file) => {
      latest += 1
      const request = latest
      const result = await load(file)
      return request === latest ? result : null
    },
    cancel: () => {
      latest += 1
    },
  }
}

export interface StartMenuWiring {
  /**
   * Reads what the browser holds now: another tab may have saved since the
   * menu showed it.
   */
  readStored: () => StoredSave
  imports: SaveImports
  /** Plays `game`. */
  onStart: (game: GameState) => void
  /** Shows why the imported file was rejected, or clears it with null. */
  onImportError: (error: string | null) => void
  /** Opens the new game form. */
  onNewGame: () => void
  /** Opens the list of the Défis. */
  onDefis: () => void
}

export interface StartMenuActions {
  /** Plays `game`, such as a new one, dropping the file being read. */
  start: (game: GameState) => void
  /**
   * Plays the game the browser holds, if any, as another tab may have saved
   * it since the menu showed it.
   */
  continueGame: () => void
  /** Opens the new game form, dropping the file being read. */
  newGame: () => void
  /** Opens the list of the Défis, dropping the file being read. */
  openDefis: () => void
  /**
   * Reads `file` and plays its game, or shows why it was rejected, unless
   * the player has since picked another file or moved on.
   */
  importFile: (file: Pick<Blob, 'text'>) => Promise<void>
}

/** What the start menu's buttons do. */
export function startMenuActions({
  readStored,
  imports,
  onStart,
  onImportError,
  onNewGame,
  onDefis,
}: StartMenuWiring): StartMenuActions {
  const start = (game: GameState) => {
    imports.cancel()
    onStart(game)
  }
  /** Leaves the menu for another page, dropping the file being read. */
  const leave = (open: () => void) => () => {
    imports.cancel()
    onImportError(null)
    open()
  }
  return {
    start,
    continueGame: () => {
      const stored = readStored()
      if (stored.status === 'found') start(stored.game)
    },
    newGame: leave(onNewGame),
    openDefis: leave(onDefis),
    importFile: async (file) => {
      onImportError(null)
      const result = await imports.read(file)
      if (result === null) return
      if ('game' in result) start(result.game)
      else onImportError(result.error)
    },
  }
}
