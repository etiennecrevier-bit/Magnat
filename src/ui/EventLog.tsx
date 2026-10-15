import { useMemo } from 'react'
import { recentEvents, type EventLogEntry } from './eventLog.ts'
import { formatShortGameDate } from './formatGameDate.ts'
import { useGame } from './store.ts'
import './EventLog.css'

/**
 * « Journal des événements »: the events of the last 12 months, newest
 * first, each with the choice made and what came of it.
 */
export function EventLogView({
  entries,
}: {
  entries: readonly EventLogEntry[]
}) {
  return (
    <section className="event-log">
      <h1>Journal des événements</h1>
      {entries.length === 0 ? (
        <p>Aucun événement depuis un an.</p>
      ) : (
        <ol className="event-log__entries">
          {entries.map((entry, index) => (
            <li key={index} className="event-log__entry">
              <h2>{entry.title}</h2>
              <p className="event-log__date">
                {formatShortGameDate(entry.day)}
              </p>
              <p>Choix&nbsp;: {entry.choice}</p>
              <p>{entry.result}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** The journal of the app store's game. */
export default function EventLog() {
  const history = useGame((state) => state.game.events.history)
  const day = useGame((state) => state.game.day)
  const entries = useMemo(() => recentEvents(history, day), [history, day])
  return <EventLogView entries={entries} />
}
