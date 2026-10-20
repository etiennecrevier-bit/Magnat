import {
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  TilingSprite,
  type Filter,
} from 'pixi.js'
import { describe, expect, it } from 'vitest'
import type { AssetManifest, CityPiece } from '../content/assets.ts'
import { WALL_KINDS } from '../content/assets.ts'
import { GROCERS } from '../engine/contracts.ts'
import { buildCityScene, type CityScene } from './cityScene.ts'
import type { CityView } from './cityView.ts'
import { boxCorners, type Vec } from './iso.ts'
import { tonesOf } from './light.ts'
import { ASSETS } from './manifest.ts'
import type { MakeFilters } from './shadows.ts'

const { city, palette, light } = ASSETS

const DAY: CityView = {
  open: true,
  atTruck: 0,
  trip: null,
  bakery: false,
  bakers: 0,
  deliverers: 0,
  vanAt: null,
  van: null,
  contracts: [],
  trips: true,
}

/** Filters that only say what they were asked for: Node has no canvas. */
const FILTERS: MakeFilters = (wanted) =>
  [{ ...wanted, destroy: () => {} }] as unknown as Filter[]

/** Builds the city with text measured as 40 wide: Node has no canvas. */
function build(
  manifest: AssetManifest = ASSETS,
  textures: ReadonlyMap<string, Texture> = new Map(),
): CityScene {
  return buildCityScene(manifest, textures, () => 40, FILTERS)
}

/** The shipped manifest with `images` given to the city pieces they name. */
function withImages(images: Record<string, string>): AssetManifest {
  return {
    ...ASSETS,
    city: {
      ...city,
      pieces: city.pieces.map((piece) =>
        piece.id in images ? { ...piece, image: images[piece.id] } : piece,
      ),
    },
  }
}

function piece(id: string): CityPiece {
  const found = city.pieces.find((p) => p.id === id)
  if (found === undefined) throw new Error(`No piece ${id}`)
  return found
}

function node(scene: CityScene, id: string): Container {
  const found = scene.root.getChildByLabel(id, true)
  if (found === null) throw new Error(`No piece ${id}`)
  return found
}

/** The art a piece shows: its image or its placeholder. */
function art(scene: CityScene, id: string): Container {
  return node(scene, id).children[0]!
}

/** `root` and every node under it, depth first. */
function everything(root: Container): Container[] {
  return [root, ...root.children.flatMap((child) => everything(child))]
}

const hex = (colour: string) => Number.parseInt(colour.slice(1), 16)

/** The colours every Graphics under `root` strokes or fills with. */
function colours(root: Container, action: 'fill' | 'stroke'): number[] {
  return everything(root).flatMap((n) =>
    n instanceof Graphics
      ? n.context.instructions
          .filter((i) => i.action === action)
          .map((i) => (i.data.style as { color: number }).color)
      : [],
  )
}

/** A point in the middle of a box's lit wall, in the design. */
function onLitWall(id: string): Vec {
  const { left, front, wall } = boxCorners(piece(id))
  return [(left[0] + front[0]) / 2, (left[1] + front[1]) / 2 - wall / 2]
}

/** A point in the middle of a box's shaded wall, in the design. */
function onShadeWall(id: string): Vec {
  const { front, right, wall } = boxCorners(piece(id))
  return [(front[0] + right[0]) / 2, (front[1] + right[1]) / 2 - wall / 2]
}

/** The cast shadows `owner` throws on the ground. */
function castBy(scene: CityScene, owner: string): Container[] {
  return scene.shadows.cast.children.filter(
    (shadow) => shadow.label === `cast:${owner}`,
  )
}

