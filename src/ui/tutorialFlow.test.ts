import { describe, expect, it, vi } from 'vitest'
import type { TutorialGesture } from '../content/schema.ts'
import { createInitialState, startChallenge } from '../engine/clock.ts'
import { DEFIS, DIFFICULTIES, FOOD_TRUCK } from '../engine/day.ts'
import { latestDecisions } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { deserialize, serialize } from '../engine/save.ts'
import { TUTORIAL } from '../engine/tutorial.ts'
import type { GameState } from '../engine/types.ts'
import {
  createGameStore,
  newTutorialGame,
  NORMAL_SPEED,
  PAUSED,
  type GameStore,
} from './store.ts'
import {
  coachShowing,
  gestureDone,
  signalDone,
  stepView,
  watchTutorial,
  type GestureState,
  type StepView,
  type TimerHost,
} from './tutorialFlow.ts'
import { startAutosave, type AutosaveHost } from './autosave.ts'
import {
  createSaveWriter,
  readStoredSave,
  SAVE_KEY,
  type SaveStorage,
} from './saves.ts'
import { replayTour } from './settingsPanel.ts'
import { createTutorialSignals } from './tutorialSignals.ts'

/** Timers run by hand. */
function fakeTimers() {
  let next = 1
  const waiting = new Map<number, { callback: () => void; ms: number }>()
  const host: TimerHost = {
    setTimeout: (callback, ms) => {
      waiting.set(next, { callback, ms })
      return next++
    },
    clearTimeout: (handle) => waiting.delete(handle),
  }
  const runAll = () => {
    const due = [...waiting.values()]
    waiting.clear()
    for (const { callback } of due) callback()
  }
  return { host, waiting, runAll }
}

function watched(game: GameState = newTutorialGame()) {
  const store = createGameStore(game)
  const signals = createTutorialSignals()
  const timers = fakeTimers()
  const stop = watchTutorial(store, signals, 1500, timers.host)
  return { store, signals, timers, stop }
}

const due = (store: GameStore) => stepView(store.getState().game)?.id ?? null

/** Plays the store's days until a step is due, or `most` days pass. */
function playToStep(store: GameStore, most = 3) {
  for (let i = 0; i < most && due(store) === null; i += 1) {
    store.getState().advance(1)
  }
}

/** The café's price one step up, as the stepper would ask. */
function raiseCafe(store: GameStore) {
  const price = latestDecisions(store.getState().game).prices.cafe
  store.getState().decide({
    kind: 'price',
    product: 'cafe',
    price: cents(price + 25),
  })
}

function raiseCroissants(store: GameStore) {
  store.getState().decide({
    kind: 'restock',
    product: 'croissant',
    rule: { kind: 'buyDaily', quantity: 80 },
  })
}

/**
 * Makes each step's gesture, through the store and `signals` as the
 * interface would, and plays the days, until `id` is due.
 */
function playTo(
  store: GameStore,
  signals: ReturnType<typeof createTutorialSignals>,
  id: string,
) {
  for (let guard = 0; guard < 100; guard += 1) {
    const view = stepView(store.getState().game)
    if (view?.id === id) return
    const state = store.getState()
    if (view === null) {
      if (state.panel !== null) state.closePanel()
      else state.advance(1)
      continue
    }
    switch (view.gesture) {
      case 'next':
      case 'priceOrOk':
        state.completeTutorialStep(view.id)
        break
      case 'openTruck':
        state.openPanel('manage')
        break
      case 'priceChange':
        raiseCafe(store)
        break
      case 'speed1':
        state.closePanel()
        state.setSpeed(NORMAL_SPEED)
        break
      case 'readYesterday':
        state.openPanel('manage', 'menu')
        break
      case 'restockRaise':
        raiseCroissants(store)
        break
      case 'tooltip':
        signals.emit({ kind: 'tooltip', anchor: view.tipAnchors[0]! })
        break
      case 'choice':
        state.chooseEvent('avecPlaisir')
        break
      case 'speed3':
        state.setSpeed(3)
        break
      case 'pause':
        state.setSpeed(PAUSED)
        break
      case 'finances':
        state.openDrawer('finances')
        break
    }
  }
  throw new Error(`Step ${id} never came`)
}

