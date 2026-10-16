import {
  streetChangeSchema,
  type ProductId,
  type SegmentId,
  type StreetModifierKind,
} from '../content/schema.ts'
import { SEGMENTS, perSegment, type CrowdChanges } from './customers.ts'
import { PRODUCTS } from './inventory.ts'
import type { Day, StreetModifier } from './types.ts'

// The street as the event cards change it for a while: construction cuts
// the crowd, a festival brings more, a heat wave kills the hot chocolate,
// the espresso machine breaks. Each change lasts its days, and the changes
// in effect on a day multiply each other.

/** Every kind of change to the street, in the order the content lists them. */
export const MODIFIER_KINDS: readonly StreetModifierKind[] =
  streetChangeSchema.options.map((option) => option.shape.kind.value)

/** The street on one day, every change in effect folded together. */
export interface Street extends CrowdChanges {
  /** The products that cannot be sold. */
  readonly unavailable: Readonly<Record<ProductId, boolean>>
  /** Whether the truck stays closed, whatever the days open. */
  readonly closed: boolean
  /** Whether the owner works the day away from the counter. */
  readonly working: boolean
}

/**
 * The modifiers in effect on `day`: those from `fromDay` to `lastDay`, both
 * included, in the order of `modifiers`.
 */
export function inEffect(
  modifiers: readonly StreetModifier[],
  day: Day,
): StreetModifier[] {
  return modifiers.filter(
    ({ fromDay, lastDay }) => fromDay <= day && day <= lastDay,
  )
}

/**
 * The street on `day` with the modifiers in effect that day. Each factor is
 * 1 unless a change multiplies it, and the factors of several multiply: a
 * change with no segment multiplies every segment's. A product one change
 * makes unavailable is, and one change closes the truck. The owner works
 * when one that closes it is for `work`.
 */
export function streetOn(
  modifiers: readonly StreetModifier[],
  day: Day,
): Street {
  const walkIns = perSegment(() => 1)
  const appeal = Object.fromEntries(
    PRODUCTS.map((product) => [product, 1]),
  ) as Record<ProductId, number>
  const willingness = perSegment(() => 1)
  const unavailable = Object.fromEntries(
    PRODUCTS.map((product) => [product, false]),
  ) as Record<ProductId, boolean>
  let closed = false
  let working = false
  for (const { change } of inEffect(modifiers, day)) {
    switch (change.kind) {
      case 'walkIns':
        for (const segment of segmentsOf(change.segment)) {
          walkIns[segment] *= change.factor
        }
        break
      case 'appeal':
        appeal[change.product] *= change.factor
        break
      case 'willingness':
        for (const segment of segmentsOf(change.segment)) {
          willingness[segment] *= change.factor
        }
        break
      case 'unavailable':
        unavailable[change.product] = true
        break
      case 'closed':
        closed = true
        if (change.work === true) working = true
        break
    }
  }
  return { walkIns, appeal, willingness, unavailable, closed, working }
}

/** `segment` alone, or every segment when a change names none. */
function segmentsOf(segment: SegmentId | undefined): readonly SegmentId[] {
  return segment === undefined ? SEGMENTS : [segment]
}