describe('buildCityScene', () => {
  it('builds one container per layer, back to front, sorting those over the shadows', () => {
    const scene = build()
    expect(scene.root.children.map((layer) => layer.label)).toEqual([
      'layer:ground',
      'layer:shadows',
      'layer:block',
    ])
    expect(scene.ground.label).toBe('layer:ground')
    expect(scene.ground.sortableChildren).toBe(false)
    expect(scene.block.label).toBe('layer:block')
    expect(scene.block.sortableChildren).toBe(true)
  })

  it('draws every box in its layer at its position, with its placeholder', () => {
    const scene = build()
    const standing = city.pieces.filter((p) => !WALL_KINDS.includes(p.kind))
    expect(scene.ground.children.map((n) => n.label)).toEqual(
      standing.filter((p) => p.layer === 'ground').map((p) => p.id),
    )
    for (const p of standing) {
      expect(node(scene, p.id).position, p.id).toMatchObject({ x: p.x, y: p.y })
      expect(art(scene, p.id).label, p.id).toBe('placeholder')
    }
  })

  it('draws what is on a wall with its box, at its place on the wall', () => {
    const scene = build()
    for (const p of city.pieces.filter((p) => p.on !== undefined)) {
      const host = node(scene, p.on!)
      const drawn = node(scene, p.id)
      expect(drawn.parent, p.id).toBe(host)
      expect(drawn.position.x + host.x).toBeCloseTo(p.x)
      expect(drawn.position.y + host.y).toBeCloseTo(p.y)
    }
  })

  it('draws the nearer boxes later: the truck over the bakery behind it', () => {
    const scene = build()
    const z = (id: string) => node(scene, id).zIndex
    expect(z('truck')).toBeGreaterThan(z('bakery'))
    expect(z('caisse')).toBeGreaterThan(z('mill'))
    expect(scene.boxes.map((box) => box.rank)).toEqual(
      scene.boxes.map((_, i) => i),
    )
  })

  it('swaps a placeholder for an image with a manifest change only, along its wall for a sign', () => {
    const texture = new Texture()
    const manifest = withImages({
      caisse: 'dummy.png',
      'bakery-sign': 'dummy.png',
    })
    const scene = build(manifest, new Map([['dummy.png', texture]]))
    const caisse = art(scene, 'caisse') as Sprite
    expect(caisse).toBeInstanceOf(Sprite)
    expect(caisse.texture).toBe(texture)
    expect(caisse.width).toBeCloseTo(piece('caisse').width)
    expect(caisse.height).toBeCloseTo(piece('caisse').height)
    const sign = art(scene, 'bakery-sign')
    expect(sign.label).toBe('image')
    expect(sign.skew.y).toBeCloseTo(Math.atan(0.5))
    expect((sign.children[0] as Sprite).texture).toBe(texture)
    // Real art is never shadowed again by code.
    expect(castBy(scene, 'caisse')).toEqual([])
    expect(castBy(scene, 'mill')).toHaveLength(1)
  })

  it('keeps the placeholder when the image did not load', () => {
    const scene = build(withImages({ caisse: 'dummy.png' }))
    expect(art(scene, 'caisse').label).toBe('placeholder')
  })

  it('writes each grocer’s name on its shop, from grocers.json', () => {
    const scene = build()
    for (const p of city.pieces.filter((p) => p.grocer !== undefined)) {
      const texts = everything(art(scene, p.id))
        .filter((n): n is Text => n instanceof Text)
        .map((t) => t.text)
      expect(texts, p.id).toContain(GROCERS.grocers[p.grocer!].name)
    }
  })

  it('frees the textures it made when it is taken down', () => {
    const scene = build()
    const bricks = everything(art(scene, 'caisse')).find(
      (n): n is TilingSprite => n instanceof TilingSprite,
    )!.texture
    scene.destroy()
    expect(scene.root.destroyed).toBe(true)
    expect(bricks.destroyed).toBe(true)
  })
})

describe('the light on the city', () => {
  it('draws no outlines', () => {
    const scene = build()
    for (const p of city.pieces) {
      expect(colours(art(scene, p.id), 'stroke'), p.id).not.toContain(
        hex(palette.ink),
      )
    }
  })

  it('lights a box’s roof from above, grades and bricks its lit wall, and shades the other', () => {
    const scene = build()
    const caisse = art(scene, 'caisse')
    const roof = caisse.getChildByLabel('roof') as Graphics
    const steel = tonesOf(palette.steel, light)
    expect(colours(roof, 'fill')).toContain(hex(steel.top))
    expect(colours(roof, 'stroke')).toContain(hex(steel.rim))

    const lit = caisse.getChildByLabel('lit')!
    expect(lit.skew.y).toBeCloseTo(Math.atan(0.5))
    const facade = lit.getChildByLabel('facade') as Sprite
    expect(facade.texture.label).toBe(
      `facade:${palette[piece('caisse').color]}`,
    )
    expect(lit.getChildByLabel('bricks')).toBeInstanceOf(TilingSprite)

    const shade = caisse.getChildByLabel('shade')!
    expect(shade.skew.y).toBeCloseTo(-Math.atan(0.5))
    expect(colours(shade, 'fill')).toContain(
      hex(tonesOf(palette[piece('caisse').color], light).shade),
    )
  })

  it('lays the streets as faces looking up', () => {
    const scene = build()
    expect(colours(art(scene, 'avenue'), 'fill')).toEqual([
      hex(tonesOf(palette.asphalt, light).top),
    ])
  })

  it('throws each box’s shadow on the ground, and each tree’s in the park', () => {
    const scene = build()
    for (const p of city.pieces) {
      const boxes = [
        'triplex',
        'building',
        'mill',
        'silo',
        'grocer',
        'bakery',
        'truck',
      ]
      if (boxes.includes(p.kind))
        expect(castBy(scene, p.id), p.id).toHaveLength(1)
      if (p.kind === 'ground' || WALL_KINDS.includes(p.kind)) {
        expect(castBy(scene, p.id), p.id).toEqual([])
      }
    }
    expect(castBy(scene, 'park').length).toBeGreaterThan(4)
  })
})

