import { useMemo } from 'react'
import type { TruckId } from '../engine/types.ts'
import { SHOWN_TRUCK, type ShownTruckStore } from '../world/shownTruck.ts'
import { useGame } from './store.ts'
import { useShownTruck } from './trucks.ts'
import { truckPills, type TruckPill } from './truckViews.ts'
import './TruckSwitcher.css'

interface TruckSwitcherViewProps {
  pills: readonly TruckPill[]
  /** The truck shown, whose pill is pressed. */
  shown: TruckId
  onPick: (truck: TruckId) => void
}

/**
 * « Camion affiché » (#265): one pill per truck, under the top-left card,
 * the one shown pressed; a press shows another. Nothing while there is one
 * truck.
 */
export function TruckSwitcherView({
  pills,
  shown,
  onPick,
}: TruckSwitcherViewProps) {
  if (pills.length < 2) return null
  return (
    <div className="truck-switcher" role="group" aria-label="Camion affiché">
      {pills.map(({ id, name, who }) => (
        <button
          key={id}
          type="button"
          className="truck-switcher__pill"
          aria-pressed={id === shown}
          onClick={() => onPick(id)}
        >
          {name} · {who}
        </button>
      ))}
    </div>
  )
}

/**
 * The switcher wired to the app store and `store`, the truck the page and
 * the street show.
 */
export default function TruckSwitcher({
  store = SHOWN_TRUCK,
}: {
  store?: ShownTruckStore
}) {
  const game = useGame((state) => state.game)
  const shown = useShownTruck(game, store)
  const pills = useMemo(() => truckPills(game), [game])
  return (
    <TruckSwitcherView
      pills={pills}
      shown={shown}
      onPick={(truck) => store.pick(truck)}
    />
  )
}
