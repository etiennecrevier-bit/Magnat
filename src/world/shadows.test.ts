import { Container, Graphics, Texture, type Filter } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { CROWD } from './crowdSettings.ts'
import { ASSETS } from './manifest.ts'
import { SPOT_HALF_RADIUS } from './noise.ts'
import {
  castGroupLabel,
  createShadows,
  type MakeFilters,
  type Oval,
  type ShadowFilters,
} from './shadows.ts'

const LIGHT = ASSETS.light
const { reach, feet } = CROWD.figure.shadow

/**
 * Filters that only say what they were asked for: Pixi's need a canvas,
 * which Node has none of.
 */
function fakeFilters(): MakeFilters & { asked: ShadowFilters[] } {
  const asked: ShadowFilters[] = []
  const make = (wanted: ShadowFilters) => {
    asked.push(wanted)
    return [{ ...wanted, destroy: () => {} }] as unknown as Filter[]
  }
  return Object.assign(make, { asked })
}

/** A person's long shadow, `height` tall, as the street sizes it. */
function long(height: number): Oval {
  return {
    ...reach,
    dx: reach.dx * height,
    dy: reach.dy * height,
    width: reach.width * height,
  }
}

/** The opacity a shape of `node` covers `point` with: 0 outside it. */
function cover(node: Container, point: { x: number; y: number }): number {
  if (!(node instanceof Graphics)) return 0
  if (!node.containsPoint(node.toLocal(point))) return 0
  const fill = node.context.instructions.find((i) => i.action === 'fill')!
  return node.alpha * (fill.data.style as { alpha: number }).alpha
}

/** `a` drawn over `b`, both opacities. */
const over = (a: number, b: number) => a + b * (1 - a)

/** The opacity a group shows at, from its alpha or its filters. */
function opacityOf(group: Container): number {
  const filtered = (group.filters ?? []) as unknown as ShadowFilters[]
  return filtered.reduce((alpha, f) => alpha * (f.opacity ?? 1), group.alpha)
}

/**
 * How dark the cast shadows make the ground at `point`, as Pixi draws them:
 * a group with filters or drawn into a texture is drawn whole, then faded;
 * any other fades each of its shapes apart.
 */
function darkness(layer: Container, point: { x: number; y: number }): number {
  let total = 0
  for (const group of layer.children) {
    if (group.label === 'contact') continue
    const flattened =
      (group.filters ?? []).length > 0 || group.isCachedAsTexture
    const opacity = opacityOf(group)
    const covers = group.children.map((node) => cover(node, point))
    const shown = flattened
      ? covers.reduce(over, 0) * opacity
      : covers.map((c) => c * opacity).reduce(over, 0)
    total = over(shown, total)
  }
  return total
}