describe('stepView', () => {
  it('shows the first step on a new tutorial game, and none in a game without one', () => {
    const view = stepView(newTutorialGame())
    expect(view).toMatchObject({
      id: 'bienvenue',
      gesture: 'next',
      button: 'Allons-y',
      anchors: [],
      showOnly: true,
    })
    expect(stepView(createInitialState(1))).toBeNull()
  })

  it('takes every text from tutorial.json', () => {
    const { tutorial } = newTutorialGame()
    // The day before showed both facts, so no fallback shows.
    const lastDay = {
      lostSales: { croissant: 3 },
      pricedOut: { cafe: 2 },
    } as unknown as GameState['lastDay']
    for (const step of TUTORIAL.steps) {
      const view = stepView({
        day: step.day - 1,
        tutorial: { ...tutorial!, step: step.id },
        lastDay,
      })
      expect(view?.text).toBe(step.text)
      expect(view?.button).toBe(step.button ?? null)
    }
  })

  it('shows the fallback, with its button, when the fact did not happen', () => {
    const { tutorial } = newTutorialGame()
    // No day played: neither fact happened.
    const view = stepView({
      day: 2,
      tutorial: { ...tutorial!, step: 'tropCher' },
      lastDay: null,
    })
    expect(view).toMatchObject({
      id: 'tropCher',
      gesture: 'next',
      text: "Personne s'est plaint du café. Pas pire!",
      button: 'Parfait',
      tipAnchors: [],
      showOnly: true,
    })
  })
})

describe('gestureDone', () => {
  const game = newTutorialGame()
  const base: GestureState = {
    game,
    panel: null,
    panelSection: null,
    drawer: null,
    speed: PAUSED,
  }
  const cases: [TutorialGesture, Partial<GestureState>][] = [
    ['openTruck', { panel: 'manage' }],
    ['finances', { drawer: 'finances' }],
    ['speed1', { speed: NORMAL_SPEED }],
    ['speed3', { speed: 3 }],
    ['readYesterday', { panel: 'manage', panelSection: 'menu' }],
  ]

  it.each(cases)(
    '%s completes on its change, and on no other',
    (gesture, change) => {
      expect(gestureDone(gesture, base, { ...base, ...change })).toBe(true)
      for (const [other, otherChange] of cases) {
        if (other === gesture) continue
        const done = gestureDone(gesture, base, { ...base, ...otherChange })
        // « Hier » opens « Camion » on « Menu », which opens the truck too.
        const alsoTruck = gesture === 'openTruck' && other === 'readYesterday'
        expect(done, other).toBe(alsoTruck)
      }
    },
  )

  it('readYesterday wants « Camion » opened on « Menu », as « Hier » opens it', () => {
    expect(
      gestureDone('readYesterday', base, { ...base, panel: 'manage' }),
    ).toBe(false)
  })

  it('pause completes as the speed drops to 0', () => {
    const running = { ...base, speed: 3 }
    expect(gestureDone('pause', running, base)).toBe(true)
    expect(gestureDone('pause', base, base)).toBe(false)
  })

  it('a price changed completes priceChange and priceOrOk; the croissant rule raised, restockRaise', () => {
    const store = createGameStore(game)
    raiseCafe(store)
    const priced = { ...base, game: store.getState().game }
    expect(gestureDone('priceChange', base, priced)).toBe(true)
    expect(gestureDone('priceOrOk', base, priced)).toBe(true)
    expect(gestureDone('restockRaise', base, priced)).toBe(false)
    raiseCroissants(store)
    const raised = { ...priced, game: store.getState().game }
    expect(gestureDone('restockRaise', priced, raised)).toBe(true)
    expect(gestureDone('priceChange', priced, raised)).toBe(false)
    // Lowered is not raised.
    expect(gestureDone('restockRaise', raised, priced)).toBe(false)
  })

  it('a choice made empties the event waiting', () => {
    const waiting = {
      ...base,
      game: {
        ...game,
        events: {
          ...game.events,
          pending: { event: 'tutoStory', followUp: false },
        },
      },
    }
    expect(gestureDone('choice', waiting, base)).toBe(true)
    expect(gestureDone('choice', base, base)).toBe(false)
  })

  it('a button or a tooltip is never the store’s', () => {
    expect(gestureDone('next', base, { ...base, panel: 'manage' })).toBe(false)
    expect(gestureDone('tooltip', base, { ...base, panel: 'manage' })).toBe(
      false,
    )
  })
})

