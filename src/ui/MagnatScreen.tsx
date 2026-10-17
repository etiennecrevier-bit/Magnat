import { useEffect, useMemo, useRef, type Ref } from 'react'
import { magnatTitle } from '../engine/dream.ts'
import type { Cents } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import { formatMoney } from './formatMoney.ts'
import { useGame } from './store.ts'
import './panel.css'
import './MagnatScreen.css'

const TITLE_ID = 'magnat-title'

// French puts a no-break space (U+00A0) before a colon.
const COLON = '\u00a0:'

interface MagnatScreenViewProps {
  /** The business's name, from the player's profile. */
  businessName: string
  /** The last title, « Magnat ». */
  title: string
  /** The owner's net worth that morning. */
  netWorth: Cents
  onContinue: () => void
  /** The title, which takes the focus when the screen opens. */
  titleRef?: Ref<HTMLHeadingElement>
}

/**
 * The celebration the morning after the owner's net worth first reaches
 * the last title: « Magnat », the business, the net worth reached, and «
 * Continuer », since the game goes on.
 */
export function MagnatScreenView({
  businessName,
  title,
  netWorth: worth,
  onContinue,
  titleRef,
}: MagnatScreenViewProps) {
  return (
    <div className="panel__content magnat__content">
      <p className="magnat__business">{businessName}</p>
      <h2 id={TITLE_ID} ref={titleRef} tabIndex={-1}>
        {title}
      </h2>
      <p className="magnat__worth">
        Valeur nette{COLON}{' '}
        <span className="magnat__amount">{formatMoney(worth)}</span>
      </p>
      <button
        type="button"
        className="button button--primary"
        onClick={onContinue}
      >
        Continuer
      </button>
    </div>
  )
}

/**
 * « Magnat » for the game the app store plays, in a modal dialog that «
 * Continuer » or Escape closes, and the game goes on.
 */
export default function MagnatScreen() {
  const game = useGame((state) => state.game)
  const closePanel = useGame((state) => state.closePanel)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const worth = useMemo(() => netWorth(game), [game])

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
    // The title, not « Continuer », so a stray key does not close it.
    titleRef.current?.focus()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="panel magnat"
      aria-labelledby={TITLE_ID}
      onClose={closePanel}
    >
      <MagnatScreenView
        businessName={game.profile.businessName}
        title={magnatTitle().name}
        netWorth={worth}
        onContinue={() => dialogRef.current?.close()}
        titleRef={titleRef}
      />
    </dialog>
  )
}
