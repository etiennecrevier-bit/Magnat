import { afterEach, describe, expect, it, vi } from 'vitest'
import eventsJson from '../content/events.json'
import { loadEventContent } from '../content/schema.ts'
import { createInitialState, startChallenge, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { magnatTitle } from '../engine/dream.ts'
import { NO_EVENTS, resolveEvent } from '../engine/events.ts'
import { cents, sum } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import { defaultProfile } from '../engine/profile.ts'
import { deserialize, serialize } from '../engine/save.ts'
import type { GameState, Profile } from '../engine/types.ts'
import { createSettingsStore, settingsStore } from './settings.ts'
import {
  NORMAL_SPEED,
  PAUSED,
  createGameStore,
  FIRST_FINANCE_SECTIONS,
  gameStore,
  newChallenge,
  newGame,
  seedFromSearch,
  type GameStore,
} from './store.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Makes `crypto.getRandomValues` return `seed`, the random seed's source. */
function stubRandomSeed(seed: number) {
  return vi
    .spyOn(crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array) array.fill(seed)
      return array
    })
}

describe('createGameStore', () => {
  it('starts a new game on day 0, running at normal speed', () => {
    const { game, speed, lastSpeed } = createGameStore().getState()
    expect(game).toEqual(createInitialState(game.seed))
    expect(speed).toBe(NORMAL_SPEED)
    expect(lastSpeed).toBe(NORMAL_SPEED)
    expect(createGameStore().getState().resumeSpeed).toBeNull()
    expect(createGameStore().getState().panel).toBeNull()
    expect(createGameStore().getState().eventBefore).toBeNull()
    expect(createGameStore().getState().reportWaiting).toBe(false)
    expect(createGameStore().getState().magnatWaiting).toBe(false)
    expect(createGameStore().getState().slideIn).toBeNull()
  })

  it('can start from a given state', () => {
    const game = { ...createInitialState(7), day: 42 }
    expect(createGameStore(game).getState().game).toEqual(game)
  })
})

describe('seedFromSearch', () => {
  it.each([
    ['?seed=42', 42],
    ['?seed=0', 0],
    ['?x=1&seed=7', 7],
    ['?seed=4294967295', 4294967295],
    ['?seed=4294967296', 4294967296],
  ])('reads %s as %d', (search, seed) => {
    expect(seedFromSearch(search)).toBe(seed)
  })

  it.each([
    '',
    '?x=1',
    '?seed=',
    '?seed=-1',
    '?seed=1.5',
    '?seed=1e3',
    '?seed=0x2a',
    '?seed=%207',
    '?seed=+7',
    `?seed=${'9'.repeat(400)}`,
  ])('finds no seed in "%s"', (search) => {
    expect(seedFromSearch(search)).toBeNull()
  })
})

describe('newGame', () => {
  it.each([
    ['?seed=42', 42],
    ['?seed=0', 0],
    ['?x=1&seed=7', 7],
    ['?seed=4294967295', 4294967295],
  ])('starts %s on seed %d, without drawing one', (search, seed) => {
    const random = stubRandomSeed(123)
    expect(newGame(search)).toEqual(createInitialState(seed))
    expect(random).not.toHaveBeenCalled()
  })

  it.each([
    '',
    '?seed=',
    '?seed=-1',
    '?seed=1.5',
    '?seed=1e3',
    '?seed=0x2a',
    '?seed=%207',
    '?seed=4294967296',
    `?seed=${'9'.repeat(400)}`,
  ])('starts "%s" on a random seed', (search) => {
    const random = stubRandomSeed(123)
    expect(newGame(search)).toEqual(createInitialState(123))
    expect(random).toHaveBeenCalledTimes(1)
  })

  it('starts with the default profile', () => {
    expect(newGame('?seed=42').profile).toEqual(defaultProfile())
  })

  it.each<Profile>([
    { businessName: 'Café Facile', avatar: 'femme', difficulty: 'facile' },
    { businessName: "Le P'tit Camion", avatar: 'homme', difficulty: 'moyen' },
    { businessName: 'Chez Mimi', avatar: 'femme', difficulty: 'difficile' },
  ])('keeps the $difficulty profile the player picked', (profile) => {
    stubRandomSeed(123)
    expect(newGame('', profile)).toEqual(
      createInitialState(123, FOOD_TRUCK, profile),
    )
    expect(newGame('?seed=42', profile)).toEqual(
      createInitialState(42, FOOD_TRUCK, profile),
    )
  })

  it('rejects a profile the engine rejects', () => {
    stubRandomSeed(123)
    const profile = { ...defaultProfile(), businessName: '' }
    expect(() => newGame('?seed=42', profile)).toThrow(RangeError)
  })
})

describe('setSpeed', () => {
  it('remembers every speed but pause as the last speed', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    expect(store.getState()).toMatchObject({ speed: 10, lastSpeed: 10 })
    store.getState().setSpeed(PAUSED)
    expect(store.getState()).toMatchObject({ speed: PAUSED, lastSpeed: 10 })
  })
})

describe('togglePause', () => {
  it('pauses, then resumes at the last speed used', () => {
    const store = createGameStore()
    store.getState().setSpeed(3)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(PAUSED)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(3)
  })

  it('resumes at the last speed after the pause button', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().setSpeed(PAUSED)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(10)
  })
})

describe('startGame', () => {
  it('plays the game it is given, from normal speed', () => {
    const store = createGameStore(createInitialState(1))
    store.getState().setSpeed(10)
    store.getState().setSpeed(PAUSED)
    const game = { ...createInitialState(7), day: 42 }

    store.getState().startGame(game)

    expect(store.getState()).toMatchObject({
      game,
      speed: NORMAL_SPEED,
      lastSpeed: NORMAL_SPEED,
    })
    store.getState().togglePause()
    store.getState().togglePause()
    expect(store.getState().speed).toBe(NORMAL_SPEED)
  })

  it('counts the games it starts, from none', () => {
    const store = createGameStore(createInitialState(1))
    expect(store.getState().gamesStarted).toBe(0)
    store.getState().advance(3)
    store.getState().openPanel('manage')
    store.getState().closePanel()
    expect(store.getState().gamesStarted).toBe(0)
    store.getState().startGame(createInitialState(7))
    store.getState().startGame(store.getState().game)
    expect(store.getState().gamesStarted).toBe(2)
  })

  it.each(['manage', 'settings'] as const)(
    'closes the %s panel left open, so the new game is not stuck paused',
    (panel) => {
      const store = createGameStore(createInitialState(1))
      store.getState().setSpeed(3)
      store.getState().openPanel(panel)

      store.getState().startGame(createInitialState(7))

      expect(store.getState()).toMatchObject({
        speed: NORMAL_SPEED,
        resumeSpeed: null,
        panel: null,
      })
      store.getState().setSpeed(10)
      expect(store.getState().speed).toBe(10)
    },
  )
})

describe('advance', () => {
  it('ticks the given number of days with one update', () => {
    const start = Object.freeze(createInitialState(1))
    const store = createGameStore(start)
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().advance(5)

    let expected = start
    for (let i = 0; i < 5; i += 1) {
      expected = tick(
        expected,
        FOOD_TRUCK,
        CUSTOMERS,
        DIFFICULTIES,
        PERSONAL,
        ENERGY,
        EVENTS,
      )
    }
    expect(store.getState().game).toEqual(expected)
    expect(store.getState().game.day).toBe(5)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(start).toEqual(createInitialState(1))
  })

  it('does nothing for zero days', () => {
    const store = createGameStore()
    const before = store.getState().game
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().advance(0)

    expect(store.getState().game).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })
})

