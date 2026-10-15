import {
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  TilingSprite,
  type Filter,
} from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import type { AssetManifest } from '../content/assets.ts'
import { ART_URLS, loadArt } from './art.ts'
import { tonesOf } from './light.ts'
import { ASSETS } from './manifest.ts'
import { SKY_COLOR } from './mountWorld.ts'
import { buildScene, type Scene } from './scene.ts'
import type { MakeFilters, ShadowFilters } from './shadows.ts'
import type { TruckView } from './truckView.ts'

const OPEN: TruckView = {
  open: true,
  croissants: 70,
  businessName: "Le P'tit Camion",
}
const CLOSED: TruckView = { ...OPEN, open: false, croissants: 0 }

/** The shipped manifest with `images` given to the pieces they name. */
function withImages(images: Record<string, string>): AssetManifest {
  return {
    ...ASSETS,
    pieces: ASSETS.pieces.map((piece) =>
      piece.id in images ? { ...piece, image: images[piece.id] } : piece,
    ),
  }
}

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

/** Builds the scene with text measured as 100 wide: node has no canvas. */
function build(
  manifest: AssetManifest,
  textures: ReadonlyMap<string, Texture> = new Map(),
  makeFilters: MakeFilters | null = fakeFilters(),
): Scene {
  return buildScene(manifest, textures, () => 100, makeFilters)
}

const hex = (colour: string) => Number.parseInt(colour.slice(1), 16)

/** `root` and every node under it, depth first. */
function everything(root: Container): Container[] {
  return [root, ...root.children.flatMap((child) => everything(child))]
}

/** The colours every Graphics under `root` strokes or fills with. */
function colours(root: Container, action: 'fill' | 'stroke'): number[] {
  return everything(root).flatMap((node) =>
    node instanceof Graphics
      ? node.context.instructions
          .filter((i) => i.action === action)
          .map((i) => (i.data.style as { color: number }).color)
      : [],
  )
}

/** The shadow layer's cast and contact shadows. */
function ground(scene: Scene) {
  const layer = scene.root.getChildByLabel(`layer:${ASSETS.light.shadowLayer}`)!
  return {
    layer,
    cast: layer.getChildByLabel('cast')!,
    contact: layer.getChildByLabel('contact')!,
  }
}

/** The labels of the shadows `owner` throws. */
function shadowsOf(scene: Scene, owner: string): Container[] {
  const { cast, contact } = ground(scene)
  return [...cast.children, ...contact.children].filter((s) =>
    s.label.endsWith(`:${owner}`),
  )
}

function node(scene: Scene, id: string): Container {
  const found = scene.root.getChildByLabel(id, true)
  if (found === null) throw new Error(`No piece ${id}`)
  return found
}

/** The art a piece shows: its image or its placeholder. */
function art(scene: Scene, id: string): Container {
  return node(scene, id).children[0]!
}

describe('buildScene', () => {
  it('builds one container per layer, back to front', () => {
    const scene = build(ASSETS)
    expect(scene.root.children.map((layer) => layer.label)).toEqual(
      ASSETS.layers.map((id) => `layer:${id}`),
    )
  })

  it('draws every piece in its layer, in order, at its position, with its placeholder', () => {
    const scene = build(ASSETS)
    const shadows = `layer:${ASSETS.light.shadowLayer}`
    for (const layer of scene.root.children) {
      if (layer.label === shadows) continue
      expect(layer.children.map((piece) => piece.label)).toEqual(
        ASSETS.pieces
          .filter((p) => `layer:${p.layer}` === layer.label)
          .map((p) => p.id),
      )
    }
    for (const piece of ASSETS.pieces) {
      const drawn = node(scene, piece.id)
      expect(drawn.position).toMatchObject({ x: piece.x, y: piece.y })
      expect(art(scene, piece.id).label).toBe('placeholder')
    }
  })

  it('swaps a placeholder for an image with a manifest change only', async () => {
    const texture = new Texture()
    const manifest = withImages({ truck: 'dummy.png' })
    const loadTexture = vi.fn(async () => texture)

    const scene = build(manifest, await loadArt(manifest, loadTexture))

    expect(loadTexture).toHaveBeenCalledExactlyOnceWith(
      ART_URLS.get('dummy.png'),
    )
    const truck = art(scene, 'truck')
    expect(truck).toBeInstanceOf(Sprite)
    expect((truck as Sprite).texture).toBe(texture)
    expect(truck.label).toBe('image')
    expect(node(scene, 'truck').position).toMatchObject({ x: 790, y: 430 })
    expect(truck.scale.x * texture.width).toBeCloseTo(580)
    expect(truck.scale.y * texture.height).toBeCloseTo(330)
    for (const piece of ASSETS.pieces.filter((p) => p.id !== 'truck')) {
      expect(art(scene, piece.id).label, piece.id).toBe('placeholder')
    }
  })

  it('keeps the placeholder when the image did not load', () => {
    const scene = build(withImages({ truck: 'dummy.png' }))
    expect(art(scene, 'truck').label).toBe('placeholder')
  })

  it('paints the sky the canvas is cleared to', () => {
    expect(ASSETS.palette.sky).toBe(SKY_COLOR)
  })
})

