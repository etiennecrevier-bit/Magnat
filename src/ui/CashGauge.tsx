import type { Cents } from '../engine/money.ts'
import { cashLevel, type CashLevel } from './cashLevel.ts'
import { formatMoney } from './formatMoney.ts'
import './CashGauge.css'

// Each level shows as a word next to its colour, so colour is never the only
// signal. U+FE0E asks for the text form of each icon rather than an emoji.
const LEVELS: Record<CashLevel, { word: string; icon: string }> = {
  healthy: { word: 'Saine', icon: '✓︎' },
  low: { word: 'Faible', icon: '⚠︎' },
  negative: { word: 'Négative', icon: '✖︎' },
}

/** The encaisse and how it reads: saine, faible or négative. */
export function CashGaugeView({ cash }: { cash: Cents }) {
  const level = cashLevel(cash)
  const { word, icon } = LEVELS[level]
  return (
    <p className={`cash-gauge cash-gauge--${level}`}>
      <span className="cash-gauge__label">Encaisse</span>{' '}
      <span className="cash-gauge__amount">{formatMoney(cash)}</span>{' '}
      <span className="cash-gauge__state">
        <span aria-hidden="true">{icon}</span> {word}
      </span>
    </p>
  )
}
