import type { Light } from '../content/assets.ts'
import { next, seedRng } from '../engine/rng.ts'
import { hexToRgb } from './light.ts'

// The pixels of the world's textures, without Pixi: the grain, the painted
// unevenness, the vignette and the glow over the world, the bricks, tiles
// and speckle of the placeholders, and the ramps their gradients and soft
// shadows stretch. Each is made once from seeded noise, so the same seed
// always gives the same texture. Pixels are RGBA, 8 bits a channel, row by
// row from the top left, their colour already multiplied by their alpha.

/** An image's pixels. */
export interface Pixels {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

/** A generator of numbers in [0, 1) from `seed`: the engine's own. */
export function seeded(seed: number): () => number {
  let state = seedRng(seed)
  return () => {
    const [value, after] = next(state)
    state = after
    return value
  }
}

/** Blank pixels, `width` × `height`, all clear. */
function blank(width: number, height: number): Pixels {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

/** Sets the pixel at `x`, `y` to `rgb` at `alpha` (0 to 1). */
function put(
  pixels: Pixels,
  x: number,
  y: number,
  rgb: readonly number[],
  alpha: number,
): void {
  const i = (y * pixels.width + x) * 4
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  for (let c = 0; c < 3; c += 1) {
    pixels.data[i + c] = Math.round((rgb[c]! * a) / 255)
  }
  pixels.data[i + 3] = a
}

/** An opaque grey, 0 to 255. */
function grey(value: number): number[] {
  const v = Math.round(Math.min(255, Math.max(0, value)))
  return [v, v, v]
}

/** 0 below `from`, 1 above `to`, smooth in between. */
function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/**
 * How far from mid-grey a texture blended at `opacity` strays, at most.
 *
 * Pixi's overlay and soft light blend a sprite's colour after its alpha has
 * darkened it, so a sprite at 40 % would darken the whole world. Both blends
 * are linear in the blend colour on either side of mid-grey, which leaves
 * the world unchanged: noise blended at an opacity looks the same as that
 * noise brought toward mid-grey by the opacity and blended in full. The
 * textures are made that way and their sprites stay opaque.
 */
export function strayOf(amplitude: number, opacity: number): number {
  return amplitude * opacity * 127
}

/**
 * The grain: a tile `size` pixels square of fine grey noise around
 * mid-grey, which an overlay leaves unchanged. Most pixels stay near it, a
 * few reach `amplitude` of the full range either way, at `opacity`.
 */
export function grainPixels(grain: Light['grain']): Pixels {
  const random = seeded(grain.seed)
  const stray = strayOf(grain.amplitude, grain.opacity)
  const pixels = blank(grain.size, grain.size)
  for (let y = 0; y < grain.size; y += 1) {
    for (let x = 0; x < grain.size; x += 1) {
      const spread = random() + random() - 1
      put(pixels, x, y, grey(128 + spread * stray), 1)
    }
  }
  return pixels
}

/** How many pixels across each of the unevenness's blotches is drawn. */
const BLOTCH_PIXELS = 8

/**
 * The painted unevenness: `cells` large soft blotches across, around
 * mid-grey, for soft light at `opacity` (see `strayOf`). Small, since it is
 * stretched to the screen: 8 pixels a blotch, 5 down for each 8 across like
 * the design.
 */
export function unevennessPixels(unevenness: Light['unevenness']): Pixels {
  const random = seeded(unevenness.seed)
  const across = unevenness.cells
  const down = Math.max(1, Math.round((across * 5) / 8))
  const corners = Array.from({ length: (across + 1) * (down + 1) }, random)
  const at = (cx: number, cy: number) => corners[cy * (across + 1) + cx]!
  const stray = strayOf(unevenness.amplitude, unevenness.opacity)
  const pixels = blank(across * BLOTCH_PIXELS, down * BLOTCH_PIXELS)
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const gx = x / BLOTCH_PIXELS
      const gy = y / BLOTCH_PIXELS
      const cx = Math.floor(gx)
      const cy = Math.floor(gy)
      const tx = smoothstep(0, 1, gx - cx)
      const ty = smoothstep(0, 1, gy - cy)
      const top = at(cx, cy) + (at(cx + 1, cy) - at(cx, cy)) * tx
      const bottom = at(cx, cy + 1) + (at(cx + 1, cy + 1) - at(cx, cy + 1)) * tx
      const value = top + (bottom - top) * ty
      put(pixels, x, y, grey(128 + (value * 2 - 1) * stray), 1)
    }
  }
  return pixels
}

/**
 * How dark the vignette is at `u`, `v`, each from -1 to 1 across the
 * screen: 0 inside `clear` of the radius, which reaches the corners, then
 * smoothly to `opacity` at the corners.
 */
export function vignetteAlpha(
  u: number,
  v: number,
  vignette: Light['vignette'],
): number {
  const radius = Math.hypot(u, v) / Math.SQRT2
  return vignette.opacity * smoothstep(vignette.clear, 1, radius)
}

