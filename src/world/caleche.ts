import { Container, Sprite, type Texture } from 'pixi.js'
import type { DistrictStreet } from '../content/assets.ts'
import type { Span } from './crowd.ts'

// The calèche that crosses a district's street now and then in summer
// (#264): decor only, never a customer and never picked. It comes in past
// the right edge of the street on screen, crosses the road in front of the
// people, right to left as the target draws it, and goes past the left
// edge; the next comes `everyMs`, give or take `jitterMs`, later. It moves
// in real time, so it freezes with the ticker.

/** The calèche's settings, from the district's street. */
export type CalecheSettings = DistrictStreet['caleche']

/** When the calèche crosses, and where it is. */
export interface CalecheClock {
  /**
   * Moves on by `deltaMs` real milliseconds with `span` of the street on
   * screen. Returns the calèche's left edge while it crosses, else null.
   */
  step: (deltaMs: number, span: Span) => number | null
  /** Takes it off the street, until its next crossing. */
  reset: () => void
}

/**
 * The calèche's clock: the first crossing within `everyMs` of the start,
 * each next one `everyMs`, give or take `jitterMs`, after the last left.
 */
export function createCalecheClock(
  settings: CalecheSettings,
  random: () => number,
): CalecheClock {
  const gap = () =>
    Math.max(0, settings.everyMs + (random() * 2 - 1) * settings.jitterMs)
  let waitMs = random() * settings.everyMs
  let x: number | null = null
  return {
    step: (deltaMs, span) => {
      if (deltaMs <= 0) return x
      if (x === null) {
        waitMs -= deltaMs
        if (waitMs > 0) return null
        x = span.right
        return x
      }
      x -= (settings.speed * deltaMs) / 1000
      if (x + settings.width < span.left) {
        x = null
        waitMs = gap()
      }
      return x
    },
    reset: () => {
      x = null
      waitMs = gap()
    },
  }
}

/** The calèche on the street. */
export interface Caleche {
  /** Its drawing, to add over the people. */
  readonly root: Container
  /** Lets it cross while the street shows its summer. */
  show: (summer: boolean) => void
  /** Moves it on by `deltaMs` real milliseconds with `span` on screen. */
  frame: (deltaMs: number, span: Span) => void
  destroy: () => void
}

/**
 * The calèche of `settings`, drawn with `texture`; without one, as when its
 * image failed to load, nothing crosses.
 */
export function createCaleche(
  settings: CalecheSettings,
  texture: Texture | undefined,
  random: () => number,
): Caleche {
  const root = new Container({ label: 'caleche', visible: false })
  if (texture !== undefined) {
    const sprite = root.addChild(new Sprite({ texture, label: 'image' }))
    sprite.setSize(settings.width, settings.height)
  }
  root.y = settings.y
  const clock = createCalecheClock(settings, random)
  let summer = false
  return {
    root,
    show: (shown) => {
      if (summer && !shown) clock.reset()
      summer = shown
      if (!shown) root.visible = false
    },
    frame: (deltaMs, span) => {
      if (!summer || texture === undefined) return
      const x = clock.step(deltaMs, span)
      root.visible = x !== null
      if (x !== null) root.x = x
    },
    destroy: () => root.destroy({ children: true }),
  }
}