// The essai card alone on every morning from day 0: the shipped pacing and
// weight keep it out of a real game.
const ESSAI_EVERY_DAY = loadEventContent({
  ...eventsJson,
  pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
  events: eventsJson.events
    .filter(({ id }) => id === 'essai')
    .map((event) => ({ ...event, weight: 1 })),
})

function tickWithEssai(state: GameState): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    ESSAI_EVERY_DAY,
  )
}

/** Day 0 with the essai card waiting for the player's choice. */
function essaiWaiting(): GameState {
  const game = createInitialState(1)
  return {
    ...game,
    events: { ...game.events, pending: { event: 'essai', followUp: false } },
  }
}

describe('the event card', () => {
  it('opens on the morning an event comes up, pausing the game', () => {
    const start = createInitialState(1)
    const store = createGameStore(start, ESSAI_EVERY_DAY)
    store.getState().setSpeed(3)
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().advance(5)

    expect(store.getState().game).toEqual(tickWithEssai(start))
    expect(store.getState()).toMatchObject({
      game: { day: 1, events: { pending: { event: 'essai' } } },
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: 3,
      lastSpeed: 3,
      eventBefore: null,
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the game from advancing before a choice', () => {
    const store = createGameStore(createInitialState(1), ESSAI_EVERY_DAY)
    store.getState().advance(1)
    const waiting = store.getState().game
    const listener = vi.fn()
    store.subscribe(listener)

    expect(() => store.getState().advance(3)).not.toThrow()
    store.getState().setSpeed(10)
    store.getState().togglePause()
    store.getState().openPanel('manage')
    store.getState().closePanel()

    expect(store.getState()).toMatchObject({
      game: waiting,
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: NORMAL_SPEED,
    })
    expect(listener).not.toHaveBeenCalled()
  })

  it('plays the choice through the engine, showing it until Continuer', () => {
    const store = createGameStore(createInitialState(1), ESSAI_EVERY_DAY)
    store.getState().setSpeed(10)
    store.getState().advance(1)
    const waiting = store.getState().game

    store.getState().chooseEvent('toutEssayer')

    expect(store.getState()).toMatchObject({
      game: resolveEvent(waiting, 'toutEssayer', ESSAI_EVERY_DAY),
      eventBefore: waiting,
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: 10,
    })
    expect(store.getState().game.events.pending).toBeNull()
    store.getState().advance(1)
    store.getState().setSpeed(3)
    expect(store.getState().game.day).toBe(1)
    expect(store.getState().speed).toBe(PAUSED)

    store.getState().closePanel()

    expect(store.getState()).toMatchObject({
      speed: 10,
      lastSpeed: 10,
      resumeSpeed: null,
      panel: null,
      eventBefore: null,
    })
    store.getState().advance(1)
    expect(store.getState().game.day).toBe(2)
  })

  it('ignores a second choice', () => {
    const store = createGameStore(essaiWaiting(), ESSAI_EVERY_DAY)
    store.getState().chooseEvent('rienFaire')
    const chosen = store.getState()
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().chooseEvent('toutEssayer')

    expect(store.getState().game).toBe(chosen.game)
    expect(store.getState().eventBefore).toBe(chosen.eventBefore)
    expect(listener).not.toHaveBeenCalled()
  })

  it("throws the engine's error for a choice the event does not have", () => {
    const store = createGameStore(essaiWaiting(), ESSAI_EVERY_DAY)
    expect(() => store.getState().chooseEvent('inconnu')).toThrow(RangeError)
    expect(store.getState().game.events.pending).not.toBeNull()
  })

  it('opens, paused, for a game loaded with an event waiting', () => {
    const waiting = essaiWaiting()
    const expected = {
      game: waiting,
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: NORMAL_SPEED,
      lastSpeed: NORMAL_SPEED,
      eventBefore: null,
    }
    expect(createGameStore(waiting).getState()).toMatchObject(expected)

    const store = createGameStore(createInitialState(1))
    store.getState().setSpeed(10)
    store.getState().startGame(waiting)
    expect(store.getState()).toMatchObject(expected)
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState().speed).toBe(NORMAL_SPEED)
  })

  it('waits for a panel already open to close, then opens', () => {
    const store = createGameStore(createInitialState(1), ESSAI_EVERY_DAY)
    store.getState().setSpeed(10)
    store.getState().openPanel('staff')

    store.getState().advance(1)

    expect(store.getState()).toMatchObject({
      game: { day: 1, events: { pending: { event: 'essai' } } },
      panel: 'staff',
      speed: PAUSED,
      resumeSpeed: 10,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: 10,
    })
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null, speed: 10 })
  })

  it('stops the days on the morning a shipped card comes up, never before the first day', () => {
    const store = createGameStore(createInitialState(1))
    store.getState().advance(60)
    const { game, panel, speed } = store.getState()
    expect(game.events.pending).not.toBeNull()
    expect(game.events.history).toEqual([])
    expect(game.day).toBeGreaterThanOrEqual(EVENTS.pacing.firstDay)
    expect(game.day).toBeLessThan(60)
    expect(panel).toBe('event')
    expect(speed).toBe(PAUSED)
  })
})

describe('openPanel and closePanel', () => {
  it.each(['manage', 'staff', 'settings'] as const)(
    'pause the game while the %s panel is open, then resume at its speed',
    (panel) => {
      const store = createGameStore()
      store.getState().setSpeed(3)
      store.getState().openPanel(panel)
      expect(store.getState()).toMatchObject({
        speed: PAUSED,
        resumeSpeed: 3,
        panel,
      })
      store.getState().closePanel()
      expect(store.getState()).toMatchObject({
        speed: 3,
        lastSpeed: 3,
        resumeSpeed: null,
        panel: null,
      })
    },
  )

  it('keep the first panel open when another is asked for', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().openPanel('staff')
    store.getState().openPanel('manage')
    store.getState().openPanel('settings')
    expect(store.getState()).toMatchObject({
      panel: 'staff',
      resumeSpeed: 10,
    })
  })

  it('open no « Réglages » over the event card', () => {
    const game = createInitialState(1)
    const store = createGameStore({
      ...game,
      events: { ...game.events, pending: { event: 'essai', followUp: false } },
    })
    store.getState().openPanel('settings')
    expect(store.getState().panel).toBe('event')
  })

  it('leave a paused game paused', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().togglePause()
    store.getState().openPanel('manage')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ speed: PAUSED, lastSpeed: 10 })
    store.getState().togglePause()
    expect(store.getState().speed).toBe(10)
  })

  it('keep the speed from before the panel when it is opened twice', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().openPanel('manage')
    store.getState().openPanel('manage')
    store.getState().closePanel()
    expect(store.getState().speed).toBe(10)
  })

  it('do nothing when no panel is open', () => {
    const store = createGameStore()
    store.getState().setSpeed(3)
    const listener = vi.fn()
    store.subscribe(listener)
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ speed: 3, resumeSpeed: null })
    expect(listener).not.toHaveBeenCalled()
  })

  it('keep the game paused against the speed buttons and Space', () => {
    const store = createGameStore()
    store.getState().openPanel('manage')
    store.getState().setSpeed(10)
    expect(store.getState().speed).toBe(PAUSED)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(PAUSED)
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      speed: NORMAL_SPEED,
      lastSpeed: NORMAL_SPEED,
    })
  })
})

