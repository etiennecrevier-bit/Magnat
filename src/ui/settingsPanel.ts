import type { GameState } from '../engine/types.ts'
import { importSaveFile, type ImportedSave } from './saves.ts'

// Reading an imported file takes a while, and meanwhile the player may pick
// another file or close « Réglages ». A read that finishes after that must
// not start its game over the one the player went back to, so picking a
// file, and closing the panel, drops the read in progress.

/** The files « Réglages » imports, of which only the latest one counts. */
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

export interface SaveImportWiring {
  imports: SaveImports
  /** Plays `game` in place of the one played. */
  onStart: (game: GameState) => void
  /** Shows why the imported file was rejected, or clears it with null. */
  onImportError: (error: string | null) => void
}

/**
 * What « Importer une partie » does with the file picked: clears the last
 * error, reads the file, then plays its game or shows why it was rejected,
 * unless the player has since picked another file or closed the panel.
 */
export function importAction({
  imports,
  onStart,
  onImportError,
}: SaveImportWiring): (file: Pick<Blob, 'text'>) => Promise<void> {
  return async (file) => {
    onImportError(null)
    const result = await imports.read(file)
    if (result === null) return
    if ('game' in result) onStart(result.game)
    else onImportError(result.error)
  }
}

/**
 * Hands the file picked in `input` to `onImport`, if any, and empties the
 * input, so that picking the same file again still reports it.
 */
export function takePickedFile(
  input: { readonly files: ArrayLike<File> | null; value: string },
  onImport: (file: File) => void,
): void {
  const file = input.files?.[0]
  input.value = ''
  if (file !== undefined) onImport(file)
}
