import type { CityLink } from '../world/cityPicker.ts'
import { gameStore, type GameStore } from './store.ts'

// What a click on a building of the city opens (#165). The world reports
// the link; this opens what the dock opens, so the city is only another
// way to the panels.

/**
 * Opens the « Contrats » with the grocers: the tab of « Ville », or, in a
 * Défi, where « Ville » is hidden, the tab of « Finances », even when that
 * drawer is open on another tab. A panel already open stays.
 */
export function openContracts(store: GameStore = gameStore): void {
  const { openPanel, openDrawer, game } = store.getState()
  if (game.challenge === null) openPanel('trip', 'contracts')
  else openDrawer('finances', 'contracts')
}

/**
 * Opens what `link` names: « Ville » for a place, outside a Défi, as the
 * dock shows it; « Camion » at « Fournil » for the bakery; the « Contrats »
 * for a grocer (see `openContracts`). A panel already open stays, as with
 * the dock's buttons.
 */
export function openCityLink(
  link: CityLink,
  store: GameStore = gameStore,
): void {
  const { openPanel, game } = store.getState()
  switch (link) {
    case 'trip':
      if (game.challenge === null) openPanel('trip')
      return
    case 'fournil':
      openPanel('manage', 'bakery')
      return
    case 'contracts':
      openContracts(store)
      return
  }
}