describe('a panel opened at a section', () => {
  it('opens « Gérer le camion » at « Fournil », then forgets it on close', () => {
    const store = createGameStore()
    expect(store.getState().panelSection).toBeNull()
    store.getState().openPanel('manage', 'bakery')
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      panelSection: 'bakery',
      speed: PAUSED,
    })
    store.getState().closePanel()
    expect(store.getState().panelSection).toBeNull()
    store.getState().openPanel('manage')
    expect(store.getState().panelSection).toBeNull()
  })

  it('keeps the section of the panel open when another is asked for', () => {
    const store = createGameStore()
    store.getState().openPanel('manage', 'bakery')
    store.getState().openPanel('trip')
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      panelSection: 'bakery',
    })
  })

  it('forgets it when the event card takes the panel’s place', () => {
    const game = createInitialState(1)
    const store = createGameStore(game)
    store.getState().openPanel('manage', 'bakery')
    store.setState({
      game: {
        ...game,
        events: {
          ...game.events,
          pending: { event: 'essai', followUp: false },
        },
      },
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'event',
      panelSection: null,
    })
  })
})

describe('the tab of « Le camion »', () => {
  it('starts on « Menu », keeps the tab last shown, and starts again with a new game', () => {
    const store = createGameStore()
    expect(store.getState().truckTab).toBe('menu')
    store.getState().setTruckTab('stocks')
    store.getState().openPanel('manage')
    store.getState().closePanel()
    expect(store.getState().truckTab).toBe('stocks')
    store.getState().startGame(createInitialState(2))
    expect(store.getState().truckTab).toBe('menu')
  })

  it('shows « Fournil » when the panel opens at the bakery, and keeps it', () => {
    const store = createGameStore()
    store.getState().openPanel('manage', 'bakery')
    expect(store.getState().truckTab).toBe('bakery')
    store.getState().closePanel()
    store.getState().openPanel('manage')
    expect(store.getState().truckTab).toBe('bakery')
  })

  it('leaves it when another panel opens at a section', () => {
    const store = createGameStore()
    store.getState().openPanel('trip', 'contracts')
    expect(store.getState().truckTab).toBe('menu')
  })
})

describe('the tab of « Améliorations »', () => {
  it('starts on « Vie personnelle », keeps the tab last shown, and starts again with a new game', () => {
    const store = createGameStore()
    expect(store.getState().dreamTab).toBe('personal')
    store.getState().openPanel('dream')
    store.getState().setDreamTab('company')
    store.getState().closePanel()
    store.getState().openPanel('dream')
    expect(store.getState().dreamTab).toBe('company')
    store.getState().startGame(createInitialState(2))
    expect(store.getState().dreamTab).toBe('personal')
  })
})

describe('the tab of « Ville » and the grocer the city picked', () => {
  it('opens on « Aller à… », or on « Contrats » for that section, with no grocer', () => {
    const store = createGameStore()
    expect(store.getState()).toMatchObject({ cityTab: 'trip', cityPick: null })
    store.getState().openPanel('trip', 'contracts')
    expect(store.getState().cityTab).toBe('contracts')
    store.getState().setCityTab('trip')
    expect(store.getState().cityTab).toBe('trip')
    store.getState().closePanel()
    store.getState().openPanel('trip')
    expect(store.getState().cityTab).toBe('trip')
  })

  it('moves to « Contrats » on the grocer picked, counting each pick, until « Ville » opens again', () => {
    const store = createGameStore()
    store.getState().openPanel('trip')
    store.getState().pickGrocer('chezNormand')
    expect(store.getState()).toMatchObject({
      cityTab: 'contracts',
      cityPick: { grocer: 'chezNormand', count: 1, pending: true },
    })
    store.getState().setCityTab('trip')
    store.getState().pickGrocer('chezNormand')
    expect(store.getState()).toMatchObject({
      cityTab: 'contracts',
      cityPick: { grocer: 'chezNormand', count: 2, pending: true },
    })
    store.getState().pickGrocer('depanneur2424')
    expect(store.getState().cityPick).toEqual({
      grocer: 'depanneur2424',
      count: 3,
      pending: true,
    })
    store.getState().closePanel()
    store.getState().openPanel('trip')
    expect(store.getState()).toMatchObject({ cityTab: 'trip', cityPick: null })
  })
  it('brings each pick into view once: settled, its card stays, until the next pick', () => {
    const store = createGameStore()
    store.getState().openPanel('trip')
    store.getState().pickGrocer('depanneur2424')
    store.getState().settleCityPick(1)
    expect(store.getState().cityPick).toEqual({
      grocer: 'depanneur2424',
      count: 1,
      pending: false,
    })
    store.getState().pickGrocer('depanneur2424')
    store.getState().settleCityPick(1)
    expect(store.getState().cityPick).toEqual({
      grocer: 'depanneur2424',
      count: 2,
      pending: true,
    })
    store.getState().settleCityPick(2)
    expect(store.getState().cityPick?.pending).toBe(false)
  })
})

describe('the drawers', () => {
  it('start closed, each on its first tab, with no report unread', () => {
    expect(createGameStore().getState()).toMatchObject({
      drawer: null,
      drawerTabs: { finances: 'company', journal: 'events' },
      unreadReports: 0,
    })
  })

  it.each(['finances', 'journal'] as const)(
    'open %s without pausing the game, then close it',
    (drawer) => {
      const store = createGameStore()
      store.getState().setSpeed(3)
      store.getState().openDrawer(drawer)
      expect(store.getState()).toMatchObject({
        drawer,
        speed: 3,
        resumeSpeed: null,
        panel: null,
      })
      store.getState().closeDrawer()
      expect(store.getState()).toMatchObject({ drawer: null, speed: 3 })
    },
  )

  it('keep the tab each showed, and open on the one asked for', () => {
    const store = createGameStore()
    store.getState().openDrawer('finances')
    store.getState().setDrawerTab('finances', 'personal')
    store.getState().openDrawer('journal')
    expect(store.getState()).toMatchObject({
      drawer: 'journal',
      drawerTabs: { finances: 'personal', journal: 'events' },
    })
    store.getState().openDrawer('finances')
    expect(store.getState().drawerTabs.finances).toBe('personal')
    store.getState().openDrawer('finances', 'contracts')
    expect(store.getState()).toMatchObject({
      drawer: 'finances',
      drawerTabs: { finances: 'contracts' },
    })
  })

  it('do not open while a panel is open', () => {
    const store = createGameStore()
    store.getState().openPanel('staff')
    store.getState().openDrawer('finances', 'personal')
    expect(store.getState()).toMatchObject({
      panel: 'staff',
      drawer: null,
      drawerTabs: { finances: 'company' },
    })
  })

  it('close as the player opens a panel, which pauses', () => {
    const store = createGameStore()
    store.getState().openDrawer('journal')
    store.getState().openPanel('manage')
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      drawer: null,
      speed: PAUSED,
    })
  })

  it('stay under a panel that opens on its own, such as the event card', () => {
    const store = createGameStore(createInitialState(1), essaiFrom(1))
    store.getState().openDrawer('finances')
    store.getState().advance(5)
    expect(store.getState()).toMatchObject({
      panel: 'event',
      drawer: 'finances',
      speed: PAUSED,
    })
  })

  it('close and go back to their first tabs as a new game starts', () => {
    const store = createGameStore()
    store.getState().openDrawer('finances', 'personal')
    store.getState().startGame(createInitialState(2))
    expect(store.getState()).toMatchObject({
      drawer: null,
      drawerTabs: { finances: 'company', journal: 'events' },
    })
  })
})