/** The vignette in `color`, to stretch over the screen. */
export function vignettePixels(
  vignette: Light['vignette'],
  color: string,
  width = 160,
  height = 100,
): Pixels {
  const rgb = hexToRgb(color)
  const pixels = blank(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = ((x + 0.5) / width) * 2 - 1
      const v = ((y + 0.5) / height) * 2 - 1
      put(pixels, x, y, rgb, vignetteAlpha(u, v, vignette))
    }
  }
  return pixels
}

/**
 * How strong the glow is at `u`, `v`, each from 0 at the upper left to 1
 * at the lower right: `opacity` in the corner, gone by `reach` of the
 * diagonal.
 */
export function glowAlpha(u: number, v: number, glow: Light['glow']): number {
  const along = Math.hypot(u, v) / Math.SQRT2
  return glow.opacity * (1 - smoothstep(0, glow.reach, along))
}

/** The glow in the sun's colour, to stretch over the screen. */
export function glowPixels(
  glow: Light['glow'],
  sun: string,
  width = 160,
  height = 100,
): Pixels {
  const rgb = hexToRgb(sun)
  const pixels = blank(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      put(
        pixels,
        x,
        y,
        rgb,
        glowAlpha((x + 0.5) / width, (y + 0.5) / height, glow),
      )
    }
  }
  return pixels
}

/** A material's joints: the brick or tile, and how its rows sit. */
interface Joints {
  readonly width: number
  readonly height: number
  readonly line: number
  readonly seed: number
}

/**
 * `columns` × `rows` bricks or tiles, clear, with the joints on their right
 * and at their foot in `color`, each joint at its own opacity within
 * `lineOpacity`. With `bond`, every other row is offset by half a brick.
 */
function jointPixels(
  joints: Joints,
  columns: number,
  rows: number,
  bond: boolean,
  lineOpacity: Light['material']['lineOpacity'],
  color: string,
): Pixels {
  const random = seeded(joints.seed)
  const rgb = hexToRgb(color)
  const w = Math.round(joints.width)
  const h = Math.round(joints.height)
  const line = Math.max(1, Math.round(joints.line))
  const pixels = blank(w * columns, h * rows)
  const opacity = () =>
    lineOpacity.min + random() * (lineOpacity.max - lineOpacity.min)
  for (let row = 0; row < rows; row += 1) {
    const shift = bond && row % 2 === 1 ? Math.round(w / 2) : 0
    const foot = opacity()
    for (let y = row * h + h - line; y < (row + 1) * h; y += 1) {
      for (let x = 0; x < pixels.width; x += 1) put(pixels, x, y, rgb, foot)
    }
    for (let column = 0; column < columns; column += 1) {
      const side = opacity()
      const right = (column * w + w + shift) % pixels.width
      for (let y = row * h; y < row * h + h - line; y += 1) {
        for (let dx = 1; dx <= line; dx += 1) {
          const x = (right - dx + pixels.width) % pixels.width
          put(pixels, x, y, rgb, side)
        }
      }
    }
  }
  return pixels
}

/** Bricks in a running bond: two across, two courses down. */
export function brickPixels(
  brick: Light['material']['brick'],
  lineOpacity: Light['material']['lineOpacity'],
  color: string,
): Pixels {
  return jointPixels(brick, 2, 2, true, lineOpacity, color)
}

/**
 * A column of pixels `height` tall going through `stops` evenly, top to
 * foot, each a colour and its alpha: a gradient to stretch.
 */
export function rampPixels(
  stops: readonly { readonly color: string; readonly alpha: number }[],
  height = 64,
): Pixels {
  const pixels = blank(1, height)
  const colours = stops.map((stop) => hexToRgb(stop.color))
  for (let y = 0; y < height; y += 1) {
    const at = (y / (height - 1)) * (stops.length - 1)
    const i = Math.min(stops.length - 2, Math.floor(at))
    const t = at - i
    const rgb = [0, 1, 2].map(
      (c) => colours[i]![c]! + (colours[i + 1]![c]! - colours[i]![c]!) * t,
    )
    const alpha = stops[i]!.alpha + (stops[i + 1]!.alpha - stops[i]!.alpha) * t
    put(pixels, 0, y, rgb, alpha)
  }
  return pixels
}

/**
 * A soft round spot in `color`, `size` pixels square: solid inside half
 * its radius, then fading out to its edge. Stretched, it makes the
 * contact shadows.
 */
export function spotPixels(color: string, size = 64): Pixels {
  const rgb = hexToRgb(color)
  const pixels = blank(size, size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * 2 - 1
      const v = ((y + 0.5) / size) * 2 - 1
      put(pixels, x, y, rgb, 1 - smoothstep(0.5, 1, Math.hypot(u, v)))
    }
  }
  return pixels
}
