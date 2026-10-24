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
const SHORT_WEEKDAYS = [
  'lun.',
  'mar.',
  'mer.',
  'jeu.',
  'ven.',
  'sam.',
  'dim.',
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

/** The day of the month, e.g. `1er` or `12`. */
function dayNumber({ dayOfMonth }: CalendarDate): string {
  return dayOfMonth === 1 ? '1er' : String(dayOfMonth)
}

/** The day and month, e.g. `1er mai`. */
function dayAndMonth(date: CalendarDate): string {
  return `${dayNumber(date)} ${nameAt(MONTHS, date.month)}`
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

/** French (Quebec) day of the month alone, e.g. `1er` or `12`. */
export function formatDayOfMonth(day: Day): string {
  return dayNumber(toCalendar(day))
}

/** French (Quebec) day of the month and month, e.g. `1er mai`. */
export function formatDayAndMonth(day: Day): string {
  return dayAndMonth(toCalendar(day))
}

/** A month's name in lower case, `juin`, from its number (1 = January). */
export function formatMonthName(month: number): string {
  return nameAt(MONTHS, month)
}

/**
 * A date of every year, `1er décembre`, from its month (1 = January) and
 * its day of the month.
 */
export function formatMonthDay({
  month,
  day,
}: {
  readonly month: number
  readonly day: number
}): string {
  return dayAndMonth({ year: 1, month, dayOfMonth: day, weekday: 1 })
}

/** The weekday of a game day, in lower case as in a sentence: `jeudi`. */
export function formatWeekdayName(day: Day): string {
  return nameAt(WEEKDAYS, toCalendar(day).weekday).toLowerCase()
}

/** The short weekday of a game day, as a chart labels it: `lun.`. */
export function formatShortWeekdayName(day: Day): string {
  return nameAt(SHORT_WEEKDAYS, toCalendar(day).weekday)
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
