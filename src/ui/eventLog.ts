import type { EventContent } from '../content/schema.ts'
import { EVENTS } from '../engine/day.ts'
import { isKept } from '../engine/personal.ts'
import type { Day, EventRecord } from '../engine/types.ts'

/** An event that came up, as « Journal des événements » lists it. */
export interface EventLogEntry {
  /** The morning it came up and was chosen. */
  readonly day: Day
  /** The event's title. */
  readonly title: string
  /** The label of the choice made. */
  readonly choice: string
  /** What came of it. */
  readonly result: string
}

/**
 * The events of `history` from the calendar month of `today` and the 11
 * before, as the owner's account keeps its movements, newest first. An
 * event, choice or outcome `content` no longer holds is left out.
 */
export function recentEvents(
  history: readonly EventRecord[],
  today: Day,
  content: EventContent = EVENTS,
): EventLogEntry[] {
  const entries: EventLogEntry[] = []
  for (const record of history) {
    if (!isKept(record.day, today)) continue
    const event = content.events.find(({ id }) => id === record.event)
    const choice = event?.choices.find(({ id }) => id === record.choice)
    const outcome = choice?.outcomes[record.outcome]
    if (event === undefined || choice === undefined || outcome === undefined) {
      continue
    }
    entries.push({
      day: record.day,
      title: event.title,
      choice: choice.label,
      result: outcome.result,
    })
  }
  return entries.reverse()
}