describe('signalDone', () => {
  const step = (gesture: TutorialGesture, tipAnchors: string[] = []) =>
    ({
      id: 's',
      gesture,
      text: '',
      button: null,
      anchors: [],
      tipAnchors,
      showOnly: false,
    }) satisfies StepView

  it('a tooltip of its anchors completes a tooltip step, another does not', () => {
    const tip = step('tooltip', ['menu.cafe'])
    expect(signalDone(tip, { kind: 'tooltip', anchor: 'menu.cafe' })).toBe(true)
    expect(signalDone(tip, { kind: 'tooltip', anchor: 'cash.chip' })).toBe(
      false,
    )
  })

  it('the speed button asked for completes its step, even on the speed already picked', () => {
    expect(signalDone(step('pause'), { kind: 'speed', speed: 0 })).toBe(true)
    expect(signalDone(step('pause'), { kind: 'speed', speed: 3 })).toBe(false)
    expect(signalDone(step('speed1'), { kind: 'speed', speed: 1 })).toBe(true)
    expect(signalDone(step('speed3'), { kind: 'speed', speed: 3 })).toBe(true)
    expect(signalDone(step('speed3'), { kind: 'speed', speed: 10 })).toBe(false)
  })
})

describe('watchTutorial', () => {
  it('plays the seven days, each gesture completing its step, to the first report', () => {
    const { store, signals, timers, stop } = watched()
    const state = () => store.getState()
    expect(state().speed).toBe(PAUSED)

    // Day 1.
    expect(due(store)).toBe('bienvenue')
    state().completeTutorialStep('bienvenue')
    expect(due(store)).toBe('ouvrirCamion')
    state().openPanel('manage')
    expect(due(store)).toBe('changerPrix')
    raiseCafe(store)
    expect(due(store)).toBe('lancerJour')
    state().closePanel()
    expect(state().speed).toBe(PAUSED)
    // The days stay held while a step is due.
    state().advance(1)
    expect(state().game.day).toBe(0)
    state().setSpeed(NORMAL_SPEED)
    expect(due(store)).toBeNull()
    expect(state().speed).toBe(NORMAL_SPEED)

    // Day 2: the morning stops, paused, on its first step.
    playToStep(store)
    expect(state().game.day).toBe(1)
    expect(state().speed).toBe(PAUSED)
    expect(due(store)).toBe('lireHier')
    state().openPanel('manage', 'menu')
    expect(due(store)).toBe('commander')
    raiseCroissants(store)
    expect(due(store)).toBeNull()
    // The panel open resumes at normal speed as it closes.
    expect(state().resumeSpeed).toBe(NORMAL_SPEED)
    state().closePanel()
    expect(state().speed).toBe(NORMAL_SPEED)

    // Day 3: the tooltip, then the button of « C'est correct de même ».
    playToStep(store)
    const day3 = stepView(state().game)!
    expect(day3.id).toBe('tropCher')
    if (day3.gesture === 'tooltip') {
      signals.emit({ kind: 'tooltip', anchor: 'cash.chip' })
      expect(due(store)).toBe('tropCher')
      signals.emit({ kind: 'tooltip', anchor: 'menu.cafe' })
    } else {
      state().completeTutorialStep('tropCher')
    }
    expect(due(store)).toBe('ajuster')
    state().completeTutorialStep('ajuster')
    expect(state().speed).toBe(NORMAL_SPEED)

    // Day 4: the scripted card, held paused until the choice.
    playToStep(store)
    expect(due(store)).toBe('evenement')
    expect(state().panel).toBe('event')
    expect(state().game.events.pending?.event).toBe('tutoStory')
    expect(state().resumeSpeed).toBe(PAUSED)
    state().chooseEvent('avecPlaisir')
    expect(due(store)).toBeNull()
    expect(state().resumeSpeed).toBe(NORMAL_SPEED)
    state().closePanel()
    expect(state().speed).toBe(NORMAL_SPEED)

    // Day 5: ×3 held, then the pause, then ×1 by itself.
    playToStep(store)
    expect(due(store)).toBe('accelerer')
    signals.emit({ kind: 'speed', speed: 3 })
    state().setSpeed(3)
    expect(due(store)).toBe('pause')
    const day = state().game.day
    state().advance(1)
    expect(state().game.day).toBe(day)
    state().setSpeed(PAUSED)
    expect(due(store)).toBeNull()
    expect(state().speed).toBe(PAUSED)
    expect([...timers.waiting.values()].map(({ ms }) => ms)).toEqual([1500])
    timers.runAll()
    expect(state().speed).toBe(NORMAL_SPEED)

    // Day 6.
    playToStep(store)
    expect(due(store)).toBe('encaisse')
    state().completeTutorialStep('encaisse')
    expect(due(store)).toBe('finances')
    state().openDrawer('finances')
    expect(due(store)).toBeNull()
    expect(state().speed).toBe(NORMAL_SPEED)

    // Day 7, then the protection ends on day 8.
    playToStep(store)
    expect(due(store)).toBe('aurevoir')
    state().completeTutorialStep('aurevoir')
    expect(state().speed).toBe(NORMAL_SPEED)
    expect(state().game.tutorial?.done).toBe(false)
    state().advance(1)
    expect(state().game.day).toBe(7)
    expect(state().game.tutorial).toMatchObject({ done: true, skipped: false })
    expect(coachShowing(state())).toBe(false)
    stop()
  })

  it('completes the pause from a save loaded on it, by the pause button, though already paused', () => {
    const { store: first, signals: firstSignals, stop: stopFirst } = watched()
    playTo(first, firstSignals, 'pause')
    const atPause = first.getState().game
    stopFirst()
    const loaded = deserialize(serialize(atPause))
    const { store, signals, timers, stop } = watched(loaded)
    expect(due(store)).toBe('pause')
    expect(store.getState().speed).toBe(PAUSED)
    signals.emit({ kind: 'speed', speed: PAUSED })
    store.getState().setSpeed(PAUSED)
    expect(due(store)).toBeNull()
    timers.runAll()
    expect(store.getState().speed).toBe(NORMAL_SPEED)
    stop()
  })

  it('cancels the resume after the pause when stopped, or when another game starts', () => {
    const pauseGame = (): GameState => {
      const game = newTutorialGame()
      return { ...game, day: 4, tutorial: { ...game.tutorial!, step: 'pause' } }
    }
    const one = watched(pauseGame())
    one.signals.emit({ kind: 'speed', speed: PAUSED })
    expect(one.timers.waiting.size).toBe(1)
    one.stop()
    expect(one.timers.waiting.size).toBe(0)

    const two = watched(pauseGame())
    two.signals.emit({ kind: 'speed', speed: PAUSED })
    two.store.getState().startGame(createInitialState(3))
    expect(two.timers.waiting.size).toBe(0)
    two.stop()
  })

  it('completes « Finances » at once when it is already open as its step comes', () => {
    const game = newTutorialGame()
    const store = createGameStore({
      ...game,
      day: 5,
      tutorial: { ...game.tutorial!, step: 'encaisse' },
    })
    const signals = createTutorialSignals()
    const stop = watchTutorial(store, signals, 1500, fakeTimers().host)
    store.getState().openDrawer('finances')
    store.getState().completeTutorialStep('encaisse')
    expect(due(store)).toBeNull()
    stop()
  })

  it('never completes a step twice, nor one not due', () => {
    const { store, stop } = watched()
    store.getState().completeTutorialStep('ouvrirCamion')
    expect(due(store)).toBe('bienvenue')
    store.getState().completeTutorialStep('bienvenue')
    store.getState().completeTutorialStep('bienvenue')
    expect(due(store)).toBe('ouvrirCamion')
    stop()
  })
})

