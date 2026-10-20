import { useCallback, useEffect, useRef, type Ref } from 'react'
import {
  isNoticeCard,
  type EventCard as Card,
  type DifficultyId,
  type EventContent,
} from '../content/schema.ts'
import { allowedChoices } from '../engine/challenge.ts'
import { DEFIS, EVENTS } from '../engine/day.ts'
import { scalingOf } from '../engine/events.ts'
import { cardText, choiceTags, type TextScope } from '../engine/scaling.ts'
import type { EventRecord, GameState } from '../engine/types.ts'
import {
  allowedChoiceForKey,
  choiceKey,
  handleCardEscape,
  pickChoice,
} from './choiceKeys.ts'
import { FORCED_CHOICE_REASON } from './defis.ts'
import { choiceChanges, formatChangeLine } from './eventChanges.ts'
import { formatCardText, formatChoiceTag } from './eventTags.ts'
import { portraitUrl } from './portraits.ts'
import { Silhouette } from './Silhouette.tsx'
import { gameStore, useGame } from './store.ts'
import './panel.css'
import './EventCard.css'

const TITLE_ID = 'event-title'
// French quotation marks hold their text with no-break spaces (U+00A0).
const OPEN_QUOTE = '« '
const CLOSE_QUOTE = ' »'

/** What came of the player's choice, as the card shows it. */
export interface EventResult {
  /** The label of the choice made, its amounts written. */
  readonly choice: string
  /** What came of it, as the content writes it, its amounts written. */
  readonly text: string
  /** What it changed, one plain line each (see eventChanges.ts). */
  readonly changes: readonly string[]
}

interface EventCardViewProps {
  card: Card
  /** The game's difficulty, which sets the amounts the card shows. */
  difficulty: DifficultyId
  /**
   * How the game scales the cards (see `scalingOf`); the shipped scaling
   * by default.
   */
  scaling?: Pick<EventContent, 'scaling'>
  /** The URL of the character's portrait; null shows a silhouette. */
  portrait: string | null
  /** Null while the player chooses; then what came of the choice. */
  result: EventResult | null
  /**
   * The ids of the choices a Défi leaves the player; null leaves every
   * choice. The others are disabled, with the reason.
   */
  allowed: readonly string[] | null
  onChoose: (choiceId: string) => void
  onContinue: () => void
  /** The title, which takes the focus when the card opens. */
  titleRef?: Ref<HTMLHeadingElement>
  /** What came of the choice, which takes the focus once it shows. */
  resultRef?: Ref<HTMLElement>
}

/**
 * An event card: who brings it, the title, the situation and their words,
 * then a large button for each choice, with its key and its tags at the
 * game's difficulty (see `choiceTags`); the amounts in the text are those
 * of that difficulty too (see `cardText`). Once chosen, what came of it takes
 * the choices' place, with « Continuer ». There is no way to close it
 * before choosing.
 */