describe('the accordions of « Finances »', () => {
  it('start closed, every statement on this month', () => {
    expect(createGameStore().getState().financeSections).toEqual(
      FIRST_FINANCE_SECTIONS,
    )
    expect(Object.values(FIRST_FINANCE_SECTIONS.open)).not.toContain(true)
  })

  it('keep their period as they close and open, as the drawer closes and opens, and across the tabs', () => {
    const store = createGameStore()
    store.getState().openDrawer('finances')
    store.getState().toggleFinanceSection('balanceSheet')
    store.getState().setStatementPeriod('balanceSheet', 'lastMonth')
    store.getState().toggleFinanceSection('balanceSheet')
    expect(store.getState().financeSections).toEqual({
      open: { ...FIRST_FINANCE_SECTIONS.open },
      periods: { ...FIRST_FINANCE_SECTIONS.periods, balanceSheet: 'lastMonth' },
    })
    store.getState().toggleFinanceSection('balanceSheet')
    store.getState().closeDrawer()
    store.getState().openDrawer('finances')
    store.getState().setDrawerTab('finances', 'personal')
    store.getState().setDrawerTab('finances', 'company')
    expect(store.getState().financeSections).toEqual({
      open: { ...FIRST_FINANCE_SECTIONS.open, balanceSheet: true },
      periods: { ...FIRST_FINANCE_SECTIONS.periods, balanceSheet: 'lastMonth' },
    })
  })

  it('open one from a tile on « Entreprise », without pausing the game', () => {
    const store = createGameStore()
    store.getState().setSpeed(3)
    store.getState().openDrawer('finances', 'personal')
    store.getState().showFinanceSection('incomeStatement')
    expect(store.getState()).toMatchObject({
      drawer: 'finances',
      drawerTabs: { finances: 'company' },
      financeSections: { open: { incomeStatement: true, cashFlow: false } },
      speed: 3,
      resumeSpeed: null,
    })
    store.getState().showFinanceSection('incomeStatement')
    expect(store.getState().financeSections.open.incomeStatement).toBe(true)
  })

  it('open nothing under a panel', () => {
    const store = createGameStore()
    store.getState().openPanel('staff')
    store.getState().showFinanceSection('cashFlow')
    expect(store.getState()).toMatchObject({
      drawer: null,
      financeSections: FIRST_FINANCE_SECTIONS,
    })
  })

  it('close again as a new game starts', () => {
    const store = createGameStore()
    store.getState().showFinanceSection('cashFlow')
    store.getState().setStatementPeriod('cashFlow', 'yearToDate')
    store.getState().startGame(createInitialState(2))
    expect(store.getState().financeSections).toEqual(FIRST_FINANCE_SECTIONS)
  })
})

describe('the reports unread', () => {
  it('count each report that only slides in, until one opens in « Bilans »', () => {
    const store = createGameStore(playedTo(34), NO_EVENTS, REPORT_AT_FIRST)
    store.getState().advance(1)
    expect(store.getState()).toMatchObject({ slideIn: 28, unreadReports: 1 })
    store.getState().advance(7)
    expect(store.getState()).toMatchObject({ slideIn: 35, unreadReports: 2 })
    store.getState().openDrawer('finances')
    expect(store.getState().unreadReports).toBe(2)
    store.getState().closeDrawer()
    store.getState().openDrawer('journal')
    expect(store.getState()).toMatchObject({
      drawer: 'journal',
      unreadReports: 2,
    })
    store.getState().readReports()
    expect(store.getState().unreadReports).toBe(0)
  })

  it('open « Journal » on « Bilans », unless a tab is asked', () => {
    const store = createGameStore(createInitialState(1))
    store.setState({ unreadReports: 1 })
    store.getState().openDrawer('journal', 'events')
    expect(store.getState().drawerTabs.journal).toBe('events')
    store.getState().closeDrawer()
    store.getState().openDrawer('journal')
    expect(store.getState().drawerTabs.journal).toBe('reports')
  })

  it('leave « Journal » on its tab when none is unread', () => {
    const store = createGameStore(createInitialState(1))
    store.getState().openDrawer('journal', 'events')
    store.getState().closeDrawer()
    store.getState().openDrawer('journal')
    expect(store.getState().drawerTabs.journal).toBe('events')
  })

  it('stay read when none is unread', () => {
    const store = createGameStore(createInitialState(1))
    const before = store.getState()
    store.getState().readReports()
    expect(store.getState()).toBe(before)
  })

  it('are read once the full report opens from the card', () => {
    const store = createGameStore(playedTo(34), NO_EVENTS, REPORT_AT_FIRST)
    store.getState().advance(1)
    store.getState().openPanel('report')
    expect(store.getState()).toMatchObject({
      panel: 'report',
      unreadReports: 0,
    })
  })

  it('are read once the full report opens on its own', () => {
    const store = createGameStore(
      createInitialState(1),
      NO_EVENTS,
      REPORT_AT_FIRST,
    )
    store.setState({ unreadReports: 3 })
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      panel: 'report',
      unreadReports: 0,
    })
  })

  it('are read once a full report waiting for a panel opens', () => {
    const store = createGameStore(
      createInitialState(1),
      NO_EVENTS,
      REPORT_AT_FIRST,
    )
    store.setState({ unreadReports: 2 })
    store.getState().openPanel('staff')
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      reportWaiting: true,
      unreadReports: 2,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'report',
      unreadReports: 0,
    })
  })

  it('start at none in a new game', () => {
    const store = createGameStore(playedTo(34), NO_EVENTS, REPORT_AT_FIRST)
    store.getState().advance(1)
    store.getState().startGame(createInitialState(2))
    expect(store.getState().unreadReports).toBe(0)
  })
})

describe('decide', () => {
  it('leaves the change waiting for the next morning', () => {
    const start = createInitialState(1)
    const store = createGameStore(start)
    store.getState().setSpeed(3)
    store.getState().openPanel('manage')

    store
      .getState()
      .decide({ kind: 'price', product: 'cafe', price: cents(300) })
    store.getState().decide({ kind: 'marketingDaily', budget: cents(1500) })

    const { game, speed, resumeSpeed } = store.getState()
    expect(game.decisions).toEqual(start.decisions)
    expect(game.pendingDecisions).toEqual({
      ...start.decisions,
      prices: { ...start.decisions.prices, cafe: 300 },
      marketingDaily: 1500,
    })
    expect({ speed, resumeSpeed }).toEqual({ speed: PAUSED, resumeSpeed: 3 })
  })

  it("throws the engine's error for a change outside the limits", () => {
    const store = createGameStore(createInitialState(1))
    expect(() =>
      store
        .getState()
        .decide({ kind: 'price', product: 'cafe', price: cents(1) }),
    ).toThrow(RangeError)
    expect(store.getState().game.pendingDecisions).toBeNull()
  })
})

/** The essai card alone on every morning from `firstDay`. */
function essaiFrom(firstDay: number) {
  return loadEventContent({
    ...eventsJson,
    pacing: { firstDay, minDaysBetween: 0, dailyChance: 1 },
    events: eventsJson.events
      .filter(({ id }) => id === 'essai')
      .map((event) => ({ ...event, weight: 1 })),
  })
}

/** A seed-1 game played with no event card to the morning of `day`. */
function playedTo(day: number): GameState {
  let game = createInitialState(1)
  while (game.day < day) {
    game = tick(
      game,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
    )
  }
  return game
}

/** The weekly report on, in full only for the first weeks of a game. */
const REPORT_AT_FIRST = { everyWeek: () => false }

