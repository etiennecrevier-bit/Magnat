import type { FinancingSummary } from './financingSummary.ts'
import { formatDayAndMonth } from './formatGameDate.ts'
import { formatMoney } from './formatMoney.ts'
import './FinancingBlock.css'

// A share shows to a tenth of a percent, a no-break space (U+00A0) before
// its sign.
const TENTHS_PER_PERCENT = 10
const PERCENT = '\u00a0%'

/** A share in tenths of a percent: « 20 % », « 20,5 % ». */
function formatShare(tenths: number): string {
  const whole = Math.floor(tenths / TENTHS_PER_PERCENT)
  const tenth = tenths % TENTHS_PER_PERCENT
  return `${tenth === 0 ? whole : `${whole},${tenth}`}${PERCENT}`
}

/**
 * « Financement », once the game took an emergency loan or sold shares:
 * the loans still open, the shares sold and the next dividend.
 */
export function FinancingBlock({ financing }: { financing: FinancingSummary }) {
  const { hadLoans, loans, shares, dividend } = financing
  return (
    <ul className="financing">
      {loans.map(({ lender, owed, next }, index) => (
        <li key={index}>
          Prêt d'urgence · {lender}&nbsp;: {formatMoney(owed)} à rembourser
          {next !== null && (
            <>
              , prochain versement de {formatMoney(next.amount)} le{' '}
              {formatDayAndMonth(next.day)}
            </>
          )}
        </li>
      ))}
      {hadLoans && loans.length === 0 && <li>Aucun prêt d'urgence en cours</li>}
      {shares.map(({ investor, tenths }) => (
        <li key={investor}>
          {investor}&nbsp;: {formatShare(tenths)} des actions
        </li>
      ))}
      {dividend !== null && (
        <li>
          {dividend.final ? (
            <>Dividende aujourd'hui&nbsp;: {formatMoney(dividend.amount)}</>
          ) : (
            <>
              Prochain dividende le {formatDayAndMonth(dividend.day)}&nbsp;:{' '}
              {formatMoney(dividend.amount)} à ce jour
            </>
          )}
        </li>
      )}
    </ul>
  )
}