describe('the light on the placeholders', () => {
  it('draws no outlines', () => {
    const scene = build(ASSETS)
    for (const piece of ASSETS.pieces) {
      expect(colours(art(scene, piece.id), 'stroke'), piece.id).not.toContain(
        hex(ASSETS.palette.ink),
      )
    }
  })

  it('lights each surface in the tones of its colour', () => {
    const scene = build(ASSETS)
    const { palette, light } = ASSETS
    // The street is a top face: asphalt mixed with the sun, as the rule
    // sheet gives it.
    expect(colours(art(scene, 'street'), 'fill')).toContain(hex('#80796E'))
    const truck = tonesOf(palette.mustard, light)
    expect(colours(art(scene, 'truck'), 'fill')).toEqual(
      expect.arrayContaining([truck.top, truck.lit, truck.shade].map(hex)),
    )
    const leaves = tonesOf(palette.foliage, light)
    expect(colours(art(scene, 'tree'), 'fill')).toEqual(
      expect.arrayContaining([leaves.top, leaves.lit, leaves.shade].map(hex)),
    )
  })

  it('grades each facade from light at the top to slate at the foot, and lays bricks on it', () => {
    const scene = build(ASSETS)
    const facade = (id: string) =>
      art(scene, id).getChildByLabel('facade') as Sprite
    const bricks = (id: string) =>
      art(scene, id).getChildByLabel('bricks') as TilingSprite
    const triplexes = ASSETS.pieces.filter((p) => p.kind === 'triplex')
    for (const piece of triplexes) {
      expect(facade(piece.id).width).toBeCloseTo(piece.width)
      expect(facade(piece.id).height).toBeCloseTo(piece.height)
      expect(facade(piece.id).texture.label).toBe(
        `facade:${ASSETS.palette[piece.color]}`,
      )
      expect(bricks(piece.id)).toBeInstanceOf(TilingSprite)
    }
    // Each texture is made once and shared: one per facade colour, one for
    // all the bricks.
    expect(facade('triplex-1').texture).toBe(facade('triplex-4').texture)
    expect(facade('triplex-1').texture).not.toBe(facade('triplex-2').texture)
    expect(
      new Set(triplexes.map((piece) => bricks(piece.id).texture)).size,
    ).toBe(1)
  })

  it('tiles the sidewalk and speckles the street', () => {
    const scene = build(ASSETS)
    expect(art(scene, 'sidewalk').getChildByLabel('tiles')).toBeInstanceOf(
      TilingSprite,
    )
    expect(art(scene, 'street').getChildByLabel('speckle')).toBeInstanceOf(
      TilingSprite,
    )
  })

  it('throws short shadows under cornices, balconies, sills and the awning', () => {
    const scene = build(ASSETS)
    const { opacity, depth } = ASSETS.light.ledgeShadow
    const ledges = (id: string, kind: string) =>
      art(scene, id).children.filter((c) => c.label === `ledgeShadow:${kind}`)
    expect(ledges('triplex-1', 'cornice')).toHaveLength(1)
    expect(ledges('triplex-1', 'balcony')).toHaveLength(2)
    // A hood over each of the six windows, and a sill under each.
    expect(ledges('triplex-1', 'sill')).toHaveLength(12)
    expect(ledges('awning', 'awning')).toHaveLength(1)
    for (const [id, kind] of [
      ['triplex-1', 'cornice'],
      ['triplex-1', 'balcony'],
      ['triplex-1', 'sill'],
      ['awning', 'awning'],
    ] as const) {
      for (const shadow of ledges(id, kind)) {
        expect(shadow.alpha).toBe(opacity)
        expect(shadow.height).toBeCloseTo(depth[kind])
      }
    }
  })
})

