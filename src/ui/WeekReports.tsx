import type { ReactNode } from 'react'
import type {
  ChallengeState,
  Day,
  WeekRecord,
  WeekReport,
} from '../engine/types.ts'
import { formatGameMonth, formatShortGameDate } from './formatGameDate.ts'
import JournalRow from './JournalRow.tsx'
import { monthKey, useOpenRows, weekKey } from './journalRows.ts'
import { MonthlyReportView } from './MonthlyReport.tsx'
import type { MonthReport } from './monthlyReport.ts'
import { gameStore, useGame } from './store.ts'
import {
  Amount,
  LastWeekReport,
  WeekFigures,
  WeeklyReportView,
} from './WeeklyReport.tsx'
import { recentWeeks } from './weeklyReport.ts'

// French puts a no-break space (U+00A0) before a colon.
const COLON = ' :'

/** A row's line: its name, its period if any, and its bénéfice at the right. */
function ReportLine({
  name,
  period = null,
  netIncome,
}: {
  name: string
  period?: string | null
  netIncome: WeekRecord['netIncome']
}) {
  return (
    <>
      <span className="journal-row__title">{name}</span>{' '}
      {period !== null && (
        <>
          <span className="journal-row__muted">{period}</span>{' '}
        </>
      )}
      <span className="journal-row__end">
        <span className="journal-row__muted">Bénéfice{COLON}</span>{' '}
        <Amount amount={netIncome} />
      </span>
    </>
  )
}

interface WeekReportsViewProps {
  /** The weeks the game keeps, oldest first. */
  history: readonly WeekRecord[]
  /** The last « Bilan du mois » that came; null for none, which hides it. */
  monthReport?: MonthReport | null
  /** The game's Défi, which the month's report shows while under way. */
  challenge?: ChallengeState | null
  /**
   * The latest week, by its first day, and the full report it opens to,
   * with how the owner stands now; null for none.
   */
  latest?: { firstDay: Day; report: ReactNode } | null
  /** The full reports of the last weeks the store still keeps. */
  reports?: readonly WeekReport[]
  /** The keys of the rows open (see `monthKey` and `weekKey`). */
  openKeys?: ReadonlySet<string>
  onToggle?: (key: string) => void
}

/**
 * What a week's row opens to: the latest week's full report; an older
 * week's, without what only the present says, while the store keeps it;
 * else its ventes, bénéfice and encaisse at the close of the Sunday.
 */
function weekBody(
  week: WeekRecord,
  latest: WeekReportsViewProps['latest'],
  reports: readonly WeekReport[],
): ReactNode {
  if (latest?.firstDay === week.firstDay) return latest.report
  const full = reports.find(({ firstDay }) => firstDay === week.firstDay)
  if (full !== undefined) return <WeeklyReportView report={full} />
  return (
    <div className="weekly-report">
      <WeekFigures
        report={{ ...week, cashAtStart: null }}
        className="weekly-report__figures"
      />
    </div>
  )
}

/**
 * « Bilans »: the last « Bilan du mois », once one came, then the last 12
 * weeks, newest first, each a line with its bénéfice which opens to its
 * report. Before the first week closes, it says there is none yet.
 */
export function WeekReportsView({
  history,
  monthReport = null,
  challenge = null,
  latest = null,
  reports = [],
  openKeys = new Set(),
  onToggle = () => {},
}: WeekReportsViewProps) {
  const weeks = recentWeeks(history)
  if (weeks.length === 0 && monthReport === null) {
    return (
      <section className="week-reports">
        <p>Aucun bilan pour l'instant.</p>
      </section>
    )
  }
  return (
    <section className="week-reports">
      <ol className="journal-rows">
        {monthReport !== null && (
          <JournalRow
            id="week-reports-month"
            open={openKeys.has(monthKey(monthReport))}
            onToggle={() => onToggle(monthKey(monthReport))}
            line={
              <ReportLine
                name="Bilan du mois"
                period={formatGameMonth(monthReport.firstDay)}
                netIncome={monthReport.netIncome}
              />
            }
          >
            <MonthlyReportView report={monthReport} challenge={challenge} />
          </JournalRow>
        )}
        {weeks.map((week) => (
          <JournalRow
            key={week.firstDay}
            id={`week-reports-${week.firstDay}`}
            open={openKeys.has(weekKey(week.firstDay))}
            onToggle={() => onToggle(weekKey(week.firstDay))}
            line={
              <ReportLine
                name={`Semaine du ${formatShortGameDate(week.firstDay)}`}
                netIncome={week.netIncome}
              />
            }
          >
            {weekBody(week, latest, reports)}
          </JournalRow>
        ))}
      </ol>
    </section>
  )
}

/**
 * « Bilans » for the app store's game. Opening a report counts the
 * reports as read.
 */
export default function WeekReports() {
  const history = useGame((state) => state.game.weekHistory)
  const lastWeek = useGame((state) => state.game.lastWeek)
  const challenge = useGame((state) => state.game.challenge)
  const monthReport = useGame((state) => state.monthReport)
  const reports = useGame((state) => state.weekReports)
  const [openKeys, toggle] = useOpenRows()
  return (
    <WeekReportsView
      history={history}
      monthReport={monthReport}
      challenge={challenge}
      latest={
        lastWeek === null
          ? null
          : { firstDay: lastWeek.firstDay, report: <LastWeekReport /> }
      }
      reports={reports}
      openKeys={openKeys}
      onToggle={(key) => {
        if (toggle(key)) gameStore.getState().readReports()
      }}
    />
  )
}
