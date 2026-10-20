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
import { ART_URLS } from './art.ts'
import { boxCorners, type Vec } from './iso.ts'
import { fitCity } from './layout.ts'
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

/** The pieces of `kind`. */
function ofKind(kind: string): CityPiece[] {
  return city.pieces.filter((p) => p.kind === kind)
}

/** Where `node` is drawn in the design, from the city's root. */
function global(scene: CityScene, drawn: Container): Vec {
  let x = 0
  let y = 0
  for (
    let at: Container | null = drawn;
    at !== null && at !== scene.root;
    at = at.parent
  ) {
    x += at.x
    y += at.y
  }
  return [x, y]
}

describe('buildCityScene', () => {
  it('builds one container per layer, back to front, sorting those over the shadows', () => {
    const scene = build()
    expect(scene.root.children.map((layer) => layer.label)).toEqual([
      'layer:sky',
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
    expect(scene.ground.children.map((n) => n.label)).toEqual([
      'island',
      'shadows',
    ])
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

  it('puts who serves in the truck, over its hatch and under its awning', () => {
    const scene = build()
    const truck = node(scene, 'truck')
    expect(scene.crew.parent).toBe(truck)
    const order = truck.children.map((n) => n.label)
    expect(order.indexOf('crew')).toBe(order.indexOf('truck-hatch') + 1)
    expect(order.indexOf('truck-awning')).toBe(order.indexOf('crew') + 1)
  })

  it('draws the nearer boxes later, as the reference paints them', () => {
    const scene = build()
    const z = (id: string) => node(scene, id).zIndex
    // Pairs that overlap on screen, the nearer last.
    for (const [far, near] of [
      ['cafe', 'truck'],
      ['tri4', 'tree-8'],
      ['mill', 'silo'],
      ['mill', 'permits'],
      ['chez-normand', 'tree-14'],
      ['bank', 'car-2'],
    ] as const) {
      expect(z(near), `${near} over ${far}`).toBeGreaterThan(z(far))
    }
    expect(scene.boxes.map((box) => box.rank)).toEqual(
      scene.boxes.map((_, i) => i),
    )
  })

  it('ranks no flat piece: the sky, the island and the shadows are drawn first', () => {
    const scene = build()
    for (const p of [...ofKind('backdrop'), ...ofKind('shadows')]) {
      expect(node(scene, p.id).zIndex, p.id).toBe(0)
      expect(node(scene, p.id).parent?.label).not.toBe('layer:block')
    }
  })

  it('draws an image at its art, a wall’s as drawn: no second slant along the wall', () => {
    const texture = new Texture()
    const manifest = withImages({
      bank: 'dummy.png',
      'truck-hatch': 'dummy.png',
    })
    const scene = build(manifest, new Map([['dummy.png', texture]]))
    for (const id of ['bank', 'truck-hatch']) {
      const sprite = art(scene, id) as Sprite
      const { art: rect } = piece(id)
      expect(sprite, id).toBeInstanceOf(Sprite)
      expect(sprite.texture).toBe(texture)
      expect(sprite.skew.y, id).toBe(0)
      expect(node(scene, id).skew.y, id).toBe(0)
      const [x, y] = global(scene, sprite)
      expect(x, id).toBeCloseTo(rect!.x)
      expect(y, id).toBeCloseTo(rect!.y)
      expect(sprite.width, id).toBeCloseTo(rect!.width)
      expect(sprite.height, id).toBeCloseTo(rect!.height)
    }
  })

  it('stretches an image without art to its box, along its wall for a sign', () => {
    const texture = new Texture()
    const manifest = withImages({
      'bakery-sign': 'dummy.png',
      tri1: 'dummy.png',
    })
    const noArt = {
      ...manifest,
      city: {
        ...manifest.city,
        pieces: manifest.city.pieces.map((p) => ({ ...p, art: undefined })),
      },
    }
    const scene = build(noArt, new Map([['dummy.png', texture]]))
    const box = art(scene, 'tri1') as Sprite
    expect(box.width).toBeCloseTo(piece('tri1').width)
    expect(box.height).toBeCloseTo(piece('tri1').height)
    const sign = art(scene, 'bakery-sign')
    expect(sign.label).toBe('image')
    expect(sign.skew.y).toBeCloseTo(Math.atan(0.5))
    expect((sign.children[0] as Sprite).texture).toBe(texture)
  })

  it('throws no shadow in code for real art, nor for any box once the shadows’ image loaded', () => {
    const texture = new Texture()
    const one = build(
      withImages({ bank: 'dummy.png' }),
      new Map([['dummy.png', texture]]),
    )
    expect(castBy(one, 'bank')).toEqual([])
    expect(castBy(one, 'mill')).toHaveLength(1)
    const baked = build(
      withImages({ shadows: 'dummy.png' }),
      new Map([['dummy.png', texture]]),
    )
    expect(
      baked.shadows.cast.children.filter((c) => c.label.startsWith('cast:')),
    ).toEqual([])
  })

  it('keeps the placeholder when the image did not load', () => {
    const scene = build(withImages({ bank: 'dummy.png' }))
    expect(art(scene, 'bank').label).toBe('placeholder')
  })

  it('writes each grocer’s name on its shop’s placeholder, from grocers.json', () => {
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
    const bricks = everything(art(scene, 'bank')).find(
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
    const bank = art(scene, 'bank')
    const roof = bank.getChildByLabel('roof') as Graphics
    const steel = tonesOf(palette.steel, light)
    expect(colours(roof, 'fill')).toContain(hex(steel.top))
    expect(colours(roof, 'stroke')).toContain(hex(steel.rim))

    const lit = bank.getChildByLabel('lit')!
    expect(lit.skew.y).toBeCloseTo(Math.atan(0.5))
    const facade = lit.getChildByLabel('facade') as Sprite
    expect(facade.texture.label).toBe(`facade:${palette[piece('bank').color]}`)
    expect(lit.getChildByLabel('bricks')).toBeInstanceOf(TilingSprite)

    const shade = bank.getChildByLabel('shade')!
    expect(shade.skew.y).toBeCloseTo(-Math.atan(0.5))
    expect(colours(shade, 'fill')).toContain(
      hex(tonesOf(palette[piece('bank').color], light).shade),
    )
  })

  it('lays the island flat, as a face looking up, under the sky', () => {
    const scene = build()
    expect(colours(art(scene, 'island'), 'fill')).toEqual([
      hex(tonesOf(palette.sidewalk, light).top),
    ])
    expect(colours(art(scene, 'sky'), 'fill')).toEqual([hex(palette.sky)])
  })

  it('throws each box’s shadow on the ground while no image of the shadows loaded', () => {
    const scene = build()
    const boxes = [
      'triplex',
      'building',
      'mill',
      'silo',
      'grocer',
      'bakery',
      'truck',
    ]
    for (const p of city.pieces) {
      if (boxes.includes(p.kind)) {
        expect(castBy(scene, p.id), p.id).toHaveLength(1)
      } else {
        expect(castBy(scene, p.id), p.id).toEqual([])
      }
    }
  })
})

describe('CityScene.update', () => {
  const visible = (scene: CityScene, id: string) => node(scene, id).visible
  const lamplight = ofKind('windows').map((p) => p.id)

  it('shows the bakery for rent, dark, until it runs', () => {
    const scene = build()
    scene.update(DAY)
    expect(visible(scene, 'bakery-for-rent')).toBe(true)
    expect(visible(scene, 'bakery-sign')).toBe(false)
    expect(lamplight).toHaveLength(3)
    for (const id of lamplight) expect(visible(scene, id)).toBe(false)
    scene.update({ ...DAY, bakery: true })
    expect(visible(scene, 'bakery-for-rent')).toBe(false)
    expect(visible(scene, 'bakery-sign')).toBe(true)
    for (const id of lamplight) expect(visible(scene, id)).toBe(true)
  })

  it('writes the board as the reference: « À louer » in red, « Fournil » in ink, on white', () => {
    const scene = build()
    const words = (id: string) =>
      everything(art(scene, id)).find((n): n is Text => n instanceof Text)!
    expect(words('bakery-for-rent').text).toBe('À louer')
    expect(words('bakery-for-rent').style.fill).toBe(palette.dangerRed)
    expect(words('bakery-sign').text).toBe('Fournil')
    expect(words('bakery-sign').style.fill).toBe(palette.ink)
    expect(colours(art(scene, 'bakery-sign'), 'fill')).toContain(
      hex(palette.white),
    )
  })

  it('hangs the croissant sign at each grocer whose contract runs', () => {
    const scene = build()
    scene.update({ ...DAY, contracts: ['marcheBioLogique'] })
    expect(visible(scene, 'marche-bio-logique-contract')).toBe(true)
    expect(visible(scene, 'chez-normand-contract')).toBe(false)
    expect(visible(scene, 'depanneur-24-24-contract')).toBe(false)
  })

  it('opens the hatch and its awning or shuts it by the minute, whatever the day shows', () => {
    const scene = build()
    scene.update(DAY)
    expect(visible(scene, 'truck-hatch')).toBe(true)
    expect(visible(scene, 'truck-awning')).toBe(true)
    expect(visible(scene, 'truck-shutter')).toBe(false)
    scene.showTruck(false)
    expect(visible(scene, 'truck-hatch')).toBe(false)
    expect(visible(scene, 'truck-awning')).toBe(false)
    expect(visible(scene, 'truck-shutter')).toBe(true)
    scene.update({ ...DAY, bakery: true })
    expect(visible(scene, 'truck-shutter')).toBe(true)
    scene.showTruck(true)
    expect(visible(scene, 'truck-hatch')).toBe(true)
  })
})

describe('CityScene.linkAt', () => {
  const scene = build()
  const top = (id: string): Vec => {
    const { left, right, back, wall } = boxCorners(piece(id))
    return [(left[0] + right[0]) / 2, back[1] - wall]
  }

  it('finds what a click on a building opens, and where its name goes', () => {
    expect(scene.linkAt(onLitWall('rent'))).toEqual({
      opens: 'fournil',
      place: 'fournil',
      top: top('rent'),
    })
    expect(scene.linkAt(onLitWall('bank'))).toEqual({
      opens: { trip: 'caisse' },
      place: 'caisse',
      top: top('bank'),
    })
    expect(scene.linkAt(onShadeWall('mill'))).toMatchObject({
      opens: { trip: 'meunerie' },
      place: 'meunerie',
    })
    // The silo opens the meunerie too, with no place of its own.
    expect(scene.linkAt(onLitWall('silo'))).toEqual({
      opens: { trip: 'meunerie' },
      top: top('silo'),
    })
  })

  it('names the grocer whose shop a click is on', () => {
    expect(scene.linkAt(onLitWall('chez-normand'))).toMatchObject({
      opens: 'contracts',
      grocer: 'chezNormand',
    })
    expect(scene.linkAt(onLitWall('depanneur-24-24'))).toMatchObject({
      opens: 'contracts',
      grocer: 'depanneur2424',
    })
  })

  it('opens nothing on a triplex, the truck, the island or the sky', () => {
    expect(scene.linkAt(onLitWall('tri1'))).toBeNull()
    expect(scene.linkAt(onLitWall('truck'))).toBeNull()
    const island = boxCorners(piece('island'))
    expect(scene.linkAt([island.left[0] + 60, island.left[1]])).toBeNull()
    expect(scene.linkAt([-500, 100])).toBeNull()
  })

  it('takes the nearest building where two overlap: the permits office over the mill', () => {
    expect(scene.linkAt([700, 560])).toMatchObject({
      opens: { trip: 'bureauPermis' },
    })
    expect(scene.linkAt([700, 515])).toMatchObject({
      opens: { trip: 'meunerie' },
    })
  })

  it('clicks through a tree to the shop behind it', () => {
    const tree = boxCorners(piece('tree-14'))
    const crown: Vec = [tree.front[0], tree.front[1] - tree.wall * 0.7]
    expect(scene.linkAt(crown)).toMatchObject({ grocer: 'chezNormand' })
  })
})

// The city's art, cut from the design reference by src/world/art/cut_city.py
// (#209): the files as text, by their path under src/world/art/.
const CITY_SVGS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('./art/city/*.svg', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([file, text]) => [file.slice('./art/'.length), text]),
)

/** An SVG's viewBox. */
function viewBox(text: string) {
  const head = /<svg\b[^>]*>/.exec(text)![0]
  const [x, y, width, height] = /\sviewBox="([^"]+)"/
    .exec(head)![1]!
    .split(/\s+/)
    .map(Number)
  return { x: x!, y: y!, width: width!, height: height! }
}

describe("the city's art", () => {
  const drawn = city.pieces.filter((p) => p.image !== undefined)

  it('finds a file for every image, and uses every file', () => {
    for (const p of drawn) {
      expect(ART_URLS.has(p.image!), `${p.id}: ${p.image}`).toBe(true)
    }
    expect(Object.keys(CITY_SVGS).sort()).toEqual(
      [...new Set(drawn.map((p) => p.image!))].sort(),
    )
  })

  it('draws each image where the reference draws it, at its own size', () => {
    for (const p of drawn) {
      if (p.id === 'sky') continue
      const where = p.art ?? p
      expect([where.x, where.y, where.width, where.height], p.id).toEqual(
        Object.values(viewBox(CITY_SVGS[p.image!]!)),
      )
    }
  })

  it.each([
    [1280, 720],
    [1440, 900],
    [1440, 1400],
    [1920, 1080],
    [2560, 1080],
    [3440, 1440],
    [390, 844],
  ])('fills a %i × %i window with sky', (viewWidth, viewHeight) => {
    const { width } = city.designSize
    const fit = fitCity(viewWidth, viewHeight, city)
    const sky = piece('sky')
    expect(sky.x).toBeLessThanOrEqual(-fit.x / fit.scale)
    expect(sky.x + sky.width).toBeGreaterThanOrEqual(
      (viewWidth - fit.x) / fit.scale,
    )
    expect(sky.y).toBeLessThanOrEqual(-fit.y / fit.scale)
    expect(sky.y + sky.height).toBeGreaterThanOrEqual(
      (viewHeight - fit.y) / fit.scale,
    )
    // Its gradient stretches across; above the design, its top colour, and
    // below it its bottom one.
    expect(viewBox(CITY_SVGS['city/sky.svg']!)).toEqual({
      x: 0,
      y: sky.y,
      width,
      height: sky.height,
    })
  })

  it('draws a flat shape in its colour where an image fails to load', () => {
    const scene = build()
    for (const p of ofKind('backdrop').filter((p) => p.depth === undefined)) {
      const shape = art(scene, p.id)
      expect(shape.label, p.id).toBe('placeholder')
      expect(colours(shape, 'fill'), p.id).toEqual([hex(palette[p.color])])
      expect(shape.getBounds(), p.id).toMatchObject({
        width: p.width,
        height: p.height,
      })
    }
  })
})
