import type { ReportText } from '../content/reportText.ts'
import type { ChallengeState } from '../engine/types.ts'
import {
  formatDayAndMonth,
  formatGameMonth,
  formatGamePeriod,
} from './formatGameDate.ts'
import {
  formatWeekOf,
  monthAdvice,
  monthChart,
  monthFactLines,
  weeksFirstDay,
  weeksLastDay,
  type MonthReport,
} from './monthlyReport.ts'
import { BANKER, portraitUrl } from './portraits.ts'
import { PrudhommeAdvice } from './PrudhommeAdvice.tsx'
import { useGame } from './store.ts'
import { REPORT_TEXT } from './weeklyReport.ts'
import {
  Amount,
  DefiInProgress,
  WeekChart,
  WeekFigures,
} from './WeeklyReport.tsx'
import './WeeklyReport.css'

// French puts a no-break space (U+00A0) before a colon.
const COLON = ' :'

/** `text` with its first letter in lower case, to go on after a comma. */
function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

/**
 * The weeks the month's figures cover, e.g. `4 semaines, du 29 mai au
 * 25 juin, an 1`.
 */
function weeksPeriod(report: MonthReport): string {
  const count = report.weeks.length
  const period = formatGamePeriod(weeksFirstDay(report), weeksLastDay(report))
  return `${count} semaine${count > 1 ? 's' : ''}, ${lowerFirst(period)}`
}

interface MonthlyReportViewProps {
  report: MonthReport
  /** The game's Défi; the report shows it while it is under way. */
  challenge?: ChallengeState | null
  text?: ReportText
}

/**
 * The « Bilan du mois » of `report`: the month, the weeks its figures
 * cover, as a month's weeks do not line up with its days, their ventes,
 * bénéfice and encaisse, the lowest encaisse when known, the Défi under
 * way, if any, the chart of the calendar month's days, the facts its weeks
 * told, each with its week, and « Le conseil de Mme Prudhomme » on the
 * first of them, or a quiet line, with the week it is on. It never
 * explains a term.
 */
export function MonthlyReportView({
  report,
  challenge = null,
  text = REPORT_TEXT,
}: MonthlyReportViewProps) {
  const facts = monthFactLines(report, text)
  const advice = monthAdvice(report, text)
  return (
    <div className="weekly-report monthly-report">
      <p className="monthly-report__month">
        {formatGameMonth(report.firstDay)}
      </p>
      <p className="weekly-report__dates">{weeksPeriod(report)}</p>
      <WeekFigures report={report} className="weekly-report__figures" />
      {report.lowestCash !== null && (
        <p className="monthly-report__lowest">
          Encaisse la plus basse{COLON} <Amount amount={report.lowestCash} />
        </p>
      )}
      {challenge?.status === 'enCours' && (
        <DefiInProgress challenge={challenge} />
      )}
      <p className="monthly-report__days">
        Jour par jour,{' '}
        {lowerFirst(formatGamePeriod(report.firstDay, report.lastDay))}
      </p>
      <WeekChart days={monthChart(report)} notes={[]} />
      {facts.length > 0 && (
        <ul className="weekly-report__facts">
          {facts.map(({ week, text: fact }) => (
            <li key={`${week} ${fact}`}>
              <span className="monthly-report__fact-week">
                {formatWeekOf(week)}
              </span>{' '}
              — {fact}
            </li>
          ))}
        </ul>
      )}
      <PrudhommeAdvice
        advice={advice.text}
        portrait={portraitUrl(BANKER)}
        about={
          advice.week === null
            ? null
            : `Sur la semaine du ${formatDayAndMonth(advice.week)}`
        }
      />
    </div>
  )
}

/**
 * The app store's last « Bilan du mois », with the game's Défi under way;
 * nothing before one came.
 */
export function LastMonthReport() {
  const report = useGame((state) => state.monthReport)
  const challenge = useGame((state) => state.game.challenge)
  return report === null ? null : (
    <MonthlyReportView report={report} challenge={challenge} />
  )
}