describe('createShadows: the long shadows of people', () => {
  it.each([
    ['filtered', fakeFilters()],
    ['drawn into a texture', null],
  ] as const)(
    'shows them at their own opacity, no darker where two overlap: %s',
    (_, makeFilters) => {
      const layer = new Container()
      const shadows = createShadows(layer, LIGHT, Texture.WHITE, makeFilters)
      const oval = long(116)
      // Two people side by side, their shadows overlapping.
      shadows.castOval('customer', 0, 0, oval)
      shadows.castOval('customer', oval.width / 3, 0, oval)
      const group = layer.getChildByLabel(castGroupLabel(reach.opacity))!
      expect(group.children).toHaveLength(2)
      const alone = { x: oval.dx - oval.width * 0.4, y: oval.dy }
      const both = { x: oval.dx + oval.width * 0.2, y: oval.dy }
      expect(cover(group.children[0]!, both)).toBe(1)
      expect(cover(group.children[1]!, both)).toBe(1)
      expect(darkness(layer, alone)).toBeCloseTo(reach.opacity)
      expect(darkness(layer, both)).toBeCloseTo(reach.opacity)
      for (const effects of ['simple', 'full'] as const) {
        shadows.setEffects(effects)
        expect(darkness(layer, both)).toBeCloseTo(reach.opacity)
      }
      // Each shape opaque and slate, faded only with the others.
      for (const shadow of group.children as Graphics[]) {
        expect(shadow.alpha).toBe(1)
        expect(
          shadow.context.instructions.map(
            (i) => i.data.style as { color: number; alpha: number },
          ),
        ).toEqual([
          expect.objectContaining({
            color: Number.parseInt(LIGHT.slate.slice(1), 16),
            alpha: 1,
          }),
        ])
      }
      if (makeFilters === null) {
        expect(group.isCachedAsTexture).toBe(true)
        expect(group.alpha).toBe(reach.opacity)
      } else {
        expect(group.alpha).toBe(1)
        expect(group.isCachedAsTexture).toBe(false)
      }
    },
  )

  it("counts each shape apart where a group isn't drawn whole", () => {
    // What would darken the overlaps: the check above catches it.
    const layer = new Container()
    const group = layer.addChild(new Container({ alpha: 0.2 }))
    for (const x of [0, 20]) {
      group.addChild(new Graphics({ x }).ellipse(0, 0, 30, 4).fill('#34404F'))
    }
    expect(darkness(layer, { x: 10, y: 0 })).toBeCloseTo(0.36)
  })

  it('goes over the cast shadows and under the contact ones, made once per opacity', () => {
    const layer = new Container()
    const shadows = createShadows(layer, LIGHT, Texture.WHITE, fakeFilters())
    expect(layer.children.map((c) => c.label)).toEqual(['cast', 'contact'])
    shadows.castOval('a', 0, 0, long(116))
    shadows.castOval('b', 50, 0, long(100))
    const label = castGroupLabel(reach.opacity)
    expect(layer.children.map((c) => c.label)).toEqual([
      'cast',
      label,
      'contact',
    ])
    // At the cast shadows' own opacity, one goes with them.
    shadows.castOval('c', 0, 0, {
      ...long(116),
      opacity: LIGHT.castShadow.opacity,
    })
    expect(shadows.cast.children.map((c) => c.label)).toEqual(['cast:c'])
  })

  it('blurs them with the full effects only, as the cast shadows', () => {
    const filters = fakeFilters()
    const layer = new Container()
    const shadows = createShadows(layer, LIGHT, Texture.WHITE, filters)
    shadows.setEffects('simple')
    shadows.castOval('customer', 0, 0, long(116))
    const group = layer.getChildByLabel(castGroupLabel(reach.opacity))!
    const { blur, opacity } = LIGHT.castShadow
    expect(group.filters).toEqual([
      expect.objectContaining({ blur: 0, opacity: reach.opacity }),
    ])
    shadows.setEffects('full')
    expect(group.filters).toEqual([
      expect.objectContaining({ blur, opacity: reach.opacity }),
    ])
    expect(shadows.cast.filters).toEqual([
      expect.objectContaining({ blur, opacity }),
    ])
    shadows.destroy()
    expect(group.filters ?? []).toEqual([])
    expect(shadows.cast.filters ?? []).toEqual([])
  })

  it('redraws their texture with the cast shadows where the renderer cannot filter', () => {
    const layer = new Container()
    const shadows = createShadows(layer, LIGHT, Texture.WHITE, null)
    shadows.redraw(2)
    shadows.castOval('customer', 0, 0, long(116))
    const group = layer.getChildByLabel(castGroupLabel(reach.opacity))!
    const rendered = group.renderGroup!
    // Made at the pixels already asked for.
    expect(rendered.textureOptions.resolution).toBe(2)
    rendered.textureNeedsUpdate = false
    shadows.redraw(2)
    expect(rendered.textureNeedsUpdate).toBe(true)
    shadows.redraw(3)
    expect(rendered.textureOptions.resolution).toBe(3)
    expect(shadows.cast.renderGroup!.textureOptions.resolution).toBe(3)
  })

  it('reaches to the lower right of the feet, in its own shape, as the reference', () => {
    const layer = new Container()
    const shadows = createShadows(layer, LIGHT, Texture.WHITE, fakeFilters())
    const oval = long(116)
    const shadow = shadows.castOval('customer', 300, 600, oval)
    expect(shadow.position).toMatchObject({ x: 300, y: 600 })
    const { minX, maxX, minY, maxY } = shadow.getLocalBounds()
    expect((minX + maxX) / 2).toBeCloseTo(26)
    expect((minY + maxY) / 2).toBeCloseTo(-1)
    expect(maxX - minX).toBeCloseTo(60)
    expect(maxY - minY).toBeCloseTo(8)
  })
})

describe('createShadows: the spot under the feet', () => {
  it('centres it off the feet in its anchor, half dark as wide as the reference, at its opacity', () => {
    const layer = new Container()
    const shadows = createShadows(layer, LIGHT, Texture.WHITE, fakeFilters())
    const height = 116
    const spot = shadows.spot('customer', 300, 600, {
      ...feet,
      dx: feet.dx * height,
      dy: feet.dy * height,
      width: feet.width * height,
    })
    expect(spot.parent).toBe(shadows.contact)
    expect(spot.label).toBe('contact:customer')
    expect(spot.position).toMatchObject({ x: 300, y: 600 })
    expect(spot.alpha).toBe(feet.opacity)
    expect(feet.opacity).toBe(0.45)
    const { minX, maxX, minY, maxY } = spot.getBounds()
    expect((minX + maxX) / 2).toBeCloseTo(304)
    expect((minY + maxY) / 2).toBeCloseTo(601)
    expect((maxX - minX) * SPOT_HALF_RADIUS).toBeCloseTo(44)
    expect((maxY - minY) * SPOT_HALF_RADIUS).toBeCloseTo(10)
    // It stays off the feet wherever it moves.
    spot.position.set(10, 20)
    const moved = spot.getBounds()
    expect((moved.minX + moved.maxX) / 2).toBeCloseTo(14)
  })
})