describe('the shadows on the ground', () => {
  it('fill the shadow layer, the contact shadows over the cast ones', () => {
    const { layer, cast, contact } = ground(build(ASSETS))
    expect(layer.children).toEqual([cast, contact])
  })

  it.each([
    ['tree', 'tree', 1],
    ['lamp-post', 'lampPost', 1],
    ['truck', 'wheel', 2],
  ] as const)(
    "throws the %s's shadows from its foot to the lower right",
    (id, kind, contacts) => {
      const scene = build(ASSETS)
      const piece = ASSETS.pieces.find((p) => p.id === id)!
      const foot = { x: piece.x + piece.width / 2, y: piece.y + piece.height }
      const cast = shadowsOf(scene, id).filter((s) =>
        s.label.startsWith('cast:'),
      )
      const contact = shadowsOf(scene, id).filter((s) =>
        s.label.startsWith('contact:'),
      )
      expect(cast.length).toBeGreaterThan(0)
      for (const shadow of cast) {
        const { minX, maxX, maxY } = shadow.getBounds()
        // Further right than the foot is wide, and down onto the ground.
        expect(maxX - foot.x).toBeGreaterThan(foot.x - minX)
        expect(maxY).toBeGreaterThan(foot.y)
      }
      expect(contact).toHaveLength(contacts)
      for (const shadow of contact) {
        expect(shadow.y).toBeCloseTo(foot.y)
        expect(shadow.alpha).toBe(ASSETS.light.contactShadow.opacity[kind])
        expect(shadow.width).toBeGreaterThan(shadow.height)
      }
    },
  )

  it('leaves the shading and the shadows of a piece with an image to its art', async () => {
    const manifest = withImages({ tree: 'dummy.png', truck: 'dummy.png' })
    const textures = new Map([['dummy.png', new Texture()]])
    const scene = build(manifest, textures)
    expect(art(scene, 'tree')).toBeInstanceOf(Sprite)
    expect(shadowsOf(scene, 'tree')).toEqual([])
    expect(shadowsOf(scene, 'truck')).toEqual([])
    expect(shadowsOf(scene, 'lamp-post').length).toBeGreaterThan(0)
  })

  it('blurs the cast shadows and fades them as one, without the blur when simple', () => {
    const filters = fakeFilters()
    const scene = build(ASSETS, new Map(), filters)
    const { cast } = ground(scene)
    const { blur, opacity } = ASSETS.light.castShadow
    expect(filters.asked).toEqual([{ blur, opacity }])
    expect(cast.filters).toEqual([expect.objectContaining({ blur, opacity })])
    expect(cast.alpha).toBe(1)

    scene.setEffects('simple')
    expect(filters.asked).toEqual([
      { blur, opacity },
      { blur: 0, opacity },
    ])
    expect(cast.filters).toEqual([
      expect.objectContaining({ blur: 0, opacity }),
    ])

    scene.setEffects('full')
    expect(filters.asked).toHaveLength(2)
    expect(cast.filters).toEqual([expect.objectContaining({ blur, opacity })])
  })

  it('shows the cast shadows through one texture at their opacity where the renderer cannot filter', () => {
    const scene = build(ASSETS, new Map(), null)
    const { cast } = ground(scene)
    // Drawn opaque into the texture, which alone fades: where two overlap,
    // the ground is no darker.
    expect(cast.isCachedAsTexture).toBe(true)
    expect(cast.alpha).toBe(ASSETS.light.castShadow.opacity)
    expect(cast.children.length).toBeGreaterThan(1)
    for (const shadow of cast.children) expect(shadow.alpha).toBe(1)
    expect(cast.filters ?? []).toEqual([])

    for (const effects of ['simple', 'full'] as const) {
      scene.setEffects(effects)
      expect(cast.isCachedAsTexture).toBe(true)
      expect(cast.alpha).toBe(ASSETS.light.castShadow.opacity)
      expect(cast.filters ?? []).toEqual([])
    }
    expect(() => scene.destroy()).not.toThrow()
  })

  it('redraws that texture as the shadows move, at the pixels it is asked for', () => {
    const scene = build(ASSETS, new Map(), null)
    const group = ground(scene).cast.renderGroup!
    scene.shadows.redraw(3)
    expect(group.textureOptions.resolution).toBe(3)
    expect(group.textureNeedsUpdate).toBe(true)

    // As a render draws it.
    group.textureNeedsUpdate = false
    scene.shadows.redraw(3)
    expect(group.textureNeedsUpdate).toBe(true)
    expect(group.textureOptions.resolution).toBe(3)
    group.textureNeedsUpdate = false
    scene.shadows.redraw(1.5)
    expect(group.textureOptions.resolution).toBe(1.5)
    expect(group.textureNeedsUpdate).toBe(true)
  })

  it('keeps the cast shadows out of any texture where the filters fade them', () => {
    const scene = build(ASSETS)
    const { cast } = ground(scene)
    scene.shadows.redraw(2)
    expect(cast.isCachedAsTexture).toBe(false)
    expect(cast.alpha).toBe(1)
  })

  it('frees the textures it made when it is taken down', () => {
    const scene = build(ASSETS)
    const bricks = (
      art(scene, 'triplex-1').getChildByLabel('bricks') as TilingSprite
    ).texture
    scene.destroy()
    expect(scene.root.destroyed).toBe(true)
    expect(bricks.destroyed).toBe(true)
  })
})

