import { describe, expect, it } from 'vitest'
import { createInitialState, startChallenge } from '../engine/clock.ts'
import { NORMAL_SPEED } from './store.ts'
import { openCityLink, openContracts } from './cityLinks.ts'
import { createGameStore, PAUSED } from './store.ts'

function setup(game = createInitialState(42)) {
  const store = createGameStore(game)
  return {
    store,
    open: (link: Parameters<typeof openCityLink>[0]) =>
      openCityLink(link, store),
  }
}

const DEFI = () => startChallenge('travauxSaintDenis', 42)

describe('openCityLink', () => {
  it('opens « Ville » for a place, paused', () => {
    const { store, open } = setup()
    open('trip')
    expect(store.getState()).toMatchObject({
      panel: 'trip',
      panelSection: null,
      speed: PAUSED,
    })
  })

  it('opens no trip in a Défi, as the dock hides « Ville »', () => {
    const { store, open } = setup(DEFI())
    open('trip')
    expect(store.getState().panel).toBeNull()
  })

  it('opens « Camion » at « Fournil » for the bakery', () => {
    const { store, open } = setup()
    open('fournil')
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      panelSection: 'bakery',
    })
  })

  it('opens « Ville » on « Contrats » for a grocer, paused', () => {
    const { store, open } = setup()
    open('contracts')
    expect(store.getState()).toMatchObject({
      panel: 'trip',
      panelSection: 'contracts',
      speed: PAUSED,
      drawer: null,
    })
  })

  it('opens « Finances » on « Contrats » for a grocer in a Défi, without pausing', () => {
    const { store, open } = setup(DEFI())
    open('contracts')
    expect(store.getState()).toMatchObject({
      panel: null,
      drawer: 'finances',
      drawerTabs: { finances: 'contracts' },
      speed: NORMAL_SPEED,
    })
  })

  it('moves « Finances » already open on another tab to « Contrats » in a Défi', () => {
    const { store, open } = setup(DEFI())
    store.getState().openDrawer('finances', 'statements')
    open('contracts')
    expect(store.getState()).toMatchObject({
      drawer: 'finances',
      drawerTabs: { finances: 'contracts' },
      speed: NORMAL_SPEED,
    })
  })

  it('leaves a panel already open, as the dock’s buttons do', () => {
    const { store, open } = setup()
    store.getState().openPanel('settings')
    open('fournil')
    open('contracts')
    expect(store.getState()).toMatchObject({
      panel: 'settings',
      panelSection: null,
    })
  })

  it('opens no drawer under a panel in a Défi', () => {
    const { store } = setup(DEFI())
    store.getState().openPanel('settings')
    openContracts(store)
    expect(store.getState()).toMatchObject({ panel: 'settings', drawer: null })
  })
})
