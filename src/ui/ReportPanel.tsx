import { useEffect, useRef } from 'react'
import { LastMonthReport } from './MonthlyReport.tsx'
import { useGame } from './store.ts'
import { LastWeekReport } from './WeeklyReport.tsx'
import './panel.css'
import './WeeklyReport.css'

const TITLE_ID = 'weekly-report-title'

/**
 * The « Bilan » that came last, the week's or the month's (see
 * `reportShown`), in a modal dialog: the page behind it is out of reach,
 * and Fermer or Escape closes it.
 */
export default function ReportPanel() {
  const closePanel = useGame((state) => state.closePanel)
  const month = useGame(
    (state) => state.reportShown === 'month' && state.monthReport !== null,
  )
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="panel weekly-report-panel"
      aria-labelledby={TITLE_ID}
      onClose={closePanel}
    >
      <div className="panel__content">
        {/* Fermer comes first so it has the focus when the panel opens. */}
        <div className="panel__header">
          <button
            type="button"
            className="toggle"
            onClick={() => dialogRef.current?.close()}
          >
            Fermer
          </button>
          <h2 id={TITLE_ID}>
            {month ? 'Bilan du mois' : 'Bilan de la semaine'}
          </h2>
        </div>
        {month ? <LastMonthReport /> : <LastWeekReport />}
      </div>
    </dialog>
  )
}
