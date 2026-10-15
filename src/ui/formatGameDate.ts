import { toCalendar, type CalendarDate } from '../engine/clock.ts'
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

/** The day and month, e.g. `1er mai`. */
function dayAndMonth({ month, dayOfMonth }: CalendarDate): string {
  const dayLabel = dayOfMonth === 1 ? '1er' : String(dayOfMonth)
  return `${dayLabel} ${nameAt(MONTHS, month)}`
}

function shortDate(date: CalendarDate): string {
  return `${dayAndMonth(date)}, an ${date.year}`
}

/** French (Quebec) long date for a game day, e.g. `Lundi 1er mai, an 1`. */
export function formatGameDate(day: Day): string {
  const date = toCalendar(day)
  return `${nameAt(WEEKDAYS, date.weekday)} ${shortDate(date)}`
}

/** French (Quebec) date without the weekday, e.g. `1er mai, an 1`. */
export function formatShortGameDate(day: Day): string {
  return shortDate(toCalendar(day))
}

/** French (Quebec) day of the month and month, e.g. `1er mai`. */
export function formatDayAndMonth(day: Day): string {
  return dayAndMonth(toCalendar(day))
}

/** The weekday of a game day, in lower case as in a sentence: `jeudi`. */
export function formatWeekdayName(day: Day): string {
  return nameAt(WEEKDAYS, toCalendar(day).weekday).toLowerCase()
}

/** French (Quebec) month and year of a game day, e.g. `Mai, an 1`. */
export function formatGameMonth(day: Day): string {
  const { month, year } = toCalendar(day)
  const name = nameAt(MONTHS, month)
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}, an ${year}`
}

/**
 * A period from `fromDay` to `toDay`, both included, e.g. `Du 1er mai au
 * 31 mai, an 1`, or `Le 1er juin, an 1` for a single day. The year shows
 * once when both days share it.
 */
export function formatGamePeriod(fromDay: Day, toDay: Day): string {
  const from = toCalendar(fromDay)
  const to = toCalendar(toDay)
  if (fromDay === toDay) return `Le ${shortDate(to)}`
  const fromText = from.year === to.year ? dayAndMonth(from) : shortDate(from)
  return `Du ${fromText} au ${shortDate(to)}`
}
