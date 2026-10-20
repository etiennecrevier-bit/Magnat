import type { Vec } from './iso.ts'

// A way through the city: a line through points, in the design's pixels,
// that the owner walks and the van drives along. Pure, so it is tested
// without Pixi.

/** A length too small to draw: what floats leave of a run to its end. */
const EPSILON = 1e-9

/** How long the way through `points` is. */
export function routeLength(points: readonly Vec[]): number {
  let length = 0
  for (let i = 1; i < points.length; i += 1) {
    length += distance(points[i - 1]!, points[i]!)
  }
  return length
}

/**
 * The point `share` of the way along `points`, from 0 at the first point to
 * 1 at the last; a share outside those stays at that end.
 */
export function pointAlong(points: readonly Vec[], share: number): Vec {
  const first = points[0]
  if (first === undefined) throw new RangeError('A route needs a point')
  let left = Math.min(1, Math.max(0, share)) * routeLength(points)
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!
    const to = points[i]!
    const step = distance(from, to)
    if (left <= step && step > 0) {
      const t = left / step
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
    }
    left -= step
  }
  return points[points.length - 1]!
}

/**
 * The dashes of a dashed line along `points`: `dash` long, `gap` apart,
 * from the first point, each as its start and end. A dash runs on round a
 * corner as two pieces, so the pattern keeps its pace.
 */
export function dashesOf(
  points: readonly Vec[],
  dash: number,
  gap: number,
): [Vec, Vec][] {
  const dashes: [Vec, Vec][] = []
  // Whether the walk is in a dash or a gap, and how much of it is left.
  let drawing = true
  let left = dash
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!
    const to = points[i]!
    const step = distance(from, to)
    const at = (t: number): Vec => [
      from[0] + ((to[0] - from[0]) * t) / step,
      from[1] + ((to[1] - from[1]) * t) / step,
    ]
    let t = 0
    while (step - t > EPSILON) {
      const run = Math.min(left, step - t)
      if (drawing) dashes.push([at(t), at(t + run)])
      t += run
      left -= run
      if (left <= EPSILON) {
        drawing = !drawing
        left = drawing ? dash : gap
      }
    }
  }
  return dashes
}

/** `points` the other way round. */
export function reversed(points: readonly Vec[]): Vec[] {
  return [...points].reverse()
}

function distance(a: Vec, b: Vec): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}
