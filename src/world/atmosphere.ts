// Overlay and soft light are advanced blend modes, which Pixi only knows
// once this is imported; they also need WebGL's back buffer, which the
// street turns on for them (see startStreet). Their sprites stay opaque:
// the textures hold their opacity (see `strayOf` in noise.ts).
import 'pixi.js/advanced-blend-modes'
import {
  Container,
  extensions,
  OverlayBlend,
  SoftLightBlend,
  Sprite,
  TilingSprite,
  type Filter,
  type Texture,
} from 'pixi.js'
import type { Light, Palette } from '../content/assets.ts'
import type { VisualEffects } from '../ui/settings.ts'
import { textureOf } from './materials.ts'
import {
  glowPixels,
  grainPixels,
  unevennessPixels,
  vignettePixels,
} from './noise.ts'

// Pixi copies the world behind a blended sprite at the screen's pixels, but
// draws the sprite through the blend's filter at the filter's resolution, 1
// by default, then reads both at the same place. On a screen of two pixels
// per logical pixel each blend would zoom the world from its top-left
// corner and push the truck off the screen (#110). These draw at the
// screen's pixels and take Pixi's place under the same blend names.
class ScreenOverlayBlend extends OverlayBlend {
  override resolution: Filter['resolution'] = 'inherit'
}
class ScreenSoftLightBlend extends SoftLightBlend {
  override resolution: Filter['resolution'] = 'inherit'
}
extensions.add(ScreenOverlayBlend, ScreenSoftLightBlend)

/**
 * What is drawn over the whole world, under the panels: the sun's warm
 * glow from the upper left, the painted unevenness in soft light, the
 * vignette's darker corners and the film grain in overlay.
 */
export interface Atmosphere {
  readonly root: Container
  /** Covers a screen `width` × `height`, in the stage's pixels. */
  fit: (width: number, height: number) => void
  /** The simple visual effects drop the unevenness and the grain. */
  setEffects: (effects: VisualEffects) => void
  /** Takes it down with its textures. */
  destroy: () => void
}

/**
 * Makes the atmosphere from `light`, each texture once from its seeded
 * noise: the grain is tiled, the rest is stretched over the screen.
 */
export function createAtmosphere(light: Light, palette: Palette): Atmosphere {
  const textures: Texture[] = []
  const make = (...args: Parameters<typeof textureOf>) => {
    const texture = textureOf(...args)
    textures.push(texture)
    return texture
  }
  const glow = new Sprite({
    texture: make(glowPixels(light.glow, light.sun), 'glow'),
    label: 'glow',
  })
  const unevenness = new Sprite({
    texture: make(unevennessPixels(light.unevenness), 'unevenness'),
    label: 'unevenness',
    blendMode: light.unevenness.blend,
  })
  const vignette = new Sprite({
    texture: make(
      vignettePixels(light.vignette, palette[light.vignette.color]),
      'vignette',
    ),
    label: 'vignette',
  })
  const grain = new TilingSprite({
    texture: make(grainPixels(light.grain), 'grain'),
    label: 'grain',
    blendMode: light.grain.blend,
  })
  const root = new Container({
    label: 'atmosphere',
    children: [glow, unevenness, vignette, grain],
  })

  return {
    root,
    fit: (width, height) => {
      for (const sprite of [glow, unevenness, vignette]) {
        sprite.setSize(width, height)
      }
      grain.width = width
      grain.height = height
    },
    setEffects: (effects) => {
      unevenness.visible = effects === 'full'
      grain.visible = effects === 'full'
    },
    destroy: () => {
      root.destroy({ children: true })
      for (const texture of textures) texture.destroy(true)
      textures.length = 0
    },
  }
}
