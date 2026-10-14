import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import type { AssetManifest } from '../content/assets.ts'
import { ART_URLS, loadArt } from './art.ts'
import { ASSETS } from './manifest.ts'
import { SKY_COLOR } from './mountWorld.ts'
import { buildScene, type Scene } from './scene.ts'
import { BUSINESS_NAME, type TruckView } from './truckView.ts'

const OPEN: TruckView = {
  open: true,
  croissants: 70,
  businessName: BUSINESS_NAME,
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

/** Builds the scene with text measured as 100 wide: node has no canvas. */
function build(
  manifest: AssetManifest,
  textures: ReadonlyMap<string, Texture> = new Map(),
): Scene {
  return buildScene(manifest, textures, () => 100)
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
    for (const layer of scene.root.children) {
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
      const scene = buildScene(ASSETS, new Map(), () => 100)
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

    it('shrinks a name too wide for the sign to fit', () => {
      const scene = buildScene(ASSETS, new Map(), () => 600)
      scene.update(OPEN)
      const room = sign.width - 2 * ASSETS.signText.paddingX
      expect(nameOf(scene).scale.x).toBeCloseTo(room / 600)
      expect(nameOf(scene).scale.y).toBeCloseTo(room / 600)
    })

    it('measures the name only when it changes', () => {
      const measure = vi.fn(() => 100)
      const scene = buildScene(ASSETS, new Map(), measure)
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
