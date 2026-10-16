import { useEffect, useRef, type Ref } from 'react'
import type { Defi } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import { defiPercentileOf } from '../engine/percentiles.ts'
import type { ChallengeState } from '../engine/types.ts'
import { endFigures, failureLine, MEDAL_TITLES } from './defis.ts'
import { gameStore, newChallenge, useGame } from './store.ts'
import './panel.css'
import './DefiEnd.css'
import './medals.css'

const TITLE_ID = 'defi-end-title'
// French puts a no-break space (U+00A0) before a percent sign.
const PERCENT = ' %'

interface DefiEndViewProps {
  defi: Defi
  /** The Défi over, réussi or échoué. */
  challenge: ChallengeState
  /**
   * Where the Défi stands among the simulated games (see
   * `defiPercentileOf`); null shows nothing.
   */
  percentile?: number | null
  onReplay: () => void
  onMenu: () => void
  /** The title, which takes the focus when the screen opens. */
  titleRef?: Ref<HTMLHeadingElement>
}

/**
 * The end of a Défi: réussi with its medal, or échoué with why, how it
 * compares with the simulated games, rounded down, then the key numbers,
 * « Rejouer » and « Retour au menu ».
 */
export function DefiEndView({
  defi,
  challenge,
  percentile = null,
  onReplay,
  onMenu,
  titleRef,
}: DefiEndViewProps) {
  const { medal, progress } = challenge
  return (
    <div className="panel__content defi-end__content">
      <p className="defi-end__defi">{defi.title}</p>
      <h2 id={TITLE_ID} ref={titleRef} tabIndex={-1}>
        {medal === null ? 'Défi échoué' : 'Défi réussi'}
      </h2>
      {medal === null ? (
        <p className="defi-end__why">{failureLine(progress, defi)}</p>
      ) : (
        <p className={`defi-end__medal defi-medal--${medal}`}>
          {MEDAL_TITLES[medal]}
        </p>
      )}
      {percentile !== null && (
        <p className="defi-end__percentile">
          {`Mieux que ${Math.floor(percentile)}${PERCENT} des parties simulées`}
        </p>
      )}
      <ul className="defi-end__figures">
        {endFigures(progress, defi).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="defi-end__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={onReplay}
        >
          Rejouer
        </button>
        <button type="button" className="button" onClick={onMenu}>
          Retour au menu
        </button>
      </div>
    </div>
  )
}

/**
 * The end of the Défi the app store plays, with how it compares with the
 * simulated games, in a modal dialog with no way out but its buttons:
 * Escape does nothing, and if the browser closes the dialog anyway, it
 * opens again. « Rejouer » plays the same Défi again, for the same
 * business, on a new seed; `onMenu` goes back to the start screen.
 */
export default function DefiEnd({ onMenu }: { onMenu: () => void }) {
  const challenge = useGame((state) => state.game.challenge)
  const profile = useGame((state) => state.game.profile)
  const startGame = useGame((state) => state.startGame)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
    // The title, not « Rejouer », so a stray key starts nothing.
    titleRef.current?.focus()
  }, [])

  if (challenge === null) return null
  const defi = defiById(DEFIS, challenge.id)
  return (
    <dialog
      ref={dialogRef}
      className="panel defi-end"
      aria-labelledby={TITLE_ID}
      onCancel={(event) => event.preventDefault()}
      onClose={() => {
        if (gameStore.getState().panel === 'defiEnd') {
          dialogRef.current?.showModal()
        }
      }}
    >
      <DefiEndView
        defi={defi}
        challenge={challenge}
        percentile={defiPercentileOf(defi, challenge.progress)}
        onReplay={() =>
          startGame(newChallenge(window.location.search, challenge.id, profile))
        }
        onMenu={onMenu}
        titleRef={titleRef}
      />
    </dialog>
  )
}
