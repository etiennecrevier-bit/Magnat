import type { PlaceEffect, PlaceId } from '../content/schema.ts'
import { toCalendar } from '../engine/calendar.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { startOfDay } from '../engine/effects.ts'
import { isLoanOpen } from '../engine/financing.ts'
import {
  PLACES,
  placeOf,
  stayRefusal,
  todaysTrip,
  tripRefusal,
  tripTime,
  type TripRefusal,
} from '../engine/places.ts'
import { streetOn } from '../engine/street.ts'
import type { GameState } from '../engine/types.ts'
import type { StatusLine } from './productFacts.ts'
import type { TipContent, TipRow } from './tooltip.ts'

// What the « Aller à… » panel shows (#164): each place in town, how long
// the trip takes, whether the truck closes meanwhile, and whether the owner
// may go today. The engine sends the owner (src/engine/places.ts); this
// only reads the game.

// French puts a no-break space (U+00A0) before a colon and a percent sign,
// and between a number and its unit.
const COLON = ' :'
const PERCENT = ' %'
const NBSP = ' '

// A calendar fact, not a tunable.
const MINUTES_PER_HOUR = 60

/** A place, as the panel shows it. */
export interface PlaceRow {
  readonly id: PlaceId
  readonly name: string
  /** What the owner does there. */
  readonly does: string
  /** What the trip gives, as a plain fact; null when nothing. */
  readonly gives: string | null
  /** « Trajet : 25 min · visite : 30 min », or « Toute la journée ». */
  readonly time: string
  /** « Départ 10 h · retour 11 h 20 »; null for a whole day. */
  readonly schedule: string | null
  /**
   * Whether the truck serves nobody while the owner is there: it opens
   * today, and no employee works at it.
   */
  readonly closesTruck: boolean
  /** Whether it is today's trip, chosen or booked by a card. */
  readonly chosen: boolean
  /**
   * Why the owner cannot go there today, or, for today's trip, cannot
   * stay at the truck instead; null when they can.
   */
  readonly refusal: string | null
}

/** The « Aller à… » panel. */
export interface TripBoard {
  /** The places, in the content's order. */
  readonly rows: readonly PlaceRow[]
  /**
   * Today's trip, chosen or booked by a card (see `todaysTrip`); null when
   * the owner stays at the truck.
   */
  readonly trip: PlaceId | null
}

/** The panel on the morning of `game.day`. */
export function tripBoard(game: GameState): TripBoard {
  const closesTruck =
    opensToday(game) &&
    !game.decisions.staff.some(({ role }) => role === 'camion')
  const trip = todaysTrip(game)
  return {
    trip,
    rows: PLACES.places.map((place): PlaceRow => {
      const time = tripTime(place.id, game.dream)
      const chosen = trip === place.id
      const refusal = chosen ? stayRefusal(game) : tripRefusal(game, place.id)
      return {
        id: place.id,
        name: place.name,
        does: place.does,
        gives: givesLine(place.effect),
        time: time.wholeDay
          ? 'Toute la journée'
          : `Trajet${COLON} ${time.legMinutes}${NBSP}min · visite${COLON} ${time.visitMinutes}${NBSP}min`,
        schedule: time.wholeDay
          ? null
          : `Départ ${clockTime(time.leavesAtMinute)} · retour ${clockTime(time.backAtMinute)}`,
        closesTruck,
        chosen,
        refusal: refusal === null ? null : refusalLine(game, refusal),
      }
    }),
  }
}

/**
 * « En route vers la Caisse » while the day has a trip, chosen or booked
 * by a card (see `todaysTrip`); null otherwise.
 */
export function enRouteLine(
  game: Pick<GameState, 'day' | 'events' | 'town'>,
): string | null {
  const trip = todaysTrip(game)
  return trip === null ? null : `En route vers ${placeOf(trip).towards}`
}

/** A minute of the day as a clock reads it: 600 is « 10 h », 680 « 11 h 20 ». */
export function clockTime(minute: number): string {
  const hours = Math.floor(minute / MINUTES_PER_HOUR)
  const minutes = minute % MINUTES_PER_HOUR
  return minutes === 0
    ? `${hours}${NBSP}h`
    : `${hours}${NBSP}h${NBSP}${String(minutes).padStart(2, '0')}`
}

/**
 * Whether the truck opens on the morning of `game.day` with the owner at
 * it: a day open, which no change to the street closes, as the engine
 * starts the day (see `startOfDay`).
 */
function opensToday(game: GameState): boolean {
  const started = startOfDay(game, FOOD_TRUCK)
  const { weekday } = toCalendar(started.day)
  return (
    started.decisions.daysOpen.includes(weekday) &&
    !streetOn(started.events.modifiers, started.day).closed
  )
}

/** What going to a place gives, as a plain fact. */
function givesLine(effect: PlaceEffect): string | null {
  switch (effect.kind) {
    case 'loanAppointment':
      return 'Son offre de prêt arrive demain matin'
    case 'discount':
      return `−${Math.round(effect.share * 100)}${PERCENT} sur le prochain achat de marchandises`
    case 'filing':
    case 'none':
      return null
  }
}

/** Why the owner cannot go, as the player reads it. */
export function refusalLine(game: GameState, refusal: TripRefusal): string {
  switch (refusal) {
    case 'defi':
      return 'Pas pendant un défi'
    case 'ended':
      return 'La partie est terminée'
    case 'played':
      return 'La journée est jouée'
    case 'booked':
      return 'Déplacement obligatoire'
    case 'nothingToFile':
      return 'Rien à déposer'
    case 'came':
      return 'Déjà reçu cette année'
    case 'mayNotLend':
      return game.financing.loans.some((loan) => isLoanOpen(loan, game.day))
        ? 'Un prêt déjà en cours'
        : "Un seul prêt d'urgence"
    case 'noNeed':
      return 'Votre encaisse suffit'
  }
}

/**
 * What a place's tooltip says: what the owner does there, what it gives
 * and when they leave and come back.
 */
export function placeTip({
  name,
  does,
  gives,
  schedule,
}: PlaceRow): TipContent {
  const rows: TipRow[] = []
  if (gives !== null) rows.push({ label: 'Ce que ça donne', value: gives })
  if (schedule !== null) rows.push({ label: 'Horaire', value: schedule })
  return { title: name, text: does, rows }
}

/**
 * A place's one status line: why the owner cannot go, or, when they can,
 * that nobody serves at the truck meanwhile.
 */
export function placeLine({ refusal, closesTruck }: PlaceRow): StatusLine {
  if (refusal !== null) {
    return { fact: { tone: 'off', text: refusal }, tomorrow: null }
  }
  if (closesTruck) {
    return {
      fact: { tone: 'warn', text: 'Fermé pendant ce temps' },
      tomorrow: null,
    }
  }
  return { fact: null, tomorrow: null }
}
