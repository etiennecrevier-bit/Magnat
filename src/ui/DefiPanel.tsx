import { useEffect, useRef } from 'react'
import type { Defi } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import type { ChallengeState, Day } from '../engine/types.ts'
import {
  conditionLine,
  defiWeek,
  goalLine,
  progressLines,
  thresholdLines,
} from './defis.ts'
import { useGame } from './store.ts'
import './panel.css'
import './DefiPanel.css'

const TITLE_ID = 'defi-title'

/**
 * Where the Défi stands, one line per measure it watches: « Encaisse la
 * plus basse : 1 870 $ ».
 */
export function DefiProgressView({
  challenge,
  defi,
}: {
  challenge: ChallengeState
  defi: Defi
}) {
  return (
    <ul className="defi-progress">
      {progressLines(challenge.progress, defi).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

interface DefiPanelViewProps {
  defi: Defi
  challenge: ChallengeState
  /** The morning the game is at. */
  day: Day
  onClose: () => void
}

/**
 * The Défi under way: its week, its goal, where it stands, the medals'
 * thresholds and its conditions.
 */
export function DefiPanelView({
  defi,
  challenge,
  day,
  onClose,
}: DefiPanelViewProps) {
  const { week, weeks } = defiWeek(challenge, defi, day)
  return (
    <div className="panel__content">
      {/* Fermer comes first so it has the focus when the panel opens. */}
      <div className="panel__header">
        <button type="button" className="toggle" onClick={onClose}>
          Fermer
        </button>
        <h2 id={TITLE_ID}>{defi.title}</h2>
      </div>
      <p className="defi-panel__week">
        Semaine {week} de {weeks}
      </p>
      <h3>Objectif</h3>
      <p>{goalLine(defi.goal)}</p>
      <h3>Où vous en êtes</h3>
      <DefiProgressView challenge={challenge} defi={defi} />
      <h3>Médailles</h3>
      <ul className="defi-panel__list">
        {thresholdLines(defi.goal).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {defi.conditions.length > 0 && (
        <>
          <h3>Conditions</h3>
          <ul className="defi-panel__list">
            {defi.conditions.map((condition) => (
              <li key={condition.kind}>{conditionLine(condition)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * The Défi's panel wired to the app store, in a modal dialog: the page
 * behind it is out of reach, and Fermer or Escape closes it.
 */
export default function DefiPanel() {
  const challenge = useGame((state) => state.game.challenge)
  const day = useGame((state) => state.game.day)
  const closePanel = useGame((state) => state.closePanel)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])

  if (challenge === null) return null
  return (
    <dialog
      ref={dialogRef}
      className="panel defi-panel"
      aria-labelledby={TITLE_ID}
      onClose={closePanel}
    >
      <DefiPanelView
        defi={defiById(DEFIS, challenge.id)}
        challenge={challenge}
        day={day}
        onClose={() => dialogRef.current?.close()}
      />
    </dialog>
  )
}