/** A `localStorage` of the page; `failing` makes every write throw. */
function memoryStorage(failing = false) {
  const items: Record<string, string> = {}
  const storage: SaveStorage = {
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      if (failing) throw new Error('QuotaExceededError')
      items[key] = value
    },
  }
  return { storage, items }
}

/** The page as App runs it: the store, its autosave and `saveGame`. */
function page(storage: SaveStorage, game: GameState) {
  const store = createGameStore(game)
  let hide = () => {}
  const host: AutosaveHost = {
    isHidden: () => true,
    onVisibilityChange: (listener) => {
      hide = listener
      return () => {}
    },
  }
  const save = createSaveWriter(storage)
  const stopSave = startAutosave(
    store,
    (saved, replaces) => save(saved, replaces),
    host,
  )
  const signals = createTutorialSignals()
  const stopWatch = watchTutorial(store, signals, 1500, fakeTimers().host)
  return {
    store,
    signals,
    saveGame: () => save(store.getState().game),
    hide: () => hide(),
    stop: () => {
      stopSave()
      stopWatch()
    },
  }
}

function stored(storage: SaveStorage): GameState | null {
  const found = readStoredSave(storage)
  return found.status === 'found' ? found.game : null
}

describe('« Refaire la visite »', () => {
  /**
   * The page playing a game some days past its last save, with a price
   * change waiting for tomorrow.
   */
  function longGame(storage: SaveStorage) {
    const tab = page(storage, createInitialState(42))
    tab.store.getState().advance(12)
    raiseCafe(tab.store)
    return tab
  }

  it('saves the game played, unsaved days and decision waiting included, and keeps it while the tour is protected', () => {
    const { storage } = memoryStorage()
    const tab = longGame(storage)
    const before = tab.store.getState().game
    expect(stored(storage)?.day).toBe(0)

    expect(replayTour(tab.store, tab.saveGame)).toBe(true)
    expect(tab.store.getState().game.tutorial?.step).toBe('bienvenue')
    expect(tab.store.getState().keepsSave).toBe(true)
    const kept = stored(storage)!
    expect(kept.day).toBe(before.day)
    expect(kept.pendingDecisions).toEqual(before.pendingDecisions)

    // Days of the tour, and the page hidden, leave the kept game alone.
    playTo(tab.store, tab.signals, 'commander')
    tab.hide()
    expect(stored(storage)?.seed).toBe(42)
    expect(stored(storage)?.day).toBe(before.day)
    tab.stop()
  })

  it('replaces the kept game with the tour the moment its protection ends, on day 8', () => {
    const { storage } = memoryStorage()
    const tab = longGame(storage)
    replayTour(tab.store, tab.saveGame)
    playTo(tab.store, tab.signals, 'aurevoir')
    expect(stored(storage)?.seed).toBe(42)
    tab.store.getState().completeTutorialStep('aurevoir')
    tab.store.getState().advance(1)
    expect(tab.store.getState().game.tutorial?.done).toBe(true)
    expect(stored(storage)?.seed).toBe(tab.store.getState().game.seed)
    expect(stored(storage)?.day).toBe(7)
    tab.stop()
  })

  it('replaces it at once when the tour is skipped', () => {
    const { storage } = memoryStorage()
    const tab = longGame(storage)
    replayTour(tab.store, tab.saveGame)
    tab.store.getState().skipTour()
    expect(stored(storage)?.tutorial).toMatchObject({
      done: true,
      skipped: true,
    })
    tab.stop()
  })

  it('starts nothing when the save fails, then, asked again, starts the tour without keeping a save', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { storage, items } = memoryStorage(true)
    const tab = longGame(storage)
    const before = tab.store.getState().game
    expect(replayTour(tab.store, tab.saveGame)).toBe(false)
    expect(tab.store.getState().game).toBe(before)
    expect(replayTour(tab.store, tab.saveGame, true)).toBe(true)
    expect(tab.store.getState().game.tutorial?.step).toBe('bienvenue')
    expect(tab.store.getState().keepsSave).toBe(false)
    expect(items[SAVE_KEY]).toBeUndefined()
    tab.stop()
    vi.restoreAllMocks()
  })

  it('a tour replayed during a replayed tour keeps the game saved before the first', () => {
    const { storage } = memoryStorage()
    const tab = longGame(storage)
    replayTour(tab.store, tab.saveGame)
    playTo(tab.store, tab.signals, 'lireHier')
    const saveGame = vi.fn(tab.saveGame)
    expect(replayTour(tab.store, saveGame)).toBe(true)
    expect(saveGame).not.toHaveBeenCalled()
    expect(stored(storage)?.seed).toBe(42)
    expect(tab.store.getState().game.day).toBe(0)
    tab.stop()
  })
})

describe('never in a Défi', () => {
  it('a Défi has no tour, so no bubble shows', () => {
    const defi = startChallenge(
      DEFIS.defis[0]!.id,
      5,
      FOOD_TRUCK,
      DEFIS,
      DIFFICULTIES,
    )
    expect(defi.tutorial).toBeUndefined()
    expect(coachShowing({ game: defi })).toBe(false)
    // Even a Défi given a tutorial by mistake shows none.
    expect(
      coachShowing({ game: { ...defi, tutorial: newTutorialGame().tutorial } }),
    ).toBe(false)
  })
})
