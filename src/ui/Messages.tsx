import { useStore } from 'zustand'
import { TUTORIAL } from '../engine/tutorial.ts'
import { formatDayAndMonth } from './formatGameDate.ts'
import { PalmStamp } from './icons.tsx'
import {
  messageElementId,
  messageStack,
  streetMessages,
  type MessageStack,
} from './messageStack.ts'
import type { Message } from './messageTriggers.ts'
import { POSTCARDS } from './postcards.ts'
import { portraitUrl } from './portraits.ts'
import { Silhouette } from './Silhouette.tsx'
import { gameStore, type GameStore } from './store.ts'
import './Messages.css'

/** What a postcard shows besides its own text: Réal's face and « Merci! ». */
export interface PostcardLook {
  /** The URL of Réal's portrait; null for the silhouette. */
  readonly portrait: string | null
  /** The button that puts it away. */
  readonly thanks: string
}

const POSTCARD_LOOK: PostcardLook = {
  portrait: portraitUrl(TUTORIAL.coach.character),
  thanks: POSTCARDS.thanks,
}

interface MessagesViewProps {
  /** Newest first. */
  messages: readonly Message[]
  onDismiss: (id: number) => void
  postcard?: PostcardLook
}

/** A sender's face, or a silhouette for one without a portrait file. */
function MessagePortrait({ url }: { url: string | null }) {
  return url === null ? (
    <Silhouette className="message__portrait message__silhouette" size={44} />
  ) : (
    <img
      className="message__portrait"
      src={url}
      alt=""
      width={44}
      height={44}
    />
  )
}

/**
 * The messages the player received, newest first, each with its sender, its
 * day and « Fermer », and an employee's with their face. A postcard from Réal is a cream card with a palm-tree
 * stamp in its corner and his portrait, put away with « Merci! ». The log
 * is always on the page, empty and taking no room when there is none, so
 * screen readers read each new one.
 */
export function MessagesView({
  messages,
  onDismiss,
  postcard = POSTCARD_LOOK,
}: MessagesViewProps) {
  return (
    <section className="messages" role="log" aria-label="Messages">
      {messages.map(({ id, kind, from, portrait, text, day }) =>
        kind === 'postcard' ? (
          <article
            key={id}
            id={messageElementId(id)}
            className="message message--postcard"
            tabIndex={-1}
          >
            <MessagePortrait url={postcard.portrait} />
            <p className="message__from" id={`message-${id}`}>
              {from}{' '}
              <span className="message__day">{formatDayAndMonth(day)}</span>
            </p>
            <p className="message__text">{text}</p>
            <span className="message__stamp">
              <PalmStamp />
            </span>
            <button
              type="button"
              className="toggle message__close"
              aria-describedby={`message-${id}`}
              onClick={() => onDismiss(id)}
            >
              {postcard.thanks}
            </button>
          </article>
        ) : (
          <article
            key={id}
            id={messageElementId(id)}
            className={`message message--${kind}${portrait === undefined ? '' : ' message--face'}`}
            tabIndex={-1}
          >
            {portrait !== undefined && (
              <MessagePortrait url={portraitUrl(portrait)} />
            )}
            <p className="message__from" id={`message-${id}`}>
              {from}{' '}
              <span className="message__day">{formatDayAndMonth(day)}</span>
            </p>
            <p className="message__text">{text}</p>
            <button
              type="button"
              className="toggle message__close"
              aria-describedby={`message-${id}`}
              onClick={() => onDismiss(id)}
            >
              Fermer
            </button>
          </article>
        ),
      )}
    </section>
  )
}

/**
 * The messages in `stack` the street shows on `store`'s game day (see
 * `streetMessages`), which the shell fills with those the app store's game
 * calls for (see `startMessageStack`).
 */
export default function Messages({
  stack = messageStack,
  store = gameStore,
}: {
  stack?: MessageStack
  store?: GameStore
}) {
  const messages = useStore(stack, (state) => state.messages)
  const shownAgainOn = useStore(stack, (state) => state.shownAgainOn)
  const dismiss = useStore(stack, (state) => state.dismiss)
  const today = useStore(store, (state) => state.game.day)
  return (
    <MessagesView
      messages={streetMessages(messages, today, shownAgainOn)}
      onDismiss={dismiss}
    />
  )
}