describe('the weekly report', () => {
  it('stays out of a store without it: the days run past Monday', () => {
    const store = createGameStore(createInitialState(1), NO_EVENTS)
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 10, lastWeek: { firstDay: 0 } },
      panel: null,
      reportWaiting: false,
      slideIn: null,
    })
  })

  it('opens in full on the Monday of each of the first 4 weeks, pausing the game', () => {
    const store = createGameStore(
      createInitialState(1),
      NO_EVENTS,
      REPORT_AT_FIRST,
    )
    store.getState().setSpeed(3)
    for (const monday of [7, 14, 21, 28]) {
      store.getState().advance(10)
      expect(store.getState()).toMatchObject({
        game: { day: monday, lastWeek: { firstDay: monday - 7 } },
        panel: 'report',
        speed: PAUSED,
        resumeSpeed: 3,
        slideIn: null,
      })
      // Nothing advances while it shows the week.
      store.getState().advance(1)
      expect(store.getState().game.day).toBe(monday)

      store.getState().closePanel()
      expect(store.getState()).toMatchObject({
        panel: null,
        speed: 3,
        resumeSpeed: null,
      })
    }
  })

  it('slides in from the fifth week, without pausing', () => {
    const store = createGameStore(playedTo(34), NO_EVENTS, REPORT_AT_FIRST)
    store.getState().setSpeed(10)
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().advance(5)

    expect(store.getState()).toMatchObject({
      game: { day: 35, lastWeek: { firstDay: 28 } },
      panel: null,
      speed: 10,
      resumeSpeed: null,
      slideIn: 28,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    store.getState().advance(1)
    expect(store.getState()).toMatchObject({ game: { day: 36 }, slideIn: 28 })
    store.getState().dismissSlideIn()
    expect(store.getState().slideIn).toBeNull()
  })

  it('opens in full every week while « Ouvrir le bilan chaque semaine » is on', () => {
    const settings = createSettingsStore(null)
    settings.getState().setOpenReportEveryWeek(true)
    const store = createGameStore(playedTo(34), NO_EVENTS, {
      everyWeek: () => settings.getState().openReportEveryWeek,
    })

    store.getState().advance(1)
    expect(store.getState()).toMatchObject({
      game: { day: 35 },
      panel: 'report',
      speed: PAUSED,
      resumeSpeed: NORMAL_SPEED,
      slideIn: null,
    })
    store.getState().closePanel()

    settings.getState().setOpenReportEveryWeek(false)
    store.getState().advance(7)
    expect(store.getState()).toMatchObject({
      game: { day: 42 },
      panel: null,
      slideIn: 35,
    })
  })

  it('shows before the event card on a Monday that brings both', () => {
    const store = createGameStore(
      createInitialState(1),
      essaiFrom(7),
      REPORT_AT_FIRST,
    )
    store.getState().setSpeed(3)

    store.getState().advance(10)

    expect(store.getState()).toMatchObject({
      game: {
        day: 7,
        lastWeek: { firstDay: 0 },
        events: { pending: { event: 'essai' } },
      },
      panel: 'report',
      speed: PAUSED,
      resumeSpeed: 3,
    })
    store.getState().advance(1)
    expect(store.getState().game.day).toBe(7)

    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: 3,
    })
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: null,
      speed: 3,
      resumeSpeed: null,
    })
  })

  it('opens in full before the event card after the first 4 weeks too, rather than sliding in', () => {
    const store = createGameStore(playedTo(34), essaiFrom(35), REPORT_AT_FIRST)
    store.getState().setSpeed(10)

    store.getState().advance(1)

    expect(store.getState()).toMatchObject({
      game: {
        day: 35,
        lastWeek: { firstDay: 28 },
        events: { pending: { event: 'essai' } },
      },
      panel: 'report',
      speed: PAUSED,
      resumeSpeed: 10,
      slideIn: null,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: 'event', speed: PAUSED })
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: null,
      speed: 10,
      slideIn: null,
    })
  })

  it('waits for a panel open when its Monday comes, then shows before the event card', () => {
    const store = createGameStore(
      createInitialState(1),
      essaiFrom(7),
      REPORT_AT_FIRST,
    )
    store.getState().setSpeed(10)
    store.getState().openPanel('staff')

    store.getState().advance(10)

    expect(store.getState()).toMatchObject({
      game: { day: 7, events: { pending: { event: 'essai' } } },
      panel: 'staff',
      reportWaiting: true,
      speed: PAUSED,
      resumeSpeed: 10,
    })
    store.getState().advance(1)
    expect(store.getState().game.day).toBe(7)

    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'report',
      reportWaiting: false,
      speed: PAUSED,
      resumeSpeed: 10,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: 'event', speed: PAUSED })
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null, speed: 10 })
  })

  it('slides in once a panel open when its Monday comes closes', () => {
    const store = createGameStore(playedTo(34), NO_EVENTS, REPORT_AT_FIRST)
    store.getState().openPanel('manage')
    store.getState().advance(1)
    expect(store.getState()).toMatchObject({
      game: { day: 35 },
      panel: 'manage',
      reportWaiting: false,
      slideIn: 28,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: null,
      speed: NORMAL_SPEED,
      slideIn: 28,
    })
  })

  it('opens in full from the card sliding in, which then goes away', () => {
    const store = createGameStore(playedTo(34), NO_EVENTS, REPORT_AT_FIRST)
    store.getState().setSpeed(3)
    store.getState().advance(1)

    store.getState().openPanel('report')

    expect(store.getState()).toMatchObject({
      panel: 'report',
      speed: PAUSED,
      resumeSpeed: 3,
      slideIn: null,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: null,
      speed: 3,
      slideIn: null,
    })
  })

  it('does not show again for a game started or loaded on its Monday', () => {
    const store = createGameStore(
      createInitialState(1),
      essaiFrom(7),
      REPORT_AT_FIRST,
    )
    store.getState().openPanel('staff')
    store.getState().advance(10)
    expect(store.getState().reportWaiting).toBe(true)
    store.getState().startGame(playedTo(7))
    expect(store.getState()).toMatchObject({
      game: { day: 7, lastWeek: { firstDay: 0 } },
      panel: null,
      reportWaiting: false,
      slideIn: null,
      speed: NORMAL_SPEED,
    })

    const sliding = createGameStore(playedTo(34), NO_EVENTS, REPORT_AT_FIRST)
    sliding.getState().advance(1)
    expect(sliding.getState().slideIn).toBe(28)
    sliding.getState().startGame(playedTo(35))
    expect(sliding.getState().slideIn).toBeNull()
  })

  it('lets the shipped cards come up, after the reports of the Mondays before', () => {
    const store = createGameStore(
      createInitialState(1),
      EVENTS,
      REPORT_AT_FIRST,
    )
    const reported: number[] = []
    while (
      store.getState().game.events.pending === null &&
      store.getState().game.day < 60
    ) {
      store.getState().advance(60 - store.getState().game.day)
      if (store.getState().panel === 'report') {
        reported.push(store.getState().game.day)
        store.getState().closePanel()
      }
    }
    const { game, panel, speed } = store.getState()
    expect(game.events.pending).not.toBeNull()
    expect(game.day).toBeGreaterThanOrEqual(EVENTS.pacing.firstDay)
    expect(game.day).toBeLessThan(60)
    expect(panel).toBe('event')
    expect(speed).toBe(PAUSED)
    expect(reported).toEqual(
      [7, 14, 21, 28].filter((monday) => monday <= game.day),
    )
  })
})

/** The report on, monthly after the first weeks, in full only at first. */
const MONTHLY = { everyWeek: () => false, cadence: () => 'month' as const }

/**
 * The mornings `store` stops on, playing up to `lastDay`, each with what
 * shows: the panel the report opens in, or the card sliding in, of the week
 * or the month. Each full report is closed and each card taken away, so
 * the next one shows.
 */
