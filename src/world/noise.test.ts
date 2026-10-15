import { describe, expect, it } from 'vitest'
import { ASSETS } from './manifest.ts'
import {
  brickPixels,
  glowAlpha,
  grainPixels,
  rampPixels,
  speckledPixels,
  spotPixels,
  strayOf,
  tilePixels,
  unevennessPixels,
  vignetteAlpha,
  vignettePixels,
  type Pixels,
} from './noise.ts'

const LIGHT = ASSETS.light
const { lineOpacity } = LIGHT.material

/** Each pixel's alpha, 0 to 1. */
function alphas({ data }: Pixels): number[] {
  return Array.from(
    { length: data.length / 4 },
    (_, i) => data[i * 4 + 3]! / 255,
  )
}

/** The average of the red channel over opaque pixels. */
function meanGrey({ data }: Pixels): number {
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += data[i]!
  return sum / (data.length / 4)
}

describe('the noise textures', () => {
  it('gives the same pixels for the same seed, other pixels for another', () => {
    expect(grainPixels(LIGHT.grain).data).toEqual(grainPixels(LIGHT.grain).data)
    expect(grainPixels({ ...LIGHT.grain, seed: 1 }).data).not.toEqual(
      grainPixels(LIGHT.grain).data,
    )
    expect(unevennessPixels(LIGHT.unevenness).data).toEqual(
      unevennessPixels(LIGHT.unevenness).data,
    )
    expect(unevennessPixels({ ...LIGHT.unevenness, seed: 1 }).data).not.toEqual(
      unevennessPixels(LIGHT.unevenness).data,
    )
  })

  it('keeps the grain fine and opaque around mid-grey, which an overlay leaves as is', () => {
    const grain = grainPixels(LIGHT.grain)
    expect(grain.width).toBe(LIGHT.grain.size)
    expect(grain.height).toBe(LIGHT.grain.size)
    expect(new Set(alphas(grain))).toEqual(new Set([1]))
    expect(meanGrey(grain)).toBeGreaterThan(124)
    expect(meanGrey(grain)).toBeLessThan(132)
    // The overlay's 40 % is in the texture, which strays from mid-grey by
    // that share of the amplitude at most (see strayOf).
    const reach = strayOf(LIGHT.grain.amplitude, LIGHT.grain.opacity)
    expect(reach).toBeCloseTo(LIGHT.grain.amplitude * 0.4 * 127)
    let furthest = 0
    for (let i = 0; i < grain.data.length; i += 4) {
      furthest = Math.max(furthest, Math.abs(grain.data[i]! - 128))
    }
    expect(furthest).toBeLessThanOrEqual(reach + 1)
    expect(furthest).toBeGreaterThan(reach / 2)
  })

  it('paints the unevenness in a few large soft blotches around mid-grey', () => {
    const blotches = unevennessPixels(LIGHT.unevenness)
    expect(blotches.width).toBe(LIGHT.unevenness.cells * 8)
    expect(new Set(alphas(blotches))).toEqual(new Set([1]))
    expect(meanGrey(blotches)).toBeGreaterThan(100)
    expect(meanGrey(blotches)).toBeLessThan(156)
    // Soft: across a blotch's 8 pixels, the grey changes by a quarter of
    // its range at most from one pixel to the next.
    const { amplitude, opacity } = LIGHT.unevenness
    const steepest = (strayOf(amplitude, opacity) * 2 * 1.5) / 8
    for (let i = 4; i < blotches.width * 4; i += 4) {
      const step = Math.abs(blotches.data[i]! - blotches.data[i - 4]!)
      expect(step).toBeLessThanOrEqual(steepest + 1)
    }
  })
})

