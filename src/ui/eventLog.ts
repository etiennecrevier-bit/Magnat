import type {
  DifficultyId,
  DreamContent,
  EventContent,
} from '../content/schema.ts'
import { EVENTS } from '../engine/day.ts'
import {
  DREAM,
  DREAM_MEMO,
  dreamLabel,
  isCompany,
  rungOf,
} from '../engine/dream.ts'
import { isKept } from '../engine/personal.ts'
import { cardText } from '../engine/scaling.ts'
import type { BoughtRung, Day, EventRecord } from '../engine/types.ts'
import { formatCardText } from './eventTags.ts'
import { formatBriefMoney } from './formatMoney.ts'

// French puts a no-break space (U+00A0) before a colon.
const COLON = '\u00a0:'

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

/**
 * `events` with the rungs of « Améliorations » in `bought` from the same
 * months mixed in, each as an event of its day, « Achat · {name} » at what it
 * cost, opening to who paid and, for a company rung, the equipment it put
 * on the bilan. Newest first; on a day with both, the purchase comes after
 * the day's events. A rung `content` no longer holds is left out.
 */
export function withPurchases(
  events: readonly EventLogEntry[],
  bought: readonly BoughtRung[],
  today: Day,
  content: DreamContent = DREAM,
): EventLogEntry[] {
  const purchases: EventLogEntry[] = []
  for (const { rung: id, day, cost } of bought) {
    if (!isKept(day, today)) continue
    let rung
    try {
      rung = rungOf(id, content).rung
    } catch (error) {
      if (error instanceof RangeError) continue
      throw error
    }
    purchases.push({
      key: `achat-${day}-${id}`,
      day,
      title: dreamLabel(DREAM_MEMO.bought, rung.name),
      choice: formatBriefMoney(cost),
      result: isCompany(rung)
        ? `Payé par l'entreprise · Équipement au bilan${COLON} +${formatBriefMoney(cost)}`
        : "Payé par vous · ne touche pas l'entreprise",
    })
  }
  // Both lists are newest first; a purchase goes after its day's events.
  const merged: EventLogEntry[] = []
  const newest = purchases.reverse()
  let next = 0
  for (const event of events) {
    while (next < newest.length && newest[next]!.day > event.day) {
      merged.push(newest[next]!)
      next += 1
    }
    merged.push(event)
  }
  return [...merged, ...newest.slice(next)]
}