function stops(store: GameStore, lastDay: number) {
  const seen: { day: number; shows: string; firstDay: number }[] = []
  while (store.getState().game.day < lastDay) {
    store.getState().advance(lastDay - store.getState().game.day)
    const { game, panel, slideIn, reportShown, monthReport } = store.getState()
    const report = reportShown === 'month' ? monthReport : game.lastWeek
    if (panel === 'report') {
      seen.push({
        day: game.day,
        shows: `${reportShown} in full`,
        firstDay: report!.firstDay,
      })
      store.getState().closePanel()
    } else if (slideIn !== null) {
      seen.push({
        day: game.day,
        shows: `${reportShown} sliding in`,
        firstDay: slideIn,
      })
      store.getState().dismissSlideIn()
    }
  }
  return seen
}

describe('the monthly report', () => {
  it('leaves the weekly report as it is when the player wants it every week', () => {
    const weekly = stops(
      createGameStore(createInitialState(1), NO_EVENTS, {
        everyWeek: () => false,
        cadence: () => 'week',
      }),
      70,
    )
    expect(weekly).toEqual(
      stops(
        createGameStore(createInitialState(1), NO_EVENTS, REPORT_AT_FIRST),
        70,
      ),
    )
    expect(weekly).toEqual([
      ...[7, 14, 21, 28].map((day) => ({
        day,
        shows: 'week in full',
        firstDay: day - 7,
      })),
      ...[35, 42, 49, 56, 63, 70].map((day) => ({
        day,
        shows: 'week sliding in',
        firstDay: day - 7,
      })),
    ])
  })

  it('stays weekly for the first 4 weeks, then comes on the 1st only, sliding in', () => {
    expect(
      stops(createGameStore(createInitialState(1), NO_EVENTS, MONTHLY), 100),
    ).toEqual([
      { day: 7, shows: 'week in full', firstDay: 0 },
      { day: 14, shows: 'week in full', firstDay: 7 },
      { day: 21, shows: 'week in full', firstDay: 14 },
      { day: 28, shows: 'week in full', firstDay: 21 },
      // June 1st, July 1st, August 1st.
      { day: 31, shows: 'month sliding in', firstDay: 0 },
      { day: 61, shows: 'month sliding in', firstDay: 31 },
      { day: 92, shows: 'month sliding in', firstDay: 61 },
    ])
  })

  it('slides in on the 1st without pausing, then nothing until the next 1st', () => {
    const store = createGameStore(playedTo(29), NO_EVENTS, MONTHLY)
    store.getState().setSpeed(10)
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().advance(10)

    expect(store.getState()).toMatchObject({
      game: { day: 31, lastWeek: { firstDay: 21 } },
      panel: null,
      speed: 10,
      resumeSpeed: null,
      reportShown: 'month',
      monthReport: { firstDay: 0, lastDay: 30 },
      slideIn: 0,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    for (let day = 32; day < 61; day += 1) {
      store.getState().advance(1)
      expect(store.getState()).toMatchObject({
        game: { day },
        panel: null,
        reportShown: 'month',
        monthReport: { firstDay: 0 },
        slideIn: 0,
      })
    }
    store.getState().advance(1)
    expect(store.getState()).toMatchObject({
      game: { day: 61, lastWeek: { firstDay: 49 } },
      monthReport: { firstDay: 31, lastDay: 60 },
      slideIn: 31,
    })
  })

  it('totals the weeks of the month as the history has them', () => {
    const store = createGameStore(playedTo(29), NO_EVENTS, MONTHLY)
    store.getState().advance(40)
    store.getState().advance(40)
    const { game, monthReport, weekReports } = store.getState()
    expect(game.day).toBe(61)
    const weeks = game.weekHistory.filter(
      ({ firstDay }) => firstDay >= 28 && firstDay <= 49,
    )
    expect(weeks).toHaveLength(4)
    expect(monthReport).toMatchObject({
      weeks,
      sales: sum(weeks.map(({ sales }) => sales)),
      netIncome: sum(weeks.map(({ netIncome }) => netIncome)),
      cashAtEnd: weeks.at(-1)!.cashAtEnd,
    })
    // Every week of the month played in the store, so nothing is left out.
    expect(monthReport!.reports.map(({ firstDay }) => firstDay)).toEqual([
      28, 35, 42, 49,
    ])
    expect(monthReport!.lowestCash).not.toBeNull()
    expect(monthReport!.days).toHaveLength(30)
    expect(weekReports.map(({ firstDay }) => firstDay)).toEqual([
      21, 28, 35, 42, 49,
    ])
  })

  it('opens in full every month while « Ouvrir le bilan chaque mois » is on', () => {
    const store = createGameStore(playedTo(29), NO_EVENTS, {
      everyWeek: () => true,
      cadence: () => 'month',
    })
    store.getState().setSpeed(3)
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 31 },
      panel: 'report',
      speed: PAUSED,
      resumeSpeed: 3,
      reportShown: 'month',
      monthReport: { firstDay: 0 },
      slideIn: null,
    })
    store.getState().advance(1)
    expect(store.getState().game.day).toBe(31)
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null, speed: 3 })
  })

  it('shows before the event card on a 1st that brings both', () => {
    const store = createGameStore(playedTo(29), essaiFrom(31), MONTHLY)
    store.getState().setSpeed(10)
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 31, events: { pending: { event: 'essai' } } },
      panel: 'report',
      reportShown: 'month',
      speed: PAUSED,
      resumeSpeed: 10,
      slideIn: null,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: 'event', speed: PAUSED })
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null, speed: 10 })
  })

  it('waits for a panel open when its 1st comes, then shows before the event card', () => {
    const store = createGameStore(playedTo(29), essaiFrom(31), MONTHLY)
    store.getState().openPanel('staff')
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 31 },
      panel: 'staff',
      reportWaiting: true,
      reportShown: 'month',
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'report',
      reportWaiting: false,
      reportShown: 'month',
    })
    store.getState().closePanel()
    expect(store.getState().panel).toBe('event')
  })

  it('opens in full from its card sliding in', () => {
    const store = createGameStore(playedTo(29), NO_EVENTS, MONTHLY)
    store.getState().advance(10)
    store.getState().openPanel('report')
    expect(store.getState()).toMatchObject({
      panel: 'report',
      reportShown: 'month',
      slideIn: null,
    })
  })

  it('brings one report, the month’s, on a 1st that is also a Monday, with the week closed the night before', () => {
    // January 1st, year 2, is day 245, a Monday.
    const store = createGameStore(playedTo(200), essaiFrom(245), MONTHLY)
    store.getState().advance(50)
    expect(store.getState()).toMatchObject({
      game: { day: 214 },
      monthReport: { firstDay: 184 },
      slideIn: 184,
    })
    store.getState().advance(50)
    const { game, monthReport, weekReports } = store.getState()
    expect(store.getState()).toMatchObject({
      game: { day: 245, lastWeek: { firstDay: 238 } },
      panel: 'report',
      reportShown: 'month',
      slideIn: null,
    })
    expect(game.events.pending).not.toBeNull()
    expect(weekReports.at(-1)).toBe(game.lastWeek)
    expect(monthReport).toMatchObject({ firstDay: 214, lastDay: 244 })
    expect(monthReport!.weeks.map(({ firstDay }) => firstDay)).toEqual([
      210, 217, 224, 231, 238,
    ])
    expect(monthReport!.lowestCash).not.toBeNull()

    store.getState().closePanel()
    expect(store.getState().panel).toBe('event')
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: null,
      reportShown: 'month',
    })
  })

  it('follows the player who changes it during a game', () => {
    const settings = createSettingsStore(null)
    const store = createGameStore(playedTo(34), NO_EVENTS, {
      everyWeek: () => settings.getState().openReportEveryWeek,
      cadence: () => settings.getState().reportCadence,
    })
    store.getState().advance(1)
    expect(store.getState()).toMatchObject({
      game: { day: 35 },
      reportShown: 'week',
      slideIn: 28,
    })

    // Monthly from mid-June: the next report is June's, on July 1st, with
    // every week of June, kept while the reports were weekly.
    settings.getState().setReportCadence('month')
    store.getState().advance(40)
    expect(store.getState()).toMatchObject({
      game: { day: 61 },
      reportShown: 'month',
      monthReport: { firstDay: 31 },
      slideIn: 31,
    })
    expect(store.getState().monthReport!.lowestCash).not.toBeNull()

    // Weekly again: the next Monday brings its week.
    settings.getState().setReportCadence('week')
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 63, lastWeek: { firstDay: 56 } },
      reportShown: 'week',
      monthReport: { firstDay: 31 },
      slideIn: 56,
    })
  })

  it('starts each game with only its last week, and no month', () => {
    const store = createGameStore(playedTo(29), NO_EVENTS, MONTHLY)
    store.getState().advance(10)
    expect(store.getState().monthReport).not.toBeNull()
    const next = playedTo(40)
    store.getState().startGame(next)
    expect(store.getState()).toMatchObject({
      weekReports: [next.lastWeek],
      monthReport: null,
      reportShown: 'week',
      slideIn: null,
    })
    store.getState().startGame(createInitialState(2))
    expect(store.getState().weekReports).toEqual([])
  })

  it('leaves out what a game loaded during the month did not keep', () => {
    // Loaded on June 26: the store has only that morning's week, of June 19.
    const store = createGameStore(playedTo(56), NO_EVENTS, MONTHLY)
    store.getState().advance(10)
    const { game, monthReport } = store.getState()
    expect(game.day).toBe(61)
    expect(monthReport!.reports.map(({ firstDay }) => firstDay)).toEqual([49])
    expect(monthReport!.lowestCash).toBeNull()
    expect(monthReport!.sales).toBe(
      sum(
        game.weekHistory
          .filter(({ firstDay }) => firstDay >= 28 && firstDay <= 49)
          .map(({ sales }) => sales),
      ),
    )
  })
})

