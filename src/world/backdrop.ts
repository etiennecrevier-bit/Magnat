import { Container, RenderTexture, Sprite, type ColorSource } from 'pixi.js'

// The street's backdrop drawn once (#281). Everything behind the shadows,
// the sky, the buildings, the sidewalk and the road, never moves, yet each
// frame drew every piece of it, one over the other. It is drawn into one
// texture of the screen's pixels, and each frame shows that texture under
// what moves, then the atmosphere over all of it, as before: its blends
// still cover the truck and the people, so nothing looks different. It is
// drawn again when the screen changes size or the street changes (a heat
// wave's sky).

/** The part of Pixi's renderer that draws into a texture. */
export interface BakeRenderer {
  readonly resolution: number
  render: (options: {
    container: Container
    target: RenderTexture
    clear: boolean
    clearColor: ColorSource
  }) => void
}

/** What the backdrop is drawn from, on the stage. */
export interface BackdropParts {
  /** The street, whose first children are drawn into the backdrop. */
  readonly street: Container
  /** Those children: every layer under the shadows. */
  readonly layers: readonly Container[]
  /** Anything else on the stage, which the backdrop leaves out. */
  readonly others: readonly Container[]
}

export interface Backdrop {
  /** The backdrop draws again before the next frame. */
  invalidate: () => void
  /**
   * Draws the backdrop again, if asked, for a screen of `width` × `height`
   * logical pixels; a frame calls it first.
   */
  update: (width: number, height: number) => void
  /** Takes it down, with its texture, and shows the parts live again. */
  destroy: () => void
}

/**
 * Draws `parts`' layers into a texture shown first on `stage`, in their
 * place, and leaves them out of each frame. `clearColor` is what shows
 * where the street does not reach, the canvas's background.
 */
export function createBackdrop(
  stage: Container,
  parts: BackdropParts,
  renderer: BakeRenderer,
  clearColor: ColorSource,
): Backdrop {
  const baked = new Set<Container>(parts.layers)
  let texture: RenderTexture | null = null
  const sprite = new Sprite({ label: 'backdrop' })
  stage.addChildAt(sprite, 0)
  let dirty = true

  /** Whether each part is drawn: the baked ones, or the others. */
  const draw = (bakedOnly: boolean) => {
    sprite.renderable = !bakedOnly
    for (const child of parts.street.children) {
      child.renderable = baked.has(child) === bakedOnly
    }
    for (const other of parts.others) other.renderable = !bakedOnly
  }

  return {
    invalidate: () => {
      dirty = true
    },
    update: (width, height) => {
      const { resolution } = renderer
      const resized =
        texture === null ||
        texture.width !== width ||
        texture.height !== height ||
        texture.source.resolution !== resolution
      if (!dirty && !resized) return
      dirty = false
      if (resized) {
        texture?.destroy(true)
        texture = RenderTexture.create({ width, height, resolution })
        sprite.texture = texture
      }
      draw(true)
      renderer.render({
        container: stage,
        target: texture as RenderTexture,
        clear: true,
        clearColor,
      })
      draw(false)
    },
    destroy: () => {
      for (const part of baked) part.renderable = true
      sprite.destroy()
      texture?.destroy(true)
      texture = null
    },
  }
}

/**
 * The renderer `renderer` is, when it draws into textures the way the
 * backdrop needs: WebGL's or WebGPU's (`type` 1 or 2), not Canvas 2D's,
 * nor a test's.
 */
export function bakeRenderer(
  renderer: { readonly type: number } | undefined,
): BakeRenderer | null {
  const found = renderer as Partial<BakeRenderer> & { type?: number }
  return found !== undefined &&
    (found.type === 1 || found.type === 2) &&
    typeof found.render === 'function' &&
    typeof found.resolution === 'number'
    ? (found as BakeRenderer)
    : null
}
