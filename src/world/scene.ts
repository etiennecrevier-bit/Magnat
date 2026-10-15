import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import type { AssetManifest, Piece } from '../content/assets.ts'
import type { VisualEffects } from '../ui/settings.ts'
import { TITLE_FONT, TITLE_FONT_FAMILY } from './fonts.ts'
import { createMaterials } from './materials.ts'
import {
  PLACEHOLDER_SHADOWS,
  PLACEHOLDERS,
  type PlaceholderStyle,
} from './placeholders.ts'
import {
  createShadows,
  PIXI_FILTERS,
  type MakeFilters,
  type Shadows,
} from './shadows.ts'
import { rackFill, type TruckView } from './truckView.ts'

/** The street, built once from the manifest and redrawn from the game. */
export interface Scene {
  /**
   * The whole street at its design size: one child per layer, back to front,
   * labelled `layer:<id>`, holding one child per piece, labelled with its id.
   */
  readonly root: Container
  /** What the street is drawn with, which the people on it share. */
  readonly style: PlaceholderStyle
  /** The shadows on the ground, where the people add theirs. */
  readonly shadows: Shadows
  /** Shows `view`: open or closed, the croissants and the business name. */
  update: (view: TruckView) => void
  /** Moves the steam on by `deltaMs` milliseconds. */
  animate: (deltaMs: number) => void
  /** Softens the shadows' edge with the full visual effects only. */
  setEffects: (effects: VisualEffects) => void
  /** Takes the street down, with its textures and filters. */
  destroy: () => void
}

/** How wide `text` is drawn. Pixi measures it in the browser only. */
export type MeasureWidth = (text: Text) => number

/**
 * Builds the street from `manifest`. Each piece is a container at its
 * position holding its art: a sprite stretched to its size when `textures`
 * holds its image (see `loadArt`), or else its placeholder, lit by the
 * manifest's `light` with the textures it makes once here. Only a
 * placeholder throws its shadows on the ground, in the manifest's shadow
 * layer, whose cast shadows `makeFilters` blurs and fades as one (see
 * `createShadows`). Nothing shows the game until the first `update`.
 */
export function buildScene(
  manifest: AssetManifest,
  textures: ReadonlyMap<string, Texture>,
  measureWidth: MeasureWidth = (text) => text.width,
  makeFilters: MakeFilters | null = PIXI_FILTERS,
): Scene {
  const { light } = manifest
  const materials = createMaterials(light)
  const style: PlaceholderStyle = {
    palette: manifest.palette,
    outline: manifest.outlineWidth,
    light,
    materials,
  }
  const root = new Container({ label: 'street' })
  const layers = new Map<string, Container>()
  for (const id of manifest.layers) {
    layers.set(id, root.addChild(new Container({ label: `layer:${id}` })))
  }
  const ground = layers.get(light.shadowLayer)
  if (ground === undefined) {
    throw new Error(`The manifest has no layer ${light.shadowLayer}`)
  }
  const shadows = createShadows(ground, light, materials.spot, makeFilters)

  const switched: { shows: 'open' | 'closed'; node: Container }[] = []
  const steam: Container[] = []
  let rack: { piece: Piece; art: Container; mask: Graphics } | undefined
  let sign: { piece: Piece; text: Text } | undefined

  for (const piece of manifest.pieces) {
    const node = new Container({ label: piece.id, x: piece.x, y: piece.y })
    const art = node.addChild(drawPiece(piece, textures, style))
    layers.get(piece.layer)?.addChild(node)
    if (art.label === 'placeholder') {
      PLACEHOLDER_SHADOWS[piece.kind]?.(piece, shadows)
    }

    if (piece.shows !== undefined) switched.push({ shows: piece.shows, node })
    if (piece.kind === 'steam') steam.push(art)
    if (piece.fill !== undefined) {
      // Reveals the art from the bottom up, placeholder or image alike.
      const mask = node.addChild(new Graphics({ label: 'mask' }))
      art.mask = mask
      rack = { piece, art, mask }
    }
    if (piece.kind === 'truckSign') {
      const text = node.addChild(
        new Text({
          label: 'name',
          style: {
            fontFamily: TITLE_FONT_FAMILY,
            fontWeight: TITLE_FONT.weight,
            fontSize: manifest.signText.fontSize,
            fill: manifest.palette[manifest.signText.color],
          },
          anchor: 0.5,
          position: { x: piece.width / 2, y: piece.height / 2 },
        }),
      )
      sign = { piece, text }
    }
  }

  const { periodMs, rise } = manifest.steamPuff
  let steamPhase = 0

  return {
    root,
    style,
    shadows,
    update: (view) => {
      for (const { shows, node } of switched) {
        node.visible = (shows === 'open') === view.open
      }
      if (rack?.piece.fill !== undefined) {
        const { capacity, steps } = rack.piece.fill
        const fill = rackFill(view.croissants, capacity, steps)
        const { width, height } = rack.piece
        rack.mask
          .clear()
          .rect(0, height * (1 - fill), width, height * fill)
          .fill('white')
        rack.art.visible = fill > 0
      }
      if (sign !== undefined && sign.text.text !== view.businessName) {
        const { text, piece } = sign
        text.text = view.businessName
        text.scale.set(1)
        const room = piece.width - 2 * manifest.signText.paddingX
        const width = measureWidth(text)
        text.scale.set(width > room ? room / width : 1)
      }
    },
    animate: (deltaMs) => {
      // Each period, a puff rises by `rise` as it fades in, then out.
      steamPhase = (steamPhase + deltaMs) % periodMs
      const t = steamPhase / periodMs
      for (const art of steam) {
        art.y = -rise * t
        art.alpha = Math.sin(Math.PI * t)
      }
    },
    setEffects: (effects) => shadows.setEffects(effects),
    destroy: () => {
      root.destroy({ children: true })
      shadows.destroy()
      materials.destroy()
    },
  }
}

/** The piece's image stretched to its size, or else its placeholder. */
function drawPiece(
  piece: Piece,
  textures: ReadonlyMap<string, Texture>,
  style: PlaceholderStyle,
): Container {
  const texture =
    piece.image === undefined ? undefined : textures.get(piece.image)
  if (texture === undefined) {
    const placeholder = PLACEHOLDERS[piece.kind](piece, style)
    placeholder.label = 'placeholder'
    return placeholder
  }
  const sprite = new Sprite({ texture, label: 'image' })
  sprite.setSize(piece.width, piece.height)
  return sprite
}
