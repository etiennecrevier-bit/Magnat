import { describe, expect, it } from 'vitest'
import { ASSETS } from './manifest.ts'
import {
  createSnow,
  fallFlakes,
  flakeAt,
  makeFlakes,
  type Area,
  type SnowSettings,
} from './snow.ts'

const SNOW: SnowSettings = ASSETS.districtStreets.vieuxMontreal!.snow
const AREA: Area = { left: -200, right: 1640, top: -100, bottom: 900 }

/** A `random` going through `values` over and over. */
function cycling(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('the falling snow (#264)', () => {
  it('makes its flakes within the ranges of its settings', () => {
    const flakes = makeFlakes(SNOW, Math.random)
    expect(flakes).toHaveLength(SNOW.count)
    for (const flake of flakes) {
      expect(flake.radius).toBeGreaterThanOrEqual(SNOW.radius.min)
      expect(flake.radius).toBeLessThanOrEqual(SNOW.radius.max)
      expect(flake.opacity).toBeGreaterThanOrEqual(SNOW.opacity.min)
      expect(flake.opacity).toBeLessThanOrEqual(SNOW.opacity.max)
      expect(flake.fall).toBeGreaterThanOrEqual(SNOW.fall.min)
      expect(flake.fall).toBeLessThanOrEqual(SNOW.fall.max)
      expect(flake.x).toBeGreaterThanOrEqual(0)
      expect(flake.x).toBeLessThan(1)
    }
  })

  it('falls at its speed, a real second at a time, and comes back in at the top', () => {
    const [flake] = makeFlakes({ ...SNOW, count: 1 }, cycling(0.5))
    const height = AREA.bottom - AREA.top
    const start = flake!.y
    fallFlakes([flake!], 1000, AREA)
    expect(flake!.y - start).toBeCloseTo(flake!.fall / height)
    flake!.y = 0.999
    fallFlakes([flake!], 1000, AREA)
    expect(flake!.y).toBeLessThan(0.5)
    expect(flake!.y).toBeGreaterThanOrEqual(0)
  })

  it('stands still without time, as on pause', () => {
    const flakes = makeFlakes(SNOW, Math.random)
    const before = flakes.map(({ y }) => y)
    fallFlakes(flakes, 0, AREA)
    expect(flakes.map(({ y }) => y)).toEqual(before)
  })

  it('stays over the part of the street on screen, however it sways', () => {
    for (const flake of makeFlakes(SNOW, Math.random)) {
      for (const ms of [0, 1250, 2500, 99_999]) {
        const { x, y } = flakeAt(flake, AREA, ms, SNOW)
        expect(x).toBeGreaterThanOrEqual(AREA.left)
        expect(x).toBeLessThan(AREA.right)
        expect(y).toBeGreaterThanOrEqual(AREA.top)
        expect(y).toBeLessThanOrEqual(AREA.bottom)
      }
    }
  })

  it('sways by its drift each way, once a sway', () => {
    const [flake] = makeFlakes(
      { ...SNOW, count: 1 },
      cycling(0.5, 0.5, 0.5, 0.5, 0.5, 0),
    )
    flake!.x = 0.5
    const xAt = (ms: number) => flakeAt(flake!, AREA, ms, SNOW).x
    const middle = AREA.left + 0.5 * (AREA.right - AREA.left)
    expect(xAt(0)).toBeCloseTo(middle)
    expect(xAt(SNOW.driftMs / 4)).toBeCloseTo(middle + SNOW.drift)
    expect(xAt((3 * SNOW.driftMs) / 4)).toBeCloseTo(middle - SNOW.drift)
  })

  it('shows in winter with the full visual effects only, and moves only then', () => {
    const snow = createSnow(SNOW, '#FFFFFF', Math.random)
    expect(snow.root.particleChildren).toHaveLength(SNOW.count)
    expect(snow.root.visible).toBe(false)
    snow.show(true)
    expect(snow.root.visible).toBe(true)
    snow.frame(16, AREA)
    const at = snow.root.particleChildren.map(({ x, y }) => [x, y])
    snow.setEffects('simple')
    expect(snow.root.visible).toBe(false)
    snow.frame(1000, AREA)
    expect(snow.root.particleChildren.map(({ x, y }) => [x, y])).toEqual(at)
    snow.setEffects('full')
    snow.frame(1000, AREA)
    expect(snow.root.particleChildren.map(({ x, y }) => [x, y])).not.toEqual(at)
    snow.show(false)
    expect(snow.root.visible).toBe(false)
    snow.destroy()
  })
})
