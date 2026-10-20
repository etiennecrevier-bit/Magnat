import { describe, expect, it } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { readStoredSave, writeStoredSave } from './saves.ts'
import { createSettingsStore, type SettingsStorage } from './settings.ts'
import { createGameStore, newChallenge, newGame } from './store.ts'
import { nextStreetLegend, watchStreetLegend } from './streetLegend.ts'

/** A storage the settings keep in, as a browser's would between games. */
function memory(): SettingsStorage {
  const items: Record<string, string> = {}
  return {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value
    },
  }
}

const DAYS = 3

describe('nextStreetLegend', () => {
  it('takes the first game in its first days, keeps it, then is done', () => {
    expect(nextStreetLegend('unseen', { day: 0, seed: 42 }, DAYS)).toEqual({
      seed: 42,
    })
    const taken = { seed: 42 }
    expect(nextStreetLegend(taken, { day: 2, seed: 42 }, DAYS)).toBe(taken)
    expect(nextStreetLegend(taken, { day: 3, seed: 42 }, DAYS)).toBe('done')
  })

  it('is done once another game plays, or the first is past its days', () => {
    expect(nextStreetLegend({ seed: 42 }, { day: 0, seed: 7 }, DAYS)).toBe(
      'done',
    )
    expect(nextStreetLegend('unseen', { day: 3, seed: 42 }, DAYS)).toBe('done')
    expect(nextStreetLegend('done', { day: 0, seed: 42 }, DAYS)).toBe('done')
  })

  it('is done once a new game starts, even on the first game’s seed', () => {
    const taken = { seed: 42 }
    expect(nextStreetLegend(taken, { day: 0, seed: 42 }, DAYS, true)).toBe(
      'done',
    )
    expect(nextStreetLegend(taken, { day: 0, seed: 42 }, DAYS, false)).toBe(
      taken,
    )
    expect(
      nextStreetLegend('unseen', { day: 0, seed: 42 }, DAYS, true),
    ).toEqual({ seed: 42 })
  })
})

describe('watchStreetLegend', () => {
  it('shows for the first three days of the first game, then never again', () => {
    const storage = memory()
    const settings = createSettingsStore(storage)
    const store = createGameStore(createInitialState(42), NO_EVENTS)
    const stop = watchStreetLegend(store, settings, DAYS)
    expect(settings.getState().streetLegend).toEqual({ seed: 42 })

    store.getState().advance(2)
    expect(settings.getState().streetLegend).toEqual({ seed: 42 })
    store.getState().advance(1)
    expect(settings.getState().streetLegend).toBe('done')
    stop()

    // A later game, after a reload, never shows it.
    const later = createGameStore(createInitialState(7), NO_EVENTS)
    const reloaded = createSettingsStore(storage)
    watchStreetLegend(later, reloaded, DAYS)
    expect(reloaded.getState().streetLegend).toBe('done')
  })

  it('keeps showing in the first game after a reload, while in its first days', () => {
    const storage = memory()
    const store = createGameStore(createInitialState(42), NO_EVENTS)
    watchStreetLegend(store, createSettingsStore(storage), DAYS)()
    store.getState().advance(1)

    // The page reloads; the same game loads from its save.
    const reloaded = createSettingsStore(storage)
    watchStreetLegend(createGameStore(store.getState().game), reloaded, DAYS)
    expect(reloaded.getState().streetLegend).toEqual({ seed: 42 })
  })

  it('never shows again once the first game is left before its third day', () => {
    const storage = memory()
    const first = createGameStore(createInitialState(42), NO_EVENTS)
    watchStreetLegend(first, createSettingsStore(storage), DAYS)()

    // Back to the menu, then a new game, after a reload or in its place.
    const reloaded = createSettingsStore(storage)
    const second = createGameStore(createInitialState(7), NO_EVENTS)
    watchStreetLegend(second, reloaded, DAYS)
    expect(reloaded.getState().streetLegend).toBe('done')

    const settings = createSettingsStore(storage)
    const store = createGameStore(createInitialState(42), NO_EVENTS)
    watchStreetLegend(store, settings, DAYS)
    store.getState().startGame(createInitialState(9))
    expect(settings.getState().streetLegend).toBe('done')
  })

  it('never shows for a loaded save already past its days', () => {
    const settings = createSettingsStore(memory())
    const store = createGameStore(createInitialState(42), NO_EVENTS)
    store.getState().advance(5)
    watchStreetLegend(store, settings, DAYS)
    expect(settings.getState().streetLegend).toBe('done')
  })

  it('follows a game started in place of the first, and stops when asked', () => {
    const settings = createSettingsStore(memory())
    const store = createGameStore(createInitialState(42), NO_EVENTS)
    const stop = watchStreetLegend(store, settings, DAYS)
    stop()
    store.getState().startGame(createInitialState(7))
    expect(settings.getState().streetLegend).toEqual({ seed: 42 })
  })

  describe('on a ?seed= address, where every new game has the same seed', () => {
    const SEARCH = '?seed=42'

    /** The first game, new, played one day, then the menu. */
    function playFirstDay(storage: SettingsStorage) {
      const store = createGameStore(newGame(SEARCH), NO_EVENTS)
      const settings = createSettingsStore(storage)
      const stop = watchStreetLegend(store, settings, DAYS)
      store.getState().advance(1)
      stop()
      return { store, settings }
    }

    it('never shows in a new game started in place of the first', () => {
      const settings = createSettingsStore(memory())
      const store = createGameStore(newGame(SEARCH), NO_EVENTS)
      watchStreetLegend(store, settings, DAYS)
      store.getState().advance(1)
      expect(settings.getState().streetLegend).toEqual({ seed: 42 })

      store.getState().startGame(newGame(SEARCH))
      expect(store.getState().game.seed).toBe(42)
      expect(settings.getState().streetLegend).toBe('done')
    })

    it('never shows in a new game started from the menu', () => {
      const storage = memory()
      const { store, settings } = playFirstDay(storage)

      store.getState().startGame(newGame(SEARCH))
      watchStreetLegend(store, settings, DAYS)
      expect(settings.getState().streetLegend).toBe('done')
    })

    it('never shows in a new game or Défi after a reload', () => {
      for (const next of [
        () => newGame(SEARCH),
        () => newChallenge(SEARCH, 'travauxSaintDenis'),
      ]) {
        const storage = memory()
        playFirstDay(storage)

        const reloaded = createSettingsStore(storage)
        watchStreetLegend(createGameStore(next(), NO_EVENTS), reloaded, DAYS)
        expect(reloaded.getState().streetLegend).toBe('done')
      }
    })

    it('keeps showing when the first game is continued from its save', () => {
      const storage = memory()
      const saves = memory()
      const { store: first, settings: menu } = playFirstDay(storage)
      writeStoredSave(saves, first.getState().game)

      // « Continuer », back at the menu, then after a reload.
      for (const settings of [menu, createSettingsStore(storage)]) {
        const stored = readStoredSave(saves)
        if (stored.status !== 'found') throw new Error('no save')
        first.getState().startGame(stored.game)
        const stop = watchStreetLegend(first, settings, DAYS)
        expect(settings.getState().streetLegend).toEqual({ seed: 42 })
        stop()
      }
    })

    it('keeps showing as the first game is watched again, as React does', () => {
      const settings = createSettingsStore(memory())
      const store = createGameStore(newGame(SEARCH), NO_EVENTS)
      watchStreetLegend(store, settings, DAYS)()
      watchStreetLegend(store, settings, DAYS)
      expect(settings.getState().streetLegend).toEqual({ seed: 42 })
    })
  })
})
