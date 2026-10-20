import type { AssetManifest, Spot, SpotOpens } from '../content/assets.ts'
import type { GameState } from '../engine/types.ts'
import { DOCK_ITEMS } from '../ui/dock.ts'
import type { StreetLegend } from '../ui/settings.ts'
import type { CityLink } from './cityPicker.ts'
import type { Point } from './customerCard.ts'
import { showsOn, type TruckView } from './truckView.ts'

// The street's hotspots (#208): the chalkboard, the croissant rack, the
// owner and the far city each open their panel, as the dock does. The street
// reports the click; the UI opens it (see src/ui/streetLinks.ts).

/** What a click on a spot of the street opens, as the street reports it. */
export type StreetLink = SpotOpens

/** Where the scene sits on the page: its scale, then its top-left corner. */
export interface Fit {
  readonly scale: number
  readonly x: number
  readonly y: number
}

/**
 * The spots of `manifest` the street shows in `view`: each with its piece,
 * or on the days its own `shows` says, or always. In a Défi, those that open
 * a dock button the Défi hides go too, as « Ville » does.
 */
export function spotsShown(
  manifest: Pick<AssetManifest, 'pieces' | 'spots'>,
  view: Pick<TruckView, 'open' | 'modifiers'>,
  inChallenge: boolean,
): readonly Spot[] {
  const pieces = new Map(manifest.pieces.map((piece) => [piece.id, piece]))
  return manifest.spots.filter((spot) => {
    if (inChallenge && hiddenInChallenge(spot.opens)) return false
    const shows =
      spot.piece === undefined ? spot.shows : pieces.get(spot.piece)?.shows
    return shows === undefined || showsOn(shows, view)
  })
}

function hiddenInChallenge(opens: SpotOpens): boolean {
  return DOCK_ITEMS.some(
    ({ id, hiddenInChallenge }) => id === opens.dock && hiddenInChallenge,
  )
}

/**
 * The spot at `point` of the design, edges included: the one listed last
 * when several hold it, as it is on top. Null when none does.
 */
export function spotAt(spots: readonly Spot[], point: Point): Spot | null {
  return (
    spots.findLast(
      (spot) =>
        point.x >= spot.x &&
        point.x <= spot.x + spot.width &&
        point.y >= spot.y &&
        point.y <= spot.y + spot.height,
    ) ?? null
  )
}

/** The point of the design drawn at `point` on the page. */
export function designPoint(point: Point, fit: Fit): Point {
  return { x: (point.x - fit.x) / fit.scale, y: (point.y - fit.y) / fit.scale }
}

/** The point of the page `point` of the design is drawn at. */
export function pagePoint(point: Point, fit: Fit): Point {
  return { x: fit.x + point.x * fit.scale, y: fit.y + point.y * fit.scale }
}

/** The outline round a spot the pointer is over, and its label, on the page. */
export interface SpotMark {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly label: string
  readonly detail: string
  /** Whether the label goes under the outline, not over it. */
  readonly below: boolean
}

/** Where `spot` is outlined on the page, the scene fitted so. */
export function spotMark(spot: Spot, fit: Fit): SpotMark {
  const { x: left, y: top } = pagePoint(spot, fit)
  return {
    left,
    top,
    width: spot.width * fit.scale,
    height: spot.height * fit.scale,
    label: spot.label,
    detail: spot.detail,
    below: spot.labelBelow === true,
  }
}

/** Whether two marks, or their absence, show the same. */
export function sameMark(a: SpotMark | null, b: SpotMark | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height &&
    a.label === b.label &&
    a.detail === b.detail &&
    a.below === b.below
  )
}

/**
 * Whether the street shows its legend in `game`: only in the game the
 * setting kept as the player's first, by its seed, and only for its first
 * `days` days (see src/ui/streetLegend.ts).
 */
export function legendShows(
  game: Pick<GameState, 'day' | 'seed'>,
  legend: StreetLegend,
  days: number,
): boolean {
  return (
    typeof legend === 'object' && legend.seed === game.seed && game.day < days
  )
}

/** What a click on the world opens: a building of the city or a spot of the street. */
export type WorldLink = CityLink | StreetLink
