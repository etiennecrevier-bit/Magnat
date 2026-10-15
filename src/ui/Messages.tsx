import { useEffect, useState } from 'react'
import { formatDayAndMonth } from './formatGameDate.ts'
import { received, startMessages, type Message } from './messageTriggers.ts'
import { gameStore } from './store.ts'
import './Messages.css'

interface MessagesViewProps {
  /** Newest first. */
  messages: readonly Message[]
  onDismiss: (id: number) => void
}

/**
 * The messages the player received, newest first, each with its sender, its
 * day and « Fermer ». The log is always on the page, empty and taking no
 * room when there is none, so screen readers read each new one.
 */
export function MessagesView({ messages, onDismiss }: MessagesViewProps) {
  return (
    <section className="messages" role="log" aria-label="Messages">
      {messages.map(({ id, kind, from, text, day }) => (
        <article key={id} className={`message message--${kind}`}>
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
      ))}
    </section>
  )
}

/** The messages the app store's game calls for, from now on. */
export default function Messages() {
  const [messages, setMessages] = useState<readonly Message[]>([])

  useEffect(
    () =>
      startMessages(gameStore, (message) =>
        setMessages((all) => received(all, message)),
      ),
    [],
  )

  return (
    <MessagesView
      messages={messages}
      onDismiss={(id) =>
        setMessages((all) => all.filter((message) => message.id !== id))
      }
    />
  )
}