export function EventCardView({
  card,
  difficulty,
  scaling = EVENTS,
  portrait,
  result,
  allowed,
  onChoose,
  onContinue,
  titleRef,
  resultRef,
}: EventCardViewProps) {
  const { character, title, situation, quote, choices } = card
  const text = (written: string, scope: TextScope) =>
    formatCardText(cardText(written, scope, difficulty, scaling))
  return (
    <div className="panel__content event-card__content">
      <div className="event-card__who">
        {portrait === null ? (
          <Silhouette
            className="event-card__portrait event-card__silhouette"
            size={96}
          />
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
      <p className="event-card__situation">{text(situation, card)}</p>
      {quote !== undefined && (
        <blockquote className="event-card__quote">
          <p>
            {OPEN_QUOTE}
            {text(quote, card)}
            {CLOSE_QUOTE}
          </p>
        </blockquote>
      )}
      {result === null ? (
        <ol className="event-card__choices">
          {choices.map((choice, index) => {
            const forbidden = allowed !== null && !allowed.includes(choice.id)
            const reasonId = `event-choice-${choice.id}-reason`
            return (
              <li key={choice.id}>
                <button
                  type="button"
                  className="event-card__choice"
                  aria-keyshortcuts={forbidden ? undefined : choiceKey(index)}
                  disabled={forbidden}
                  aria-describedby={forbidden ? reasonId : undefined}
                  onClick={() => onChoose(choice.id)}
                >
                  <span className="event-card__key" aria-hidden="true">
                    {choiceKey(index)}
                  </span>{' '}
                  <span className="event-card__label">
                    {text(choice.label, choice)}
                  </span>{' '}
                  <span className="event-card__tags">
                    {choiceTags(choice, difficulty, scaling).map(
                      (tag, tagIndex) => (
                        <span key={tagIndex}>
                          {tagIndex > 0 && ' '}
                          <span className="event-card__tag">
                            {formatChoiceTag(tag)}
                          </span>
                        </span>
                      ),
                    )}
                  </span>
                </button>
                {forbidden && (
                  <p id={reasonId} className="event-card__forbidden">
                    {FORCED_CHOICE_REASON}
                  </p>
                )}
              </li>
            )
          })}
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

/**
 * What came of `record`, the choice made on `card` between `before` and
 * `after`, with the amounts of `after`'s game; null if the card has no such
 * choice or outcome.
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
  const { difficulty } = after.profile
  const scaling = scalingOf(after)
  return {
    choice: formatCardText(cardText(choice.label, choice, difficulty, scaling)),
    text: formatCardText(
      cardText(outcome.result, outcome, difficulty, scaling),
    ),
    changes: choiceChanges(before, after).map((line) =>
      formatChangeLine(line, before.day),
    ),
  }
}

/**
 * The event card wired to the app store, in a modal dialog over the street
 * while the store's panel is `event`. The keys 1, 2 and 3 pick the choices.
 * Escape does nothing before the choice, and if the browser closes the
 * dialog anyway, it opens again while the event waits. « Continuer », or
 * Escape once the result shows, closes it, and the game resumes at the
 * speed from before the card. A notice, such as Mme Prudhomme's letters,
 * closes as soon as its one choice is made, with no result to read: the
 * card keeps its choice until it is gone, and « Événements » in « Journal »
 * keeps what came of it.
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
  const allowed = choosing === undefined ? null : allowedChoices(game, DEFIS)
  const notice = card !== undefined && isNoticeCard(card)
  const result =
    card === undefined || chosen === undefined || before === null || notice
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

  const choose = useCallback(
    (choice: string) => {
      if (choosing === undefined) return
      pickChoice(choosing, choice, chooseEvent, () =>
        dialogRef.current?.close(),
      )
    },
    [choosing, chooseEvent],
  )

  useEffect(() => {
    if (choosing === undefined) return
    const onKeyDown = (event: KeyboardEvent) => {
      const choice = allowedChoiceForKey(event, choosing.choices, allowed)
      if (choice === null) return
      event.preventDefault()
      choose(choice)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [choosing, allowed, choose])

  if (card === undefined) return null
  const onContinue = () => dialogRef.current?.close()
  return (
    <dialog
      ref={dialogRef}
      className="panel event-card"
      aria-labelledby={TITLE_ID}
      onCancel={(event) => {
        event.preventDefault()
        if (showsResult) onContinue()
      }}
      onKeyDown={(event) => handleCardEscape(event, showsResult, onContinue)}
      onClose={() => {
        closePanel()
        if (gameStore.getState().panel === 'event') {
          dialogRef.current?.showModal()
        }
      }}
    >
      <EventCardView
        card={card}
        difficulty={game.profile.difficulty}
        scaling={scalingOf(game)}
        portrait={portraitUrl(card.character.id)}
        result={result}
        allowed={allowed}
        onChoose={choose}
        onContinue={onContinue}
        titleRef={titleRef}
        resultRef={resultRef}
      />
    </dialog>
  )
}
