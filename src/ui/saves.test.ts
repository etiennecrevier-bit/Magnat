import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { SAVE_VERSION, serialize } from '../engine/save.ts'
import type { GameState } from '../engine/types.ts'
import {
  INVALID_SAVE_FILE,
  SAVE_KEY,
  UNREADABLE_SAVE_FILE,
  browserStorage,
  createSaveWriter,
  downloadSave,
  importSaveFile,
  readImportedSave,
  readStoredSave,
  saveFileName,
  writeStoredSave,
  type SaveStorage,
} from './saves.ts'

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function played(days: number, from: GameState): GameState {
  let state = from
  for (let i = 0; i < days; i += 1) state = tick(state)
  return state
}

const GAME = played(
  40,
  createInitialState(7, FOOD_TRUCK, {
    businessName: 'Chez Mimi',
    avatar: 'homme',
    difficulty: 'difficile',
  }),
)

/** An in-memory storage, as `localStorage` behaves when it works. */
function memoryStorage(items: Record<string, string> = {}): SaveStorage & {
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

/** A storage whose every access throws, as private browsing can. */
const BLOCKED: SaveStorage = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  },
}

describe('readStoredSave', () => {
  it('finds nothing in a browser that never saved', () => {
    expect(readStoredSave(memoryStorage())).toEqual({ status: 'none' })
  })

  it('loads the game an earlier visit saved', () => {
    const storage = memoryStorage()
    writeStoredSave(storage, GAME)
    const stored = readStoredSave(storage)
    expect(stored).toEqual({ status: 'found', game: GAME })
  })

  it.each([
    ['text that is not JSON', 'pas une partie'],
    [
      'a save of version 1',
      serialize(GAME).replace(
        `"saveVersion":${SAVE_VERSION}`,
        '"saveVersion":1',
      ),
    ],
    ['a tampered save', serialize(GAME).replace('"Chez Mimi"', '" Chez Mimi"')],
  ])('reports %s as unreadable, with the reason in the console', (_, text) => {
    expect(readStoredSave(memoryStorage({ [SAVE_KEY]: text }))).toEqual({
      status: 'unreadable',
    })
    expect(warn).toHaveBeenCalledWith(
      'The saved game does not load',
      expect.any(Error),
    )
  })

  it('reports storage that throws as unavailable', () => {
    expect(readStoredSave(BLOCKED)).toEqual({ status: 'unavailable' })
    expect(warn).toHaveBeenCalledOnce()
  })

  it('reports no storage at all as unavailable', () => {
    expect(readStoredSave(null)).toEqual({ status: 'unavailable' })
  })
})

describe('writeStoredSave', () => {
  it('saves the game under its key, replacing the one there', () => {
    const storage = memoryStorage({ [SAVE_KEY]: 'ancienne partie' })
    expect(writeStoredSave(storage, GAME)).toBe(true)
    expect(storage.items).toEqual({ [SAVE_KEY]: serialize(GAME) })
  })

  it('says so, and warns, when storage throws', () => {
    expect(writeStoredSave(BLOCKED, GAME)).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      'Could not save the game',
      expect.any(DOMException),
    )
  })

  it('says so without storage', () => {
    expect(writeStoredSave(null, GAME)).toBe(false)
  })
})

describe('createSaveWriter', () => {
  const LATER = played(5, GAME)

  it('saves over the game storage held, then keeps saving its own', () => {
    const storage = memoryStorage({ [SAVE_KEY]: 'ancienne partie' })
    const save = createSaveWriter(storage)
    expect(save(GAME)).toBe(true)
    expect(save(LATER)).toBe(true)
    expect(storage.items).toEqual({ [SAVE_KEY]: serialize(LATER) })
  })

  it('stops, and warns, while another tab saved the same game further on', () => {
    const storage = memoryStorage()
    const behind = createSaveWriter(storage)
    const ahead = createSaveWriter(storage)
    expect(behind(GAME)).toBe(true)
    expect(ahead(LATER)).toBe(true)
    expect(behind(played(3, GAME))).toBe(false)
    expect(storage.items).toEqual({ [SAVE_KEY]: serialize(LATER) })
    expect(warn).toHaveBeenCalledWith(
      'Another tab saved a game this one would set back',
    )
  })

  it.each([5, 10])(
    'saves over the same game another tab saved, once it played %i days of it',
    (days) => {
      const storage = memoryStorage()
      const behind = createSaveWriter(storage)
      const ahead = createSaveWriter(storage)
      behind(GAME)
      ahead(LATER)
      const further = played(days, GAME)
      expect(behind(further)).toBe(true)
      expect(storage.items).toEqual({ [SAVE_KEY]: serialize(further) })
    },
  )

  it.each([
    ['seed', createInitialState(8, FOOD_TRUCK, GAME.profile)],
    [
      'business name',
      createInitialState(7, FOOD_TRUCK, {
        ...GAME.profile,
        businessName: 'Chez Toto',
      }),
    ],
    [
      'avatar',
      createInitialState(7, FOOD_TRUCK, { ...GAME.profile, avatar: 'femme' }),
    ],
    [
      'difficulty',
      createInitialState(7, FOOD_TRUCK, {
        ...GAME.profile,
        difficulty: 'facile',
      }),
    ],
  ])(
    'does not save over a game of another %s another tab started',
    (_, other) => {
      const storage = memoryStorage()
      const save = createSaveWriter(storage)
      save(GAME)
      createSaveWriter(storage)(other)
      expect(save(LATER)).toBe(false)
      expect(storage.items).toEqual({ [SAVE_KEY]: serialize(other) })
    },
  )

  it.each([
    ['another game', createInitialState(8, FOOD_TRUCK, GAME.profile)],
    ['an earlier save of its game', GAME],
  ])(
    'replaces what another tab saved since with %s it is handed, as an import mid-game',
    (_, imported) => {
      const storage = memoryStorage()
      const save = createSaveWriter(storage)
      save(LATER)
      createSaveWriter(storage)(played(3, LATER))
      expect(save(imported)).toBe(true)
      expect(storage.items).toEqual({ [SAVE_KEY]: serialize(imported) })
      // From then on it saves that game played on, and only that.
      const further = played(1, imported)
      expect(save(further)).toBe(true)
      createSaveWriter(storage)(played(3, imported))
      expect(save(played(2, imported))).toBe(false)
    },
  )

  it("does not save over a save it cannot load, such as a newer version's", () => {
    const storage = memoryStorage()
    const save = createSaveWriter(storage)
    save(GAME)
    const newer = JSON.stringify({ saveVersion: SAVE_VERSION + 1 })
    storage.items[SAVE_KEY] = newer
    expect(save(LATER)).toBe(false)
    expect(storage.items).toEqual({ [SAVE_KEY]: newer })
  })

  it('saves again over storage cleared since', () => {
    const storage = memoryStorage()
    const save = createSaveWriter(storage)
    save(GAME)
    delete storage.items[SAVE_KEY]
    expect(save(LATER)).toBe(true)
    expect(storage.items).toEqual({ [SAVE_KEY]: serialize(LATER) })
  })
})

