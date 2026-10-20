import { describe, expect, it, vi } from 'vitest'
import { createInitialState, startChallenge, tick } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
import type { PersonalAccount } from '../engine/types.ts'
import {
  activateDockItem,
  DOCK_ITEMS,
  dockBadges,
  dockButtonId,
  dockItems,
  dockKeyItem,
  handleDockKey,
  isDockItemOpen,
  type DockItem,
  type DockItemId,
} from './dock.ts'
import type { KeyEventLike } from './pauseShortcut.ts'
import { createGameStore, NORMAL_SPEED, PAUSED } from './store.ts'

function item(id: DockItemId): DockItem {
  const found = DOCK_ITEMS.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`No ${id}`)
  return found
}

function keyEvent(overrides: Partial<KeyEventLike> = {}) {
  return {
    key: 'c',
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...overrides,
  }
}

/** A fake element that sits inside the elements `ancestors` name. */
function element(tagName: string, ancestors: string[] = []) {
  return {
    tagName,
    isContentEditable: false,
    closest(selectors: string) {
      return selectors
        .split(',')
        .map((selector) => selector.trim())
        .some((selector) => ancestors.includes(selector))
        ? {}
        : null
    },
  }
}

describe('dockItems', () => {
  it('lists the seven buttons in the dock’s order, a divider before « Journal »', () => {
    expect(dockItems(false).map(({ label }) => label)).toEqual([
      'Camion',
      'Équipe',
      'Ville',
      'Finances',
      'Améliorations',
      'Journal',
      'Réglages',
    ])
    expect(
      dockItems(false)
        .filter(({ divided }) => divided)
        .map(({ id }) => id),
    ).toEqual(['journal'])
  })

  it('hides « Ville » and « Améliorations » in a Défi', () => {
    expect(dockItems(true).map(({ id }) => id)).toEqual([
      'camion',
      'equipe',
      'finances',
      'journal',
      'reglages',
    ])
  })

  it('gives each a key, C, E, V, F, A and J, but « Réglages »', () => {
    expect(DOCK_ITEMS.map(({ key }) => key)).toEqual([
      'C',
      'E',
      'V',
      'F',
      'A',
      'J',
      null,
    ])
  })

  it('opens a panel from each decision button and a drawer from « Finances » and « Journal »', () => {
    expect(DOCK_ITEMS.map(({ target }) => target)).toEqual([
      { kind: 'panel', panel: 'manage' },
      { kind: 'panel', panel: 'staff' },
      { kind: 'panel', panel: 'trip' },
      { kind: 'drawer', drawer: 'finances' },
      { kind: 'panel', panel: 'dream' },
      { kind: 'drawer', drawer: 'journal' },
      { kind: 'panel', panel: 'settings' },
    ])
    expect(dockButtonId('finances')).toBe('dock-finances')
  })
})

describe('activateDockItem', () => {
  it.each([
    ['camion', 'manage'],
    ['equipe', 'staff'],
    ['ville', 'trip'],
    ['ameliorations', 'dream'],
    ['reglages', 'settings'],
  ] as const)('opens the panel of %s, which pauses', (id, panel) => {
    const store = createGameStore()
    store.getState().setSpeed(3)
    activateDockItem(store, item(id))
    expect(store.getState()).toMatchObject({ panel, speed: PAUSED })
    expect(isDockItemOpen(item(id), store.getState())).toBe(true)
  })

  it.each(['finances', 'journal'] as const)(
    'opens the %s drawer without pausing, and closes it on a second press',
    (id) => {
      const store = createGameStore()
      store.getState().setSpeed(3)
      activateDockItem(store, item(id))
      expect(store.getState()).toMatchObject({
        drawer: id,
        panel: null,
        speed: 3,
      })
      expect(isDockItemOpen(item(id), store.getState())).toBe(true)
      activateDockItem(store, item(id))
      expect(store.getState()).toMatchObject({ drawer: null, speed: 3 })
    },
  )

  it('moves from one drawer to the other', () => {
    const store = createGameStore()
    activateDockItem(store, item('finances'))
    activateDockItem(store, item('journal'))
    expect(store.getState().drawer).toBe('journal')
    expect(isDockItemOpen(item('finances'), store.getState())).toBe(false)
  })

  it('does nothing while a panel is open', () => {
    const store = createGameStore()
    activateDockItem(store, item('camion'))
    activateDockItem(store, item('equipe'))
    activateDockItem(store, item('journal'))
    expect(store.getState()).toMatchObject({ panel: 'manage', drawer: null })
  })
})

