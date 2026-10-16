import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { deserialize, serialize } from '../engine/save.ts'
import type { GameState } from '../engine/types.ts'
import { startAutosave, type AutosaveHost } from './autosave.ts'
import {
  INVALID_SAVE_FILE,
  SAVE_KEY,
  createSaveWriter,
  type ImportedSave,
  type SaveStorage,
} from './saves.ts'
import {
  createSaveImports,
  importAction,
  takePickedFile,
} from './settingsPanel.ts'
import { createGameStore, newChallenge, NORMAL_SPEED, PAUSED } from './store.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

function game(businessName: string, seed: number): GameState {
  return createInitialState(seed, FOOD_TRUCK, {
    businessName,
    avatar: 'femme',
    difficulty: 'moyen',
  })
}

function played(days: number, from: GameState): GameState {
  let state = from
  for (let i = 0; i < days; i += 1) state = tick(state)
  return state
}

const IMPORTED = game('Imported', 8)
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

/** A file that holds `text`. */
function fileOf(text: string) {
  return { text: () => Promise.resolve(text) }
}

const FILE = fileOf('')

describe('createSaveImports', () => {
  it('gives the result of a read nothing superseded', async () => {
    const imports = createSaveImports(() => Promise.resolve({ game: IMPORTED }))
    await expect(imports.read(FILE)).resolves.toEqual({ game: IMPORTED })
  })

  it('reads the file as importSaveFile does by default', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const imports = createSaveImports()
    await expect(imports.read(fileOf(serialize(IMPORTED)))).resolves.toEqual({
      game: IMPORTED,
    })
    await expect(imports.read(fileOf('{}'))).resolves.toEqual({
      error: INVALID_SAVE_FILE,
    })
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

/** « Importer une partie » with its callbacks as mocks. */
function importer() {
  const imports = createSaveImports()
  const onStart = vi.fn<(game: GameState) => void>()
  const onImportError = vi.fn<(error: string | null) => void>()
  const importFile = importAction({ imports, onStart, onImportError })
  return { imports, importFile, onStart, onImportError }
}

describe('importAction', () => {
  it('plays the game of an imported file', async () => {
    const { importFile, onStart, onImportError } = importer()
    await importFile(fileOf(serialize(OTHER)))
    expect(onStart).toHaveBeenCalledExactlyOnceWith(OTHER)
    expect(onImportError.mock.calls).toEqual([[null]])
  })

  it('clears the last error, then shows why a file was rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { importFile, onStart, onImportError } = importer()
    await importFile(fileOf('{}'))
    expect(onStart).not.toHaveBeenCalled()
    expect(onImportError.mock.calls).toEqual([[null], [INVALID_SAVE_FILE]])
  })

  it('plays only the last file picked, even when an earlier one reads last', async () => {
    const { importFile, onStart } = importer()
    const earlier = slowFile(serialize(IMPORTED))
    const later = slowFile(serialize(OTHER))
    const importingEarlier = importFile(earlier.file)
    const importingLater = importFile(later.file)
    later.finish()
    await importingLater
    earlier.finish()
    await importingEarlier
    expect(onStart).toHaveBeenCalledExactlyOnceWith(OTHER)
  })

  it('shows only why the last file picked was rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { importFile, onStart, onImportError } = importer()
    const earlier = slowFile(serialize(IMPORTED))
    const later = slowFile('{}')
    const importingEarlier = importFile(earlier.file)
    const importingLater = importFile(later.file)
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

  it.each([
    ['a game', serialize(IMPORTED)],
    ['an invalid file', '{}'],
  ])(
    'drops %s read while the panel closed, as its cancel on closing does',
    async (_, text) => {
      const { imports, importFile, onStart, onImportError } = importer()
      const file = slowFile(text)
      const importing = importFile(file.file)
      imports.cancel()
      file.finish()
      await importing
      expect(onStart).not.toHaveBeenCalled()
      expect(onImportError.mock.calls).toEqual([[null]])
    },
  )
})

describe('takePickedFile', () => {
  it('hands the file picked over, then empties the input', () => {
    const file = new File([serialize(IMPORTED)], 'magnat.json')
    const input = { files: [file], value: 'C:\\fakepath\\magnat.json' }
    const onImport = vi.fn<(file: File) => void>()
    takePickedFile(input, onImport)
    expect(onImport).toHaveBeenCalledExactlyOnceWith(file)
    expect(input.value).toBe('')
  })

  it('hands nothing over when the player picked no file', () => {
    const onImport = vi.fn<(file: File) => void>()
    takePickedFile({ files: [], value: '' }, onImport)
    takePickedFile({ files: null, value: '' }, onImport)
    expect(onImport).not.toHaveBeenCalled()
  })
})

/** A `localStorage` that every tab of the browser shares. */
function sharedStorage(items: Record<string, string>): SaveStorage {
  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

/**
 * A tab playing `playing`, as App runs it: its store, with the autosave
 * already writing to `storage`, then `days` played on, and « Réglages »
 * open, importing into the store. `failed()` is whether the last save
 * failed, which shows App's banner.
 */
function tab(storage: SaveStorage, playing: GameState, days = 0) {
  const host: AutosaveHost = {
    isHidden: () => false,
    onVisibilityChange: () => () => {},
  }
  const store = createGameStore(playing, NO_EVENTS)
  const save = createSaveWriter(storage)
  let failed = false
  startAutosave(
    store,
    (game, replaces) => (failed = !save(game, replaces)),
    host,
  )
  store.getState().advance(days)
  store.getState().setSpeed(3)
  store.getState().openPanel('settings')
  const onImportError = vi.fn<(error: string | null) => void>()
  const importFile = importAction({
    imports: createSaveImports(),
    onStart: store.getState().startGame,
    onImportError,
  })
  return { store, importFile, onImportError, failed: () => failed }
}

/** The game `items` holds. */
function stored(items: Record<string, string>): GameState {
  return deserialize(items[SAVE_KEY]!)
}

describe('an import mid-game', () => {
  // Day 0 is May 1st, so every game below is in May.
  const PLAYED = played(10, game('Played', 7))

  it('plays the imported game at normal speed, closing « Réglages »', async () => {
    const items: Record<string, string> = {}
    const { store, importFile } = tab(sharedStorage(items), PLAYED)
    expect(store.getState()).toMatchObject({ panel: 'settings', speed: PAUSED })
    await importFile(fileOf(serialize(IMPORTED)))
    expect(store.getState()).toMatchObject({
      game: IMPORTED,
      panel: null,
      speed: NORMAL_SPEED,
      resumeSpeed: null,
    })
  })

  it('replaces the saved game at once, though it is of the same month', async () => {
    const items: Record<string, string> = {}
    const { importFile, failed } = tab(sharedStorage(items), PLAYED)
    expect(stored(items)).toEqual(PLAYED)
    await importFile(fileOf(serialize(IMPORTED)))
    expect(stored(items)).toEqual(IMPORTED)
    expect(failed()).toBe(false)
  })

  it('replaces it with an earlier save of the same game', async () => {
    const items: Record<string, string> = {}
    const earlier = played(4, game('Played', 7))
    const { importFile } = tab(sharedStorage(items), PLAYED)
    await importFile(fileOf(serialize(earlier)))
    expect(stored(items)).toEqual(earlier)
  })

  it('replaces it though another tab saved its game further on since', async () => {
    const items: Record<string, string> = {}
    const storage = sharedStorage(items)
    const { importFile, failed } = tab(storage, PLAYED)
    const ahead = played(5, PLAYED)
    createSaveWriter(storage)(ahead)
    await importFile(fileOf(serialize(IMPORTED)))
    expect(stored(items)).toEqual(IMPORTED)
    expect(failed()).toBe(false)
  })

  it.each([
    ['as this tab last saved it', 0],
    ['further than this tab last saved it, behind where it plays', 4],
    ['where this tab plays it', 10],
    ['further than this tab plays it', 11],
    ['further than the other tab saved it', 15],
  ])(
    'replaces it with its own game %s, though another tab saved that further on since',
    async (_, day) => {
      const items: Record<string, string> = {}
      const storage = sharedStorage(items)
      const start = game('Played', 7)
      // This tab saved its game on day 0, then played on to day 10 in May,
      // which saves nothing; another tab then saved day 12 of it.
      const { store, importFile, failed } = tab(storage, start, 10)
      expect(store.getState().game.day).toBe(10)
      expect(stored(items)).toEqual(start)
      createSaveWriter(storage)(played(12, start))

      const imported = played(day, start)
      await importFile(fileOf(serialize(imported)))
      expect(store.getState().game).toEqual(imported)
      expect(stored(items)).toEqual(imported)
      expect(failed()).toBe(false)
    },
  )

  it('then saves the imported game as it plays on', async () => {
    const items: Record<string, string> = {}
    const { store, importFile } = tab(sharedStorage(items), PLAYED)
    await importFile(fileOf(serialize(IMPORTED)))
    // June 1st is day 31.
    store.getState().advance(31)
    expect(store.getState().game.day).toBe(31)
    expect(stored(items)).toEqual(store.getState().game)
  })

  it('never replaces the long game with an imported Défi', async () => {
    const items: Record<string, string> = {}
    const { store, importFile } = tab(sharedStorage(items), PLAYED)
    const defi = newChallenge('?seed=7', 'travauxSaintDenis')
    await importFile(fileOf(serialize(defi)))
    expect(store.getState().game).toEqual(defi)
    expect(stored(items)).toEqual(PLAYED)
  })

  it('leaves the game, the panel and the save alone when the file is rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const items: Record<string, string> = {}
    const { store, importFile, onImportError } = tab(
      sharedStorage(items),
      PLAYED,
    )
    await importFile(fileOf('{}'))
    expect(store.getState()).toMatchObject({
      game: PLAYED,
      panel: 'settings',
      speed: PAUSED,
      resumeSpeed: 3,
    })
    expect(onImportError).toHaveBeenLastCalledWith(INVALID_SAVE_FILE)
    expect(stored(items)).toEqual(PLAYED)
  })
})