describe('browserStorage', () => {
  it('is null where there is no window, as here', () => {
    expect(browserStorage()).toBeNull()
  })

  it("is the window's localStorage", () => {
    const storage = memoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    expect(browserStorage()).toBe(storage)
  })

  it('is null when reading localStorage throws', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    expect(browserStorage()).toBeNull()
  })
})

describe('readImportedSave', () => {
  it('loads an exported game', () => {
    expect(readImportedSave(serialize(GAME))).toEqual({ game: GAME })
  })

  it.each([
    ['an empty file', ''],
    ['a file that is not JSON', '<html></html>'],
    ['JSON that is not a save', '{"partie": 1}'],
    [
      'a save of version 1',
      serialize(GAME).replace(
        `"saveVersion":${SAVE_VERSION}`,
        '"saveVersion":1',
      ),
    ],
    ['a tampered save', serialize(GAME).replace('"day":40', '"day":41')],
  ])('rejects %s with a French message', (_, text) => {
    expect(readImportedSave(text)).toEqual({ error: INVALID_SAVE_FILE })
    expect(INVALID_SAVE_FILE).toBe(
      "Ce fichier n'est pas une sauvegarde valide de Magnat.",
    )
    expect(warn).toHaveBeenCalledWith(
      'The imported file is not a saved game',
      expect.objectContaining({
        message: expect.stringMatching(/^Invalid save/),
      }),
    )
  })
})

describe('importSaveFile', () => {
  it('loads the game a file holds', async () => {
    const file = new Blob([serialize(GAME)], { type: 'application/json' })
    expect(await importSaveFile(file)).toEqual({ game: GAME })
  })

  it('rejects a file that is not a save', async () => {
    expect(await importSaveFile(new Blob(['bonjour']))).toEqual({
      error: INVALID_SAVE_FILE,
    })
  })

  it('reports a file the browser cannot read', async () => {
    const file = { text: () => Promise.reject(new Error('NotReadableError')) }
    expect(await importSaveFile(file)).toEqual({ error: UNREADABLE_SAVE_FILE })
    expect(UNREADABLE_SAVE_FILE).toBe("Ce fichier n'a pas pu être lu.")
  })
})

describe('saveFileName', () => {
  it.each([
    ["Le P'tit Camion", 0, 'magnat-le-ptit-camion-jour-0.json'],
    ['Chez Mimi', 40, 'magnat-chez-mimi-jour-40.json'],
    ['Café Ô Délice', 3, 'magnat-cafe-o-delice-jour-3.json'],
    ['L’Érable 2', 7, 'magnat-lerable-2-jour-7.json'],
    ['🚚🥐', 1, 'magnat-partie-jour-1.json'],
  ])('names the save of %s on day %d %s', (businessName, day, name) => {
    const game = { ...GAME, day, profile: { ...GAME.profile, businessName } }
    expect(saveFileName(game)).toBe(name)
  })
})

describe('downloadSave', () => {
  it('downloads the game as a file the import loads', async () => {
    vi.useFakeTimers()
    const link = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    }
    const append = vi.fn()
    const doc = {
      createElement: vi.fn(() => link),
      body: { append },
    } as unknown as Document
    let blob: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation((object) => {
      blob = object as Blob
      return 'blob:magnat'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    downloadSave(GAME, doc)

    expect(doc.createElement).toHaveBeenCalledWith('a')
    expect(link).toMatchObject({
      href: 'blob:magnat',
      download: 'magnat-chez-mimi-jour-40.json',
    })
    expect(append).toHaveBeenCalledWith(link)
    expect(link.click).toHaveBeenCalledOnce()
    expect(link.remove).toHaveBeenCalledOnce()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:magnat')
    vi.useRealTimers()

    expect(blob?.type).toBe('application/json')
    expect(await importSaveFile(blob!)).toEqual({ game: GAME })
  })
})
