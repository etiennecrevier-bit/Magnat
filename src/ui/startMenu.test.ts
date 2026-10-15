import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Avatar } from '../content/schema.ts'
import { createInitialState } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { deserialize, serialize } from '../engine/save.ts'
import type { GameState } from '../engine/types.ts'
import { startAutosave, type AutosaveHost } from './autosave.ts'
import {
  INVALID_SAVE_FILE,
  SAVE_KEY,
  createSaveWriter,
  readStoredSave,
  type ImportedSave,
  type SaveStorage,
  type StoredSave,
} from './saves.ts'
import { createSaveImports, startMenuActions } from './startMenu.ts'
import { createGameStore, NORMAL_SPEED, PAUSED } from './store.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

function game(
  businessName: string,
  seed = 7,
  avatar: Avatar = 'femme',
): GameState {
  return createInitialState(seed, FOOD_TRUCK, {
    businessName,
    avatar,
    difficulty: 'moyen',
  })
}

const CONTINUED = game('Continued', 7)
const IMPORTED = game('Imported', 8, 'homme')
const OTHER = game('Other', 9)

/** A file whose read finishes only when the test calls `finish`. */
function slowFile(text: string) {
  let finish!: () => void
  const read = new Promise<string>((resolve) => {
    finish = () => resolve(text)
  })
  return { file: { text: () => read }, finish }
}

/** A read that finishes only when the test calls `finish`. */
function slowRead() {
  let finish!: (result: ImportedSave) => void
  const read = new Promise<ImportedSave>((resolve) => {
    finish = resolve
  })
  return { read, finish }
}

const FILE = { text: () => Promise.resolve('') }

describe('createSaveImports', () => {
  it('gives the result of a read nothing superseded', async () => {
    const imports = createSaveImports(() => Promise.resolve({ game: IMPORTED }))
    await expect(imports.read(FILE)).resolves.toEqual({ game: IMPORTED })
  })

  it('reads the file as importSaveFile does by default', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const imports = createSaveImports()
    await expect(
      imports.read({ text: () => Promise.resolve(serialize(IMPORTED)) }),
    ).resolves.toEqual({ game: IMPORTED })
    await expect(
      imports.read({ text: () => Promise.resolve('{}') }),
    ).resolves.toEqual({ error: INVALID_SAVE_FILE })
  })

  it('drops a read cancelled before it finished', async () => {
    const slow = slowRead()
    const imports = createSaveImports(() => slow.read)
    const reading = imports.read(FILE)
    imports.cancel()
    slow.finish({ game: IMPORTED })
    await expect(reading).resolves.toBeNull()
  })

  it.each(['first', 'last'])(
    'drops a read a later one superseded, when the earlier finishes %s',
    async (order) => {
      const earlier = slowRead()
      const later = slowRead()
      const reads = [earlier.read, later.read]
      const imports = createSaveImports(() => reads.shift()!)
      const readingEarlier = imports.read(FILE)
      const readingLater = imports.read(FILE)
      if (order === 'first') earlier.finish({ game: IMPORTED })
      later.finish({ game: OTHER })
      if (order === 'last') earlier.finish({ game: IMPORTED })
      await expect(readingEarlier).resolves.toBeNull()
      await expect(readingLater).resolves.toEqual({ game: OTHER })
    },
  )

  it('still reads the files picked after a cancel', async () => {
    const imports = createSaveImports(() => Promise.resolve({ game: IMPORTED }))
    imports.cancel()
    await expect(imports.read(FILE)).resolves.toEqual({ game: IMPORTED })
  })
})

/** The start menu over `stored`, with its callbacks as mocks. */
function menu(stored: StoredSave = { status: 'none' }) {
  const onStart = vi.fn<(game: GameState) => void>()
  const onImportError = vi.fn<(error: string | null) => void>()
  const onNewGame = vi.fn<() => void>()
  const actions = startMenuActions({
    stored,
    imports: createSaveImports(),
    onStart,
    onImportError,
    onNewGame,
  })
  return { actions, onStart, onImportError, onNewGame }
}

