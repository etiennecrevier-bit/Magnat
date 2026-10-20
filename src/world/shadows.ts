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
import { SPOT_HALF_RADIUS } from './noise.ts'

// The shadows on the ground, all in one layer under what stands there: the
// cast shadows, slate shapes reaching to the lower right, away from the sun,
// then the contact shadows, a tight soft ellipse under each foot, wheel and
// post. The cast shadows are drawn opaque and blurred together, then shown
// at one opacity, so where two overlap the ground is no darker. Where the
// renderer has no filters, they are drawn opaque into one texture, which
// shows at that opacity, without the blur. A cast shadow at an opacity of
// its own, as the long one by a person's feet, goes in a group of its own
// shown the same way, so the ground is no darker where two of those overlap
// either.

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

/**
 * A soft ellipse `width` wide and `depth` times as deep, at `opacity`, its
 * centre `dx`, `dy` from where it is put.
 */
export interface Oval {
  readonly dx: number
  readonly dy: number
  readonly width: number
  readonly depth: number
  readonly opacity: number
}

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
   * Adds the shadow `owner` casts as the shape through `points`, which
   * already reaches away from the sun, as a box's in the city does.
   */
  castShape: (
    owner: string,
    points: readonly (readonly [number, number])[],
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
  /**
   * Adds the cast shadow `oval` describes for `owner` at `x`, `y`: a slate
   * ellipse in the group of cast shadows shown at its opacity, blurred and
   * faded with them. Its offset is in its own shape, so it stays when the
   * shadow moves.
   */
  castOval: (owner: string, x: number, y: number, oval: Oval) => Graphics
  /**
   * Adds the contact shadow `oval` describes for `owner` at `x`, `y`: the
   * soft spot, half as dark as its middle `oval.width` across. Its offset
   * is in its anchor, so it stays when the shadow moves.
   */
  spot: (owner: string, x: number, y: number, oval: Oval) => Sprite
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

/** Where a group of cast shadows shows at an opacity of its own. */
export function castGroupLabel(opacity: number): string {
  return `cast@${opacity}`
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
  const filters = new Map<string, Filter[]>()
  const filtersOf = (effects: VisualEffects, opacity: number) => {
    if (makeFilters === null) return []
    const key = `${effects}:${opacity}`
    let made = filters.get(key)
    if (made === undefined) {
      made = makeFilters({
        blur: effects === 'full' ? castShadow.blur : 0,
        opacity,
      })
      filters.set(key, made)
    }
    return made
  }
  let effects: VisualEffects = 'full'
  // The texture's pixels per unit; Pixi's default is the screen's.
  let resolution: number | undefined
  // Each group of cast shadows and the opacity it shows at.
  const groups = new Map<Container, number>()
  /** Shows `group` at `opacity` as one, filtered or through a texture. */
  const fade = (group: Container, opacity: number) => {
    groups.set(group, opacity)
    if (makeFilters === null) {
      group.cacheAsTexture(resolution === undefined ? true : { resolution })
      group.alpha = opacity
    } else group.filters = filtersOf(effects, opacity)
  }
  fade(cast, castShadow.opacity)
  /** The group of cast shadows shown at `opacity`, made the first time. */
  const groupAt = (opacity: number) => {
    if (opacity === castShadow.opacity) return cast
    const label = castGroupLabel(opacity)
    let group = layer.getChildByLabel(label)
    if (group === null) {
      group = new Container({ label })
      layer.addChildAt(group, layer.getChildIndex(contact))
      fade(group, opacity)
    }
    return group
  }

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
    castShape: (owner, points) =>
      cast.addChild(
        new Graphics({ label: `cast:${owner}` })
          .poly(points.flatMap(([x, y]) => [x, y]))
          .fill(light.slate),
      ),
    castOval: (owner, x, y, { dx, dy, width, depth, opacity }) =>
      groupAt(opacity).addChild(
        new Graphics({ label: `cast:${owner}`, x, y })
          .ellipse(dx, dy, width / 2, (width * depth) / 2)
          .fill(light.slate),
      ),
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
    spot: (owner, x, y, { dx, dy, width, depth, opacity }) => {
      const across = width / SPOT_HALF_RADIUS
      const deep = across * depth
      const sprite = new Sprite({
        texture: spot,
        label: `contact:${owner}`,
        anchor: { x: 0.5 - dx / across, y: 0.5 - dy / deep },
        x,
        y,
        alpha: opacity,
      })
      sprite.setSize(across, deep)
      return contact.addChild(sprite)
    },
    setEffects: (wanted) => {
      effects = wanted
      if (makeFilters === null) return
      for (const [group, opacity] of groups) {
        group.filters = filtersOf(effects, opacity)
      }
    },
    redraw: (wanted) => {
      if (makeFilters !== null) return
      const same = wanted === resolution
      resolution = wanted
      for (const group of groups.keys()) {
        if (same) group.updateCacheTexture()
        else group.cacheAsTexture({ resolution })
      }
    },
    destroy: () => {
      for (const group of groups.keys()) group.filters = []
      groups.clear()
      for (const made of filters.values()) {
        for (const filter of made) filter.destroy()
      }
      filters.clear()
    },
  }
}
