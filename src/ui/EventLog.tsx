import { useMemo } from 'react'
import { scalingOf } from '../engine/events.ts'
import { recentEvents, type EventLogEntry } from './eventLog.ts'
import { formatShortGameDate } from './formatGameDate.ts'
import JournalRow from './JournalRow.tsx'
import { useOpenRows } from './journalRows.ts'
import { useGame } from './store.ts'
import './EventLog.css'

/**
 * « Événements »: the events of the last 12 months, newest first, each a
 * line with its date, its title and the choice made, which opens to what
 * came of it.
 */
export function EventLogView({
  entries,
  openKeys = new Set(),
  onToggle = () => {},
}: {
  entries: readonly EventLogEntry[]
  /** The keys of the entries open. */
  openKeys?: ReadonlySet<string>
  onToggle?: (key: string) => void
}) {
  return (
    <section className="event-log">
      {entries.length === 0 ? (
        <p>Aucun événement depuis un an.</p>
      ) : (
        <ol className="journal-rows">
          {entries.map((entry) => (
            <JournalRow
              key={entry.key}
              id={`event-log-${entry.key}`}
              open={openKeys.has(entry.key)}
              onToggle={() => onToggle(entry.key)}
              line={
                <>
                  <span className="journal-row__muted">
                    {formatShortGameDate(entry.day)}
                  </span>{' '}
                  <span className="journal-row__title">{entry.title}</span>{' '}
                  <span className="journal-row__muted">{entry.choice}</span>
                </>
              }
            >
              <p className="event-log__result">{entry.result}</p>
            </JournalRow>
          ))}
        </ol>
      )}
    </section>
  )
}

/** The events of the app store's game, with the amounts it plays. */
export default function EventLog() {
  const history = useGame((state) => state.game.events.history)
  const day = useGame((state) => state.game.day)
  const difficulty = useGame((state) => state.game.profile.difficulty)
  const challenge = useGame((state) => state.game.challenge)
  const entries = useMemo(
    () => recentEvents(history, day, difficulty, scalingOf({ challenge })),
    [history, day, difficulty, challenge],
  )
  const [openKeys, toggle] = useOpenRows()
  return (
    <EventLogView entries={entries} openKeys={openKeys} onToggle={toggle} />
  )
}
