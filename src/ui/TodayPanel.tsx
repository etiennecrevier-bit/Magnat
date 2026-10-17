import { useMemo } from 'react'
import { FOOD_TRUCK } from '../engine/day.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import { cents, sub } from '../engine/money.ts'
import { netWorthParts, type NetWorthParts } from '../engine/netWorth.ts'
import type { DaySummary } from '../engine/types.ts'
import { formatGameDate } from './formatGameDate.ts'
import { formatMoney } from './formatMoney.ts'
import { useGame } from './store.ts'
import { todayNumbers, totalUnits } from './todayNumbers.ts'
import './TodayPanel.css'

/**
 * Yesterday at the truck: units sold, lost and spoiled, by product and in
 * all, the revenue and the customers served. The folded strip shows the
 * same numbers (see todayNumbers.ts). Then the owner's « Valeur nette » this
 * morning and its four parts, from the first morning on, the debts below
 * zero so the parts add up to it.
 */
export function TodayPanelView({
  lastDay,
  netWorth,
}: {
  lastDay: DaySummary | null
  netWorth: NetWorthParts
}) {
  const numbers = lastDay === null ? null : todayNumbers(lastDay)
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
    <section className="today">
      <h1>Aujourd'hui</h1>
      {lastDay === null || numbers === null ? (
        <p>La première journée n'est pas encore terminée.</p>
      ) : (
        <>
          <p>Hier&nbsp;: {formatGameDate(lastDay.day)}</p>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Produit</th>
                <th scope="col" className="number">
                  Vendus
                </th>
                <th scope="col" className="number">
                  Ventes perdues
                </th>
                <th scope="col" className="number">
                  Périmés
                </th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((product) => (
                <tr key={product}>
                  <th scope="row">{FOOD_TRUCK.products[product].name}</th>
                  <td className="number">{lastDay.sold[product]}</td>
                  <td className="number">{lastDay.lostSales[product]}</td>
                  <td className="number">{lastDay.spoiled[product]}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="number">{totalUnits(lastDay.sold)}</td>
                <td className="number">{numbers.lostSales}</td>
                <td className="number">{totalUnits(lastDay.spoiled)}</td>
              </tr>
            </tfoot>
          </table>
          <p>
            Chiffre d'affaires&nbsp;:{' '}
            <strong>{formatMoney(numbers.revenue)}</strong>
          </p>
          <p>
            Clients servis&nbsp;: <strong>{numbers.customersServed}</strong>
          </p>
        </>
      )}
      <p className="today__net-worth">
        Valeur nette&nbsp;: <strong>{formatMoney(netWorth.total)}</strong>
      </p>
      <ul className="today__net-worth-parts">
        {parts.map(({ label, amount }) => (
          <li key={label}>
            {label}&nbsp;: {formatMoney(amount)}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The Aujourd'hui panel wired to the app store. */
export default function TodayPanel() {
  const lastDay = useGame((state) => state.game.lastDay)
  const day = useGame((state) => state.game.day)
  const journal = useGame((state) => state.game.journal)
  const financing = useGame((state) => state.game.financing)
  const personal = useGame((state) => state.game.personal)
  // The books only change when a day is played, not on every frame.
  const netWorth = useMemo(
    () => netWorthParts({ day, journal, financing, personal }),
    [day, journal, financing, personal],
  )
  return <TodayPanelView lastDay={lastDay} netWorth={netWorth} />
}
