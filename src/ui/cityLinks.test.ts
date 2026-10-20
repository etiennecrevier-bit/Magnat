import { describe, expect, it } from 'vitest'
import { createInitialState, startChallenge } from '../engine/clock.ts'
import { openCityLink } from './cityLinks.ts'
import { createSettingsStore } from './settings.ts'
import { createGameStore, PAUSED } from './store.ts'

function setup(game = createInitialState(42)) {
  const store = createGameStore(game)
  const settings = createSettingsStore(null)
  return {
    store,
    settings,
    open: (link: Parameters<typeof openCityLink>[0]) =>
      openCityLink(link, store, settings),
  }
}

describe('openCityLink', () => {
  it('opens « Aller à… » for a place, paused', () => {
    const { store, open } = setup()
    open('trip')
    expect(store.getState()).toMatchObject({ panel: 'trip', speed: PAUSED })
  })

  it('opens no trip in a Défi, as the top bar hides « Aller à… »', () => {
    const { store, open } = setup(startChallenge('travauxSaintDenis', 42))
    open('trip')
    expect(store.getState().panel).toBeNull()
  })

  it('opens « Gérer le camion » at « Fournil » for the bakery', () => {
    const { store, open } = setup()
    open('fournil')
    expect(store.getState()).toMatchObject({
      panel: 'manage',
      panelSection: 'bakery',
    })
  })

  it('shows « Contrats » for a grocer, unfolding the screens', () => {
    const { store, settings, open } = setup()
    settings.getState().setScreensFolded(true)
    open('contracts')
    expect(store.getState().screen).toBe('contracts')
    expect(store.getState().panel).toBeNull()
    expect(settings.getState().screensFolded).toBe(false)
  })

  it('leaves a panel already open, as the top bar’s buttons do', () => {
    const { store, open } = setup()
    store.getState().openPanel('finances')
    open('fournil')
    expect(store.getState()).toMatchObject({
      panel: 'finances',
      panelSection: null,
    })
  })
})
