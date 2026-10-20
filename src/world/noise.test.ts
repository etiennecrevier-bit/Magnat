import { describe, expect, it } from 'vitest'
import { ASSETS } from './manifest.ts'
import {
  brickPixels,
  glowAlpha,
  grainPixels,
  radialPixels,
  rampPixels,
  sideRampPixels,
  SPOT_HALF_RADIUS,
  spotPixels,
  strayOf,
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
  it('draws the bricks at 12 to 20 %, clear between their lines', () => {
    const pixels = brickPixels(LIGHT.material.brick, lineOpacity, LIGHT.slate)
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

  it('is half as dark as its middle where its edge seems to be', () => {
    const size = 400
    const spot = spotPixels('#34404F', size)
    const alpha = alphas(spot)
    const x = Math.round((size / 2) * (1 + SPOT_HALF_RADIUS))
    expect(alpha[(size / 2) * size + x]!).toBeCloseTo(0.5, 1)
  })
})

describe('the gradients over people', () => {
  // The reference's side light: sun at 30 %, gone by 45 %, slate at 38 %.
  const SIDE = [
    { offset: 0, color: '#FFF1CF', alpha: 0.3 },
    { offset: 0.45, color: '#FFF1CF', alpha: 0 },
    { offset: 1, color: '#34404F', alpha: 0.38 },
  ]

  /** The colour and the alpha (0 to 1) of pixel `i`, unmultiplied. */
  function pixel({ data }: Pixels, i: number) {
    const alpha = data[i * 4 + 3]! / 255
    const rgb = [0, 1, 2].map((c) => data[i * 4 + c]! / alpha)
    return { rgb, alpha }
  }

  it('runs a side through its stops, from the sun on its left', () => {
    const ramp = sideRampPixels(SIDE, false, 100)
    expect(ramp.width).toBe(100)
    expect(ramp.height).toBe(1)
    const first = pixel(ramp, 0)
    expect(first.alpha).toBeCloseTo(0.3, 1)
    expect(first.rgb[0]).toBeCloseTo(0xff, -1)
    expect(pixel(ramp, 45).alpha).toBeLessThan(0.01)
    const last = pixel(ramp, 99)
    expect(last.alpha).toBeCloseTo(0.38, 1)
    expect(last.rgb[0]).toBeCloseTo(0x34, -1)
    // Halfway between two stops, halfway between their alphas.
    expect(pixel(ramp, 72).alpha).toBeCloseTo(0.19, 1)
  })

  it('mirrors a side for the sun on its right', () => {
    const ramp = sideRampPixels(SIDE, false, 64)
    const mirrored = sideRampPixels(SIDE, true, 64)
    for (let x = 0; x < 64; x += 1) {
      expect(Array.from(mirrored.data.slice(x * 4, x * 4 + 4))).toEqual(
        Array.from(ramp.data.slice((63 - x) * 4, (63 - x) * 4 + 4)),
      )
    }
  })

  it('lights a round shape out from its centre, and the last stop beyond', () => {
    const stops = [
      { offset: 0, color: '#FFF1CF', alpha: 0.45 },
      { offset: 0.5, color: '#FFF1CF', alpha: 0 },
      { offset: 1, color: '#34404F', alpha: 0.42 },
    ]
    const size = 100
    const round = radialPixels(stops, { x: 0.32, y: 0.28 }, 0.85, size)
    expect([round.width, round.height]).toEqual([size, size])
    expect(pixel(round, 28 * size + 32).alpha).toBeCloseTo(0.45, 1)
    // Halfway out, nothing.
    const halfway = Math.round(28 + 0.85 * 0.5 * 100)
    expect(pixel(round, halfway * size + 32).alpha).toBeLessThan(0.02)
    // The far corner is past the radius: the last stop, in slate.
    const corner = pixel(round, size * size - 1)
    expect(corner.alpha).toBeCloseTo(0.42, 1)
    expect(corner.rgb[2]).toBeCloseTo(0x4f, -1)
    // Its centre is where it is asked for.
    const other = radialPixels(stops, { x: 0.68, y: 0.28 }, 0.85, size)
    expect(pixel(other, 28 * size + 68).alpha).toBeCloseTo(0.45, 1)
  })
})
