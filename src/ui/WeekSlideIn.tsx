import { useEffect, useMemo } from 'react'
import pacing from '../content/pacing.json'
import type { WeekReport } from '../engine/types.ts'
import { gameStore, useGame } from './store.ts'
import { WeekFigures } from './WeeklyReport.tsx'
import { factLines } from './weeklyReport.ts'
import { hideSlideInAfter, slideInWeek } from './weekSlideIn.ts'
import './WeekSlideIn.css'

interface WeekSlideInViewProps {
  report: WeekReport
  /** The week's first fact, in words; null when none is worth telling. */
  topFact: string | null
  /** Opens the full report. */
  onOpen: () => void
}

/**
 * The week in brief, at the bottom right: ventes, bénéfice, encaisse and
 * the first fact, with « Voir le bilan ».
 */
export function WeekSlideInView({
  report,
  topFact,
  onOpen,
}: WeekSlideInViewProps) {
  return (
    <section className="week-slide-in__card" aria-label="Bilan de la semaine">
      <p className="week-slide-in__title">Bilan de la semaine</p>
      <WeekFigures report={report} className="week-slide-in__figures" />
      {topFact !== null && <p className="week-slide-in__fact">{topFact}</p>}
      <button type="button" className="button button--primary" onClick={onOpen}>
        Voir le bilan
      </button>
    </section>
  )
}

/**
 * The card of the app store's week, when it slides in (see weekSlideIn.ts),
 * for `pacing.reportSlideInMs` of real time. The status region is always
 * on the page, empty when no card shows, so screen readers read each new
 * one.
 */
export default function WeekSlideIn() {
  const report = useGame(slideInWeek)
  const openPanel = useGame((state) => state.openPanel)
  const topFact = useMemo(
    () => (report === null ? null : (factLines(report)[0] ?? null)),
    [report],
  )

  useEffect(() => hideSlideInAfter(gameStore, pacing.reportSlideInMs), [])

  return (
    <div className="week-slide-in" role="status">
      {report !== null && (
        <WeekSlideInView
          key={report.firstDay}
          report={report}
          topFact={topFact}
          onOpen={() => openPanel('report')}
        />
      )}
    </div>
  )
}
