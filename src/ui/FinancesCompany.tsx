import { useId, useMemo, useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import FinancialStatement from './FinancialStatements.tsx'
import {
  companyBoard,
  type CompanyBoard,
  type FinanceTile,
  type TruckFinanceRow,
} from './financesBoard.ts'
import { FinancingBlock } from './FinancingBlock.tsx'
import { formatGamePeriod } from './formatGameDate.ts'
import { formatWholeStatementAmount } from './formatMoney.ts'
import { Icon } from './icons.tsx'
import { STATEMENT_TITLES, type StatementTab } from './statementPeriods.ts'
import { useGame, type FinanceSection, type FinanceSections } from './store.ts'
import Tooltip from './Tooltip.tsx'
import { WeekChart } from './WeeklyReport.tsx'
import './FinancesCompany.css'

const STATEMENTS: readonly StatementTab[] = [
  'balanceSheet',
  'incomeStatement',
  'cashFlow',
]

interface AccordionProps {
  title: string
  open: boolean
  onToggle: () => void
  /** The id of its title, which names what it holds. */
  titleId: string
  headingRef: (heading: HTMLHeadingElement | null) => void
  children: ReactNode
}

/**
 * An accordion: a heading whose button opens or closes it, « Détail » at
 * its right, then what it holds, drawn only while open.
 */
function Accordion({
  title,
  open,
  onToggle,
  titleId,
  headingRef,
  children,
}: AccordionProps) {
  const regionId = `${titleId}-region`
  return (
    <div className="finance-accordion">
      <h3 ref={headingRef} className="finance-accordion__heading">
        <button
          type="button"
          className="finance-accordion__button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={onToggle}
        >
          <span className="finance-accordion__marker" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span id={titleId}>{title}</span>
          <span className="finance-accordion__hint">Détail</span>
        </button>
      </h3>
      <div
        id={regionId}
        className="finance-accordion__body"
        role="region"
        aria-labelledby={titleId}
        hidden={!open}
      >
        {open && children}
      </div>
    </div>
  )
}

/**
 * « Par camion » (#265): each truck's sales and margin this month, a row
 * each, then the total; a negative margin in parentheses.
 */
function TruckTable({
  rows,
  labelledBy,
}: {
  rows: readonly TruckFinanceRow[]
  labelledBy: string
}) {
  return (
    <table className="finances-company__trucks" aria-labelledby={labelledBy}>
      <thead>
        <tr>
          <th scope="col">Camion</th>
          <th scope="col">Ventes</th>
          <th scope="col">Marge</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ id, label, sales, margin }) => (
          <tr
            key={id}
            className={
              id === 'total' ? 'finances-company__trucks-total' : undefined
            }
          >
            <th scope="row">{label}</th>
            <td>{formatWholeStatementAmount(sales)}</td>
            <td>{formatWholeStatementAmount(margin)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface FinancesCompanyViewProps {
  board: CompanyBoard
  sections: FinanceSections
  /** A tile's click: the accordion it names, or « Personnel ». */
  onTile: (opens: FinanceTile['opens'], tile: HTMLElement) => void
  onToggle: (section: FinanceSection) => void
  /** Keeps each accordion's heading, so a tile can bring it into view. */
  headingRef: (
    section: FinanceSection,
  ) => (heading: HTMLHeadingElement | null) => void
}

/**
 * « Entreprise », level by level: four tiles, each with its parts in its
 * tooltip and a click to the statement it comes from; « Par camion » with
 * two trucks or more; the last 30 days;
 * « À surveiller », when there is something to watch; then the statements,
 * and « Financement » once the game took a loan or sold shares, each in an
 * accordion closed until the player opens it.
 */
export function FinancesCompanyView({
  board,
  sections,
  onTile,
  onToggle,
  headingRef,
}: FinancesCompanyViewProps) {
  const id = useId()
  const { tiles, trucks, chart, watch, financing } = board
  const first = chart[0]
  const last = chart.at(-1)
  const accordions: {
    section: FinanceSection
    title: string
    body: ReactNode
  }[] = STATEMENTS.map((statement) => ({
    section: statement,
    title: STATEMENT_TITLES[statement],
    body: (
      <FinancialStatement
        statement={statement}
        labelledBy={`${id}-${statement}`}
      />
    ),
  }))
  if (financing !== null) {
    accordions.push({
      section: 'financing',
      title: 'Financement',
      body: <FinancingBlock financing={financing} />,
    })
  }
  return (
    <div className="finances-company">
      <section aria-labelledby={`${id}-glance`}>
        <h3 id={`${id}-glance`} className="finances-company__kicker">
          En un coup d'œil
        </h3>
        <div className="finance-tiles">
          {tiles.map((tile) => (
            <div key={tile.id} className="finance-tiles__cell">
              <Tooltip content={tile.tip}>
                {(anchor) => (
                  <button
                    type="button"
                    className="finance-tile"
                    {...anchor}
                    onClick={(event) => onTile(tile.opens, event.currentTarget)}
                  >
                    <span className="finance-tile__label">{tile.label}</span>
                    <span className="finance-tile__value">{tile.value}</span>
                    {tile.status !== null && (
                      <span
                        className={`finance-tile__status finance-tile__status--${tile.tone}`}
                      >
                        {tile.status}
                      </span>
                    )}
                  </button>
                )}
              </Tooltip>
            </div>
          ))}
        </div>
      </section>
      {trucks !== null && (
        <section aria-labelledby={`${id}-trucks`}>
          <h3 id={`${id}-trucks`} className="finances-company__kicker">
            Par camion
          </h3>
          <TruckTable rows={trucks} labelledBy={`${id}-trucks`} />
        </section>
      )}
      <section aria-labelledby={`${id}-chart`}>
        <h3 id={`${id}-chart`} className="finances-company__kicker">
          30 derniers jours
        </h3>
        <div className="finances-company__chart">
          {first === undefined || last === undefined ? (
            <p>La première journée n'est pas encore terminée.</p>
          ) : (
            <>
              <p className="finances-company__dates">
                {formatGamePeriod(first.day, last.day)}
              </p>
              <WeekChart days={chart} notes={[]} />
            </>
          )}
        </div>
      </section>
      {watch.length > 0 && (
        <section aria-labelledby={`${id}-watch`}>
          <h3 id={`${id}-watch`} className="finances-company__kicker">
            À surveiller
          </h3>
          <ul className="finances-company__watch">
            {watch.map(({ id: line, text }) => (
              <li key={line}>
                <Icon name="alerte" size={18} />
                {text}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="finances-company__accordions">
        {accordions.map(({ section, title, body }) => (
          <Accordion
            key={section}
            title={title}
            open={sections.open[section]}
            onToggle={() => onToggle(section)}
            titleId={`${id}-${section}`}
            headingRef={headingRef(section)}
          >
            {body}
          </Accordion>
        ))}
      </div>
    </div>
  )
}

/**
 * « Entreprise » wired to the app store. A tile's click opens its
 * accordion, brings it into view and puts the focus on its button; the
 * tile of « Valeur nette » moves to « Personnel », its tab taking the
 * focus.
 */
export default function FinancesCompany() {
  const game = useGame((state) => state.game)
  const weekReports = useGame((state) => state.weekReports)
  const sections = useGame((state) => state.financeSections)
  const toggle = useGame((state) => state.toggleFinanceSection)
  const show = useGame((state) => state.showFinanceSection)
  const setDrawerTab = useGame((state) => state.setDrawerTab)
  // The books only change when a day is played, not on every frame.
  const board = useMemo(
    () => companyBoard(game, weekReports),
    [game, weekReports],
  )
  const headings = useRef(new Map<FinanceSection, HTMLHeadingElement>())
  const headingRef =
    (section: FinanceSection) => (heading: HTMLHeadingElement | null) => {
      if (heading === null) headings.current.delete(section)
      else headings.current.set(section, heading)
    }
  const onTile = (opens: FinanceTile['opens'], tile: HTMLElement) => {
    if (opens === 'personal') {
      const drawer = tile.closest('.dock-frame')
      flushSync(() => setDrawerTab('finances', 'personal'))
      drawer
        ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus()
      return
    }
    flushSync(() => show(opens))
    const heading = headings.current.get(opens)
    heading?.scrollIntoView({ block: 'start' })
    heading?.querySelector('button')?.focus({ preventScroll: true })
  }
  return (
    <FinancesCompanyView
      board={board}
      sections={sections}
      onTile={onTile}
      onToggle={toggle}
      headingRef={headingRef}
    />
  )
}