/** The Défi `defiId` on `seed`, played with no event to its end. */
function playedOut(defiId: string, seed: number): GameState {
  let game = startChallenge(defiId, seed)
  while (game.challenge?.status === 'enCours') game = tick(game)
  return game
}

describe('newChallenge', () => {
  it('starts the Défi on the seed the page names, without drawing one', () => {
    const random = stubRandomSeed(123)
    expect(newChallenge('?seed=42', 'travauxSaintDenis')).toEqual(
      startChallenge('travauxSaintDenis', 42),
    )
    expect(random).not.toHaveBeenCalled()
  })

  it.each(['', '?seed=1e3', '?seed=4294967296'])(
    'starts "%s" on a random seed',
    (search) => {
      const random = stubRandomSeed(123)
      expect(newChallenge(search, 'travauxSaintDenis')).toEqual(
        startChallenge('travauxSaintDenis', 123),
      )
      expect(random).toHaveBeenCalledTimes(1)
    },
  )

  it("keeps the player's business name and avatar, at the Défi's difficulty", () => {
    const profile: Profile = {
      businessName: 'Chez Mimi',
      avatar: 'femme',
      difficulty: 'difficile',
    }
    expect(
      newChallenge('?seed=42', 'travauxSaintDenis', profile).profile,
    ).toEqual({ ...profile, difficulty: 'moyen' })
  })

  it('throws for a Défi that does not exist, whatever the seed', () => {
    stubRandomSeed(123)
    expect(() => newChallenge('?seed=42', 'inconnu')).toThrow(RangeError)
    expect(() => newChallenge('', 'inconnu')).toThrow(RangeError)
  })
})

describe('a Défi', () => {
  it('stops on the morning after its last day, on its end in place of the week, paused for good', () => {
    // « La semaine des 1 000 $ » runs from Monday, May 8 (day 7), to
    // Sunday, May 14: its end comes on a Monday the full report would show.
    const store = createGameStore(
      newChallenge('?seed=7', 'semaineDesMilleDollars'),
      EVENTS,
      REPORT_AT_FIRST,
    )
    store.getState().setSpeed(3)
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 14, challenge: { status: 'reussi' } },
      panel: 'defiEnd',
      speed: PAUSED,
      resumeSpeed: 3,
      reportWaiting: false,
      slideIn: null,
    })

    // Nothing plays a day, closes the end, or resumes the game.
    const { game } = store.getState()
    store.getState().advance(10)
    store.getState().closePanel()
    store.getState().togglePause()
    store.getState().setSpeed(10)
    store.getState().openPanel('manage')
    expect(store.getState()).toMatchObject({
      panel: 'defiEnd',
      speed: PAUSED,
    })
    expect(store.getState().game).toBe(game)
  })

  it('stops on the morning a condition breaks, before its last day', () => {
    // On seed 7, 3 000 $ a week to the owner leaves the cash of « Les travaux
    // de la rue Saint-Denis » below zero on its 12th day, day 25.
    const store = createGameStore(newChallenge('?seed=7', 'travauxSaintDenis'))
    store.getState().decide({ kind: 'ownerWeeklyPay', pay: cents(300_000) })
    store.getState().advance(40)
    expect(store.getState()).toMatchObject({
      game: {
        day: 26,
        challenge: {
          status: 'echoue',
          medal: null,
          progress: { daysPlayed: 12 },
        },
      },
      panel: 'defiEnd',
      speed: PAUSED,
    })
    expect(() => store.getState().advance(1)).not.toThrow()
    expect(store.getState().game.day).toBe(26)
  })

  it('opens its end once the panel open when it ended closes', () => {
    // Every panel pauses the game, so only a test gets here.
    const store = createGameStore(
      newChallenge('?seed=7', 'semaineDesMilleDollars'),
    )
    store.getState().setSpeed(3)
    store.getState().openPanel('defi')
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 14 },
      panel: 'defi',
      speed: PAUSED,
      resumeSpeed: 3,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'defiEnd',
      speed: PAUSED,
      resumeSpeed: 3,
    })
  })

  it('opens its panel from the top bar, pausing the game until it closes', () => {
    const store = createGameStore(newChallenge('?seed=7', 'travauxSaintDenis'))
    store.getState().setSpeed(3)
    store.getState().openPanel('defi')
    expect(store.getState()).toMatchObject({
      panel: 'defi',
      speed: PAUSED,
      resumeSpeed: 3,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null, speed: 3 })
  })

  it('opens a Défi over on its end, paused, and the next game as usual', () => {
    const store = createGameStore(createInitialState(1))
    store.getState().startGame(playedOut('semaineDesMilleDollars', 7))
    expect(store.getState()).toMatchObject({
      game: { day: 14 },
      panel: 'defiEnd',
      speed: PAUSED,
      resumeSpeed: NORMAL_SPEED,
    })
    store.getState().closePanel()
    expect(store.getState().panel).toBe('defiEnd')

    // « Rejouer »
    store
      .getState()
      .startGame(newChallenge('?seed=8', 'semaineDesMilleDollars'))
    expect(store.getState()).toMatchObject({
      game: { day: 7, challenge: { status: 'enCours' } },
      panel: null,
      speed: NORMAL_SPEED,
      resumeSpeed: null,
    })
  })
})

