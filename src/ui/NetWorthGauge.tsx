import type { Cents } from '../engine/money.ts'
import { formatMoney, formatSignedMoney } from './formatMoney.ts'
import './NetWorthGauge.css'

// The arrow's shape tells up from down, so colour is never the only signal.
const ARROWS = { up: '▲', down: '▼' } as const

/**
 * The owner's « Valeur nette », with an arrow up or down for how it moved
 * since the last Sunday's close, `change`, which its label reads out: none
 * when it did not move, or before a week has a net worth to move from.
 */
export function NetWorthGaugeView({
  netWorth,
  change,
}: {
  netWorth: Cents
  change: Cents | null
}) {
  const direction =
    change === null || change === 0 ? null : change > 0 ? 'up' : 'down'
  return (
    <p className="net-worth-gauge">
      <span className="net-worth-gauge__label">Valeur nette</span>{' '}
      <span className="net-worth-gauge__amount">{formatMoney(netWorth)}</span>
      {direction !== null && change !== null && (
        <>
          {' '}
          <span
            className={`net-worth-gauge__change net-worth-gauge__change--${direction}`}
            role="img"
            aria-label={`${formatSignedMoney(change)} cette semaine`}
          >
            {ARROWS[direction]}
          </span>
        </>
      )}
    </p>
  )
}
