import { useEffect, useRef, type Ref } from 'react'
import type { EventCard as Card } from '../content/schema.ts'
import { EVENTS } from '../engine/day.ts'
import type { EventRecord, GameState } from '../engine/types.ts'
import { choiceForKey, choiceKey } from './choiceKeys.ts'
import { choiceChanges, formatChangeLine } from './eventChanges.ts'
import { portraitUrl } from './portraits.ts'
import { gameStore, useGame } from './store.ts'
import './panel.css'
import './EventCard.css'

const TITLE_ID = 'event-title'
// French quotation marks hold their text with no-break spaces (U+00A0).
const OPEN_QUOTE = '« '
const CLOSE_QUOTE = ' »'

/** What came of the player's choice, as the card shows it. */
export interface EventResult {
  /** The label of the choice made. */
  readonly choice: string
  /** What came of it, as the content writes it. */
  readonly text: string
  /** What it changed, one plain line each (see eventChanges.ts). */
  readonly changes: readonly string[]
}

interface EventCardViewProps {
  card: Card
  /** The URL of the character's portrait; null shows a silhouette. */
  portrait: string | null
  /** Null while the player chooses; then what came of the choice. */
  result: EventResult | null
  onChoose: (choiceId: string) => void
  onContinue: () => void
  /** The title, which takes the focus when the card opens. */
  titleRef?: Ref<HTMLHeadingElement>
  /** What came of the choice, which takes the focus once it shows. */
  resultRef?: Ref<HTMLElement>
}

/**
 * An event card: who brings it, the title, the situation and their words,
 * then a large button for each choice, with its key and the tags the
 * content gives it. Once chosen, what came of it takes the choices' place,
 * with « Continuer ». There is no way to close it before choosing.
 */
export function EventCardView({
  card,
  portrait,
  result,
  onChoose,
  onContinue,
  titleRef,
  resultRef,
}: EventCardViewProps) {
  const { character, title, situation, quote, choices } = card
  return (
    <div className="panel__content event-card__content">
      <div className="event-card__who">
        {portrait === null ? (
          <Silhouette />
        ) : (
          <img
            className="event-card__portrait"
            src={portrait}
            alt=""
            width={96}
            height={96}
          />
        )}
        <div>
          <p className="event-card__name">{character.name}</p>
          <p className="event-card__role">{character.role}</p>
        </div>
      </div>
      <h2
        id={TITLE_ID}
        ref={titleRef}
        className="event-card__title"
        tabIndex={-1}
      >
        {title}
      </h2>
      <p className="event-card__situation">{situation}</p>
      {quote !== undefined && (
        <blockquote className="event-card__quote">
          <p>
            {OPEN_QUOTE}
            {quote}
            {CLOSE_QUOTE}
          </p>
        </blockquote>
      )}
      {result === null ? (
        <ol className="event-card__choices">
          {choices.map((choice, index) => (
            <li key={choice.id}>
              <button
                type="button"
                className="event-card__choice"
                aria-keyshortcuts={choiceKey(index)}
                onClick={() => onChoose(choice.id)}
              >
                <span className="event-card__key" aria-hidden="true">
                  {choiceKey(index)}
                </span>{' '}
                <span className="event-card__label">{choice.label}</span>{' '}
                <span className="event-card__tags">
                  {choice.tags.map((tag, tagIndex) => (
                    <span key={tagIndex}>
                      {tagIndex > 0 && ' '}
                      <span className="event-card__tag">{tag}</span>
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <section
          ref={resultRef}
          className="event-card__result"
          aria-label="Résultat"
          tabIndex={-1}
        >
          <p className="event-card__chosen">
            Votre choix&nbsp;: {result.choice}
          </p>
          <p className="event-card__outcome">{result.text}</p>
          {result.changes.length > 0 && (
            <ul className="event-card__changes">
              {result.changes.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="button button--primary event-card__continue"
            onClick={onContinue}
          >
            Continuer
          </button>
        </section>
      )}
    </div>
  )
}

/** A cream silhouette, for a character with no portrait yet. */
function Silhouette() {
  return (
    <svg
      className="event-card__portrait event-card__silhouette"
      viewBox="0 0 96 96"
      width={96}
      height={96}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="48" cy="38" r="17" />
      <path d="M14 96c0-21 15-35 34-35s34 14 34 35z" />
    </svg>
  )
}

/**
 * What came of `record`, the choice made on `card` between `before` and
 * `after`; null if the card has no such choice or outcome.
 */
function eventResult(
  card: Card,
  record: EventRecord,
  before: GameState,
  after: GameState,
): EventResult | null {
  const choice = card.choices.find(({ id }) => id === record.choice)
  const outcome = choice?.outcomes[record.outcome]
  if (choice === undefined || outcome === undefined) return null
  return {
    choice: choice.label,
    text: outcome.result,
    changes: choiceChanges(before, after).map((line) =>
      formatChangeLine(line, before.day),
    ),
  }
}

/**
 * The event card wired to the app store, in a modal dialog over the street
 * while the store's panel is `event`. The keys 1, 2 and 3 pick the choices.
 * Escape does nothing, and if the browser closes the dialog anyway, it
 * opens again while the event waits. « Continuer » closes it, and the game
 * resumes at the speed from before the card.
 */
export default function EventCard() {
  const game = useGame((state) => state.game)
  const before = useGame((state) => state.eventBefore)
  const chooseEvent = useGame((state) => state.chooseEvent)
  const closePanel = useGame((state) => state.closePanel)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const resultRef = useRef<HTMLElement>(null)

  const { pending, history } = game.events
  // The event waiting, or once chosen, the one just chosen.
  const chosen = pending === null ? history.at(-1) : undefined
  const id = pending?.event ?? chosen?.event
  const card = EVENTS.events.find((event) => event.id === id)
  const choosing = pending !== null ? card : undefined
  const result =
    card === undefined || chosen === undefined || before === null
      ? null
      : eventResult(card, chosen, before, game)

  useEffect(() => {
    const dialog = dialogRef.current
    // StrictMode runs this twice; the second time, the dialog is open.
    if (dialog !== null && !dialog.open) dialog.showModal()
    // The title, not the first choice, so a stray Enter picks nothing.
    titleRef.current?.focus()
  }, [])

  const showsResult = result !== null
  useEffect(() => {
    if (showsResult) resultRef.current?.focus()
  }, [showsResult])

  useEffect(() => {
    if (choosing === undefined) return
    const onKeyDown = (event: KeyboardEvent) => {
      const index = choiceForKey(event, choosing.choices.length)
      const choice = index === null ? undefined : choosing.choices[index]
      if (choice === undefined) return
      event.preventDefault()
      chooseEvent(choice.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [choosing, chooseEvent])

  if (card === undefined) return null
  return (
    <dialog
      ref={dialogRef}
      className="panel event-card"
      aria-labelledby={TITLE_ID}
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.preventDefault()
      }}
      onClose={() => {
        closePanel()
        if (gameStore.getState().panel === 'event') {
          dialogRef.current?.showModal()
        }
      }}
    >
      <EventCardView
        card={card}
        portrait={portraitUrl(card.character.id)}
        result={result}
        onChoose={chooseEvent}
        onContinue={() => dialogRef.current?.close()}
        titleRef={titleRef}
        resultRef={resultRef}
      />
    </dialog>
  )
}
