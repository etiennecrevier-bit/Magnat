import { useMemo, useState } from 'react'
import type { RungId } from '../content/schema.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import type { Cents } from '../engine/money.ts'
import {
  dreamBoard,
  priceLine,
  type DreamBoard,
  type LadderRow,
  type RungRow,
  type RungStatus,
  type TitleRow,
} from './dreamBoard.ts'
import { useFieldDialog } from './fieldDialog.ts'
import { formatMoney } from './formatMoney.ts'
import { useGame } from './store.ts'
import './panel.css'
import './DreamPanel.css'

const TITLE_ID = 'dream-title'

// French puts a no-break space (U+00A0) before a colon.
const COLON = '\u00a0:'

/** Where a rung stands, as the player reads it. */
const STATUS_TEXT: Readonly<Record<RungStatus, string>> = {
  owned: 'Acquis',
  sold: 'Revendu',
  next: 'Prochain',
  locked: 'Plus tard',
  comingSoon: 'Bientôt',
}

interface DreamPanelViewProps {
  board: DreamBoard
  /** The rung whose purchase waits for « Confirmer »; null if none. */
  confirming: RungId | null
  onConfirmingChange: (rung: RungId | null) => void
  onChange: (change: DecisionChange) => void
  onClose: () => void
}

/**
 * « Le rêve »: the owner's title and the next one, then the two ladders,
 * « Personnel » and « Entreprise », each with who pays, how close its next
 * rung is and its rungs in order. « Acheter » asks to confirm, with the
 * price, who pays and what the rung gives. It explains nothing.
 */
export function DreamPanelView({
  board,
  confirming,
  onConfirmingChange,
  onChange,
  onClose,
}: DreamPanelViewProps) {
  return (
    <div className="panel__content">
      {/* Fermer comes first so it has the focus when the panel opens. */}
      <div className="panel__header">
        <button type="button" className="toggle" onClick={onClose}>
          Fermer
        </button>
        <h2 id={TITLE_ID}>Le rêve</h2>
      </div>
      <Titles titles={board.titles} netWorth={board.netWorth} />
      {[board.personal, board.company].map((row) => (
        <LadderSection
          key={row.ladder}
          row={row}
          confirming={confirming}
          onConfirmingChange={onConfirmingChange}
          onChange={onChange}
        />
      ))}
    </div>
  )
}

/** The cash a rung needs on hand, and the cash there is. */
function cashText(cash: Cents, needed: Cents): string {
  return `${formatMoney(needed)} requis · ${formatMoney(cash)} disponibles`
}

/** A bar from 0 to 1 that reads out `text`. */
function Progress({
  label,
  share,
  text,
}: {
  label: string
  share: number
  text: string
}) {
  return (
    <span
      className="dream__bar"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={text}
    >
      <span className="dream__fill" style={{ width: `${share * 100}%` }} />
    </span>
  )
}

function Titles({ titles, netWorth }: { titles: TitleRow; netWorth: Cents }) {
  const { title, next } = titles
  return (
    <section className="dream__titles" aria-label="Titre">
      <p className="dream__title">
        Titre{COLON} {title ?? 'aucun'}
      </p>
      {next !== null && (
        <div className="dream__progress">
          <p>
            Prochain titre{COLON} {next.name} ·{' '}
            {`${formatMoney(netWorth)} sur ${formatMoney(next.netWorth)}`}
          </p>
          <Progress
            label={`Vers ${next.name}`}
            share={next.progress}
            text={`${formatMoney(netWorth)} sur ${formatMoney(next.netWorth)}`}
          />
        </div>
      )}
    </section>
  )
}

function LadderSection({
  row,
  confirming,
  onConfirmingChange,
  onChange,
}: {
  row: LadderRow
  confirming: RungId | null
  onConfirmingChange: (rung: RungId | null) => void
  onChange: (change: DecisionChange) => void
}) {
  const headingId = `dream-${row.ladder}`
  const { next, needed, progress } = row
  return (
    <section className="dream__ladder" aria-labelledby={headingId}>
      <h3 id={headingId}>{row.title}</h3>
      <p className="dream__payer">{row.payer}</p>
      {next !== null && needed !== null && progress !== null && (
        <div className="dream__progress">
          <p>
            Prochain{COLON} {next.name} · {cashText(row.cash, needed)}
          </p>
          <Progress
            label={`Vers ${next.name}`}
            share={progress}
            text={cashText(row.cash, needed)}
          />
        </div>
      )}
      <ol className="dream__rungs">
        {row.rungs.map((rung) => (
          <RungCard
            key={rung.id}
            row={row}
            rung={rung}
            confirming={confirming === rung.id}
            onConfirmingChange={onConfirmingChange}
            onChange={onChange}
          />
        ))}
      </ol>
    </section>
  )
}

function RungCard({
  row,
  rung,
  confirming,
  onConfirmingChange,
  onChange,
}: {
  row: LadderRow
  rung: RungRow
  confirming: boolean
  onConfirmingChange: (rung: RungId | null) => void
  onChange: (change: DecisionChange) => void
}) {
  const { id, name, price, status, buyable, lines } = rung
  const buy = () => {
    onConfirmingChange(null)
    onChange({ kind: 'buy', rung: id })
  }
  return (
    <li className={`dream__rung dream__rung--${status}`}>
      <h4>{name}</h4>
      <p className="dream__price">{formatMoney(price)}</p>
      <p className="dream__status">{STATUS_TEXT[status]}</p>
      {lines.length > 0 && status !== 'comingSoon' && (
        <ul className="dream__lines">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {status === 'next' &&
        (confirming ? (
          <div className="dream__confirm">
            <p role="alert">
              Acheter {name}? {priceLine(row, rung)}
            </p>
            {lines.length > 0 && (
              <ul className="dream__lines">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="button button--primary"
              onClick={buy}
            >
              Confirmer
            </button>{' '}
            <button
              type="button"
              className="button"
              onClick={() => onConfirmingChange(null)}
            >
              Annuler
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button button--primary"
            aria-label={`Acheter ${name}`}
            disabled={!buyable}
            onClick={() => onConfirmingChange(id)}
          >
            Acheter
          </button>
        ))}
    </li>
  )
}

/**
 * The panel wired to the app store, in a modal dialog (see
 * `useFieldDialog`), the purchase to confirm kept while it is open. A
 * purchase made shows at once: it does not wait for the next morning.
 */
export default function DreamPanel() {
  const game = useGame((state) => state.game)
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const board = useMemo(() => dreamBoard(game), [game])
  const [confirming, setConfirming] = useState<RungId | null>(null)
  const { dialogRef, onChange, close, onCancel } = useFieldDialog(decide)

  return (
    <dialog
      ref={dialogRef}
      className="panel dream"
      aria-labelledby={TITLE_ID}
      onCancel={onCancel}
      onClose={closePanel}
    >
      <DreamPanelView
        board={board}
        confirming={confirming}
        onConfirmingChange={setConfirming}
        onChange={onChange}
        onClose={close}
      />
    </dialog>
  )
}
