import type { WeekRecord } from '../engine/types.ts'
import { formatShortGameDate } from './formatGameDate.ts'
import { useGame } from './store.ts'
import { Amount, LastWeekReport } from './WeeklyReport.tsx'
import { recentWeeks, WEEKS_LISTED } from './weeklyReport.ts'
import './WeekReports.css'

const LATEST_ID = 'week-reports-latest'
const TABLE_ID = 'week-reports-table'

/**
 * « Bilans »: the last weeks, newest first, with their ventes, bénéfice
 * and encaisse at the close of the Sunday, then the latest week's full
 * report. Before the first week closes, it says there is none yet.
 */
export function WeekReportsView({
  history,
}: {
  /** The weeks the game keeps, oldest first. */
  history: readonly WeekRecord[]
}) {
  const weeks = recentWeeks(history)
  return (
    <section className="week-reports">
      <h1>Bilans</h1>
      {weeks.length === 0 ? (
        <p>Aucun bilan pour l'instant.</p>
      ) : (
        <>
          {/* Focusable, so a keyboard can scroll the table on a narrow screen. */}
          <div
            className="week-reports__scroll"
            role="region"
            aria-labelledby={TABLE_ID}
            tabIndex={0}
          >
            <table className="data-table">
              <caption id={TABLE_ID} className="visually-hidden">
                Les {WEEKS_LISTED} dernières semaines, la plus récente en
                premier
              </caption>
              <thead>
                <tr>
                  <th scope="col">Semaine du</th>
                  <th scope="col" className="number">
                    Ventes
                  </th>
                  <th scope="col" className="number">
                    Bénéfice
                  </th>
                  <th scope="col" className="number">
                    Encaisse
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.firstDay}>
                    <th scope="row">{formatShortGameDate(week.firstDay)}</th>
                    <td className="number">
                      <Amount amount={week.sales} />
                    </td>
                    <td className="number">
                      <Amount amount={week.netIncome} />
                    </td>
                    <td className="number">
                      <Amount amount={week.cashAtEnd} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="week-reports__latest" aria-labelledby={LATEST_ID}>
            <h2 id={LATEST_ID}>Bilan de la semaine</h2>
            <LastWeekReport />
          </section>
        </>
      )}
    </section>
  )
}

/** « Bilans » for the app store's game. */
export default function WeekReports() {
  const history = useGame((state) => state.game.weekHistory)
  return <WeekReportsView history={history} />
}
