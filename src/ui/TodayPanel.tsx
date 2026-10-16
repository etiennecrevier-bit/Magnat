import { FOOD_TRUCK } from '../engine/day.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import type { DaySummary } from '../engine/types.ts'
import { formatGameDate } from './formatGameDate.ts'
import { formatMoney } from './formatMoney.ts'
import { useGame } from './store.ts'
import { todayNumbers, totalUnits } from './todayNumbers.ts'
import './TodayPanel.css'

/**
 * Yesterday at the truck: units sold, lost and spoiled, by product and in
 * all, the revenue and the customers served. The folded strip shows the
 * same numbers (see todayNumbers.ts).
 */
export function TodayPanelView({ lastDay }: { lastDay: DaySummary | null }) {
  const numbers = lastDay === null ? null : todayNumbers(lastDay)
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
    </section>
  )
}

/** The Aujourd'hui panel wired to the app store. */
export default function TodayPanel() {
  const lastDay = useGame((state) => state.game.lastDay)
  return <TodayPanelView lastDay={lastDay} />
}
