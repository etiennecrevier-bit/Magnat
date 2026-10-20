import { describe, expect, it } from 'vitest'
import { createInitialState, startChallenge } from '../engine/clock.ts'
import { NORMAL_SPEED } from './store.ts'
import { openCityLink, openContracts, showCity } from './cityLinks.ts'
import { createSettingsStore } from './settings.ts'
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

  it('opens « Ville » on « Contrats » at the grocer whose shop was clicked', () => {
    const { store, open } = setup()
    open({ grocer: 'chezNormand' })
    expect(store.getState()).toMatchObject({
      panel: 'trip',
      cityTab: 'contracts',
      cityPick: { grocer: 'chezNormand', count: 1, pending: true },
      speed: PAUSED,
    })
  })

  it('opens « Finances » on « Contrats » for a grocer’s shop in a Défi, with no pick', () => {
    const { store, open } = setup(DEFI())
    open({ grocer: 'chezNormand' })
    expect(store.getState()).toMatchObject({
      panel: null,
      drawer: 'finances',
      drawerTabs: { finances: 'contracts' },
      cityPick: null,
    })
  })

  it('opens no grocer under another panel', () => {
    const { store, open } = setup()
    store.getState().openPanel('settings')
    open({ grocer: 'chezNormand' })
    expect(store.getState()).toMatchObject({
      panel: 'settings',
      cityPick: null,
    })
  })

  it('opens no drawer under a panel in a Défi', () => {
    const { store } = setup(DEFI())
    store.getState().openPanel('settings')
    openContracts(store)
    expect(store.getState()).toMatchObject({ panel: 'settings', drawer: null })
  })
})

describe('openCityLink with « Ville » open, the city behind it', () => {
  function inCity() {
    const context = setup()
    context.store.getState().openPanel('trip')
    return context
  }

  it('moves to « Contrats » on each grocer clicked, the same one again too', () => {
    const { store, open } = inCity()
    open({ grocer: 'marcheBioLogique' })
    expect(store.getState()).toMatchObject({
      panel: 'trip',
      cityTab: 'contracts',
      cityPick: { grocer: 'marcheBioLogique', count: 1, pending: true },
    })
    open({ grocer: 'marcheBioLogique' })
    expect(store.getState().cityPick).toEqual({
      grocer: 'marcheBioLogique',
      count: 2,
      pending: true,
    })
  })

  it('moves to « Aller à… » for a place, and to « Contrats » for the grocers', () => {
    const { store, open } = inCity()
    open('contracts')
    expect(store.getState()).toMatchObject({
      panel: 'trip',
      cityTab: 'contracts',
    })
    open('trip')
    expect(store.getState()).toMatchObject({ panel: 'trip', cityTab: 'trip' })
  })

  it('swaps « Ville » for « Camion » at « Fournil » for the bakery, still paused', () => {
    const { store, open } = inCity()
    open('fournil')
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      panelSection: 'bakery',
      truckTab: 'bakery',
      speed: PAUSED,
    })
  })
})

describe('showCity', () => {
  it('shows the city, then the street again', () => {
    const settings = createSettingsStore(null)
    const back = showCity(settings)
    expect(settings.getState().worldView).toBe('city')
    back()
    expect(settings.getState().worldView).toBe('street')
  })
})
