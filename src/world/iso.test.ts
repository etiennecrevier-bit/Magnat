import { describe, expect, it } from 'vitest'
import {
  boxCorners,
  castShadow,
  convexHull,
  depthAmong,
  inFront,
  inside,
  rankBoxes,
  silhouette,
  type Vec,
} from './iso.ts'

// A box 200 across, its lit wall 120 of it, its walls 60 tall: 160 tall on
// screen with its footprint, from 100, 100.
const BOX = { x: 100, y: 100, width: 200, height: 160, depth: 120 }

describe('boxCorners', () => {
  it('puts the front corner at the foot of the box, its lit wall depth across', () => {
    expect(boxCorners(BOX)).toEqual({
      left: [100, 200],
      front: [220, 260],
      right: [300, 220],
      back: [180, 160],
      wall: 60,
    })
  })

  it('runs both walls at half a pixel down or up a pixel across', () => {
    const { left, front, right, back } = boxCorners(BOX)
    const slope = (a: Vec, b: Vec) => (b[1] - a[1]) / (b[0] - a[0])
    expect(slope(left, front)).toBe(0.5)
    expect(slope(front, right)).toBe(-0.5)
    expect(slope(back, right)).toBe(0.5)
    expect(slope(left, back)).toBe(-0.5)
  })

  it('lays a flat piece, half as tall as wide, on the ground', () => {
    expect(boxCorners({ ...BOX, height: 100 }).wall).toBe(0)
  })
})

describe('silhouette', () => {
  it('covers the walls and the roof, from the left foot round by the top', () => {
    expect(silhouette(boxCorners(BOX))).toEqual([
      [100, 200],
      [100, 140],
      [180, 100],
      [300, 160],
      [300, 220],
      [220, 260],
    ])
  })
})

describe('castShadow', () => {
  it('reaches from the footprint to the lower right, by the height of the walls', () => {
    const shadow = castShadow(boxCorners(BOX), 0.5, 0.1)
    // The roof's footprint thrown 30 right and 6 down.
    expect(shadow).toEqual(
      expect.arrayContaining([
        [100, 200],
        [250, 266],
        [330, 226],
        [210, 166],
      ]),
    )
    // The rest of the footprint is under it.
    const covered = (point: Vec) =>
      inside(point, shadow) ||
      shadow.some(([x, y]) => x === point[0] && y === point[1])
    expect(covered([220, 260])).toBe(true)
    expect(covered([180, 160])).toBe(true)
  })

  it('casts nothing past the footprint for a flat piece', () => {
    const flat = boxCorners({ ...BOX, height: 100 })
    expect(convexHull(castShadow(flat, 0.5, 0.1))).toHaveLength(4)
  })
})

describe('inside', () => {
  const square: Vec[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ]

  it('finds a point within a shape, and not one outside', () => {
    expect(inside([5, 5], square)).toBe(true)
    expect(inside([15, 5], square)).toBe(false)
    expect(inside([5, -1], square)).toBe(false)
  })
})

describe('inFront', () => {
  const box = boxCorners(BOX)

  it('puts someone past either wall in front, and someone behind both behind', () => {
    // Down from the middle of the lit wall, and of the shaded one.
    expect(inFront([160, 240], box)).toBe(true)
    expect(inFront([260, 250], box)).toBe(true)
    // Up from the roof, behind the box.
    expect(inFront([200, 150], box)).toBe(false)
    expect(inFront([200, 200], box)).toBe(false)
  })
})

describe('rankBoxes', () => {
  it('draws the boxes from the top of the screen down, by their middle', () => {
    const near = { id: 'near', corners: boxCorners({ ...BOX, y: 300 }) }
    const far = { id: 'far', corners: boxCorners(BOX) }
    const ranked = rankBoxes([near, far])
    expect(ranked.get('far')?.rank).toBe(0)
    expect(ranked.get('near')?.rank).toBe(1)
    expect(ranked.get('far')).toMatchObject({ left: 100, right: 300 })
  })
})

describe('depthAmong', () => {
  const ranked = rankBoxes([
    { id: 'far', corners: boxCorners(BOX) },
    { id: 'near', corners: boxCorners({ ...BOX, y: 300 }) },
  ])
  const boxes = [...ranked.values()]

  it('draws someone walking past a building behind it, then in front of it', () => {
    // Along a street from behind the far box, round its front.
    const behind = depthAmong([200, 150], boxes, 5)
    const before = depthAmong([160, 240], boxes, 5)
    expect(behind).toBeLessThan(ranked.get('far')!.rank)
    expect(before).toBeGreaterThan(ranked.get('far')!.rank)
    // Still behind the near box, which stands in front of them.
    expect(before).toBeLessThan(ranked.get('near')!.rank)
  })

  it('leaves the boxes across from nobody out', () => {
    expect(depthAmong([600, 900], boxes, 5)).toBe(-0.5)
  })
})
