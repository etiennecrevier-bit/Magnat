import { useId, useMemo } from 'react'
import type { ReportText } from '../content/reportText.ts'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import { titleOf } from '../engine/dream.ts'
import type { Cents } from '../engine/money.ts'
import { percentileOnMorning } from '../engine/standing.ts'
import type { ChallengeState, WeekReport } from '../engine/types.ts'
import { DefiProgressView } from './DefiPanel.tsx'
import {
  formatDayAndMonth,
  formatGamePeriod,
  formatShortWeekdayName,
  formatWeekdayName,
} from './formatGameDate.ts'
import { formatBriefMoney, formatMoney } from './formatMoney.ts'
import { BANKER, portraitUrl } from './portraits.ts'
import { PrudhommeAdvice } from './PrudhommeAdvice.tsx'
import { useGame } from './store.ts'
import {
  chartScale,
  creditNotes,
  factLines,
  REPORT_TEXT,
  reportAdvice,
  reportHeadline,
  weekChart,
  type ChartDay,
  type CreditNote,
} from './weeklyReport.ts'
import './panel.css'
import './WeeklyReport.css'

// French puts a no-break space (U+00A0) before a colon and a percent sign.
const COLON = ' :'
const PERCENT = ' %'
// The days of the week, Monday to Sunday.
const DAYS_PER_WEEK = 7

/** fr-CA money, in red with its minus sign below zero. */
export function Amount({ amount }: { amount: Cents }) {
  return (
    <span className={amount < 0 ? 'amount amount--negative' : 'amount'}>
      {formatMoney(amount)}
    </span>
  )
}

/** What a report's figures show: a week's, or a month's. */
export interface Figures {
  readonly sales: Cents
  readonly netIncome: Cents
  /** Encaisse at the start; null when the report does not have it. */
  readonly cashAtStart: Cents | null
  readonly cashAtEnd: Cents
}

/**
 * Encaisse from the start of the period to its end, or only at its end
 * when the start is not known. A narrow card breaks the line before the
 * arrow, never after it.
 */
function CashChange({ report }: { report: Figures }) {
  if (report.cashAtStart === null) return <Amount amount={report.cashAtEnd} />
  return (
    <>
      <span className="weekly-report__from">
        <Amount amount={report.cashAtStart} />
      </span>{' '}
      <span className="weekly-report__to">
        <span aria-hidden="true">→</span>
        <span className="visually-hidden"> à </span>{' '}
        <Amount amount={report.cashAtEnd} />
      </span>
    </>
  )
}

/** Ventes, bénéfice and encaisse, as the reports and the slide-in show them. */
export function WeekFigures({
  report,
  className,
}: {
  report: Figures
  className: string
}) {
  return (
    <dl className={className}>
      <div>
        <dt>Ventes</dt>
        <dd>
          <Amount amount={report.sales} />
        </dd>
      </div>
      <div>
        <dt>Bénéfice</dt>
        <dd>
          <Amount amount={report.netIncome} />
        </dd>
      </div>
      <div>
        <dt>Encaisse</dt>
        <dd>
          <CashChange report={report} />
        </dd>
      </div>
    </dl>
  )
}

// The chart's frame, in the SVG's own units: the axis labels on the left,
// the days' labels under the bars, room above for a note's marker.
const WIDTH = 560
const HEIGHT = 232
const LEFT = 64
const RIGHT = 8
const TOP = 28
const BOTTOM = 28
const PLOT_WIDTH = WIDTH - LEFT - RIGHT
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM
const BASELINE = TOP + PLOT_HEIGHT
// Thin bars with a 2-unit gap of the surface between a day's two, rounded
// 4 units at the top and square on the baseline. A month's days are
// narrower: its bars thin down to fill at most this share of a day's band,
// so the days stay apart.
const BAR_WIDTH = 24
const BARS_SHARE_OF_BAND = 0.75
const BAR_GAP = 2
const BAR_RADIUS = 4
const MARKER_RADIUS = 5
const MARKER_ABOVE = 12