describe('the vignette', () => {
  const { vignette } = LIGHT

  it('is clear in the middle and inside 62 % of the radius', () => {
    expect(vignetteAlpha(0, 0, vignette)).toBe(0)
    const edge = vignette.clear * Math.SQRT2
    expect(
      vignetteAlpha(edge / Math.SQRT2, edge / Math.SQRT2, vignette),
    ).toBeCloseTo(0)
    expect(vignetteAlpha(0.6, 0, vignette)).toBe(0)
  })

  it('darkens to 26 % at the corners, more the further out', () => {
    expect(vignetteAlpha(1, 1, vignette)).toBeCloseTo(0.26)
    expect(vignetteAlpha(-1, 1, vignette)).toBeCloseTo(0.26)
    expect(vignetteAlpha(0.8, 0.8, vignette)).toBeLessThan(0.26)
    expect(vignetteAlpha(0.8, 0.8, vignette)).toBeGreaterThan(
      vignetteAlpha(0.7, 0.7, vignette),
    )
  })

  it('draws in ink, clear in the middle and darkest in the corners', () => {
    const pixels = vignettePixels(vignette, ASSETS.palette.ink, 160, 100)
    const alpha = alphas(pixels)
    expect(alpha[50 * 160 + 80]).toBe(0)
    expect(alpha[0]).toBeCloseTo(0.26, 1)
    expect(Math.max(...alpha)).toBeLessThanOrEqual(0.26 + 1 / 255)
  })
})

describe('the glow', () => {
  it('is warmest in the upper left corner and gone by its reach', () => {
    const { glow } = LIGHT
    expect(glowAlpha(0, 0, glow)).toBeCloseTo(glow.opacity)
    expect(glowAlpha(glow.reach, glow.reach, glow)).toBe(0)
    expect(glowAlpha(1, 1, glow)).toBe(0)
    expect(glowAlpha(0.2, 0.1, glow)).toBeLessThan(glow.opacity)
  })
})

describe('the materials', () => {
  it.each([
    ['bricks', brickPixels(LIGHT.material.brick, lineOpacity, LIGHT.slate)],
    ['tiles', tilePixels(LIGHT.material.tile, lineOpacity, LIGHT.slate)],
    ['speckle', speckledPixels(LIGHT.material.speckle, lineOpacity, LIGHT.sun)],
  ])('draws the %s at 12 to 20 %, clear between their lines', (_, pixels) => {
    const drawn = alphas(pixels).filter((a) => a > 0)
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.length).toBeLessThan(pixels.width * pixels.height * 0.5)
    for (const a of drawn) {
      expect(a).toBeGreaterThanOrEqual(lineOpacity.min - 1 / 255)
      expect(a).toBeLessThanOrEqual(lineOpacity.max + 1 / 255)
    }
  })

  it('lays the bricks two across and two courses down, the second course offset', () => {
    const { brick } = LIGHT.material
    const pixels = brickPixels(brick, lineOpacity, LIGHT.slate)
    expect(pixels.width).toBe(brick.width * 2)
    expect(pixels.height).toBe(brick.height * 2)
    const alpha = alphas(pixels)
    const at = (x: number, y: number) => alpha[y * pixels.width + x]!
    // A joint at the right of the first course's first brick, none there
    // in the second course, whose joint is half a brick on.
    expect(at(brick.width - 1, 1)).toBeGreaterThan(0)
    expect(at(brick.width - 1, brick.height + 1)).toBe(0)
    expect(at(brick.width / 2 - 1, brick.height + 1)).toBeGreaterThan(0)
  })
})

describe('the ramps and the spot', () => {
  it('fades a ramp from its first stop to its last', () => {
    const ramp = rampPixels([
      { color: '#34404F', alpha: 1 },
      { color: '#34404F', alpha: 0 },
    ])
    const alpha = alphas(ramp)
    expect(ramp.width).toBe(1)
    expect(alpha[0]).toBe(1)
    expect(alpha.at(-1)).toBe(0)
    expect(alpha[32]!).toBeLessThan(alpha[16]!)
  })

  it('goes through every colour of a ramp, premultiplied by its alpha', () => {
    const ramp = rampPixels(
      [
        { color: '#FF0000', alpha: 1 },
        { color: '#00FF00', alpha: 1 },
        { color: '#0000FF', alpha: 1 },
      ],
      5,
    )
    expect(Array.from(ramp.data.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(ramp.data.slice(8, 12))).toEqual([0, 255, 0, 255])
    expect(Array.from(ramp.data.slice(16, 20))).toEqual([0, 0, 255, 255])
  })

  it('makes a spot solid in the middle and clear at its edge', () => {
    const spot = spotPixels('#34404F', 64)
    const alpha = alphas(spot)
    expect(alpha[32 * 64 + 32]).toBe(1)
    expect(alpha[0]).toBe(0)
    expect(alpha[32 * 64]).toBeLessThan(0.05)
  })
})
