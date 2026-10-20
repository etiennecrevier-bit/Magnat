import type { CityLink } from '../world/cityPicker.ts'
import { settingsStore, type SettingsStore } from './settings.ts'
import { gameStore, type GameStore } from './store.ts'

// What a click on a building of the city opens (#165). The world reports
// the link; this opens what the top bar and the screens open, so the city
// is only another way to the panels.

/**
 * Opens what `link` names: « Aller à… » for a place, outside a Défi, as the
 * top bar shows it; « Gérer le camion » at « Fournil » for the bakery; the
 * « Contrats » screen for a grocer, unfolding the screens if they are
 * folded. A panel already open stays, as with the top bar's buttons.
 */
export function openCityLink(
  link: CityLink,
  store: GameStore = gameStore,
  settings: Pick<SettingsStore, 'getState'> = settingsStore,
): void {
  const { openPanel, showScreen, game } = store.getState()
  switch (link) {
    case 'trip':
      if (game.challenge === null) openPanel('trip')
      return
    case 'fournil':
      openPanel('manage', 'bakery')
      return
    case 'contracts':
      showScreen('contracts')
      settings.getState().setScreensFolded(false)
      return
  }
}