describe('a bankruptcy (#160)', () => {
  /**
   * Seed 7 at Difficile, its owner paying themself 3 000 $ a week from day
   * 1: below zero at every close from June 1st, the close of November
   * 30th, day 213, ends it. The morning of `day`, played with no event.
   */
  function greedy(day: number): GameState {
    let game = applyDecision(
      createInitialState(7, FOOD_TRUCK, {
        ...defaultProfile(),
        difficulty: 'difficile',
      }),
      { kind: 'ownerWeeklyPay', pay: cents(300_000) },
    )
    while (game.day < day) game = tick(game)
    return game
  }
  const NEAR_THE_END = greedy(205)
  const END = { reason: 'bankruptcy', day: 213 } as const

  it('stops on the morning after the end, on its « Faillite » in place of the month’s report, paused for good', () => {
    const store = createGameStore(NEAR_THE_END, NO_EVENTS, MONTHLY)
    store.getState().setSpeed(3)
    store.getState().advance(20)
    // December 1st, whose « Bilan du mois » the « Faillite » replaces.
    expect(store.getState()).toMatchObject({
      game: { day: 214, ended: END },
      panel: 'bankruptcy',
      speed: PAUSED,
      resumeSpeed: 3,
      reportWaiting: false,
      monthReport: null,
      slideIn: null,
    })

    // Nothing plays a day, closes the end, or resumes the game.
    const { game } = store.getState()
    expect(() => store.getState().advance(10)).not.toThrow()
    store.getState().closePanel()
    store.getState().togglePause()
    store.getState().setSpeed(10)
    store.getState().openPanel('manage')
    expect(store.getState()).toMatchObject({
      panel: 'bankruptcy',
      speed: PAUSED,
    })
    expect(store.getState().game).toBe(game)
  })

  it('opens its « Faillite » once the panel open when it ended closes', () => {
    // Every panel pauses the game, so only a test gets here.
    const store = createGameStore(NEAR_THE_END, NO_EVENTS)
    store.getState().setSpeed(3)
    store.getState().openPanel('staff')
    store.getState().advance(20)
    expect(store.getState()).toMatchObject({
      game: { day: 214, ended: END },
      panel: 'staff',
      speed: PAUSED,
      resumeSpeed: 3,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'bankruptcy',
      speed: PAUSED,
      resumeSpeed: 3,
    })
  })

  it('opens a game that went bankrupt on its « Faillite », as « Continuer » does after a reload, and the next game as usual', () => {
    const store = createGameStore(NEAR_THE_END, NO_EVENTS)
    store.getState().advance(20)
    const reloaded = deserialize(serialize(store.getState().game))
    expect(createGameStore(reloaded).getState().panel).toBe('bankruptcy')

    const other = createGameStore(createInitialState(1))
    other.getState().startGame(reloaded)
    expect(other.getState()).toMatchObject({
      game: { day: 214, ended: END },
      panel: 'bankruptcy',
      speed: PAUSED,
      resumeSpeed: NORMAL_SPEED,
    })
    other.getState().closePanel()
    expect(other.getState().panel).toBe('bankruptcy')

    // « Recommencer »
    other.getState().startGame(newGame('?seed=8', reloaded.profile))
    expect(other.getState()).toMatchObject({
      game: { day: 0, ended: null, profile: reloaded.profile },
      panel: null,
      speed: NORMAL_SPEED,
      resumeSpeed: null,
    })
  })
})

describe('gameStore', () => {
  afterEach(() => {
    gameStore.setState(gameStore.getInitialState(), true)
    settingsStore.getState().setOpenReportEveryWeek(false)
    settingsStore.getState().setReportCadence('week')
  })

  it("shows the weekly report as the player's settings say", () => {
    gameStore.getState().startGame(createInitialState(1))
    gameStore.getState().advance(10)
    expect(gameStore.getState()).toMatchObject({
      game: { day: 7 },
      panel: 'report',
    })

    settingsStore.getState().setOpenReportEveryWeek(true)
    gameStore.getState().startGame(playedTo(34))
    gameStore.getState().advance(1)
    expect(gameStore.getState()).toMatchObject({
      game: { day: 35 },
      panel: 'report',
    })
  })

  it("shows the monthly report as the player's settings say", () => {
    settingsStore.getState().setReportCadence('month')
    gameStore.getState().startGame(playedTo(29))
    gameStore.getState().advance(10)
    // The shipped cards may bring an event that morning, which opens the
    // report in full rather than sliding it in.
    expect(gameStore.getState()).toMatchObject({
      game: { day: 31 },
      reportShown: 'month',
      monthReport: { firstDay: 0, lastDay: 30 },
    })
  })
})

describe('« Magnat » (#162)', () => {
  /**
   * Seed 1 on the morning of `day`, played with no event, the owner's own
   * cash a cent short of the last title: the close of a day that makes any
   * profit crowns them.
   */
  function nearMagnat(day: number): GameState {
    const morning = playedTo(day)
    const short = magnatTitle().netWorthCents - netWorth(morning) - 1
    return {
      ...morning,
      personal: {
        ...morning.personal,
        cash: cents(morning.personal.cash + short),
      },
    }
  }

  it('opens the morning after the close that crowns the owner, paused, and once a game', () => {
    const game = nearMagnat(3)
    expect(tick(game).dream.magnatOn).toBe(3)
    const store = createGameStore(game, NO_EVENTS)
    store.getState().setSpeed(3)
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 4, dream: { magnatOn: 3 } },
      panel: 'magnat',
      speed: PAUSED,
      resumeSpeed: 3,
    })
    store.getState().advance(1)
    expect(store.getState().game.day).toBe(4)

    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null, speed: 3 })
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({ game: { day: 14 }, panel: null })
  })

  it('opens before the report that comes the same morning, then the report', () => {
    // Sunday, day 6, crowns the owner; Monday brings the first week's report.
    const game = nearMagnat(6)
    expect(tick(game).dream.magnatOn).toBe(6)
    const store = createGameStore(game, NO_EVENTS, REPORT_AT_FIRST)
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 7, lastWeek: { firstDay: 0 } },
      panel: 'magnat',
      reportWaiting: true,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'report',
      reportWaiting: false,
      speed: PAUSED,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null })
  })

  it('waits for a panel open when it comes, then opens', () => {
    // Every panel pauses the game, so only a test gets here.
    const store = createGameStore(nearMagnat(3), NO_EVENTS)
    store.getState().openPanel('dream')
    store.getState().advance(10)
    expect(store.getState()).toMatchObject({
      game: { day: 4 },
      panel: 'dream',
      magnatWaiting: true,
    })
    store.getState().advance(1)
    expect(store.getState().game.day).toBe(4)
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'magnat',
      magnatWaiting: false,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null })
  })

  it('does not open again for a game loaded after it', () => {
    const store = createGameStore(nearMagnat(3), NO_EVENTS)
    store.getState().advance(1)
    const reloaded = deserialize(serialize(store.getState().game))
    const again = createGameStore(reloaded, NO_EVENTS)
    expect(again.getState().panel).toBeNull()
    again.getState().advance(5)
    expect(again.getState()).toMatchObject({ game: { day: 9 }, panel: null })
  })
})

describe('a purchase of « Le rêve »', () => {
  it('goes through decide() that very morning', () => {
    const store = createGameStore(createInitialState(1), NO_EVENTS)
    store.getState().decide({ kind: 'buy', rung: 'velo' })
    expect(store.getState().game.dream.bought).toEqual([
      { rung: 'velo', day: 0, cost: 150_000 },
    ])
    expect(store.getState().game.pendingDecisions).toBeNull()
    expect(() =>
      store.getState().decide({ kind: 'buy', rung: 'velo' }),
    ).toThrow(RangeError)
  })
})