describe('startMenuActions', () => {
  it('plays the game of an imported file', async () => {
    const { actions, onStart, onImportError } = menu()
    await actions.importFile({ text: () => Promise.resolve(serialize(OTHER)) })
    expect(onStart).toHaveBeenCalledExactlyOnceWith(OTHER)
    expect(onImportError.mock.calls).toEqual([[null]])
  })

  it('clears the last error, then shows why a file was rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { actions, onStart, onImportError } = menu()
    await actions.importFile({ text: () => Promise.resolve('{}') })
    expect(onStart).not.toHaveBeenCalled()
    expect(onImportError.mock.calls).toEqual([[null], [INVALID_SAVE_FILE]])
  })

  it("continues the browser's saved game", () => {
    const { actions, onStart } = menu({ status: 'found', game: CONTINUED })
    actions.continueGame()
    expect(onStart).toHaveBeenCalledExactlyOnceWith(CONTINUED)
  })

  it.each<StoredSave>([
    { status: 'none' },
    { status: 'unreadable' },
    { status: 'unavailable' },
  ])('has nothing to continue when the browser holds $status', (stored) => {
    const { actions, onStart } = menu(stored)
    actions.continueGame()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('opens the new game form, clearing the last import error', () => {
    const { actions, onNewGame, onImportError } = menu()
    actions.newGame()
    expect(onNewGame).toHaveBeenCalledOnce()
    expect(onImportError.mock.calls).toEqual([[null]])
  })

  it('does not let a file read during Continuer replace the continued game', async () => {
    // As App runs it: the store plays what the menu starts, and the
    // autosave writes it to the browser from then on.
    const items: Record<string, string> = { [SAVE_KEY]: serialize(CONTINUED) }
    const storage: SaveStorage = {
      getItem: (key) => items[key] ?? null,
      setItem: (key, value) => {
        items[key] = value
      },
    }
    let hidden = false
    const listeners: (() => void)[] = []
    const host: AutosaveHost = {
      isHidden: () => hidden,
      onVisibilityChange: (listener) => {
        listeners.push(listener)
        return () => {}
      },
    }
    const store = createGameStore(OTHER)
    const onStart = vi.fn((game: GameState) => {
      store.getState().startGame(game)
      startAutosave(store, createSaveWriter(storage), host)
    })
    const actions = startMenuActions({
      stored: readStoredSave(storage),
      imports: createSaveImports(),
      onStart,
      onImportError: () => {},
      onNewGame: () => {},
    })

    const imported = slowFile(serialize(IMPORTED))
    const importing = actions.importFile(imported.file)
    actions.continueGame()
    store.getState().togglePause()
    imported.finish()
    await importing
    hidden = true
    for (const listener of listeners) listener()

    expect(onStart).toHaveBeenCalledExactlyOnceWith(CONTINUED)
    expect(store.getState().game).toEqual(CONTINUED)
    expect(store.getState().speed).toBe(PAUSED)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(NORMAL_SPEED)
    expect(deserialize(items[SAVE_KEY]!)).toEqual(CONTINUED)
  })

  it.each([
    ['a game', serialize(IMPORTED)],
    ['an invalid file', '{}'],
  ])(
    'drops %s read while the player opened the new game form',
    async (_, text) => {
      const { actions, onStart, onImportError, onNewGame } = menu()
      const file = slowFile(text)
      const importing = actions.importFile(file.file)
      actions.newGame()
      file.finish()
      await importing
      expect(onNewGame).toHaveBeenCalledOnce()
      expect(onStart).not.toHaveBeenCalled()
      expect(onImportError.mock.calls).toEqual([[null], [null]])
    },
  )

  it('drops a file read while the player started a new game', async () => {
    const { actions, onStart } = menu()
    const file = slowFile(serialize(IMPORTED))
    const importing = actions.importFile(file.file)
    actions.start(OTHER)
    file.finish()
    await importing
    expect(onStart).toHaveBeenCalledExactlyOnceWith(OTHER)
  })

  it('plays only the last file picked, even when an earlier one reads last', async () => {
    const { actions, onStart } = menu()
    const earlier = slowFile(serialize(IMPORTED))
    const later = slowFile(serialize(OTHER))
    const importingEarlier = actions.importFile(earlier.file)
    const importingLater = actions.importFile(later.file)
    later.finish()
    await importingLater
    earlier.finish()
    await importingEarlier
    expect(onStart).toHaveBeenCalledExactlyOnceWith(OTHER)
  })

  it('shows only why the last file picked was rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { actions, onStart, onImportError } = menu()
    const earlier = slowFile(serialize(IMPORTED))
    const later = slowFile('{}')
    const importingEarlier = actions.importFile(earlier.file)
    const importingLater = actions.importFile(later.file)
    earlier.finish()
    later.finish()
    await Promise.all([importingEarlier, importingLater])
    expect(onStart).not.toHaveBeenCalled()
    expect(onImportError.mock.calls).toEqual([
      [null],
      [null],
      [INVALID_SAVE_FILE],
    ])
  })
})