describe('Scene.update', () => {
  it('rolls up the awning and hangs the « Fermé » sign on a closed day', () => {
    const scene = build(ASSETS)
    scene.update(CLOSED)
    expect(node(scene, 'awning-rolled').visible).toBe(true)
    expect(node(scene, 'closed-sign').visible).toBe(true)
    expect(node(scene, 'awning').visible).toBe(false)
    expect(node(scene, 'steam').visible).toBe(false)
    expect(node(scene, 'truck').visible).toBe(true)
  })

  it('opens the awning and steams the espresso machine on an open day', () => {
    const scene = build(ASSETS)
    scene.update(CLOSED)
    scene.update(OPEN)
    expect(node(scene, 'awning').visible).toBe(true)
    expect(node(scene, 'steam').visible).toBe(true)
    expect(node(scene, 'awning-rolled').visible).toBe(false)
    expect(node(scene, 'closed-sign').visible).toBe(false)
  })

  it('writes « Fermé » on the closed sign', () => {
    const scene = build(ASSETS)
    const text = art(scene, 'closed-sign').children.find(
      (child) => child instanceof Text,
    )
    expect(text?.text).toBe('Fermé')
    expect(text?.style.fontFamily).toBe('Fredoka, sans-serif')
  })

  describe('the croissant rack', () => {
    const croissants = ASSETS.pieces.find((p) => p.id === 'croissants')!
    const maskOf = (scene: Scene) =>
      node(scene, 'croissants').getChildByLabel('mask') as Graphics

    it.each([
      [70, 0.75],
      [100, 1],
      [1, 0.25],
    ])('shows %i croissants up to %f of its height', (units, fill) => {
      const scene = build(ASSETS)
      scene.update({ ...OPEN, croissants: units })

      const bounds = maskOf(scene).getLocalBounds()
      expect(art(scene, 'croissants').mask).toBe(maskOf(scene))
      expect(art(scene, 'croissants').visible).toBe(true)
      expect(bounds.minY).toBeCloseTo(croissants.height * (1 - fill))
      expect(bounds.maxY).toBeCloseTo(croissants.height)
      expect(bounds.width).toBeCloseTo(croissants.width)
    })

    it('shows no croissants when there are none', () => {
      const scene = build(ASSETS)
      scene.update(OPEN)
      scene.update(CLOSED)
      expect(art(scene, 'croissants').visible).toBe(false)
      expect(node(scene, 'croissant-rack').visible).toBe(true)
    })

    it('masks image art the same way', () => {
      const manifest = withImages({ croissants: 'dummy.png' })
      const textures = new Map([['dummy.png', new Texture()]])
      const scene = build(manifest, textures)
      scene.update(OPEN)
      expect(art(scene, 'croissants')).toBeInstanceOf(Sprite)
      expect(art(scene, 'croissants').mask).toBe(maskOf(scene))
      expect(maskOf(scene).getLocalBounds().minY).toBeCloseTo(
        croissants.height * 0.25,
      )
    })
  })

  describe('the sign', () => {
    const sign = ASSETS.pieces.find((p) => p.id === 'truck-sign')!
    const nameOf = (scene: Scene) =>
      node(scene, 'truck-sign').getChildByLabel('name') as Text

    it('writes the business name in Fredoka, centred on the sign', () => {
      const scene = buildScene(ASSETS, new Map(), () => 100, fakeFilters())
      scene.update(OPEN)

      const name = nameOf(scene)
      expect(name.text).toBe("Le P'tit Camion")
      expect(name.style.fontFamily).toBe('Fredoka, sans-serif')
      expect(name.style.fontWeight).toBe('600')
      expect(name.style.fill).toBe(ASSETS.palette.cream)
      expect(name.position).toMatchObject({
        x: sign.width / 2,
        y: sign.height / 2,
      })
      expect(name.anchor).toMatchObject({ x: 0.5, y: 0.5 })
      expect(name.scale.x).toBe(1)
    })

    it("writes the player's business name, and a new one when it changes", () => {
      const scene = buildScene(ASSETS, new Map(), () => 100, fakeFilters())
      scene.update({ ...OPEN, businessName: 'Chez Mimi' })
      expect(nameOf(scene).text).toBe('Chez Mimi')
      scene.update(OPEN)
      expect(nameOf(scene).text).toBe("Le P'tit Camion")
    })

    it('shrinks a name too wide for the sign to fit', () => {
      const scene = buildScene(ASSETS, new Map(), () => 600, fakeFilters())
      scene.update(OPEN)
      const room = sign.width - 2 * ASSETS.signText.paddingX
      expect(nameOf(scene).scale.x).toBeCloseTo(room / 600)
      expect(nameOf(scene).scale.y).toBeCloseTo(room / 600)
    })

    it('measures the name only when it changes', () => {
      const measure = vi.fn(() => 100)
      const scene = buildScene(ASSETS, new Map(), measure, fakeFilters())
      scene.update(OPEN)
      scene.update(CLOSED)
      expect(measure).toHaveBeenCalledOnce()
    })
  })
})

describe('Scene.animate', () => {
  it('lifts a steam puff as it fades in and out, once a period', () => {
    const scene = build(ASSETS)
    const { periodMs, rise } = ASSETS.steamPuff
    const steam = art(scene, 'steam')

    scene.animate(periodMs / 2)
    expect(steam.y).toBeCloseTo(-rise / 2)
    expect(steam.alpha).toBeCloseTo(1)

    scene.animate(periodMs / 4)
    expect(steam.y).toBeCloseTo((-rise * 3) / 4)

    scene.animate(periodMs / 4)
    expect(steam.y).toBeCloseTo(0)
    expect(steam.alpha).toBeCloseTo(0)
    expect(node(scene, 'steam').position).toMatchObject({ x: 1024, y: 500 })
  })
})