/** A coordinate to a tenth of a unit, so the markup stays short. */
function at(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * A bar `width` wide from the baseline up to `top`, rounded at the top;
 * null if flat.
 */
function barPath(x: number, top: number, width: number): string | null {
  const height = BASELINE - top
  if (height <= 0) return null
  const r = Math.min(BAR_RADIUS, height, width / 2)
  const right = x + width
  return (
    `M${at(x)},${BASELINE}V${at(top + r)}` +
    `A${at(r)},${at(r)} 0 0 1 ${at(x + r)},${at(top)}` +
    `H${at(right - r)}` +
    `A${at(r)},${at(r)} 0 0 1 ${at(right)},${at(top + r)}` +
    `V${BASELINE}Z`
  )
}

/** What a day of the chart says when read or hovered. */
function dayText({ day, played, open, sales, cashReceived }: ChartDay): string {
  const date = `${formatWeekdayName(day)} ${formatDayAndMonth(day)}`
  if (!played) return `${date}${COLON} aucune donnée`
  const closed = open ? '' : ', fermé'
  return (
    `${date}${closed}${COLON} ventes ${formatBriefMoney(sales)}, ` +
    `argent reçu ${formatBriefMoney(cashReceived)}`
  )
}

/**
 * The week, or the month, day by day: ventes and argent reçu side by side
 * on one axis, and a marker above each day with a sale on credit, whose
 * note follows the chart. Each day tells its numbers when hovered, and the
 * whole chart to screen readers; a day with no label has none under it.
 */
export function WeekChart({
  days,
  notes,
}: {
  days: readonly ChartDay[]
  notes: readonly CreditNote[]
}) {
  const id = useId()
  const { top, ticks } = chartScale(days)
  const band = PLOT_WIDTH / days.length
  const barWidth = Math.min(
    BAR_WIDTH,
    (band * BARS_SHARE_OF_BAND - BAR_GAP) / 2,
  )
  const y = (amount: Cents) => TOP + PLOT_HEIGHT * (1 - amount / top)
  const noted = new Set(notes.map(({ day }) => day))
  return (
    <figure className="week-chart">
      <ul className="week-chart__legend">
        <li>
          <span
            className="week-chart__key week-chart__key--sales"
            aria-hidden="true"
          />
          Ventes
        </li>
        <li>
          <span
            className="week-chart__key week-chart__key--cash"
            aria-hidden="true"
          />
          Argent reçu
        </li>
      </ul>
      <div className="week-chart__plot">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-desc`}
        >
          <title id={`${id}-title`}>Ventes et argent reçu, jour par jour</title>
          <desc id={`${id}-desc`}>
            {[...days.map(dayText), ...notes.map(({ text }) => text)].join(
              ' ; ',
            )}
          </desc>
          {ticks.map((tick) => (
            <g key={tick} className="week-chart__tick">
              <line
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={at(y(tick))}
                y2={at(y(tick))}
              />
              <text x={LEFT - 8} y={at(y(tick))} dy="0.32em" textAnchor="end">
                {formatBriefMoney(tick)}
              </text>
            </g>
          ))}
          {days.map((day, index) => {
            const center = LEFT + band * (index + 0.5)
            const salesTop = y(day.sales)
            const cashTop = y(day.cashReceived)
            const sales = day.played
              ? barPath(center - BAR_GAP / 2 - barWidth, salesTop, barWidth)
              : null
            const cash = day.played
              ? barPath(center + BAR_GAP / 2, cashTop, barWidth)
              : null
            return (
              <g key={day.day} className="week-chart__day" data-day={day.day}>
                <title>{dayText(day)}</title>
                <rect
                  className="week-chart__hit"
                  x={at(center - band / 2)}
                  y={0}
                  width={at(band)}
                  height={HEIGHT}
                />
                {sales !== null && (
                  <path className="week-chart__bar--sales" d={sales} />
                )}
                {cash !== null && (
                  <path className="week-chart__bar--cash" d={cash} />
                )}
                {noted.has(day.day) && (
                  <circle
                    className="week-chart__marker"
                    cx={at(center)}
                    cy={at(Math.min(salesTop, cashTop) - MARKER_ABOVE)}
                    r={MARKER_RADIUS}
                  />
                )}
                {day.label !== '' && (
                  <text
                    className="week-chart__label"
                    x={at(center)}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                  >
                    {day.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {notes.length > 0 && (
        <ul className="week-chart__notes">
          {notes.map(({ day, text }, index) => (
            <li key={index}>
              <span className="week-chart__note-marker" aria-hidden="true" />
              <span className="week-chart__note-day">
                {formatShortWeekdayName(day)}
              </span>{' '}
              — {text}
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

/** The Défi under way, as the reports show it: where it stands. */
export function DefiInProgress({ challenge }: { challenge: ChallengeState }) {
  const defi = defiById(DEFIS, challenge.id)
  return (
    <section className="weekly-report__defi" aria-label="Défi en cours">
      <p className="weekly-report__defi-title">
        Défi en cours{COLON} {defi.title}
      </p>
      <p className="weekly-report__defi-days">
        {challenge.progress.daysPlayed} jours joués sur {defi.lengthDays}
      </p>
      <DefiProgressView challenge={challenge} defi={defi} />
    </section>
  )
}

interface WeeklyReportViewProps {
  report: WeekReport
  /** The game's Défi; the report shows it while it is under way. */
  challenge?: ChallengeState | null
  /**
   * Where the owner stands among the simulated owners at the close of the
   * week (see `percentileOnMorning`); null shows nothing.
   */
  percentile?: number | null
  /**
   * The title of « Améliorations » the owner's net worth earned at the close of
   * the week; null shows none.
   */
  title?: string | null
  text?: ReportText
}

/**
 * The « Bilan de la semaine » of `report`: its dates, ventes, bénéfice and
 * encaisse, the chart of its days, its facts, « Le conseil de Mme
 * Prudhomme » on them, even in a week with none, how the owner compares,
 * the owner's title, and La Presse-Citron's headline, with the Défi under
 * way, if any, after the figures. The percentile is rounded down. It never
 * explains a term.
 */
export function WeeklyReportView({
  report,
  challenge = null,
  percentile = null,
  title = null,
  text = REPORT_TEXT,
}: WeeklyReportViewProps) {
  const facts = factLines(report, text)
  return (
    <div className="weekly-report">
      <p className="weekly-report__dates">
        {formatGamePeriod(report.firstDay, report.firstDay + DAYS_PER_WEEK - 1)}
      </p>
      <WeekFigures report={report} className="weekly-report__figures" />
      {challenge?.status === 'enCours' && (
        <DefiInProgress challenge={challenge} />
      )}
      <WeekChart days={weekChart(report)} notes={creditNotes(report, text)} />
      {facts.length > 0 && (
        <ul className="weekly-report__facts">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      <PrudhommeAdvice
        advice={reportAdvice(report, text)}
        portrait={portraitUrl(BANKER)}
      />
      {percentile !== null && (
        <p className="weekly-report__percentile">
          {`Mieux que ${Math.floor(percentile)}${PERCENT} des propriétaires`}
        </p>
      )}
      {title !== null && (
        <p className="weekly-report__title">{`Titre${COLON} ${title}`}</p>
      )}
      <p className="weekly-report__headline">
        <span className="weekly-report__paper">La Presse-Citron</span>{' '}
        {reportHeadline(report, text)}
      </p>
    </div>
  )
}

/**
 * The report of the app store's last week, with how the owner compares,
 * the title their net worth earned at the close of the week, outside a
 * Défi, and the game's Défi under way.
 */
export function LastWeekReport() {
  const report = useGame((state) => state.game.lastWeek)
  const challenge = useGame((state) => state.game.challenge)
  const game = useGame((state) => state.game)
  const percentile = useMemo(() => percentileOnMorning(game), [game])
  const worth = useGame((state) => state.game.weekHistory.at(-1)?.netWorth)
  const title =
    challenge !== null || worth === undefined || worth === null
      ? null
      : (titleOf(worth)?.name ?? null)
  return report === null ? (
    <p>Aucun bilan pour l'instant.</p>
  ) : (
    <WeeklyReportView
      report={report}
      challenge={challenge}
      percentile={percentile}
      title={title}
    />
  )
}