describe('CityScene.update', () => {
  const visible = (scene: CityScene, id: string) => node(scene, id).visible

  it('shows the bakery for rent, dark, until it runs', () => {
    const scene = build()
    scene.update(DAY)
    expect(visible(scene, 'bakery-for-rent')).toBe(true)
    expect(visible(scene, 'bakery-sign')).toBe(false)
    expect(visible(scene, 'bakery-lamplight')).toBe(false)
    scene.update({ ...DAY, bakery: true })
    expect(visible(scene, 'bakery-for-rent')).toBe(false)
    expect(visible(scene, 'bakery-sign')).toBe(true)
    expect(visible(scene, 'bakery-lamplight')).toBe(true)
  })

  it('hangs the croissant sign at each grocer whose contract runs', () => {
    const scene = build()
    scene.update({ ...DAY, contracts: ['marcheBioLogique'] })
    expect(visible(scene, 'marche-bio-logique-contract')).toBe(true)
    expect(visible(scene, 'chez-normand-contract')).toBe(false)
    expect(visible(scene, 'depanneur-24-24-contract')).toBe(false)
  })

  it('opens the hatch or shuts it by the minute, whatever the day shows', () => {
    const scene = build()
    scene.update(DAY)
    expect(visible(scene, 'truck-hatch')).toBe(true)
    expect(visible(scene, 'truck-shutter')).toBe(false)
    scene.showTruck(false)
    expect(visible(scene, 'truck-hatch')).toBe(false)
    expect(visible(scene, 'truck-shutter')).toBe(true)
    scene.update({ ...DAY, bakery: true })
    expect(visible(scene, 'truck-shutter')).toBe(true)
    scene.showTruck(true)
    expect(visible(scene, 'truck-hatch')).toBe(true)
  })
})

describe('CityScene.linkAt', () => {
  const scene = build()

  it('finds what a click on a building opens', () => {
    expect(scene.linkAt(onLitWall('bakery'))).toEqual({ opens: 'fournil' })
    expect(scene.linkAt(onLitWall('caisse'))).toEqual({
      opens: { trip: 'caisse' },
    })
    // The mill's lit wall is behind the Caisse; its shaded one is in sight.
    expect(scene.linkAt(onLitWall('mill'))).toEqual({
      opens: { trip: 'caisse' },
    })
    expect(scene.linkAt(onShadeWall('mill'))).toEqual({
      opens: { trip: 'meunerie' },
    })
  })

  it('names the grocer whose shop a click is on', () => {
    expect(scene.linkAt(onLitWall('chez-normand'))).toEqual({
      opens: 'contracts',
      grocer: 'chezNormand',
    })
    expect(scene.linkAt(onLitWall('depanneur-24-24'))).toEqual({
      opens: 'contracts',
      grocer: 'depanneur2424',
    })
  })

  it('opens nothing on a triplex, the truck, the park or a street', () => {
    expect(scene.linkAt(onLitWall('triplex-west-1'))).toBeNull()
    expect(scene.linkAt(onLitWall('truck'))).toBeNull()
    const park = boxCorners(piece('park'))
    expect(
      scene.linkAt([(park.left[0] + park.right[0]) / 2, park.front[1] - 4]),
    ).toBeNull()
    expect(scene.linkAt([-500, 800])).toBeNull()
  })

  it('takes the nearest building where two overlap: the truck over the bakery', () => {
    const truck = boxCorners(piece('truck'))
    const roof: Vec = [
      (truck.left[0] + truck.right[0]) / 2,
      (truck.left[1] + truck.right[1]) / 2 - truck.wall,
    ]
    expect(scene.linkAt(roof)).toBeNull()
  })
})
