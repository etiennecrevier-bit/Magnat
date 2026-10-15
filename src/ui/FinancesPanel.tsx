import { useEffect, useRef } from 'react'
import type { Day, PersonalAccount } from '../engine/types.ts'
import { formatDayAndMonth, formatGameMonth } from './formatGameDate.ts'
import { formatMoney } from './formatMoney.ts'
import { monthMovements } from './personalFinances.ts'
import { useGame } from './store.ts'
import './panel.css'
import './FinancesPanel.css'

const TITLE_ID = 'finances-title'
const MONTH_ID = 'finances-month'

interface FinancesPanelViewProps {
  /** The owner's personal account, as of the close of the last day played. */
  account: PersonalAccount
  /** The day in the top bar, whose month shows before any day is played. */
  day: Day
  /** The last day played; null before the first. */
  lastPlayed: Day | null
  onClose: () => void
}

/**
 * The owner's own money, outside the company's books: the balance, then the
 * month's movements, newest first.
 */
export function FinancesPanelView({
  account,
  day,
  lastPlayed,
  onClose,
}: FinancesPanelViewProps) {
  const movements = monthMovements(account, lastPlayed)
  const negative = account.cash < 0
  return (
    <div className="panel__content">
      {/* Fermer comes first so it has the focus when the panel opens. */}
      <div className="panel__header">
        <button type="button" className="toggle" onClick={onClose}>
          Fermer
        </button>
        <h2 id={TITLE_ID}>Vos finances</h2>
      </div>
      <p className="finances__balance">
        <span className="finances__label">Solde</span>{' '}
        <span
          className={`finances__cash${negative ? ' finances__cash--negative' : ''}`}
        >
          {formatMoney(account.cash)}
        </span>
      </p>
      <section aria-labelledby={MONTH_ID}>
        <h3 id={MONTH_ID}>{formatGameMonth(lastPlayed ?? day)}</h3>
        {movements.length === 0 ? (
          <p>Aucun mouvement ce mois-ci.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Mouvement</th>
                <th scope="col" className="number">
                  Montant
                </th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement, i) => (
                <tr key={i}>
                  <td>{formatDayAndMonth(movement.day)}</td>
                  <td>
                    {movement.label}
                    {movement.unpaid && (
                      <>
                        {' '}
                        <span className="finances__unpaid">impayé</span>
                      </>
                    )}
                  </td>
                  <td className="number">{formatMoney(movement.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

/**
 * The panel wired to the app store, in a modal dialog: the page behind it
 * is out of reach, and Fermer or Escape closes it.
 */
export default function FinancesPanel() {
  const account = useGame((state) => state.game.personal)
  const day = useGame((state) => state.game.day)
  const lastPlayed = useGame((state) => state.game.lastDay?.day ?? null)
  const closePanel = useGame((state) => state.closePanel)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="panel finances"
      aria-labelledby={TITLE_ID}
      onClose={closePanel}
    >
      <FinancesPanelView
        account={account}
        day={day}
        lastPlayed={lastPlayed}
        onClose={() => dialogRef.current?.close()}
      />
    </dialog>
  )
}
