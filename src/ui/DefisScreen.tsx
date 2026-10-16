import { useId } from 'react'
import type { Defi, Medal } from '../content/schema.ts'
import {
  challengeDifficulties,
  lastDayOf,
  startDayOf,
} from '../engine/challenge.ts'
import { DIFFICULTIES as DIFFICULTY_CONTENT } from '../engine/day.ts'
import {
  conditionLine,
  goalLine,
  lengthText,
  lockedLines,
  MEDAL_NAMES,
  thresholdLines,
} from './defis.ts'
import { formatGamePeriod } from './formatGameDate.ts'
import { DIFFICULTIES, difficultyLine } from './newGame.ts'
import './DefisScreen.css'
import './medals.css'

// French puts a no-break space (U+00A0) before a colon.
const COLON = ' :'

/** A Défi's difficulty, as the new game form names it. */
function difficultyName(defi: Defi): string {
  return (
    DIFFICULTIES.find(({ id }) => id === defi.difficulty)?.name ??
    defi.difficulty
  )
}

/** The best medal won in a Défi, or that none was. */
function medalText(medal: Medal | undefined): string {
  return medal === undefined
    ? 'Aucune médaille'
    : `Meilleure médaille${COLON} ${MEDAL_NAMES[medal]}`
}

interface DefiListViewProps {
  defis: readonly Defi[]
  /** The best medal won in each Défi, by its id. */
  bestMedals: Readonly<Record<string, Medal>>
  /** Opens the briefing of the Défi with the id. */
  onOpen: (defiId: string) => void
  onBack: () => void
}

/**
 * The Défis, in the content's order: a card for each with its title,
 * difficulty, length and the best medal won, which opens its briefing.
 */
export function DefiListView({
  defis,
  bestMedals,
  onOpen,
  onBack,
}: DefiListViewProps) {
  const headingId = useId()
  return (
    <section className="start-screen" aria-labelledby={headingId}>
      <h1 id={headingId}>Défis</h1>
      <ul className="defi-list">
        {defis.map((defi) => (
          <li key={defi.id}>
            <button
              type="button"
              className="defi-card"
              onClick={() => onOpen(defi.id)}
            >
              <span className="defi-card__title">{defi.title}</span>
              <span className="defi-card__line">
                {difficultyName(defi)} · {lengthText(defi.lengthDays)}
              </span>
              <span
                className={
                  bestMedals[defi.id] === undefined
                    ? 'defi-card__medal'
                    : `defi-card__medal defi-medal--${bestMedals[defi.id]}`
                }
              >
                {medalText(bestMedals[defi.id])}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="start-screen__actions">
        <button type="button" className="button" onClick={onBack}>
          Retour
        </button>
      </div>
    </section>
  )
}

interface DefiBriefingViewProps {
  defi: Defi
  /** The best medal won in the Défi; undefined when none was. */
  bestMedal: Medal | undefined
  onStart: () => void
  onBack: () => void
}

/**
 * A Défi before it starts: its story, how it opens, its dates, its goal and
 * the medals' thresholds, its conditions, what it locks, the best medal won,
 * then « Commencer ». A Défi is not saved, which it says.
 */
export function DefiBriefingView({
  defi,
  bestMedal,
  onStart,
  onBack,
}: DefiBriefingViewProps) {
  const headingId = useId()
  const locked = lockedLines(defi)
  const { difficulties } = challengeDifficulties(defi, DIFFICULTY_CONTENT)
  return (
    <section className="start-screen defi-briefing" aria-labelledby={headingId}>
      <h1 id={headingId}>{defi.title}</h1>
      <p className="defi-briefing__story">{defi.story}</p>
      <p className="defi-briefing__setup">
        {difficultyName(defi)}
        {COLON} {difficultyLine(difficulties[defi.difficulty])}
      </p>
      <p className="defi-briefing__dates">
        {formatGamePeriod(startDayOf(defi), lastDayOf(defi))} (
        {lengthText(defi.lengthDays)})
      </p>
      <h2>Objectif</h2>
      <p>{goalLine(defi.goal)}</p>
      <ul className="defi-briefing__list">
        {thresholdLines(defi.goal).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {defi.conditions.length > 0 && (
        <>
          <h2>Conditions</h2>
          <ul className="defi-briefing__list">
            {defi.conditions.map((condition) => (
              <li key={condition.kind}>{conditionLine(condition)}</li>
            ))}
          </ul>
        </>
      )}
      <h2>Verrouillé</h2>
      {locked.length === 0 ? (
        <p>Toutes vos décisions sont libres.</p>
      ) : (
        <ul className="defi-briefing__list">
          {locked.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <p className="defi-briefing__medal">
        {bestMedal === undefined
          ? "Aucune médaille pour l'instant."
          : medalText(bestMedal)}
      </p>
      <p className="notice">
        Les Défis ne sont pas sauvegardés{COLON} votre partie sauvegardée reste
        intacte.
      </p>
      <div className="start-screen__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={onStart}
        >
          Commencer
        </button>
        <button type="button" className="button" onClick={onBack}>
          Retour
        </button>
      </div>
    </section>
  )
}
