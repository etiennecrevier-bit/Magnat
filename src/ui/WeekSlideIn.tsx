import { useEffect, useMemo } from 'react'
import pacing from '../content/pacing.json'
import type { WeekReport } from '../engine/types.ts'
import {
  formatWeekOf,
  isMonthReport,
  monthFactLines,
  type MonthReport,
} from './monthlyReport.ts'
import { gameStore, useGame } from './store.ts'
import { WeekFigures, type Figures } from './WeeklyReport.tsx'
import { factLines } from './weeklyReport.ts'
import { keepRoomOver } from './tickerRoom.ts'
import { hideSlideInAfter, slideInReport } from './weekSlideIn.ts'
import './WeekSlideIn.css'

interface WeekSlideInViewProps {
  report: Figures
  /** The card's title: the week's report, or the month's. */
  title?: string
  /** The first fact, in words; null when none is worth telling. */
  topFact: string | null
  /** Opens the full report. */
  onOpen: () => void
}

/** Keeps the card's height on the page while it shows, so the messages
    end above it (see tickerRoom.ts). */
function keepRoom(card: HTMLElement | null) {
  return card === null ? undefined : keepRoomOver(card, document.body)
}

/**
 * The week, or the month, in brief, at the bottom right: ventes,
 * bénéfice, encaisse and the first fact, with « Voir le bilan ».
 */
export function WeekSlideInView({
  report,
  title = 'Bilan de la semaine',
  topFact,
  onOpen,
}: WeekSlideInViewProps) {
  return (
    <section ref={keepRoom} className="week-slide-in__card" aria-label={title}>
      <p className="week-slide-in__title">{title}</p>
      <WeekFigures report={report} className="week-slide-in__figures" />
      {topFact !== null && <p className="week-slide-in__fact">{topFact}</p>}
      <button
        type="button"
        className="button button--primary"
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        Voir le bilan
      </button>
    </section>
  )
}

/**
 * The first fact of `report` in words; a month's says the week it held in,
 * since its numbers are that week's. Null when none is worth telling.
 */
function topFactOf(report: WeekReport | MonthReport): string | null {
  if (!isMonthReport(report)) return factLines(report)[0] ?? null
  const [top] = monthFactLines(report)
  return top === undefined ? null : `${formatWeekOf(top.week)} — ${top.text}`
}

/**
 * The card of the app store's week or month, when it slides in (see
 * weekSlideIn.ts), for `pacing.reportSlideInMs` of real time. The status
 * region is always on the page, empty when no card shows, so screen
 * readers read each new one.
 */
export default function WeekSlideIn() {
  const report = useGame(slideInReport)
  const openPanel = useGame((state) => state.openPanel)
  const topFact = useMemo(
    () => (report === null ? null : topFactOf(report)),
    [report],
  )

  useEffect(() => hideSlideInAfter(gameStore, pacing.reportSlideInMs), [])

  return (
    <div className="week-slide-in" role="status">
      {report !== null && (
        <WeekSlideInView
          key={`${isMonthReport(report) ? 'month' : 'week'} ${report.firstDay}`}
          report={report}
          title={
            isMonthReport(report) ? 'Bilan du mois' : 'Bilan de la semaine'
          }
          topFact={topFact}
          onOpen={() => openPanel('report')}
        />
      )}
    </div>
  )
}
