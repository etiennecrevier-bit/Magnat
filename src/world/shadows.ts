import {
  AlphaFilter,
  BlurFilter,
  Container,
  Graphics,
  RendererType,
  Sprite,
  type Filter,
  type Texture,
} from 'pixi.js'
import type { Light } from '../content/assets.ts'
import type { VisualEffects } from '../ui/settings.ts'

// The shadows on the ground, all in one layer under what stands there: the
// cast shadows, slate shapes reaching to the lower right, away from the sun,
// then the contact shadows, a tight soft ellipse under each foot, wheel and
// post. The cast shadows are drawn opaque and blurred together, then shown
// at one opacity, so where two overlap the ground is no darker. Where the
// renderer has no filters, they are drawn opaque into one texture, which
// shows at that opacity, without the blur.

/** What the cast shadows' filters do: blur their edge, then fade them. */
export interface ShadowFilters {
  /** How soft their edge is, in pixels; 0 keeps it sharp. */
  readonly blur: number
  /** The opacity the whole layer of them shows at. */
  readonly opacity: number
}

/**
 * Makes the cast shadows' filters. Pixi's need a browser, which draws an
 * alpha filter on a canvas, so a test passes its own.
 */
export type MakeFilters = (wanted: ShadowFilters) => Filter[]

/**
 * Pixi's filters for a renderer of `type`. Its Canvas 2D renderer, used
 * where WebGL and WebGPU are missing, skips filters: there are none, and
 * the cast shadows show through one texture instead (see `createShadows`).
 */
export function filtersFor(type: number | undefined): MakeFilters | null {
  return type === RendererType.CANVAS ? null : PIXI_FILTERS
}

/** Pixi's blur, then its alpha filter, which fades the shadows as one. */
export const PIXI_FILTERS: MakeFilters = ({ blur, opacity }) => [
  ...(blur > 0 ? [new BlurFilter({ strength: blur, quality: 2 })] : []),
  new AlphaFilter({ alpha: opacity }),
]

/** What a contact shadow is under, which sets its opacity. */
export type ContactKind = keyof Light['contactShadow']['opacity']

/** The shadows on the ground. */
export interface Shadows {
  /** The cast shadows, filtered as one. */
  readonly cast: Container
  /** The contact shadows, over the cast ones. */
  readonly contact: Container
  /**
   * Adds the shadow `owner` casts with a body `width` wide and `height`
   * tall standing at `x`, `y`: from its foot, it reaches right and down,
   * narrowing. Each shadow is labelled `cast:<owner>` or `contact:<owner>`.
   */
  castBody: (
    owner: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Graphics
  /**
   * Adds the shadow `owner` casts with a round mass `radius` wide held `height` above
   * the ground at `x`, `y`: a flat ellipse along the shadow's reach.
   */
  castMass: (
    owner: string,
    x: number,
    y: number,
    radius: number,
    height: number,
  ) => Graphics
  /**
   * Adds the shadow `owner` casts with a box `height` tall, from `left` to `right`,
   * whose underside is at `bottom` and which stands on the ground at
   * `ground`: it fills the ground under it and reaches right and down.
   */
  castBox: (
    owner: string,
    left: number,
    right: number,
    bottom: number,
    ground: number,
    height: number,
  ) => Graphics
  /**
   * Adds the contact shadow `width` wide under `owner`, of `kind`,
   * centred on `x`, `y`.
   */
  contactShadow: (
    owner: string,
    x: number,
    y: number,
    width: number,
    kind: ContactKind,
  ) => Sprite
  /** Blurs the cast shadows' edge with the full visual effects only. */
  setEffects: (effects: VisualEffects) => void
  /**
   * Where the cast shadows show through one texture, draws them into it
   * again, at `resolution` pixels per unit of the layer, since they move
   * each frame. Elsewhere it does nothing.
   */
  redraw: (resolution: number) => void
  /** Frees the filters. */
  destroy: () => void
}

/**
 * Fills `layer`, the manifest's shadow layer, with the cast shadows and
 * the contact shadows, shown with the full visual effects until
 * `setEffects` says otherwise. `spot` is the soft spot contact shadows
 * stretch. Without `makeFilters`, where the renderer cannot filter, the
 * cast shadows are drawn opaque into one texture, cached until `redraw`,
 * which shows at their opacity: where two overlap the ground is still no
 * darker, but their edge stays sharp.
 */
export function createShadows(
  layer: Container,
  light: Light,
  spot: Texture,
  makeFilters: MakeFilters | null,
): Shadows {
  const { castShadow, contactShadow } = light
  const cast = layer.addChild(new Container({ label: 'cast' }))
  const contact = layer.addChild(new Container({ label: 'contact' }))
  const filters = new Map<VisualEffects, Filter[]>()
  const filtersOf = (effects: VisualEffects) => {
    if (makeFilters === null) return []
    let made = filters.get(effects)
    if (made === undefined) {
      made = makeFilters({
        blur: effects === 'full' ? castShadow.blur : 0,
        opacity: castShadow.opacity,
      })
      filters.set(effects, made)
    }
    return made
  }
  // The texture's pixels per unit; Pixi's default is the screen's.
  let resolution: number | undefined
  if (makeFilters === null) {
    cast.cacheAsTexture(true)
    cast.alpha = castShadow.opacity
  } else cast.filters = filtersOf('full')

  return {
    cast,
    contact,
    castBody: (owner, x, y, width, height) => {
      const dx = height * castShadow.reach
      const dy = height * castShadow.drop
      return cast.addChild(
        new Graphics({ label: `cast:${owner}`, x, y })
          .poly([
            -width / 2,
            0,
            width / 2,
            0,
            dx + width * 0.3,
            dy,
            dx - width * 0.3,
            dy,
          ])
          .fill(light.slate),
      )
    },
    castMass: (owner, x, y, radius, height) => {
      const flat = castShadow.drop / Math.max(castShadow.reach, castShadow.drop)
      return cast.addChild(
        new Graphics({
          label: `cast:${owner}`,
          x: x + height * castShadow.reach,
          y: y + height * castShadow.drop,
        })
          .ellipse(0, 0, radius, Math.max(radius * flat, radius * 0.25))
          .fill(light.slate),
      )
    },
    castBox: (owner, left, right, bottom, ground, height) => {
      const dx = height * castShadow.reach
      const dy = height * castShadow.drop
      return cast.addChild(
        new Graphics({ label: `cast:${owner}` })
          .poly([
            left,
            bottom,
            right,
            bottom,
            right + dx,
            ground + dy,
            left + dx,
            ground + dy,
          ])
          .fill(light.slate),
      )
    },
    contactShadow: (owner, x, y, width, kind) => {
      const sprite = new Sprite({
        texture: spot,
        label: `contact:${owner}`,
        anchor: 0.5,
        x,
        y,
        alpha: contactShadow.opacity[kind],
      })
      sprite.setSize(width, width * contactShadow.depth)
      return contact.addChild(sprite)
    },
    setEffects: (effects) => {
      if (makeFilters !== null) cast.filters = filtersOf(effects)
    },
    redraw: (wanted) => {
      if (makeFilters !== null) return
      if (wanted === resolution) cast.updateCacheTexture()
      else {
        resolution = wanted
        cast.cacheAsTexture({ resolution })
      }
    },
    destroy: () => {
      cast.filters = []
      for (const made of filters.values()) {
        for (const filter of made) filter.destroy()
      }
      filters.clear()
    },
  }
}
