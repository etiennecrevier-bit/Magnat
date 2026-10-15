import type { Avatar } from '../content/schema.ts'
import { ENERGY } from '../engine/day.ts'
import { FULL_ENERGY, fatigueOf, type Fatigue } from '../engine/energy.ts'
import './EnergyGauge.css'

// Each state shows as a word next to its colour, so colour is never the only
// signal. The word describes the owner, so it agrees with their avatar.
const STATES: Record<Fatigue, { icon: string; words: Record<Avatar, string> }> =
  {
    rested: { icon: '●', words: { homme: 'Reposé', femme: 'Reposée' } },
    tired: { icon: '◐', words: { homme: 'Fatigué', femme: 'Fatiguée' } },
    exhausted: { icon: '○', words: { homme: 'Épuisé', femme: 'Épuisée' } },
  }

interface EnergyGaugeViewProps {
  /** The owner's energy this morning, 0 to `FULL_ENERGY`. */
  energy: number
  /** The owner's avatar, which the state's word agrees with. */
  avatar: Avatar
}

/** The owner's energy and how it reads: reposé, fatigué or épuisé. */
export function EnergyGaugeView({ energy, avatar }: EnergyGaugeViewProps) {
  const fatigue = fatigueOf(energy, ENERGY)
  const { icon, words } = STATES[fatigue]
  const word = words[avatar]
  const share = Math.min(1, Math.max(0, energy / FULL_ENERGY))
  return (
    <p className={`energy-gauge energy-gauge--${fatigue}`}>
      <span className="energy-gauge__label" aria-hidden="true">
        Énergie
      </span>{' '}
      <span
        className="energy-gauge__bar"
        role="meter"
        aria-label="Énergie"
        aria-valuemin={0}
        aria-valuemax={FULL_ENERGY}
        aria-valuenow={Math.round(energy)}
        aria-valuetext={word}
      >
        <span
          className="energy-gauge__fill"
          style={{ width: `${share * 100}%` }}
        />
      </span>{' '}
      <span className="energy-gauge__state">
        <span aria-hidden="true">{icon}</span> {word}
      </span>
    </p>
  )
}
