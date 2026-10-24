import { Particle, ParticleContainer, type Texture } from 'pixi.js'
import type { DistrictStreet } from '../content/assets.ts'
import type { VisualEffects } from '../ui/settings.ts'
import { textureOf } from './materials.ts'
import { radialPixels } from './noise.ts'

// The snow falling on a district's street in its winter (#264), as the
// winter target's 170 flakes: a light layer of particles over the people
// and under the atmosphere, all drawn from one round texture made once.
// The flakes fall and sway in real time, so they freeze with the ticker,
// paused or at ×10, as the steam does. « Effets visuels : Simples » turns
// them off.

/** The part of the street's design on screen, where the snow falls. */
export interface Area {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** One flake, where it is as shares of the area, and how it falls. */
export interface Flake {
  /** Across the area, from 0 at its left to 1 at its right, before it sways. */
  x: number
  /** Down the area, from 0 at its top to 1 at its bottom. */
  y: number
  readonly radius: number
  readonly opacity: number
  /** How far it falls each real second, in the design's pixels. */
  readonly fall: number
  /** Where in its sway it starts, as a share of a sway. */
  readonly phase: number
}

/** The snow's settings, from the district's street. */
export type SnowSettings = DistrictStreet['snow']

/**
 * The flakes of `settings`, spread at random over the area, each its own
 * size, opacity and speed within the settings' ranges.
 */
export function makeFlakes(
  settings: SnowSettings,
  random: () => number,
): Flake[] {
  const within = ({ min, max }: { min: number; max: number }) =>
    min + random() * (max - min)
  return Array.from({ length: settings.count }, () => ({
    x: random(),
    y: random(),
    radius: within(settings.radius),
    opacity: within(settings.opacity),
    fall: within(settings.fall),
    phase: random(),
  }))
}

/**
 * Moves `flakes` down by `deltaMs` real milliseconds' fall over `area`,
 * each one that leaves its bottom coming back in at its top: the snow
 * always covers the area, however tall. Nothing moves without time.
 */
export function fallFlakes(
  flakes: readonly Flake[],
  deltaMs: number,
  area: Area,
): void {
  const height = area.bottom - area.top
  if (deltaMs <= 0 || height <= 0) return
  for (const flake of flakes) {
    flake.y = (flake.y + (flake.fall * deltaMs) / 1000 / height) % 1
  }
}

/**
 * Where `flake` is drawn in the design, `ms` real milliseconds into the
 * snow: at its place in `area`, swayed `drift` to either side once every
 * `driftMs`, and back across the area when it sways past an edge.
 */
export function flakeAt(
  flake: Flake,
  area: Area,
  ms: number,
  { drift, driftMs }: Pick<SnowSettings, 'drift' | 'driftMs'>,
): { x: number; y: number } {
  const width = area.right - area.left
  const sway = drift * Math.sin(2 * Math.PI * (ms / driftMs + flake.phase))
  const across = (((flake.x * width + sway) % width) + width) % width
  return {
    x: area.left + across,
    y: area.top + flake.y * (area.bottom - area.top),
  }
}

/** The snow over the street. */
export interface Snow {
  /** The flakes, to add over the people. */
  readonly root: ParticleContainer
  /** Shows the snow in the street's winter, with the full visual effects. */
  show: (winter: boolean) => void
  setEffects: (effects: VisualEffects) => void
  /** Moves the snow on by `deltaMs` real milliseconds over `area`. */
  frame: (deltaMs: number, area: Area) => void
  /** Takes it down, with its texture. */
  destroy: () => void
}

/** The flake's texture's side, in pixels: twice the largest flake or so. */
const FLAKE_PIXELS = 16

/** Makes the snow of `settings`, its flakes in `color`. */
export function createSnow(
  settings: SnowSettings,
  color: string,
  random: () => number,
): Snow {
  // A disc as the target draws its flakes, its rim softened a little.
  const texture: Texture = textureOf(
    radialPixels(
      [
        { offset: 0, color, alpha: 1 },
        { offset: 0.85, color, alpha: 1 },
        { offset: 1, color, alpha: 0 },
      ],
      { x: 0.5, y: 0.5 },
      0.5,
      FLAKE_PIXELS,
    ),
    'snow:flake',
  )
  const root = new ParticleContainer({
    label: 'snow',
    dynamicProperties: { position: true },
  })
  const flakes = makeFlakes(settings, random)
  const particles = flakes.map((flake) => {
    const scale = (flake.radius * 2) / FLAKE_PIXELS
    return root.addParticle(
      new Particle({
        texture,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: scale,
        scaleY: scale,
        alpha: flake.opacity,
      }),
    )
  })
  let ms = 0
  let winter = false
  let effects: VisualEffects = 'full'
  const visible = () => {
    root.visible = winter && effects === 'full'
  }
  visible()
  return {
    root,
    show: (shown) => {
      winter = shown
      visible()
    },
    setEffects: (next) => {
      effects = next
      visible()
    },
    frame: (deltaMs, area) => {
      if (!root.visible) return
      ms += Math.max(0, deltaMs)
      fallFlakes(flakes, deltaMs, area)
      flakes.forEach((flake, index) => {
        const particle = particles[index]
        if (particle === undefined) return
        const { x, y } = flakeAt(flake, area, ms, settings)
        particle.x = x
        particle.y = y
      })
    },
    destroy: () => {
      root.destroy()
      texture.destroy(true)
    },
  }
}
