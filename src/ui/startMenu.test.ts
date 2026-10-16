import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { deserialize, serialize } from '../engine/save.ts'
import type { GameState } from '../engine/types.ts'
import { startAutosave, type AutosaveHost } from './autosave.ts'
import { isChallengeOver } from './defis.ts'
import {
  SAVE_KEY,
  createSaveWriter,
  readStoredSave,
  type SaveStorage,
  type StoredSave,
} from './saves.ts'
import { continueStoredGame } from './startMenu.ts'
import { createGameStore, newChallenge } from './store.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

function game(businessName: string, seed = 7): GameState {
  return createInitialState(seed, FOOD_TRUCK, {
    businessName,
    avatar: 'femme',
    difficulty: 'moyen',
  })
}

const CONTINUED = game('Continued', 7)
const OTHER = game('Other', 9)

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
 * A tab on the start menu, as App runs it: the store plays what the menu
 * starts, and the autosave writes it to `storage` from then on. `failed()`
 * is whether the last save failed, which shows App's banner.
 */
function tab(storage: SaveStorage) {
  let hidden = false
  const listeners: (() => void)[] = []
  const host: AutosaveHost = {
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      listeners.push(listener)
      return () => {}
    },
  }
  const store = createGameStore(OTHER, NO_EVENTS)
  let failed = false
  const onStart = vi.fn((game: GameState) => {
    store.getState().startGame(game)
    const save = createSaveWriter(storage)
    startAutosave(
      store,
      (saved) => {
        failed = !save(saved)
      },
      host,
    )
  })
  const continueGame = () =>
    continueStoredGame(() => readStoredSave(storage), onStart)
  const hide = () => {
    hidden = true
    for (const listener of listeners) listener()
  }
  return { store, onStart, continueGame, hide, failed: () => failed }
}

describe('continueStoredGame', () => {
  it("continues the browser's saved game", () => {
    const onStart = vi.fn<(game: GameState) => void>()
    continueStoredGame(() => ({ status: 'found', game: CONTINUED }), onStart)
    expect(onStart).toHaveBeenCalledExactlyOnceWith(CONTINUED)
  })

  it.each<StoredSave>([
    { status: 'none' },
    { status: 'unreadable' },
    { status: 'unavailable' },
  ])('has nothing to continue when the browser holds $status', (stored) => {
    const onStart = vi.fn<(game: GameState) => void>()
    continueStoredGame(() => stored, onStart)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('continues the game as another tab saved it since the menu showed it', () => {
    const items: Record<string, string> = { [SAVE_KEY]: serialize(CONTINUED) }
    const storage = sharedStorage(items)
    // Tab B's menu shows the game on its first day, then tab A plays it
    // further and is closed.
    const tabB = tab(storage)
    const tabA = tab(storage)
    tabA.continueGame()
    tabA.store.getState().advance(30)
    tabA.hide()
    const ahead = tabA.store.getState().game
    expect(deserialize(items[SAVE_KEY]!)).toEqual(ahead)

    tabB.continueGame()
    tabB.hide()

    expect(tabB.onStart).toHaveBeenCalledExactlyOnceWith(ahead)
    expect(deserialize(items[SAVE_KEY]!)).toEqual(ahead)
    expect(tabB.failed()).toBe(false)
  })
})

describe('a Défi and the saved game', () => {
  // Day 31 is June 1st.
  const FIRST_OF_JUNE = 31

  it('leaves the long game saved through a Défi, its replay and the way back to the menu', () => {
    const items: Record<string, string> = { [SAVE_KEY]: serialize(CONTINUED) }
    const storage = sharedStorage(items)
    const { store, onStart, hide, failed } = tab(storage)

    // « Les travaux de la rue Saint-Denis » runs from May 15 to June 4.
    onStart(newChallenge('?seed=7', 'travauxSaintDenis'))
    store.getState().advance(40)
    expect(store.getState().game.day).toBeGreaterThan(FIRST_OF_JUNE)
    expect(isChallengeOver(store.getState().game)).toBe(true)
    hide()
    // « Rejouer »
    store.getState().startGame(newChallenge('?seed=8', 'travauxSaintDenis'))
    store.getState().advance(40)
    hide()

    // Back on the menu, « Continuer » still finds the long game.
    expect(readStoredSave(storage)).toEqual({
      status: 'found',
      game: CONTINUED,
    })
    expect(failed()).toBe(false)
  })

  it('still saves the long game played after a Défi', () => {
    const items: Record<string, string> = { [SAVE_KEY]: serialize(CONTINUED) }
    const { store, onStart, continueGame, hide } = tab(sharedStorage(items))
    onStart(newChallenge('?seed=7', 'travauxSaintDenis'))
    store.getState().advance(3)
    continueGame()
    store.getState().advance(FIRST_OF_JUNE)
    hide()
    expect(store.getState().game.day).toBe(FIRST_OF_JUNE)
    expect(deserialize(items[SAVE_KEY]!)).toEqual(store.getState().game)
  })
})
