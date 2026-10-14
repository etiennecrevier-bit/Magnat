import { toCalendar } from '../engine/clock.ts'
import type { Day } from '../engine/types.ts'

// The game calendar is not a real one (no leap years, year 1 starts on a
// Monday), so the names come from fixed tables rather than Intl.DateTimeFormat.
const WEEKDAYS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const
const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const

function nameAt(names: readonly string[], oneBasedIndex: number): string {
  const name = names[oneBasedIndex - 1]
  if (name === undefined) {
    throw new RangeError(`No name for calendar index ${oneBasedIndex}`)
  }
  return name
}

/** French (Quebec) long date for a game day, e.g. `Lundi 1er mai, an 1`. */
export function formatGameDate(day: Day): string {
  const { year, month, dayOfMonth, weekday } = toCalendar(day)
  const dayLabel = dayOfMonth === 1 ? '1er' : String(dayOfMonth)
  return `${nameAt(WEEKDAYS, weekday)} ${dayLabel} ${nameAt(MONTHS, month)}, an ${year}`
}
