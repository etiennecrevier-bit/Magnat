import { useEffect, useMemo, useRef, type Ref } from 'react'
import { loadBankruptcyText } from '../content/bankruptcyText.ts'
import { percentileOnMorning } from '../engine/standing.ts'
import type { GameEnd, GameState } from '../engine/types.ts'
import {
  bankruptcyFigures,
  figureLine,
  prudhommeLine,
} from './bankruptcyEnd.ts'
import { formatShortGameDate } from './formatGameDate.ts'
import { BANKER, portraitUrl } from './portraits.ts'
import { PrudhommeAdvice } from './PrudhommeAdvice.tsx'
import { gameStore, newGame, useGame } from './store.ts'
import './panel.css'
import './BankruptcyEnd.css'

const TITLE_ID = 'bankruptcy-title'
// French puts a no-break space (U+00A0) before a percent sign.
const PERCENT = '\u00a0%'

/** The screen's French, validated once when the UI loads. */
const TEXT = loadBankruptcyText()

interface BankruptcyEndViewProps {
  /** The game that went bankrupt. */
  game: GameState
  ended: GameEnd
  /**
   * Where the owner stands among the simulated owners (see
   * `percentileOnMorning`); null shows nothing.
   */
  percentile?: number | null
  /** The URL of Mme Prudhomme's portrait; null shows none. */
  portrait?: string | null
  onRestart: () => void
  onMenu: () => void
  /** The title, which takes the focus when the screen opens. */
  titleRef?: Ref<HTMLHeadingElement>
}

/**
 * The end of a game that went bankrupt: « Faillite », the business and the
 * day, how the owner compares with the simulated owners, rounded down, the
 * key numbers, what Mme Prudhomme says, then « Recommencer » and « Retour
 * au menu ». It explains nothing.
 */
export function BankruptcyEndView({
  game,
  ended,
  percentile = null,
  portrait = null,
  onRestart,
  onMenu,
  titleRef,
}: BankruptcyEndViewProps) {
  return (
    <div className="panel__content bankruptcy-end__content">
      <p className="bankruptcy-end__business">{game.profile.businessName}</p>
      <h2 id={TITLE_ID} ref={titleRef} tabIndex={-1}>
        Faillite
      </h2>
      <p className="bankruptcy-end__date">
        {`Dossier fermé le ${formatShortGameDate(ended.day)}`}
      </p>
      {percentile !== null && (
        <p className="bankruptcy-end__percentile">
          {`Mieux que ${Math.floor(percentile)}${PERCENT} des propriétaires`}
        </p>
      )}
      <ul className="bankruptcy-end__figures">
        {bankruptcyFigures(game, ended).map((figure) => (
          <li key={figure.label}>{figureLine(figure)}</li>
        ))}
      </ul>
      <PrudhommeAdvice
        title="Le mot de Mme Prudhomme"
        advice={prudhommeLine(game.seed, TEXT)}
        portrait={portrait}
      />
      <div className="bankruptcy-end__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={onRestart}
        >
          Recommencer
        </button>
        <button type="button" className="button" onClick={onMenu}>
          Retour au menu
        </button>
      </div>
    </div>
  )
}

/**
 * The « Faillite » screen of the game the app store plays, in a modal
 * dialog with no way out but its buttons: Escape does nothing, and if the
 * browser closes the dialog anyway, it opens again. « Recommencer » starts
 * a new game for the same business, its name, avatar and difficulty, on a
 * new seed; `onMenu` goes back to the start screen.
 */
export default function BankruptcyEnd({ onMenu }: { onMenu: () => void }) {
  const game = useGame((state) => state.game)
  const startGame = useGame((state) => state.startGame)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const percentile = useMemo(() => percentileOnMorning(game), [game])

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
    // The title, not « Recommencer », so a stray key starts nothing.
    titleRef.current?.focus()
  }, [])

  const { ended } = game
  if (ended === null) return null
  return (
    <dialog
      ref={dialogRef}
      className="panel bankruptcy-end"
      aria-labelledby={TITLE_ID}
      onCancel={(event) => event.preventDefault()}
      onClose={() => {
        if (gameStore.getState().panel === 'bankruptcy') {
          dialogRef.current?.showModal()
        }
      }}
    >
      <BankruptcyEndView
        game={game}
        ended={ended}
        percentile={percentile}
        portrait={portraitUrl(BANKER)}
        onRestart={() =>
          startGame(newGame(window.location.search, game.profile))
        }
        onMenu={onMenu}
        titleRef={titleRef}
      />
    </dialog>
  )
}
