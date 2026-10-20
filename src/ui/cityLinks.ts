import type { CityLink } from '../world/cityPicker.ts'
import { settingsStore, type SettingsStore } from './settings.ts'
import { gameStore, type GameStore } from './store.ts'

// What a click on a building of the city opens (#165). The world reports
// the link; this opens what the dock opens, so the city is only another
// way to the panels. The city shows while « Ville » is open (#204), so a
// click there mostly moves « Ville » to the matching tab.

/**
 * Opens the « Contrats » with the grocers: the tab of « Ville », or, in a
 * Défi, where « Ville » is hidden, the tab of « Finances », even when that
 * drawer is open on another tab. With « Ville » open, it moves to the tab;
 * another panel already open stays.
 */
export function openContracts(store: GameStore = gameStore): void {
  const { openPanel, openDrawer, setCityTab, panel, game } = store.getState()
  if (panel === 'trip') setCityTab('contracts')
  else if (game.challenge === null) openPanel('trip', 'contracts')
  else openDrawer('finances', 'contracts')
}

/**
 * Opens what `link` names: « Ville » at « Aller à… » for a place, outside
 * a Défi, as the dock shows it; « Camion » at « Fournil » for the bakery,
 * in place of « Ville » when it is open, as the street then comes back;
 * the « Contrats » for a grocer (see `openContracts`), with « Ville » on
 * the grocer's card when it names one. Another panel already open stays,
 * as with the dock's buttons.
 */
export function openCityLink(
  link: CityLink,
  store: GameStore = gameStore,
): void {
  const { openPanel, closePanel, setCityTab, pickGrocer, panel, game } =
    store.getState()
  if (typeof link === 'object') {
    openContracts(store)
    if (store.getState().panel === 'trip') pickGrocer(link.grocer)
    return
  }
  switch (link) {
    case 'trip':
      if (panel === 'trip') setCityTab('trip')
      else if (game.challenge === null) openPanel('trip')
      return
    case 'fournil':
      if (panel === 'trip') closePanel()
      openPanel('manage', 'bakery')
      return
    case 'contracts':
      openContracts(store)
      return
  }
}

/**
 * Shows the city behind « Ville » as it opens: returns what shows the
 * street again as it closes, however it closes.
 */
export function showCity(
  settings: Pick<SettingsStore, 'getState'> = settingsStore,
): () => void {
  settings.getState().setWorldView('city')
  return () => settings.getState().setWorldView('street')
}
