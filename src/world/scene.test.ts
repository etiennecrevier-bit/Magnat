import {
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  type Filter,
} from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { streetManifest, type AssetManifest } from '../content/assets.ts'
import type { StreetChange } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import type { StreetModifier } from '../engine/types.ts'
import { ART_URLS, loadArt } from './art.ts'
import { fitStreet } from './layout.ts'
import { tonesOf } from './light.ts'
import { ASSETS } from './manifest.ts'
import { SKY_COLOR } from './mountWorld.ts'
import { buildScene, monthName, type Scene } from './scene.ts'
import type { MakeFilters, ShadowFilters } from './shadows.ts'
import { truckView, type TruckView } from './truckView.ts'

const OPEN: TruckView = {
  truck: 'plateau',
  district: 'plateau',
  open: true,
  croissants: 70,
  selling: { cafe: true, chocolat: true, croissant: true, limonade: false },
  inSeason: { cafe: true, chocolat: true, croissant: true, limonade: false },
  businessName: "Le P'tit Camion",
  modifiers: [],
  stored: false,
  reopens: null,
  ownerHere: true,
  staff: 0,
  rival: false,
  season: 'summer',
}
const CLOSED: TruckView = { ...OPEN, open: false, croissants: 0 }

/** The shipped manifest with only `images`, given to the pieces they name. */
function withImages(images: Record<string, string>): AssetManifest {
  return {
    ...ASSETS,
    pieces: ASSETS.pieces.map((piece) => ({
      ...piece,
      image: images[piece.id],
    })),
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

    const scene = build(
      manifest,
      await loadArt(manifest.pieces, loadTexture, manifest.artResolution),
    )

    expect(loadTexture).toHaveBeenCalledExactlyOnceWith(
      ART_URLS.get('dummy.png'),
    )
    const truck = art(scene, 'truck')
    expect(truck).toBeInstanceOf(Sprite)
    expect((truck as Sprite).texture).toBe(texture)
    expect(truck.label).toBe('image')
    expect(node(scene, 'truck').position).toMatchObject({ x: 540, y: 450 })
    expect(truck.scale.x * texture.width).toBeCloseTo(478)
    expect(truck.scale.y * texture.height).toBeCloseTo(266)
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
    const truck = tonesOf(palette.mustard, light)
    expect(colours(art(scene, 'truck'), 'fill')).toEqual(
      expect.arrayContaining([truck.top, truck.lit, truck.shade].map(hex)),
    )
    // The counter's steel top is a face looking up, mixed with the sun.
    expect(colours(art(scene, 'counter'), 'fill')).toContain(
      hex(tonesOf(palette.steel, light).top),
    )
  })

  it("throws short shadows under the counter's top and the awning", () => {
    const scene = build(ASSETS)
    const { opacity, depth } = ASSETS.light.ledgeShadow
    const ledges = (id: string, kind: string) =>
      art(scene, id).children.filter((c) => c.label === `ledgeShadow:${kind}`)
    expect(ledges('counter', 'sill')).toHaveLength(1)
    expect(ledges('awning', 'awning')).toHaveLength(1)
    for (const [id, kind] of [
      ['counter', 'sill'],
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
    ['truck', 'wheel', 2],
    ['rival-truck', 'wheel', 2],
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
    const manifest = withImages({ truck: 'dummy.png' })
    const textures = new Map([['dummy.png', new Texture()]])
    const scene = build(manifest, textures)
    expect(art(scene, 'truck')).toBeInstanceOf(Sprite)
    expect(shadowsOf(scene, 'truck')).toEqual([])
    expect(shadowsOf(scene, 'rival-truck').length).toBeGreaterThan(0)
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
    const ledge = (
      art(scene, 'awning').getChildByLabel('ledgeShadow:awning') as Sprite
    ).texture
    scene.destroy()
    expect(scene.root.destroyed).toBe(true)
    expect(ledge.destroyed).toBe(true)
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
      [70, 1],
      [100, 1],
      [50, 2 / 3],
      [1, 1 / 3],
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
      scene.update({ ...OPEN, croissants: 40 })
      expect(art(scene, 'croissants')).toBeInstanceOf(Sprite)
      expect(art(scene, 'croissants').mask).toBe(maskOf(scene))
      expect(maskOf(scene).getLocalBounds().minY).toBeCloseTo(
        croissants.height / 3,
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

describe("the truck's lettering", () => {
  it('writes « CAFÉ · CROISSANTS » in Fredoka ink, as tall as its box and centred in it', () => {
    const scene = build(ASSETS)
    const piece = ASSETS.pieces.find((p) => p.id === 'lettering')!
    const text = art(scene, 'lettering').getChildByLabel('text', true) as Text
    expect(text.text).toBe('CAFÉ · CROISSANTS')
    expect(text.style.fontFamily).toBe('Fredoka, sans-serif')
    expect(text.style.fontWeight).toBe('600')
    expect(text.style.fill).toBe(ASSETS.palette.ink)
    expect(text.style.fontSize).toBe(piece.height)
    expect(text.anchor).toMatchObject({ x: 0.5, y: 0.5 })
    expect(text.position).toMatchObject({
      x: piece.width / 2,
      y: piece.height / 2,
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
    expect(node(scene, 'steam').position).toMatchObject({ x: 597, y: 490 })
  })
})

describe('Scene.update: the events on the street', () => {
  /** A change from `event`, in effect on the day shown. */
  const change = (event: string, what: StreetChange): StreetModifier => ({
    event,
    change: what,
    fromDay: 2,
    lastDay: 4,
  })
  const FEWER: StreetChange = { kind: 'walkIns', factor: 0.65 }
  const MORE: StreetChange = { kind: 'walkIns', factor: 1.8 }
  const COLD: StreetChange = {
    kind: 'appeal',
    product: 'chocolat',
    factor: 0.3,
  }
  const CASES = [
    {
      name: 'construction',
      modifier: change('conesOrange', FEWER),
      pieces: ['cones-left', 'cones-right', 'road-sign'],
    },
    {
      name: 'a competitor',
      modifier: change('concurrence', { ...FEWER, segment: 'aubaine' }),
      pieces: ['rival-truck'],
    },
    {
      name: 'a festival',
      modifier: change('festival', MORE),
      pieces: ['bunting', 'festival-banner'],
    },
    {
      name: 'a heat wave',
      modifier: change('canicule', COLD),
      pieces: ['heat-sky'],
    },
    {
      name: 'café unavailable',
      modifier: change('machineTousse', {
        kind: 'unavailable',
        product: 'cafe',
      }),
      pieces: ['out-of-order'],
    },
  ]
  const EVENT_PIECES = CASES.flatMap(({ pieces }) => pieces)
  const shown = (scene: Scene) =>
    EVENT_PIECES.filter((id) => node(scene, id).visible)

  it('lists every piece an event shows', () => {
    const switched = ASSETS.pieces.filter(
      ({ shows }) => typeof shows === 'object' && !('sells' in shows),
    )
    expect(switched.map((p) => p.id).sort()).toEqual([...EVENT_PIECES].sort())
  })

  it('hides every event piece while no change is in effect', () => {
    const scene = build(ASSETS)
    scene.update(OPEN)
    expect(shown(scene)).toEqual([])
    scene.update(CLOSED)
    expect(shown(scene)).toEqual([])
  })

  it.each(CASES)(
    'shows only the pieces of $name while it is in effect, then hides them',
    ({ modifier, pieces }) => {
      const scene = build(ASSETS)
      scene.update({ ...OPEN, modifiers: [modifier] })
      expect(shown(scene)).toEqual(pieces)
      scene.update(OPEN)
      expect(shown(scene)).toEqual([])
    },
  )

  it('shows several at once, open or closed', () => {
    const scene = build(ASSETS)
    const [cones, rival, , heat] = CASES
    scene.update({
      ...CLOSED,
      modifiers: [cones!.modifier, rival!.modifier, heat!.modifier],
    })
    expect(shown(scene)).toEqual([
      ...cones!.pieces,
      ...rival!.pieces,
      ...heat!.pieces,
    ])
  })

  it('shows no café card while another product cannot be sold', () => {
    const scene = build(ASSETS)
    scene.update({
      ...OPEN,
      modifiers: [
        change('essai', { kind: 'unavailable', product: 'croissant' }),
      ],
    })
    expect(node(scene, 'out-of-order').visible).toBe(false)
  })

  it('sets the lemonade jar on the counter only while lemonade sells (#261)', () => {
    const scene = build(ASSETS)
    const jar = node(scene, 'lemonade-jar')
    const selling = { ...OPEN.selling, limonade: true }
    scene.update(OPEN)
    expect(jar.visible).toBe(false)
    scene.update({ ...OPEN, selling })
    expect(jar.visible).toBe(true)
    // Drawn in code, over the counter it stands on.
    expect(art(scene, 'lemonade-jar').label).toBe('placeholder')
    const truck = jar.parent!
    expect(truck.getChildIndex(jar)).toBeGreaterThan(
      truck.getChildIndex(node(scene, 'counter')),
    )
    scene.update({ ...CLOSED, selling })
    expect(jar.visible).toBe(false)
    scene.update({
      ...OPEN,
      selling,
      modifiers: [
        change('essai', { kind: 'unavailable', product: 'limonade' }),
      ],
    })
    expect(jar.visible).toBe(false)
  })

  it('stops the steam while the café cannot be sold, then steams again', () => {
    const scene = build(ASSETS)
    const [, , , , broken] = CASES
    scene.update({ ...OPEN, modifiers: [broken!.modifier] })
    expect(node(scene, 'out-of-order').visible).toBe(true)
    expect(node(scene, 'steam').visible).toBe(false)
    scene.update(OPEN)
    expect(node(scene, 'steam').visible).toBe(true)
    scene.update({
      ...OPEN,
      modifiers: [
        change('essai', { kind: 'unavailable', product: 'croissant' }),
      ],
    })
    expect(node(scene, 'steam').visible).toBe(true)
  })

  it.each(['cones-left', 'cones-right', 'road-sign', 'rival-truck'])(
    "shows and hides the %s's shadows with it",
    (id) => {
      const scene = build(ASSETS)
      const thrown = shadowsOf(scene, id)
      expect(thrown.length).toBeGreaterThan(0)
      scene.update(OPEN)
      for (const shadow of thrown) expect(shadow.visible).toBe(false)
      const [cones, rival] = CASES
      scene.update({ ...OPEN, modifiers: [cones!.modifier, rival!.modifier] })
      for (const shadow of thrown) expect(shadow.visible).toBe(true)
      scene.update(OPEN)
      for (const shadow of thrown) expect(shadow.visible).toBe(false)
    },
  )

  it("keeps the street's other shadows whatever happens", () => {
    const scene = build(ASSETS)
    scene.update(OPEN)
    for (const id of ['truck']) {
      for (const shadow of shadowsOf(scene, id)) {
        expect(shadow.visible, id).toBe(true)
      }
    }
  })

  it.each([
    ['cones-left', 'prop'],
    ['cones-right', 'prop'],
    ['road-sign', 'prop'],
  ] as const)(
    "throws the %s's shadows from each foot to the lower right",
    (id, kind) => {
      const scene = build(ASSETS)
      const piece = ASSETS.pieces.find((p) => p.id === id)!
      const ground = piece.y + piece.height
      const thrown = shadowsOf(scene, id)
      const cast = thrown.filter((s) => s.label.startsWith('cast:'))
      const contact = thrown.filter((s) => s.label.startsWith('contact:'))
      expect(cast.length).toBeGreaterThan(0)
      for (const shadow of cast) {
        // Each starts at its own foot.
        const { minX, maxX, maxY } = shadow.getBounds()
        expect(shadow.y).toBeCloseTo(ground)
        expect(maxX - shadow.x).toBeGreaterThan(shadow.x - minX)
        expect(maxY).toBeGreaterThan(ground)
      }
      expect(contact.length).toBeGreaterThan(1)
      for (const shadow of contact) {
        expect(shadow.y).toBeCloseTo(ground)
        expect(shadow.alpha).toBe(ASSETS.light.contactShadow.opacity[kind])
      }
    },
  )

  it('stands a cone in its row for every 1.4 times its height', () => {
    const scene = build(ASSETS)
    const contacts = (id: string) =>
      shadowsOf(scene, id).filter((s) => s.label.startsWith('contact:'))
    for (const id of ['cones-left', 'cones-right']) {
      const { width, height } = ASSETS.pieces.find((p) => p.id === id)!
      expect(contacts(id), id).toHaveLength(Math.floor(width / (height * 1.4)))
    }
  })

  it.each([
    ['road-sign', ASSETS.palette.ink],
    ['rival-truck', ASSETS.palette.cream],
    ['festival-banner', ASSETS.palette.dangerRed],
    ['out-of-order', ASSETS.palette.dangerRed],
  ])('writes the %s its text in Fredoka', (id, fill) => {
    const scene = build(ASSETS)
    const piece = ASSETS.pieces.find((p) => p.id === id)!
    const text = art(scene, id).getChildByLabel('text', true) as Text
    expect(text.text).toBe(piece.text)
    expect(text.style.fontFamily).toBe('Fredoka, sans-serif')
    expect(text.style.fill).toBe(fill)
  })

  it('warms the sky of a heat wave behind the clouds', () => {
    const scene = build(ASSETS)
    const sky = scene.root.getChildByLabel('layer:sky')!
    expect(sky.children.map((piece) => piece.label).slice(0, 3)).toEqual([
      'sky',
      'heat-sky',
      'cloud-1',
    ])
    expect(colours(art(scene, 'heat-sky'), 'fill')).toContain(
      hex(ASSETS.palette.heatSky),
    )
  })

  it('closes the truck on a day the street closes it, as on a day off', () => {
    // Day 2, a Wednesday the truck opens, closed by a change made for it.
    const wednesday = tick(tick(createInitialState(42)))
    const closing: StreetModifier = {
      event: 'chalet',
      change: { kind: 'closed' },
      fromDay: 2,
      lastDay: 2,
    }
    const closed = {
      ...wednesday,
      events: { ...wednesday.events, modifiers: [closing] },
    }
    const scene = build(ASSETS)
    scene.update(truckView(wednesday))
    expect(node(scene, 'awning').visible).toBe(true)

    scene.update(truckView(closed))
    expect(node(scene, 'awning-rolled').visible).toBe(true)
    expect(node(scene, 'closed-sign').visible).toBe(true)
    expect(node(scene, 'awning').visible).toBe(false)
    expect(node(scene, 'steam').visible).toBe(false)
    expect(node(scene, 'croissants').children[0]?.visible).toBe(false)
  })
})

// The street's and the truck's art, cut from the design reference
// (src/world/art/street/ and truck/, #198 and #199): the files as text, by
// their path under src/world/art/.
const SVGS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('./art/**/*.svg', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([file, text]) => [file.slice('./art/'.length), text]),
)

/** An SVG's own size and its viewBox. */
function svgBox(text: string) {
  const head = /<svg\b[^>]*>/.exec(text)![0]
  const attr = (name: string) =>
    new RegExp(`\\s${name}="([^"]+)"`).exec(head)![1]!
  const [x, y, width, height] = attr('viewBox').split(/\s+/).map(Number)
  return {
    width: Number(attr('width')),
    height: Number(attr('height')),
    view: { x: x!, y: y!, width: width!, height: height! },
  }
}

/** The street's pieces drawn by an image, with the image's file. */
const ART = ASSETS.pieces.flatMap((piece) =>
  piece.image === undefined ? [] : [{ piece, image: piece.image }],
)

/** Where `id` is drawn, back to front: its layer, then its place in it. */
function drawOrder(id: string): number {
  const piece = ASSETS.pieces.find((p) => p.id === id)!
  const layer = ASSETS.pieces.filter((p) => p.layer === piece.layer)
  return ASSETS.layers.indexOf(piece.layer) * 1000 + layer.indexOf(piece)
}

describe("the street's art", () => {
  it('finds a file for every image the manifest names', () => {
    expect(ART.length).toBeGreaterThan(0)
    for (const { piece, image } of ART) {
      expect(ART_URLS.has(image), `${piece.id}: ${image}`).toBe(true)
    }
  })

  it("draws the pieces in the target's order, the heat wave's sky behind the clouds", () => {
    const order = [
      'sky',
      'heat-sky',
      'cloud-1',
      'cloud-2',
      'cloud-3',
      'far',
      'triplex-5-left',
      'triplex-1-mirrored',
      'triplex-1',
      'triplex-2',
      'triplex-3',
      'triplex-4',
      'triplex-5',
      'triplex-5-right-1',
      'triplex-5-right-2',
      'depanneur',
      'sidewalk-left',
      'sidewalk',
      'sidewalk-right',
      'curb-left',
      'curb',
      'curb-right',
      'road-left',
      'road',
      'road-right',
      'road-below-left',
      'road-below',
      'road-below-right',
      'truck-shadow',
      'lamp-post',
      'tree-1',
      'tree-2',
      'chalkboard',
      'truck',
      'espresso-machine',
      'croissant-rack',
      'croissants',
      'counter',
      'awning',
      'truck-sign',
    ]
    const drawn = order.map(drawOrder)
    expect(drawn).toEqual([...drawn].sort((a, b) => a - b))
    // Every piece drawn by an image is in that list.
    expect(ART.map(({ piece }) => piece.id).sort()).toEqual(
      order.filter((id) => id !== 'heat-sky').sort(),
    )
    // The scenery stays behind the truck and what the events put on the
    // street.
    const last = Math.max(
      ...ART.filter(({ piece }) => piece.kind === 'backdrop').map(({ piece }) =>
        drawOrder(piece.id),
      ),
    )
    for (const piece of ASSETS.pieces.filter((p) => p.image === undefined)) {
      if (piece.id === 'heat-sky') continue
      expect(drawOrder(piece.id), piece.id).toBeGreaterThan(last)
    }
    // The truck's art and its pieces in code, in the reference's paint
    // order: what is on the counter, the avatar (put in before the counter),
    // the counter in front of them, the lemonade jar standing on it (#261),
    // the awning and the sign over it all.
    expect(
      ASSETS.pieces.filter((p) => p.layer === 'truck').map((p) => p.id),
    ).toEqual([
      'truck',
      'espresso-machine',
      'out-of-order',
      'steam',
      'hot-chocolate-pot',
      'croissant-rack',
      'croissants',
      'counter',
      'lemonade-jar',
      'awning',
      'awning-rolled',
      'closed-sign',
      'truck-sign',
      'lettering',
    ])
  })

  it("parks the truck at the reference's place, its wheels on the road", () => {
    const at = (id: string) => ASSETS.pieces.find((p) => p.id === id)!
    const truck = at('truck')
    // The reference's truck, translated to 540, 410: its body from 0 to the
    // headlight at 478, its roof at 40 and its wheels, 34 round their axle
    // at 272, on the top of the road.
    expect([truck.x, truck.y, truck.width, truck.height]).toEqual([
      540, 450, 478, 266,
    ])
    expect(truck.y + truck.height).toBe(at('road').y)
    // The counter's strip is cut from the truck's own lines, so it lines up
    // with it pixel for pixel, inside it.
    const counter = at('counter')
    for (const [start, size] of [
      ['x', 'width'],
      ['y', 'height'],
    ] as const) {
      expect(Number.isInteger(counter[start] - truck[start])).toBe(true)
      expect(counter[start]).toBeGreaterThanOrEqual(truck[start])
      expect(counter[start] + counter[size]).toBeLessThanOrEqual(
        truck[start] + truck[size],
      )
    }
    // The croissants fill the rack's board, one shelf a step.
    const rack = at('croissant-rack')
    const croissants = at('croissants')
    expect([croissants.x, croissants.y, croissants.width]).toEqual([
      rack.x,
      rack.y,
      rack.width,
    ])
    expect(croissants.height).toBeLessThanOrEqual(rack.height)
    // Its shadow falls on the road, under the people's.
    const shadow = at('truck-shadow')
    expect(shadow.layer).toBe('street')
    expect(shadow.y).toBeLessThan(at('road').y)
    expect(shadow.y + shadow.height).toBeGreaterThan(at('road').y)
  })

  it("stands each piece at the target's place, at its own proportions", () => {
    const { width: designWidth } = ASSETS.designSize
    for (const { piece, image } of ART) {
      const { view } = svgBox(SVGS[image]!)
      const named = image.endsWith(`/${piece.id}.svg`)
      if (image === 'street/sky.svg') {
        // The gradient stretches across, its top colour above the design.
        expect(view).toEqual({
          x: 0,
          y: piece.y,
          width: designWidth,
          height: piece.height,
        })
        continue
      }
      // Never stretched: the piece is the size of what the file draws.
      expect([piece.width, piece.height], piece.id).toEqual([
        view.width,
        view.height,
      ])
      if (named) {
        // A piece named like its file is where the target draws it.
        expect([piece.x, piece.y], piece.id).toEqual([view.x, view.y])
      } else {
        expect(piece.y, piece.id).toBe(view.y)
      }
    }
    // The ground tiles one design wide, back to back.
    for (const name of ['sidewalk', 'curb', 'road']) {
      const tiles = ASSETS.pieces.filter(
        (p) => p.image === `street/${name}.svg`,
      )
      expect(tiles.map((p) => p.x)).toEqual([-designWidth, 0, designWidth])
    }
  })

  it('draws each image at the art resolution within 4096 pixels a side', () => {
    for (const [file, text] of Object.entries(SVGS)) {
      const { width, height } = svgBox(text)
      expect(width * ASSETS.artResolution, file).toBeLessThanOrEqual(4096)
      expect(height * ASSETS.artResolution, file).toBeLessThanOrEqual(4096)
    }
  })

  it.each([
    [1440, 900],
    [1920, 1080],
    [2560, 1080],
    [390, 844],
    [320, 568],
  ])('leaves no gap in a %i × %i window', (viewWidth, viewHeight) => {
    const fit = fitStreet(viewWidth, viewHeight, ASSETS)
    const shown = {
      left: -fit.x / fit.scale,
      right: (viewWidth - fit.x) / fit.scale,
      top: -fit.y / fit.scale,
      bottom: (viewHeight - fit.y) / fit.scale,
    }
    // Whether `pieces`, side by side, run unbroken from left to right.
    const across = (pieces: readonly { x: number; width: number }[]) => {
      let reach = shown.left
      for (const p of [...pieces].sort((a, b) => a.x - b.x)) {
        if (p.x > reach) return false
        reach = Math.max(reach, p.x + p.width)
      }
      return reach >= shown.right
    }
    const art = (file: string) =>
      ART.filter(({ image }) => image.startsWith(`street/${file}`)).map(
        ({ piece }) => piece,
      )
    for (const row of ['triplex', 'sidewalk', 'curb', 'road', 'sky']) {
      expect(across(art(row)), row).toBe(true)
    }
    const [sky] = art('sky')
    expect(sky!.y).toBeLessThanOrEqual(shown.top)
    const ground = Math.max(...art('road').map((p) => p.y + p.height))
    expect(ground).toBeGreaterThanOrEqual(shown.bottom)
  })

  it('draws a flat shape in its colour where an image fails to load', () => {
    const scene = build(ASSETS)
    const sky = ASSETS.pieces.find((p) => p.id === 'sky')!
    const drawn = art(scene, 'sky')
    expect(drawn.label).toBe('placeholder')
    expect(colours(drawn, 'fill')).toEqual([hex(ASSETS.palette[sky.color])])
    expect(drawn.getBounds()).toMatchObject({
      width: sky.width,
      height: sky.height,
    })
    expect(shadowsOf(scene, 'tree-1')).toEqual([])
  })

  it('draws a piece by its image once it loads', () => {
    const texture = new Texture()
    const scene = build(ASSETS, new Map([['street/triplex-5.svg', texture]]))
    for (const id of ['triplex-5', 'triplex-5-left', 'triplex-5-right-2']) {
      const drawn = art(scene, id) as Sprite
      expect(drawn.texture, id).toBe(texture)
    }
    expect(art(scene, 'triplex-4').label).toBe('placeholder')
  })
})

/** Vieux-Montréal's street (#264), as the street draws it. */
const VIEUX = streetManifest(ASSETS, 'vieuxMontreal')
const VIEUX_STREET = ASSETS.districtStreets.vieuxMontreal!

/** A summer day at Vieux-Montréal's truck, open, the rival at work. */
const VIEUX_JULY: TruckView = {
  ...OPEN,
  truck: 'vieuxMontreal',
  district: 'vieuxMontreal',
  selling: { cafe: true, chocolat: true, croissant: true, limonade: true },
  inSeason: { cafe: true, chocolat: true, croissant: true, limonade: true },
  rival: true,
}

/** A winter day at Vieux-Montréal's truck, stored until May. */
const VIEUX_FEBRUARY: TruckView = {
  ...OPEN,
  truck: 'vieuxMontreal',
  district: 'vieuxMontreal',
  open: false,
  croissants: 0,
  selling: { cafe: false, chocolat: false, croissant: false, limonade: false },
  stored: true,
  reopens: 5,
  season: 'winter',
}

describe("Vieux-Montréal's street (#264)", () => {
  const visible = (scene: Scene, id: string) => node(scene, id).visible

  it('shows its summer art in summer and its winter art in winter', () => {
    const scene = build(VIEUX)
    scene.update(VIEUX_JULY)
    for (const id of ['sky-summer', 'building-1-summer', 'cloud-1']) {
      expect(visible(scene, id), id).toBe(true)
    }
    for (const id of ['sky-winter', 'building-1-winter', 'snowbanks']) {
      expect(visible(scene, id), id).toBe(false)
    }
    scene.update(VIEUX_FEBRUARY)
    for (const id of ['sky-summer', 'building-1-summer', 'cloud-1']) {
      expect(visible(scene, id), id).toBe(false)
    }
    for (const id of ['sky-winter', 'building-1-winter', 'snowbanks']) {
      expect(visible(scene, id), id).toBe(true)
    }
    // The ground both seasons share.
    for (const view of [VIEUX_JULY, VIEUX_FEBRUARY]) {
      scene.update(view)
      expect(visible(scene, 'road')).toBe(true)
      expect(visible(scene, 'truck')).toBe(true)
    }
  })

  it('pulls the shutter down and hangs its card while stored, but not open', () => {
    const scene = build(VIEUX)
    scene.update(VIEUX_FEBRUARY)
    expect(visible(scene, 'shutter')).toBe(true)
    expect(visible(scene, 'stored-sign')).toBe(true)
    scene.update(VIEUX_JULY)
    expect(visible(scene, 'shutter')).toBe(false)
    expect(visible(scene, 'stored-sign')).toBe(false)
    expect(visible(scene, 'awning')).toBe(true)
  })

  it('writes the month the truck comes back on its card', () => {
    const scene = build(VIEUX)
    scene.update(VIEUX_FEBRUARY)
    const lines = art(scene, 'stored-sign')
      .getChildrenByLabel('line')
      .map((line) => (line as Text).text)
    expect(lines).toEqual(["Fermé pour l'hiver", 'De retour en mai'])
    scene.update({ ...VIEUX_FEBRUARY, reopens: 4 })
    expect(
      (art(scene, 'stored-sign').getChildrenByLabel('line')[1] as Text).text,
    ).toBe('De retour en avril')
  })

  it('names the months in French', () => {
    expect([1, 5, 8, 12].map(monthName)).toEqual([
      'janvier',
      'mai',
      'août',
      'décembre',
    ])
    expect(monthName(null)).toBe('')
  })

  it('opens the cart in the rival’s months, and tarps it the others', () => {
    const scene = build(VIEUX)
    scene.update(VIEUX_JULY)
    expect(visible(scene, 'cart')).toBe(true)
    expect(visible(scene, 'cart-tarp')).toBe(false)
    scene.update({ ...VIEUX_JULY, rival: false })
    expect(visible(scene, 'cart')).toBe(false)
    expect(visible(scene, 'cart-tarp')).toBe(true)
    expect(visible(scene, 'cart-tarp-snow')).toBe(false)
    scene.update(VIEUX_FEBRUARY)
    expect(visible(scene, 'cart-tarp-snow')).toBe(true)
  })

  it('letters the truck by the products in season, the lemonade jar while it sells', () => {
    const scene = build(VIEUX)
    scene.update(VIEUX_JULY)
    expect(visible(scene, 'lettering-limonade')).toBe(true)
    expect(visible(scene, 'lettering')).toBe(false)
    expect(visible(scene, 'lemonade-jar')).toBe(true)
    expect(visible(scene, 'hot-chocolate-pot')).toBe(false)
    const october = {
      ...VIEUX_JULY,
      selling: { ...VIEUX_JULY.selling, limonade: false },
      inSeason: { ...VIEUX_JULY.inSeason, limonade: false },
    }
    scene.update(october)
    expect(visible(scene, 'lettering-limonade')).toBe(false)
    expect(visible(scene, 'lettering')).toBe(true)
    expect(visible(scene, 'lemonade-jar')).toBe(false)
    expect(visible(scene, 'hot-chocolate-pot')).toBe(true)
  })

  it("writes the player's name with « · Vieux-Port » on its sign, and the Plateau's alone", () => {
    const nameOf = (scene: Scene) =>
      (node(scene, 'truck-sign').getChildByLabel('name') as Text).text
    const vieux = build(VIEUX)
    vieux.update(VIEUX_JULY)
    expect(nameOf(vieux)).toBe("Le P'tit Camion · Vieux-Port")
    vieux.update({ ...VIEUX_JULY, businessName: 'Chez Mimi' })
    expect(nameOf(vieux)).toBe('Chez Mimi · Vieux-Port')
    const plateau = build(ASSETS)
    plateau.update({ ...OPEN, businessName: 'Chez Mimi' })
    expect(nameOf(plateau)).toBe('Chez Mimi')
  })

  it('hangs the jazz festival unless the player stayed put, and barriers for the shoot', () => {
    const scene = build(VIEUX)
    const festival = (choice: string) => ({
      ...VIEUX_JULY,
      modifiers: [
        {
          event: 'festivalJazz',
          change: { kind: 'walkIns' as const, factor: 1.8 },
          fromDay: 10,
          lastDay: 19,
          district: 'vieuxMontreal' as const,
          choice,
        },
      ],
    })
    scene.update(festival('payer'))
    expect(visible(scene, 'festival-banner')).toBe(true)
    expect(visible(scene, 'bunting')).toBe(true)
    scene.update(festival('rester'))
    expect(visible(scene, 'festival-banner')).toBe(false)
    scene.update({
      ...VIEUX_JULY,
      open: false,
      modifiers: [
        {
          event: 'tournage',
          change: { kind: 'closed' as const },
          fromDay: 10,
          lastDay: 12,
          district: 'vieuxMontreal' as const,
          choice: 'accepter',
        },
      ],
    })
    expect(visible(scene, 'barriers-left')).toBe(true)
    expect(visible(scene, 'barriers-right')).toBe(true)
    expect(shadowsOf(scene, 'barriers-left').length).toBeGreaterThan(0)
    expect(shadowsOf(scene, 'barriers-left').every((s) => s.visible)).toBe(true)
  })
})

describe("Vieux-Montréal's art (#264)", () => {
  const ART_VIEUX = VIEUX.pieces.flatMap((piece) =>
    piece.image === undefined ? [] : [{ piece, image: piece.image }],
  )
  const { width: designWidth } = ASSETS.designSize

  it('finds a file for every image it names', () => {
    expect(ART_VIEUX.length).toBeGreaterThan(40)
    for (const { piece, image } of ART_VIEUX) {
      expect(ART_URLS.has(image), `${piece.id}: ${image}`).toBe(true)
    }
    expect(ART_URLS.has(VIEUX_STREET.caleche.image)).toBe(true)
  })

  it("stands each piece at the target's place, at its own proportions", () => {
    for (const { piece, image } of ART_VIEUX) {
      const { view } = svgBox(SVGS[image]!)
      if (image.endsWith('/sky.svg')) {
        expect(view).toMatchObject({ x: 0, y: piece.y, width: designWidth })
        continue
      }
      expect([piece.width, piece.height], piece.id).toEqual([
        view.width,
        view.height,
      ])
      // The Plateau's files serve the truck 60 to the right.
      const dx = image.startsWith('truck/') ? VIEUX_STREET.truckOffsetX : 0
      const copy = /-(left|right)(-\d)?(-summer|-winter)?$/.test(piece.id)
      if (copy) expect(piece.y, piece.id).toBe(view.y)
      else expect([piece.x, piece.y], piece.id).toEqual([view.x + dx, view.y])
    }
    const caleche = svgBox(SVGS[VIEUX_STREET.caleche.image]!)
    expect([VIEUX_STREET.caleche.width, VIEUX_STREET.caleche.height]).toEqual([
      caleche.view.width,
      caleche.view.height,
    ])
    expect(VIEUX_STREET.caleche.y).toBe(caleche.view.y)
  })

  it.each([
    [1440, 900],
    [2560, 1080],
    [390, 844],
  ])('leaves no gap in a %i × %i window, summer or winter', (w, h) => {
    const fit = fitStreet(w, h, VIEUX)
    const shown = {
      left: -fit.x / fit.scale,
      right: (w - fit.x) / fit.scale,
      top: -fit.y / fit.scale,
      bottom: (h - fit.y) / fit.scale,
    }
    const across = (pieces: readonly { x: number; width: number }[]) => {
      let reach = shown.left
      for (const p of [...pieces].sort((a, b) => a.x - b.x)) {
        if (p.x > reach) return false
        reach = Math.max(reach, p.x + p.width)
      }
      return reach >= shown.right
    }
    for (const season of ['summer', 'winter']) {
      const art = (name: string) =>
        ART_VIEUX.filter(
          ({ image, piece }) =>
            image.includes(name) &&
            (piece.shows === undefined ||
              (typeof piece.shows === 'object' &&
                'season' in piece.shows &&
                piece.shows.season === season)),
        ).map(({ piece }) => piece)
      for (const row of [
        'building',
        'sidewalk.svg',
        'curb',
        'road.svg',
        'sky',
      ]) {
        expect(across(art(row)), `${season} ${row}`).toBe(true)
      }
      expect(art('sky')[0]!.y).toBeLessThanOrEqual(shown.top)
      const ground = Math.max(...art('road').map((p) => p.y + p.height))
      expect(ground).toBeGreaterThanOrEqual(shown.bottom)
    }
  })
})
