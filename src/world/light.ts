import type { Light } from '../content/assets.ts'

// The colour maths of the look approved for #89: one sun from the upper
// left, three tones per surface. Colours mix channel by channel in 8-bit
// sRGB, rounding half to even: that is how the rule sheet's values come out
// (brick #B4532F lit from above gives #C47652, where rounding half up would
// give #C57652).

/** A colour's red, green and blue, each 0 to 255. */
export type Rgb = readonly [number, number, number]

/** `#RRGGBB` as its three channels. */
export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** Three channels as `#RRGGBB`, in capitals. */
export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

/** `amount` of `b` mixed into `a`: 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, amount: number): string {
  const to = hexToRgb(b)
  const mixed = hexToRgb(a).map((c, i) =>
    roundHalfToEven(c + (to[i]! - c) * amount),
  )
  return rgbToHex(mixed as [number, number, number])
}

/**
 * Rounds to the nearest whole number, and a half to the even one. A value
 * within a hair of a half counts as one, so 196.49999999999997 from the
 * floats still rounds as 196.5.
 */
export function roundHalfToEven(value: number): number {
  const floor = Math.floor(value)
  const rest = value - floor
  if (Math.abs(rest - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1
  return Math.round(value)
}

/** The tones a surface of one colour takes under the sun. */
export interface Tones {
  /** A face looking up, mixed with the sun. */
  readonly top: string
  /** A face looking at the viewer: the colour itself. */
  readonly lit: string
  /** A face turned away from the sun, mixed with slate. */
  readonly shade: string
  /** The bright rim along a top face's front edge. */
  readonly rim: string
}

/** The tones of a surface coloured `base`. */
export function tonesOf(base: string, light: Light): Tones {
  return {
    top: mix(base, light.sun, light.topFace.light),
    lit: base,
    shade: mix(base, light.slate, light.shadeSide.slate),
    rim: mix(base, light.sun, light.topFace.rim.light),
  }
}

/**
 * A lit side's gradient, top to foot: lighter at the top, the colour itself
 * in the middle and darker at the foot.
 */
export function facadeStops(
  base: string,
  light: Light,
): readonly [string, string, string] {
  return [
    mix(base, light.sun, light.litSide.topLight),
    base,
    mix(base, light.slate, light.litSide.footSlate),
  ]
}
