import { describe, expect, it } from 'vitest'
import { createInitialState, startChallenge } from '../engine/clock.ts'
import { ASSETS } from '../world/manifest.ts'
import { openCityLink } from './cityLinks.ts'
import { openStreetLink } from './streetLinks.ts'
import { createGameStore, NORMAL_SPEED, PAUSED } from './store.ts'

function setup(game = createInitialState(42)) {
  const store = createGameStore(game)
  return {
    store,
    open: (link: Parameters<typeof openStreetLink>[0]) =>
      openStreetLink(link, store),
  }
}

describe('openStreetLink', () => {
  it.each([
    ['menu', 'menu'],
    ['stocks', 'stocks'],
    ['schedule', 'schedule'],
  ] as const)('opens « Le camion » on « %s », paused', (tab, shown) => {
    const { store, open } = setup()
    store.getState().setTruckTab('payMarketing')
    open({ dock: 'camion', tab })
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      truckTab: shown,
      speed: PAUSED,
      resumeSpeed: NORMAL_SPEED,
    })
  })

  it('opens « Le camion » on the tab it showed last when none is named', () => {
    const { store, open } = setup()
    store.getState().setTruckTab('bakery')
    open({ dock: 'camion' })
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      truckTab: 'bakery',
    })
  })

  it('opens « Équipe » and « Ville » as their dock buttons do', () => {
    const staff = setup()
    staff.open({ dock: 'equipe' })
    expect(staff.store.getState().panel).toBe('staff')

    const city = setup()
    city.open({ dock: 'ville' })
    expect(city.store.getState()).toMatchObject({
      panel: 'trip',
      cityTab: 'trip',
    })
  })

  it('opens each spot of the manifest', () => {
    for (const { opens } of ASSETS.spots) {
      const { store, open } = setup()
      open(opens)
      expect(store.getState().panel, opens.dock).not.toBeNull()
    }
  })

  it('does nothing while a panel is open, and leaves its tab', () => {
    const { store, open } = setup()
    store.getState().openPanel('staff')
    store.getState().setTruckTab('menu')
    open({ dock: 'camion', tab: 'stocks' })
    expect(store.getState()).toMatchObject({ panel: 'staff', truckTab: 'menu' })
  })

  it('opens no « Ville » in a Défi, which hides it, but « Le camion » still', () => {
    const { store, open } = setup(startChallenge('travauxSaintDenis', 42))
    open({ dock: 'ville' })
    expect(store.getState().panel).toBeNull()
    open({ dock: 'camion', tab: 'menu' })
    expect(store.getState().panel).toBe('manage')
  })

  it('closes the drawer open as its panel opens', () => {
    const { store, open } = setup()
    store.getState().openDrawer('finances')
    open({ dock: 'camion', tab: 'menu' })
    expect(store.getState()).toMatchObject({ panel: 'manage', drawer: null })
  })

  it('is what the world reports to the city links too', () => {
    const store = createGameStore(createInitialState(42))
    openCityLink({ dock: 'camion', tab: 'stocks' }, store)
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      truckTab: 'stocks',
    })
  })
})
