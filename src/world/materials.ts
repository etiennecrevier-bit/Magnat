import { BufferImageSource, Texture } from 'pixi.js'
import type { Light } from '../content/assets.ts'
import { facadeStops } from './light.ts'
import { brickPixels, rampPixels, spotPixels, type Pixels } from './noise.ts'

/**
 * The textures the placeholders are drawn with, made once when the street
 * starts and shared by every piece: never again on a frame.
 */
export interface Materials {
  /** The city's bricks. */
  readonly brick: Texture
  /** Slate, solid at the top and clear at the foot: a ledge's shadow. */
  readonly ledge: Texture
  /** A soft slate spot: a contact shadow, once stretched. */
  readonly spot: Texture
  /** The gradient of a lit side coloured `base`, made once per colour. */
  facade: (base: string) => Texture
  /** Frees them all, when the street stops. */
  destroy: () => void
}

/** A texture holding `pixels`, whose colours are already premultiplied. */
export function textureOf(pixels: Pixels, label: string): Texture {
  return new Texture({
    source: new BufferImageSource({
      resource: pixels.data,
      width: pixels.width,
      height: pixels.height,
      format: 'rgba8unorm',
      alphaMode: 'premultiplied-alpha',
      label,
    }),
    label,
  })
}

/** Makes the placeholders' textures from `light`. */
export function createMaterials(light: Light): Materials {
  const { material, slate } = light
  const toneOf = (tone: 'sun' | 'slate') => light[tone]
  const made: Texture[] = []
  const make = (pixels: Pixels, label: string) => {
    const texture = textureOf(pixels, label)
    made.push(texture)
    return texture
  }
  const facades = new Map<string, Texture>()
  return {
    brick: make(
      brickPixels(
        material.brick,
        material.lineOpacity,
        toneOf(material.brick.tone),
      ),
      'brick',
    ),
    ledge: make(
      rampPixels([
        { color: slate, alpha: 1 },
        { color: slate, alpha: 0 },
      ]),
      'ledge',
    ),
    spot: make(spotPixels(slate), 'spot'),
    facade: (base) => {
      let texture = facades.get(base)
      if (texture === undefined) {
        const stops = facadeStops(base, light).map((color) => ({
          color,
          alpha: 1,
        }))
        texture = make(rampPixels(stops), `facade:${base}`)
        facades.set(base, texture)
      }
      return texture
    },
    destroy: () => {
      for (const texture of made) texture.destroy(true)
      made.length = 0
      facades.clear()
    },
  }
}
