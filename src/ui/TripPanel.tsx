import { useEffect, useMemo, type CSSProperties } from 'react'
import type { DecisionChange } from '../engine/decisions.ts'
import { CITY } from '../world/cityPicker.ts'
import { ASSETS } from '../world/manifest.ts'
import { showCity } from './cityLinks.ts'
import ContractsScreen from './ContractsScreen.tsx'
import { DockPanel } from './DockFrame.tsx'
import { CITY_TABS, type BackdropPicks } from './dockFrame.ts'
import { describedBy } from './describedBy.ts'
import { useFieldDialog } from './fieldDialog.ts'
import { StatusLineView } from './ProductCard.tsx'
import { settingsStore, type SettingsStore } from './settings.ts'
import { useGame } from './store.ts'
import Tooltip from './Tooltip.tsx'
import {
  placeLine,
  placeTip,
  tripBoard,
  type PlaceRow,
  type TripBoard,
} from './tripBoard.ts'
import './panel.css'
import './TripPanel.css'

// French puts a no-break space (U+00A0) before a colon.
const COLON = ' :'

/**
 * The city's height over its width, which TripPanel.css reads to keep the
 * panel above the city on a phone.
 */
const CITY_RATIO = {
  '--city-ratio': ASSETS.city.designSize.height / ASSETS.city.designSize.width,
} as CSSProperties

interface TripPanelViewProps {
  board: TripBoard
  onChange: (change: DecisionChange) => void
}

/**
 * « Aller à… »: a row for each place in town, with how long the trip takes,
 * « Y aller » or, for the day's trip, « Annuler ».
 */
export function TripPanelView({ board, onChange }: TripPanelViewProps) {
  return (
    <ul className="trip__places">
      {board.rows.map((row) => (
        <PlaceCard key={row.id} row={row} onChange={onChange} />
      ))}
    </ul>
  )
}

/**
 * A place: its name, « Aujourd'hui » on the day's trip, the trip's time,
 * its status line, then « Y aller », disabled with the reason when the
 * owner cannot go, or « Annuler » for the day's trip, disabled with the
 * reason when a card booked it. The row is the anchor of its tooltip, and
 * takes the focus itself when its button cannot.
 */
export function PlaceCard({
  row,
  onChange,
}: {
  row: PlaceRow
  onChange: (change: DecisionChange) => void
}) {
  const { id, name, time, chosen, refusal } = row
  const line = placeLine(row)
  const lineId = refusal === null ? `trip-${id}-status` : `trip-${id}-refusal`
  const shown = line.fact === null ? undefined : lineId
  return (
    <li>
      <Tooltip content={placeTip(row)}>
        {(anchor) => (
          <div
            className={
              chosen ? 'trip__place trip__place--chosen' : 'trip__place'
            }
            tabIndex={refusal === null ? undefined : 0}
            {...anchor}
          >
            <div className="trip__about">
              <div className="trip__head">
                <h3 className="trip__name">{name}</h3>
                {chosen && <span className="chip">Aujourd'hui</span>}
              </div>
              <p className="trip__time">{time}</p>
              <StatusLineView id={lineId} line={line} />
            </div>
            {chosen ? (
              <button
                type="button"
                className="button"
                aria-label={`Annuler${COLON} ${name}`}
                aria-describedby={describedBy(
                  shown,
                  anchor['aria-describedby'],
                )}
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
                aria-describedby={describedBy(
                  shown,
                  anchor['aria-describedby'],
                )}
                disabled={refusal !== null}
                onClick={() => onChange({ kind: 'goTo', place: id })}
              >
                Y aller
              </button>
            )}
          </div>
        )}
      </Tooltip>
    </li>
  )
}

/**
 * « Ville », the panel wired to the app store, in the dock's frame, a modal
 * dialog (see `useFieldDialog`): « Aller à… », where a trip shows at once,
 * as it is for the day under way, and « Contrats », with the grocers. The
 * world shows the city while it is open, beside it, and a press on a
 * building there goes to `city` through the backdrop, which opens its tab.
 */
export default function TripPanel({
  settings = settingsStore,
  city = CITY,
}: {
  settings?: Pick<SettingsStore, 'getState'>
  city?: BackdropPicks
}) {
  const game = useGame((state) => state.game)
  const decide = useGame((state) => state.decide)
  const closePanel = useGame((state) => state.closePanel)
  const tab = useGame((state) => state.cityTab)
  const setTab = useGame((state) => state.setCityTab)
  const board = useMemo(() => tripBoard(game), [game])
  const { dialogRef, onChange, close, onCancel } = useFieldDialog(decide)

  useEffect(() => showCity(settings), [settings])

  return (
    <DockPanel
      dialogRef={dialogRef}
      className="trip"
      title="Ville"
      tabs={CITY_TABS}
      tab={tab}
      onTab={setTab}
      onCancel={onCancel}
      onClose={closePanel}
      onDismiss={close}
      backdrop={city}
      style={CITY_RATIO}
    >
      {tab === 'trip' ? (
        <TripPanelView board={board} onChange={onChange} />
      ) : (
        <ContractsScreen followsCity />
      )}
    </DockPanel>
  )
}
