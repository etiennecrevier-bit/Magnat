import type { GrocerId } from '../content/schema.ts'
import type { Point } from './customerCard.ts'
import type { Picker } from './picker.ts'

// The bridge between the page, where the player presses, and the city,
// which knows where its buildings are drawn: as `PICKER` is the street's.
// The city reports what a click opens; the UI opens it. It hears where the
// pointer is, to name the building under it. Either side can come and go: a
// press before the city starts, or after it stops, does nothing.

/**
 * What a click on a building opens, as the city reports it to the page: a
 * grocer's shop names its grocer, so the page can show that grocer's card.
 */
export type CityLink =
  'trip' | 'fournil' | 'contracts' | { readonly grocer: GrocerId }

/** What the city does when the page presses it: the city's side. */
export interface CityTarget {
  /** Opens what the building drawn at `point` on the page opens, if any. */
  openAt: (point: Point) => void
  /** Whether a building that opens something is drawn at `point`. */
  isOver: (point: Point) => boolean
  /**
   * The pointer is at `point` on the page over the world, or, with null,
   * elsewhere: the city names the building there that opens something.
   */
  hoverAt: (point: Point | null) => void
}

export interface CityPicker {
  /** The player pressed the city at `point`. */
  at: (point: Point) => void
  /** Whether a building that opens something is drawn at `point`. */
  over: (point: Point) => boolean
  /** The pointer is at `point` over the world, or elsewhere with null. */
  hover: (point: Point | null) => void
  /**
   * Hands the picker to `city`, as `Picker.connect` does: the latest to
   * connect holds it, and when it lets go the one before it, if still
   * connected, holds it again. A city that stops holding it hears the
   * pointer is gone. Returns the function that lets go, which does nothing
   * the second time.
   */
  connect: (city: CityTarget) => () => void
}

export function createCityPicker(): CityPicker {
  const cities: { readonly target: CityTarget }[] = []
  const holder = () => cities.at(-1)?.target
  return {
    at: (point) => holder()?.openAt(point),
    over: (point) => holder()?.isOver(point) ?? false,
    hover: (point) => holder()?.hoverAt(point),
    connect: (target) => {
      const link = { target }
      holder()?.hoverAt(null)
      cities.push(link)
      return () => {
        const at = cities.indexOf(link)
        if (at < 0) return
        if (at === cities.length - 1) target.hoverAt(null)
        cities.splice(at, 1)
      }
    },
  }
}

/** The picker the page and the city share, as `PICKER` is the street's. */
export const CITY: CityPicker = createCityPicker()

/**
 * What a press on the world goes to: the street's customers and spots and
 * the city's buildings, each acting only while its scene holds its picker.
 * Only the street has a card to close; both hear where the pointer is, the
 * street to mark the spot under it, the city to name the building.
 */
export function worldPicks(
  street: Pick<Picker, 'at' | 'over' | 'close' | 'hover'>,
  city: Pick<CityPicker, 'at' | 'over' | 'hover'>,
): Pick<Picker, 'at' | 'over' | 'close' | 'hover'> {
  return {
    at: (point) => {
      street.at(point)
      city.at(point)
    },
    over: (point) => street.over(point) || city.over(point),
    close: () => street.close(),
    hover: (point) => {
      street.hover(point)
      city.hover(point)
    },
  }
}
