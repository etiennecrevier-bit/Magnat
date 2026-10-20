import type { StreetLink } from '../world/streetSpots.ts'
import { activateDockItem, DOCK_ITEMS } from './dock.ts'
import { gameStore, type GameStore } from './store.ts'

// What a click on a spot of the street opens (#208). The street reports the
// link; this opens what the dock opens, so the street is only another way to
// the panels.

/**
 * Opens what `link` names as its dock button does, on « Le camion »'s tab
 * when it names one: nothing while a panel is open, as with the dock, nor in
 * a Défi for a button the Défi hides. A drawer open closes as the panel
 * opens.
 */
export function openStreetLink(
  link: StreetLink,
  store: GameStore = gameStore,
): void {
  const { game, resumeSpeed, setTruckTab } = store.getState()
  const item = DOCK_ITEMS.find(({ id }) => id === link.dock)
  if (item === undefined || resumeSpeed !== null) return
  if (item.hiddenInChallenge && game.challenge !== null) return
  if ('tab' in link && link.tab !== undefined) setTruckTab(link.tab)
  activateDockItem(store, item)
}
