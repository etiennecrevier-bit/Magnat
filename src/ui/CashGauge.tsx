import type { Cents } from '../engine/money.ts'
import { cashTip, SPARKLINE, sparklinePoints } from './cashChip.ts'
import { cashLevel, type CashLevel } from './cashLevel.ts'
import { formatWholeMoney } from './formatMoney.ts'
import type { TodayNumbers } from './todayNumbers.ts'
import Tooltip from './Tooltip.tsx'
import './CashGauge.css'

// Each level shows as a word next to its colour, so colour is never the only
// signal. U+FE0E asks for the text form of each icon rather than an emoji.
const LEVELS: Record<CashLevel, { word: string; icon: string }> = {
  healthy: { word: 'Saine', icon: '✓︎' },
  low: { word: 'Faible', icon: '⚠︎' },
  negative: { word: 'Négative', icon: '✖︎' },
}

interface CashChipViewProps {
  /** The encaisse now. */
  cash: Cents
  /** What the next 1st of the month takes from the encaisse. */
  fixedCosts: Cents
  /** The encaisse at each of the last closes, oldest first. */
  history: readonly Cents[]
  /** The last day's numbers for the tooltip, as on a phone; see `cashTip`. */
  yesterday?: TodayNumbers | null
  /** Opens « Finances ». */
  onOpen: () => void
}

/**
 * The cash chip: « Encaisse » to the dollar, a sparkline of the encaisse at
 * the last closes, and how it reads against the fixed costs, saine, faible
 * or négative, as a word. Its tooltip has the cents and the fixed costs; a
 * click opens « Finances ».
 */
export function CashChipView({
  cash,
  fixedCosts,
  history,
  yesterday,
  onOpen,
}: CashChipViewProps) {
  const level = cashLevel(cash, fixedCosts)
  const { word, icon } = LEVELS[level]
  const points = sparklinePoints(history)
  return (
    <Tooltip content={cashTip({ cash, fixedCosts, yesterday })}>
      {(anchor) => (
        <button
          type="button"
          className={`cash-chip cash-chip--${level}`}
          data-tuto="cash.chip"
          aria-haspopup="dialog"
          {...anchor}
          onClick={onOpen}
        >
          <span className="cash-chip__label">Encaisse</span>{' '}
          <span className="cash-chip__amount">{formatWholeMoney(cash)}</span>{' '}
          <svg
            className="cash-chip__sparkline"
            width={SPARKLINE.width}
            height={SPARKLINE.height}
            viewBox={`0 0 ${SPARKLINE.width} ${SPARKLINE.height}`}
            aria-hidden="true"
            focusable="false"
          >
            {points !== '' && (
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>{' '}
          <span className="cash-chip__state">
            <span aria-hidden="true">{icon}</span> {word}
          </span>
        </button>
      )}
    </Tooltip>
  )
}
