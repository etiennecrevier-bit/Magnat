import type { DifficultyId, EventContent } from '../content/schema.ts'
import { EVENTS } from '../engine/day.ts'
import { isKept } from '../engine/personal.ts'
import { cardText } from '../engine/scaling.ts'
import type { Day, EventRecord } from '../engine/types.ts'
import { formatCardText } from './eventTags.ts'

/** An event that came up, as « Événements » lists it. */
export interface EventLogEntry {
  /** Its day and event, the same when a newer event comes before it. */
  readonly key: string
  /** The morning it came up and was chosen. */
  readonly day: Day
  /** The event's title. */
  readonly title: string
  /** The label of the choice made, its amounts written. */
  readonly choice: string
  /** What came of it, its amounts written. */
  readonly result: string
}

/**
 * The events of `history` from the calendar month of `today` and the 11
 * before, as the owner's account keeps its movements, newest first, their
 * amounts as `difficulty` and `scaling` set them, as the card showed them
 * (see `cardText`). An event, choice or outcome `content` no longer holds
 * is left out.
 */
export function recentEvents(
  history: readonly EventRecord[],
  today: Day,
  difficulty: DifficultyId,
  scaling: Pick<EventContent, 'scaling'>,
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
      key: `${record.day}-${record.event}`,
      day: record.day,
      title: event.title,
      choice: formatCardText(
        cardText(choice.label, choice, difficulty, scaling),
      ),
      result: formatCardText(
        cardText(outcome.result, outcome, difficulty, scaling),
      ),
    })
  }
  return entries.reverse()
}
