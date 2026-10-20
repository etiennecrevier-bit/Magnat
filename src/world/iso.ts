import type { CityPiece } from '../content/assets.ts'

// The geometry of the city's boxes in 2:1 isometric, on the design's
// pixels: where a box's corners fall, the shape it covers on screen, the
// shadow it casts and whether someone standing on the ground is in front
// of it. Pure, so the rules are tested without Pixi.

/** A point on screen, `[x, y]`. */
export type Vec = readonly [number, number]

/** Where a box stands: its corners on the ground, and how tall its walls are. */
export interface BoxCorners {
  /** The corner farthest left, where the lit wall starts. */
  readonly left: Vec
  /** The corner nearest the viewer, between the lit and the shaded wall. */
  readonly front: Vec
  /** The corner farthest right, where the shaded wall ends. */
  readonly right: Vec
  /** The corner farthest from the viewer, hidden behind the box. */
  readonly back: Vec
  /** How tall its walls stand. */
  readonly wall: number
}

/** The size of a box piece, as the manifest gives it. */
export type BoxSize = Pick<CityPiece, 'x' | 'y' | 'width' | 'height' | 'depth'>

/**
 * The corners of the box `piece` on the ground: its lit wall `depth` across
 * from the left corner to the front one, at the foot of its box on screen,
 * then its shaded wall to the right corner. Its walls stand `height` −
 * `width` / 2 tall. A piece without a depth is a square box.
 */
export function boxCorners(piece: BoxSize): BoxCorners {
  const { x, y, width: w, height: h } = piece
  const d = piece.depth ?? w / 2
  const foot = y + h
  return {
    left: [x, foot - d / 2],
    front: [x + d, foot],
    right: [x + w, foot - (w - d) / 2],
    back: [x + w - d, foot - w / 2],
    wall: Math.max(0, h - w / 2),
  }
}

/** `point` raised by `height`. */
export function raised([x, y]: Vec, height: number): Vec {
  return [x, y - height]
}

/** The ground the box covers, from its left corner round the front. */
export function footprint(box: BoxCorners): Vec[] {
  return [box.left, box.front, box.right, box.back]
}

/**
 * What the box covers on screen: its two walls and its roof, from the foot
 * of its left corner round by the top.
 */
export function silhouette(box: BoxCorners): Vec[] {
  const { left, front, right, back, wall } = box
  return [
    left,
    raised(left, wall),
    raised(back, wall),
    raised(right, wall),
    right,
    front,
  ]
}

/**
 * The shadow the box casts on the ground, away from the sun: its footprint
 * and the footprint of its roof thrown `reach` of its height right and
 * `drop` of it down, joined into one shape.
 */
export function castShadow(
  box: BoxCorners,
  reach: number,
  drop: number,
): Vec[] {
  const dx = box.wall * reach
  const dy = box.wall * drop
  const ground = footprint(box)
  return convexHull([
    ...ground,
    ...ground.map(([x, y]): Vec => [x + dx, y + dy]),
  ])
}

/** The smallest convex shape holding `points`, round from the lowest x. */
export function convexHull(points: readonly Vec[]): Vec[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o: Vec, a: Vec, b: Vec) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: readonly Vec[]) => {
    const kept: Vec[] = []
    for (const point of list) {
      while (
        kept.length >= 2 &&
        cross(kept[kept.length - 2]!, kept[kept.length - 1]!, point) <= 0
      ) {
        kept.pop()
      }
      kept.push(point)
    }
    kept.pop()
    return kept
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/** Whether `point` is inside the shape `polygon`, its edge included or not. */
export function inside([x, y]: Vec, polygon: readonly Vec[]): boolean {
  let within = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      within = !within
    }
  }
  return within
}

/**
 * Whether someone standing at `point` on the ground is in front of the box,
 * nearer the viewer: past the line of its lit wall or past that of its
 * shaded wall. Someone who is not is behind it, where it hides them.
 */
export function inFront([x, y]: Vec, box: BoxCorners): boolean {
  const { left, front } = box
  // Both walls' lines run at half a pixel down or up per pixel across.
  const litLine = left[1] + (x - left[0]) / 2
  const shadeLine = front[1] - (x - front[0]) / 2
  return y > litLine || y > shadeLine
}

/** A box among others, in the order they are drawn, farthest first. */
export interface RankedBox {
  /** Its place in that order: higher is drawn later, nearer the viewer. */
  readonly rank: number
  readonly corners: BoxCorners
  /** How far across the screen it reaches. */
  readonly left: number
  readonly right: number
}

/**
 * The boxes in the order they are drawn: by the middle of their footprint,
 * from the top of the screen down, so the farthest first; boxes level keep
 * their order in `boxes`.
 */
export function rankBoxes(
  boxes: readonly { readonly id: string; readonly corners: BoxCorners }[],
): Map<string, RankedBox> {
  const middle = ({ corners }: (typeof boxes)[number]) =>
    (corners.left[1] + corners.right[1]) / 2
  const ordered = [...boxes].sort((a, b) => middle(a) - middle(b))
  return new Map(
    ordered.map((box, rank) => [
      box.id,
      {
        rank,
        corners: box.corners,
        left: box.corners.left[0],
        right: box.corners.right[0],
      },
    ]),
  )
}

/**
 * Where among `boxes` to draw someone standing at `point`, `halfWidth`
 * wide each side: just after the nearest box across from them they stand in
 * front of, so the boxes they stand behind hide them. Half a rank, so they
 * never tie with a box.
 */
export function depthAmong(
  point: Vec,
  boxes: Iterable<RankedBox>,
  halfWidth: number,
): number {
  let depth = -1
  for (const box of boxes) {
    if (point[0] + halfWidth < box.left || point[0] - halfWidth > box.right) {
      continue
    }
    if (inFront(point, box.corners)) depth = Math.max(depth, box.rank)
  }
  return depth + 0.5
}
