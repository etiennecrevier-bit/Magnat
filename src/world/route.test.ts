import { describe, expect, it } from 'vitest'
import type { Vec } from './iso.ts'
import { dashesOf, pointAlong, reversed, routeLength } from './route.ts'

// Right 30, then down 40: 70 long.
const ROUTE: Vec[] = [
  [0, 0],
  [30, 0],
  [30, 40],
]

describe('routeLength', () => {
  it('adds up each step', () => {
    expect(routeLength(ROUTE)).toBe(70)
    expect(routeLength([[5, 5]])).toBe(0)
  })
})

describe('pointAlong', () => {
  it('walks the way by its length, round its corners', () => {
    expect(pointAlong(ROUTE, 0)).toEqual([0, 0])
    expect(pointAlong(ROUTE, 3 / 7)).toEqual([30, 0])
    expect(pointAlong(ROUTE, 0.5)).toEqual([30, 5])
    expect(pointAlong(ROUTE, 1)).toEqual([30, 40])
  })

  it('stays at its ends past them', () => {
    expect(pointAlong(ROUTE, -1)).toEqual([0, 0])
    expect(pointAlong(ROUTE, 2)).toEqual([30, 40])
  })

  it('needs a point', () => {
    expect(() => pointAlong([], 0.5)).toThrow(RangeError)
  })
})

describe('dashesOf', () => {
  it('dashes the way, keeping the pace round a corner', () => {
    expect(dashesOf(ROUTE, 10, 10)).toEqual([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [20, 0],
        [30, 0],
      ],
      [
        [30, 10],
        [30, 20],
      ],
      [
        [30, 30],
        [30, 40],
      ],
    ])
  })

  it('runs a dash on round a corner as two pieces', () => {
    const dashes = dashesOf(ROUTE, 20, 5)
    expect(dashes[1]).toEqual([
      [25, 0],
      [30, 0],
    ])
    expect(dashes[2]).toEqual([
      [30, 0],
      [30, 15],
    ])
  })

  it('draws nothing on a way without length', () => {
    expect(dashesOf([[1, 1]], 10, 5)).toEqual([])
  })
})

describe('reversed', () => {
  it('turns the way round without changing it', () => {
    const route = [...ROUTE]
    expect(reversed(route)).toEqual([...ROUTE].reverse())
    expect(route).toEqual(ROUTE)
  })
})
