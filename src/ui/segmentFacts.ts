import type { SegmentId } from '../content/schema.ts'
import { SEGMENTS } from '../engine/customers.ts'
import { perProduct } from '../engine/inventory.ts'
import type { DaySummary, PerProduct } from '../engine/types.ts'

/** What one segment, or all of them, did at the truck on a day. */
export interface SegmentFacts {
  /** Units sold to the segment. */
  readonly sold: PerProduct
  /** Visits that bought nothing because a price was above what they pay. */
  readonly tooExpensive: number
  /** Visits that bought nothing because what they wanted had sold out. */
  readonly soldOut: number
}

/** A day's facts for each segment, in content order, and for all of them. */
export interface DayFacts {
  readonly segments: readonly {
    readonly segment: SegmentId
    readonly facts: SegmentFacts
  }[]
  readonly total: SegmentFacts
}

/**
 * The facts the « Gérer le camion » panel shows for `day`, by segment: the
 * units sold, summed from the visits, and the visits that left without
 * buying because of a price or a stockout.
 */
export function segmentFacts(day: DaySummary): DayFacts {
  const segments = SEGMENTS.map((segment) => {
    const visits = day.visits.filter((visit) => visit.segment === segment)
    const { tooExpensive, soldOut } = day.segments[segment]
    const sold = perProduct((product) =>
      visits.reduce((units, visit) => units + visit.bought[product], 0),
    )
    return { segment, facts: { sold, tooExpensive, soldOut } }
  })
  const sum = (count: (facts: SegmentFacts) => number) =>
    segments.reduce((total, { facts }) => total + count(facts), 0)
  return {
    segments,
    total: {
      sold: perProduct((product) => sum((facts) => facts.sold[product])),
      tooExpensive: sum((facts) => facts.tooExpensive),
      soldOut: sum((facts) => facts.soldOut),
    },
  }
}
