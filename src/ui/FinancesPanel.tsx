import { useMemo } from 'react'
import { cents, sub } from '../engine/money.ts'
import { netWorthParts, type NetWorthParts } from '../engine/netWorth.ts'
import type { Day, PersonalAccount } from '../engine/types.ts'
import { formatDayAndMonth, formatGameMonth } from './formatGameDate.ts'
import { formatMoney } from './formatMoney.ts'
import { monthMovements } from './personalFinances.ts'
import { useGame } from './store.ts'
import './panel.css'
import './FinancesPanel.css'

const TITLE_ID = 'finances-title'
const MONTH_ID = 'finances-month'
const NET_WORTH_ID = 'finances-net-worth'

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
 * The owner's « Valeur nette » this morning and its four parts, the debts
 * below zero so the parts add up to it.
 */
export function NetWorthPartsView({ netWorth }: { netWorth: NetWorthParts }) {
  const parts = [
    { label: "Part de l'entreprise", amount: netWorth.companyShare },
    { label: 'Argent personnel', amount: netWorth.personalCash },
    { label: 'Biens personnels', amount: netWorth.personalAssets },
    {
      label: 'Dettes personnelles',
      amount: sub(cents(0), netWorth.personalDebts),
    },
  ]
  return (
    <section className="finances__net-worth" aria-labelledby={NET_WORTH_ID}>
      <h3 id={NET_WORTH_ID}>
        Valeur nette&nbsp;: <strong>{formatMoney(netWorth.total)}</strong>
      </h3>
      <ul className="finances__net-worth-parts">
        {parts.map(({ label, amount }) => (
          <li key={label}>
            {label}&nbsp;: {formatMoney(amount)}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * « Personnel » of « Finances » with the app store's game: « Vos finances
 * », then the net worth's four parts.
 */
export default function FinancesPanel() {
  const account = useGame((state) => state.game.personal)
  const day = useGame((state) => state.game.day)
  const lastPlayed = useGame((state) => state.game.lastDay?.day ?? null)
  const journal = useGame((state) => state.game.journal)
  const financing = useGame((state) => state.game.financing)
  const dream = useGame((state) => state.game.dream)
  // The books only change when a day is played, not on every frame.
  const netWorth = useMemo(
    () => netWorthParts({ day, journal, financing, personal: account, dream }),
    [day, journal, financing, account, dream],
  )
  // Its own « Fermer » hides in the drawer's frame, whose « ✕ » closes it.
  return (
    <div className="finances">
      <FinancesPanelView
        account={account}
        day={day}
        lastPlayed={lastPlayed}
        onClose={() => {}}
      />
      <NetWorthPartsView netWorth={netWorth} />
    </div>
  )
}
