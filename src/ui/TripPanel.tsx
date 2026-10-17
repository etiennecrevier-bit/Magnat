import { useMemo } from 'react'
import type { DecisionChange } from '../engine/decisions.ts'
import { useFieldDialog } from './fieldDialog.ts'
import { useGame } from './store.ts'
import { tripBoard, type PlaceRow, type TripBoard } from './tripBoard.ts'
import './panel.css'
import './TripPanel.css'

const TITLE_ID = 'trip-title'

// French puts a no-break space (U+00A0) before a colon.
const COLON = '\u00a0:'

interface TripPanelViewProps {
  board: TripBoard
  onChange: (change: DecisionChange) => void
  onClose: () => void
}

/**
 * « Aller à… »: each place in town, what the owner does there and what it
 * gives, how long the trip takes and when they leave and come back, and «
 * Fermé pendant ce temps » when nobody else serves at the truck. « Y aller
 * » sends the owner today; the day's trip shows « Annuler ». It explains
 * nothing.
 */
export function TripPanelView({
  board,
  onChange,
  onClose,
}: TripPanelViewProps) {
  return (
    <div className="panel__content">
      {/* Fermer comes first so it has the focus when the panel opens. */}
      <div className="panel__header">
        <button type="button" className="toggle" onClick={onClose}>
          Fermer
        </button>
        <h2 id={TITLE_ID}>Aller à…</h2>
      </div>
      <ul className="trip__places">
        {board.rows.map((row) => (
          <PlaceCard key={row.id} row={row} onChange={onChange} />
        ))}
      </ul>
    </div>
  )
}

/**
 * A place: « Y aller », disabled with the reason when the owner cannot go,
 * or « Annuler » for the day's trip, disabled with the reason when a card
 * booked it.
 */
export function PlaceCard({
  row,
  onChange,
}: {
  row: PlaceRow
  onChange: (change: DecisionChange) => void
}) {
  const { id, name, does, gives, time, schedule, closesTruck, chosen } = row
  const { refusal } = row
  const refusalId = `trip-${id}-refusal`
  const describedBy = refusal === null ? undefined : refusalId
  return (
    <li className={chosen ? 'trip__place trip__place--chosen' : 'trip__place'}>
      <h3>{name}</h3>
      {chosen && <p className="trip__status">Aujourd'hui</p>}
      <p>{does}</p>
      {gives !== null && <p className="trip__gives">{gives}</p>}
      <p className="trip__time">{time}</p>
      {schedule !== null && <p className="trip__time">{schedule}</p>}
      {closesTruck && <p className="trip__closed">Fermé pendant ce temps</p>}
      {chosen ? (
        <button
          type="button"
          className="button"
          aria-label={`Annuler${COLON} ${name}`}
          aria-describedby={describedBy}
          disabled={refusal !== null}
          onClick={() => onChange({ kind: 'goTo', place: null })}
        >
          Annuler
        </button>
      ) : (
        <button
          type="button"
          className="button button--primary"
          aria-label={`Y aller${COLON} ${name}`}
          aria-describedby={describedBy}
          disabled={refusal !== null}
          onClick={() => onChange({ kind: 'goTo', place: id })}
        >
          Y aller
        </button>
      )}
      {refusal !== null && (
        <p id={refusalId} className="trip__refusal">
          {refusal}
        </p>
      )}
    </li>
  )
}

/**
 * The panel wired to the app store, in a modal dialog (see
 * `useFieldDialog`). A trip shows at once: it is for the day under way.
 */
export default function TripPanel() {
  const game = useGame((state) => state.game)
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const board = useMemo(() => tripBoard(game), [game])
  const { dialogRef, onChange, close, onCancel } = useFieldDialog(decide)

  return (
    <dialog
      ref={dialogRef}
      className="panel trip"
      aria-labelledby={TITLE_ID}
      onCancel={onCancel}
      onClose={closePanel}
    >
      <TripPanelView board={board} onChange={onChange} onClose={close} />
    </dialog>
  )
}