describe('dockBadges', () => {
  const personal: PersonalAccount = createInitialState(42).personal

  it('shows none while nothing waits', () => {
    expect(
      dockBadges({
        unreadReports: 0,
        cash: cents(100),
        personal,
        lastPlayed: null,
      }),
    ).toEqual({})
  })

  it('counts the reports not read on « Journal »', () => {
    expect(
      dockBadges({
        unreadReports: 2,
        cash: cents(0),
        personal,
        lastPlayed: null,
      }),
    ).toEqual({ journal: 2 })
  })

  it('counts one on « Finances » while the encaisse is below zero', () => {
    expect(
      dockBadges({
        unreadReports: 0,
        cash: cents(-1),
        personal,
        lastPlayed: null,
      }),
    ).toEqual({ finances: 1 })
  })

  it('counts each rent left unpaid in the month « Vos finances » shows', () => {
    // A game whose owner has no money misses the rent of the 1st.
    let game = createInitialState(42)
    game = {
      ...game,
      personal: { ...game.personal, cash: cents(0) },
    }
    game = tick(game)
    expect(game.personal.unpaidRents).toEqual([0])
    expect(
      dockBadges({
        unreadReports: 0,
        cash: cents(-1),
        personal: game.personal,
        lastPlayed: 0,
      }),
    ).toEqual({ finances: 2 })
    // The next month's view no longer lists it.
    expect(
      dockBadges({
        unreadReports: 0,
        cash: cents(1),
        personal: game.personal,
        lastPlayed: 40,
      }),
    ).toEqual({})
  })
})

describe('the dock’s keys', () => {
  const items = dockItems(false)

  it.each([
    ['c', 'camion'],
    ['C', 'camion'],
    ['e', 'equipe'],
    ['v', 'ville'],
    ['f', 'finances'],
    ['a', 'ameliorations'],
    ['j', 'journal'],
  ] as const)('opens with %s what %s opens', (key, id) => {
    expect(dockKeyItem(keyEvent({ key }), items)?.id).toBe(id)
  })

  it('has no key for « Réglages », nor for R, Space or the others', () => {
    for (const key of ['r', ' ', 'g', 'Escape', 'Enter']) {
      expect(dockKeyItem(keyEvent({ key }), items)).toBeNull()
    }
  })

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const)(
    'leaves the key alone with %s',
    (modifier) => {
      expect(dockKeyItem(keyEvent({ [modifier]: true }), items)).toBeNull()
    },
  )

  it('leaves the key to a text field, and to a panel or the event card', () => {
    expect(
      dockKeyItem(keyEvent({ target: element('INPUT') }), items),
    ).toBeNull()
    expect(
      dockKeyItem(keyEvent({ target: element('BUTTON', ['dialog']) }), items),
    ).toBeNull()
  })

  it('works from inside a drawer, which is no dialog element', () => {
    expect(
      dockKeyItem(
        keyEvent({ key: 'j', target: element('BUTTON', ['.dock-drawer']) }),
        items,
      )?.id,
    ).toBe('journal')
  })

  it('has no V nor A in a Défi', () => {
    expect(dockKeyItem(keyEvent({ key: 'v' }), dockItems(true))).toBeNull()
    expect(dockKeyItem(keyEvent({ key: 'a' }), dockItems(true))).toBeNull()
  })

  it('does what the button does once, and not again while the key is held', () => {
    const activate = vi.fn()
    const event = keyEvent({ key: 'f' })
    handleDockKey(event, items, activate)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(activate).toHaveBeenCalledWith(item('finances'))
    const held = keyEvent({ key: 'f', repeat: true })
    handleDockKey(held, items, activate)
    expect(held.preventDefault).toHaveBeenCalled()
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('opens each panel from the keyboard, pausing, and each drawer without', () => {
    const store = createGameStore()
    const press = (key: string) =>
      handleDockKey(keyEvent({ key }), dockItems(false), (found) =>
        activateDockItem(store, found),
      )
    press('f')
    expect(store.getState()).toMatchObject({
      drawer: 'finances',
      speed: NORMAL_SPEED,
    })
    press('c')
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      drawer: null,
      speed: PAUSED,
    })
  })

  it('does nothing elsewhere in a Défi for its hidden buttons', () => {
    const store = createGameStore(startChallenge('travauxSaintDenis', 42))
    handleDockKey(keyEvent({ key: 'v' }), dockItems(true), (found) =>
      activateDockItem(store, found),
    )
    expect(store.getState().panel).toBeNull()
  })
})
