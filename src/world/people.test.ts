import { Container, Graphics, Texture } from 'pixi.js'
import { afterAll, describe, expect, it } from 'vitest'
import type { SegmentId } from '../content/schema.ts'
import { next, seedRng } from '../engine/rng.ts'
import { CROWD } from './crowdSettings.ts'
import { ASSETS } from './manifest.ts'
import { MOOD_COLORS } from './customerCard.ts'
import {
  CHILD_OFFSET,
  createPeopleShading,
  drawAvatar,
  drawBubble,
  drawCustomer,
  drawPickMark,
  drawSpill,
  pickLook,
  SEGMENT_ACCESSORY,
  type ChildLook,
  type Look,
  type PeopleStyle,
} from './people.ts'
import { mix } from './light.ts'

const LIGHT = ASSETS.light
const FIGURE = CROWD.figure
const SHADING = createPeopleShading(LIGHT, FIGURE)
afterAll(() => SHADING.destroy())
const STYLE: PeopleStyle = {
  palette: ASSETS.palette,
  outline: ASSETS.outlineWidth,
  light: LIGHT,
  shading: SHADING,
}
const LOOKS = CROWD.looks
const CIRCLES = CROWD.fatigue.circlesColor

function avatar(kind: 'femme' | 'homme' = 'femme') {
  return drawAvatar(kind, STYLE, CROWD.avatar, LOOKS.trousers, CIRCLES)
}
const SEGMENTS: readonly SegmentId[] = ['aubaine', 'habitue', 'chic']

function seeded(seed: number): () => number {
  let state = seedRng(seed)
  return () => {
    const [value, after] = next(state)
    state = after
    return value
  }
}

const LOOK: Look = {
  segment: 'habitue',
  skin: LOOKS.skinTones[0]!,
  clothes: LOOKS.clothes[0]!,
  height: 116,
  hair: LOOKS.hair.colors[0]!,
  headwear: 'hair',
  office: null,
  child: null,
  fan: null,
}

/** The labels of every node under `root`, depth first. */
function labels(root: Container): string[] {
  return root.children.flatMap((child) => [child.label, ...labels(child)])
}

function find(root: Container, label: string): Container {
  const found = root.getChildByLabel(label, true)
  if (found === null) throw new Error(`No ${label}`)
  return found
}

/** The colours `g` fills or strokes with, in drawing order, as numbers. */
function colours(g: Container, action: 'fill' | 'stroke'): number[] {
  if (!(g instanceof Graphics)) return []
  return g.context.instructions
    .filter((i) => i.action === action)
    .map((i) => (i.data.style as { color: number }).color)
}

/**
 * What `g` fills with, in drawing order: a colour as a number, or the
 * label of a texture.
 */
function paints(g: Container): (number | string)[] {
  if (!(g instanceof Graphics)) return []
  return g.context.instructions
    .filter((i) => i.action === 'fill')
    .map(({ data }) => {
      const { color, texture } = data.style as {
        color: number
        texture: Texture
      }
      return texture === Texture.WHITE ? color : texture.label!
    })
}

/** Every fill colour under `root`, depth first. */
function fills(root: Container): number[] {
  return root.children.flatMap((child) => [
    ...colours(child, 'fill'),
    ...fills(child),
  ])
}

/** `root` and every node under it, depth first. */
function everything(root: Container): Container[] {
  return [root, ...root.children.flatMap((child) => everything(child))]
}

/** Every stroke under `root` in ink: a dark outline. */
function outlines(root: Container): string[] {
  return everything(root).flatMap((node) =>
    colours(node, 'stroke')
      .filter((c) => c === hex(STYLE.palette.ink))
      .map(() => node.label),
  )
}

const hex = (colour: string) => Number.parseInt(colour.slice(1), 16)

/** `colour` mixed with `amount` of the sun or of slate. */
const sunlit = (colour: string, amount: number) =>
  mix(colour, LIGHT.sun, amount)
const shaded = (colour: string, amount: number) =>
  mix(colour, LIGHT.slate, amount)

interface Point {
  readonly x: number
  readonly y: number
}

/** Where the `index`th shape `g` fills is centred on the stage. */
function fillCentre(g: Graphics, index: number): Point {
  const data = g.context.instructions.flatMap((i) =>
    i.action === 'fill' ? [i.data] : [],
  )[index]!
  const { shape, transform } = data.path.shapePath.shapePrimitives[0]!
  const box = shape.getBounds()
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  return g.toGlobal(transform ? transform.apply(centre) : centre)
}

/** Where `node` is centred on the stage. */
function centreOf(node: Container): Point {
  const { minX, maxX, minY, maxY } = node.getBounds()
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

/**
 * `look` drawn to face `facing`, turned as the street turns it, holding a
 * cup with `cup`.
 */
function turned(look: Look, facing: 1 | -1, cup = false): Container {
  const drawn = drawCustomer(look, STYLE, LOOKS, facing, cup)
  drawn.scale.x = facing
  return drawn
}

/** Hue (0 to 360) and saturation (0 to 1) of `#RRGGBB`, as HSL has them. */
function hueOf(colour: string): { hue: number; saturation: number } {
  const [r, g, b] = [1, 3, 5].map(
    (i) => Number.parseInt(colour.slice(i, i + 2), 16) / 255,
  ) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const lightness = (max + min) / 2
  const saturation =
    chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1))
  let hue = 0
  if (chroma > 0) {
    if (max === r) hue = ((g - b) / chroma) % 6
    else if (max === g) hue = (b - r) / chroma + 2
    else hue = (r - g) / chroma + 4
  }
  return { hue: (hue * 60 + 360) % 360, saturation }
}

/** A hand: its centre on the stage, its radius and the part it is. */
interface Hand {
  readonly x: number
  readonly y: number
  readonly r: number
  readonly part: Graphics
}

/**
 * The hands of the person drawn in `root`, without those of a child they
 * come with: every part labelled `hand`.
 */
function hands(root: Container): Hand[] {
  const found: Hand[] = []
  const visit = (node: Container) => {
    for (const child of node.children) {
      if (child.label === 'child') continue
      if (child.label === 'hand' && child instanceof Graphics) {
        const { minX, maxX } = child.getBounds()
        found.push({ ...centreOf(child), r: (maxX - minX) / 2, part: child })
      }
      visit(child)
    }
  }
  visit(root)
  return found
}

/** Every node under `root`, in the order they are drawn. */
function drawOrder(root: Container): Container[] {
  return root.children.flatMap((child) => [child, ...drawOrder(child)])
}

/**
 * The share of `hand` that shows: of points spread over it, those that no
 * part drawn after its own fills or strokes.
 */
function shown(root: Container, hand: Hand): number {
  const order = drawOrder(root)
  const above = order
    .slice(order.indexOf(hand.part) + 1)
    .filter((node): node is Graphics => node instanceof Graphics)
  const steps = 8
  let points = 0
  let seen = 0
  for (let i = -steps; i <= steps; i += 1) {
    for (let j = -steps; j <= steps; j += 1) {
      if (i * i + j * j > steps * steps) continue
      const point = {
        x: hand.x + (hand.r * i) / steps,
        y: hand.y + (hand.r * j) / steps,
      }
      points += 1
      if (!above.some((g) => g.containsPoint(g.toLocal(point)))) seen += 1
    }
  }
  return seen / points
}

/** The design reference's shirts and hair (`rue.py`), which the looks widen to. */
const TARGET_SHIRTS = [
  '#3F7F8F',
  '#7A8F3C',
  '#6B4A8C',
  '#C0573A',
  '#D08A2E',
  '#4A6FA5',
]
const TARGET_HAIR = ['#7A4B2A', '#4A5A2A', '#C9A24A', '#2B2622', '#5A3A2A']

describe('pickLook', () => {
  it('draws skin, clothes, hair and height from the settings for every segment', () => {
    const random = seeded(5)
    for (let i = 0; i < 200; i += 1) {
      const segment = SEGMENTS[i % 3]!
      const look = pickLook(segment, 'semaine', LOOKS, random)
      expect(look.segment).toBe(segment)
      expect(LOOKS.skinTones).toContain(look.skin)
      expect(LOOKS.clothes).toContain(look.clothes)
      expect(LOOKS.hair.colors).toContain(look.hair)
      expect(['cap', 'hair']).toContain(look.headwear)
      expect(look.height).toBeGreaterThanOrEqual(LOOKS.height.min)
      expect(look.height).toBeLessThanOrEqual(LOOKS.height.max)
    }
  })

  it('varies skin tones, hair and heights within each segment', () => {
    const random = seeded(9)
    for (const segment of SEGMENTS) {
      const looks = Array.from({ length: 60 }, () =>
        pickLook(segment, 'semaine', LOOKS, random),
      )
      expect(new Set(looks.map((l) => l.skin)).size).toBeGreaterThan(3)
      expect(new Set(looks.map((l) => l.hair)).size).toBeGreaterThan(3)
      expect(new Set(looks.map((l) => l.headwear)).size).toBe(2)
      expect(new Set(looks.map((l) => l.height)).size).toBeGreaterThan(30)
    }
  })

  it('stands people about as tall as the reference draws them', () => {
    const middle = (LOOKS.height.min + LOOKS.height.max) / 2
    expect(middle).toBe(116)
    expect(LOOKS.childHeight.max).toBeLessThan(LOOKS.height.min)
  })

  it('puts a cap on as often as the settings say', () => {
    for (const capChance of [0, 1]) {
      const looks = { ...LOOKS, hair: { ...LOOKS.hair, capChance } }
      const always = { ...looks, familyChance: 1 }
      const random = seeded(13)
      for (let i = 0; i < 40; i += 1) {
        const look = pickLook('chic', 'finDeSemaine', always, random)
        const wanted = capChance === 1 ? 'cap' : 'hair'
        expect(look.headwear).toBe(wanted)
        expect(look.child!.headwear).toBe(wanted)
      }
    }
    const random = seeded(14)
    const caps = Array.from(
      { length: 400 },
      () => pickLook('aubaine', 'semaine', LOOKS, random).headwear,
    ).filter((worn) => worn === 'cap').length
    expect(caps / 400).toBeGreaterThan(LOOKS.hair.capChance - 0.1)
    expect(caps / 400).toBeLessThan(LOOKS.hair.capChance + 0.1)
  })

  it('gives office cues on weekdays only and children on weekends only', () => {
    const always = { ...LOOKS, officeChance: 1, familyChance: 1 }
    const random = seeded(11)
    const cues = new Set<string | null>()
    for (let i = 0; i < 100; i += 1) {
      const weekday = pickLook('aubaine', 'semaine', always, random)
      expect(weekday.child).toBeNull()
      cues.add(weekday.office)
      const weekend = pickLook('aubaine', 'finDeSemaine', always, random)
      expect(weekend.office).toBeNull()
      expect(weekend.child).not.toBeNull()
      expect(weekend.child!.height).toBeGreaterThanOrEqual(
        LOOKS.childHeight.min,
      )
      expect(weekend.child!.height).toBeLessThanOrEqual(LOOKS.childHeight.max)
      expect(LOOKS.hair.colors).toContain(weekend.child!.hair)
    }
    expect(cues).toEqual(new Set(['lanyard', 'laptopBag']))
  })

  it("widens the shirts and the hair to the design reference's", () => {
    expect(LOOKS.clothes).toEqual(expect.arrayContaining(TARGET_SHIRTS))
    expect(LOOKS.hair.colors).toEqual(expect.arrayContaining(TARGET_HAIR))
    expect(LOOKS.trousers).toBe('#3B3A44')
  })

  it("dresses everyone in the warm palette, never in purple but for the reference's own shirt", () => {
    const worn = [
      ...LOOKS.clothes,
      ...LOOKS.hair.colors,
      LOOKS.coat,
      LOOKS.tote,
      LOOKS.laptopBag,
      LOOKS.trousers,
      CROWD.avatar.hair,
    ]
    const purples = worn.filter((colour) => {
      const { hue, saturation } = hueOf(colour)
      return hue >= 250 && hue <= 330 && saturation > 0.08
    })
    // The reference (#197), whose colours are the spec here, dresses one
    // of its people in it.
    expect(purples).toEqual(['#6B4A8C'])
    expect(LOOKS.clothes).not.toContain('#8C6B9E')
  })

  it('gives no fan without fans, and draws the same as before', () => {
    const without = seeded(21)
    const atZero = seeded(21)
    const fans = { chance: 0, color: STYLE.palette.cream }
    for (let i = 0; i < 50; i += 1) {
      const segment = SEGMENTS[i % 3]!
      const look = pickLook(segment, 'finDeSemaine', LOOKS, without)
      expect(look.fan).toBeNull()
      expect(pickLook(segment, 'finDeSemaine', LOOKS, atZero, fans)).toEqual(
        look,
      )
    }
    expect(atZero()).toBe(without())
  })

  it('gives everyone a fan at a chance of 1, with one more draw, last', () => {
    const plain = seeded(22)
    const fanning = seeded(22)
    const fans = { chance: 1, color: STYLE.palette.cream }
    for (let i = 0; i < 50; i += 1) {
      const segment = SEGMENTS[i % 3]!
      const look = pickLook(segment, 'semaine', LOOKS, plain)
      plain()
      expect(pickLook(segment, 'semaine', LOOKS, fanning, fans)).toEqual({
        ...look,
        fan: STYLE.palette.cream,
      })
    }
  })

  it('gives a fan to some at a chance in between', () => {
    const random = seeded(23)
    const fans = { chance: 0.35, color: STYLE.palette.cream }
    const looks = Array.from({ length: 400 }, () =>
      pickLook('chic', 'semaine', LOOKS, random, fans),
    )
    const share = looks.filter((l) => l.fan !== null).length / looks.length
    expect(share).toBeGreaterThan(0.25)
    expect(share).toBeLessThan(0.45)
  })

  it('gives neither when their chance is 0', () => {
    const never = { ...LOOKS, officeChance: 0, familyChance: 0 }
    const random = seeded(12)
    for (let i = 0; i < 50; i += 1) {
      expect(pickLook('chic', 'semaine', never, random).office).toBeNull()
      expect(pickLook('chic', 'finDeSemaine', never, random).child).toBeNull()
    }
  })
})

describe('createPeopleShading', () => {
  it('makes each gradient lit from either side, from the light and the figure', () => {
    const shading = createPeopleShading(LIGHT, FIGURE)
    expect(shading.figure).toBe(FIGURE)
    for (const kind of ['side', 'round'] as const) {
      const left = shading[kind]('left')
      const right = shading[kind]('right')
      expect(left).not.toBe(right)
      expect(shading[kind]('left')).toBe(left)
      // Sun on its left: more light there than on its right.
      const pixels = (texture: Texture) => texture.source.resource as Uint8Array
      const { width } = left.source
      const alphaAt = (texture: Texture, x: number) =>
        pixels(texture)[x * 4 + 3]!
      const redAt = (texture: Texture, x: number) => pixels(texture)[x * 4]!
      expect(redAt(left, 1) / alphaAt(left, 1)).toBeGreaterThan(
        redAt(left, width - 2) / alphaAt(left, width - 2),
      )
      expect(alphaAt(right, 1)).toBe(alphaAt(left, width - 2))
    }
    shading.destroy()
    expect(shading.side('left').destroyed).toBe(true)
    expect(shading.round('right').destroyed).toBe(true)
  })
})

describe('drawCustomer', () => {
  const CHILD: ChildLook = {
    skin: LOOKS.skinTones[3]!,
    clothes: LOOKS.clothes[2]!,
    height: 70,
    hair: LOOKS.hair.colors[3]!,
    headwear: 'cap',
  }
  const FAN = LOOKS.clothes[4]!
  const PEOPLE = SEGMENTS.flatMap((segment) =>
    ([null, 'lanyard', 'laptopBag'] as const).flatMap((office) =>
      [null, CHILD].flatMap((child) =>
        [null, FAN].flatMap((fan) =>
          [false, true].map((cup) => ({
            name: [
              segment,
              office,
              child && 'child',
              fan && 'fan',
              cup && 'cup',
            ]
              .filter(Boolean)
              .join(', '),
            look: {
              ...LOOK,
              segment,
              office,
              child,
              fan,
              headwear: cup ? 'cap' : 'hair',
            } satisfies Look,
            cup,
          })),
        ),
      ),
    ),
  )

  it('draws legs, arms, hands, a torso, a head and hair', () => {
    const drawn = drawCustomer(LOOK, STYLE, LOOKS)
    for (const part of ['legs', 'farArm', 'torso', 'nearArm', 'head', 'hair']) {
      expect(labels(drawn)).toContain(part)
    }
    expect(labels(drawn)).not.toContain('cap')
    const capped = drawCustomer({ ...LOOK, headwear: 'cap' }, STYLE, LOOKS)
    expect(labels(capped)).toContain('cap')
    expect(labels(capped)).not.toContain('hair')
  })

  it.each(PEOPLE)('draws no dark outline: $name', ({ look, cup }) => {
    for (const facing of [1, -1] as const) {
      expect(outlines(turned(look, facing, cup))).toEqual([])
    }
  })

  it.each(PEOPLE)(
    'draws exactly two hands per person: $name',
    ({ look, cup }) => {
      for (const facing of [1, -1] as const) {
        const drawn = turned(look, facing, cup)
        expect(hands(drawn)).toHaveLength(2)
        if (look.child !== null) {
          expect(hands(find(drawn, 'child'))).toHaveLength(2)
        }
      }
    },
  )

  it.each(PEOPLE)(
    'keeps most of each hand in sight of what they carry: $name',
    ({ look, cup }) => {
      for (const facing of [1, -1] as const) {
        const drawn = turned(look, facing, cup)
        const all = [
          ...hands(drawn),
          ...(look.child ? hands(find(drawn, 'child')) : []),
        ]
        for (const hand of all) {
          expect(
            shown(drawn, hand),
            `facing ${facing}, hand at ${hand.x.toFixed(0)}`,
          ).toBeGreaterThan(0.5)
        }
      }
    },
  )

  it.each(PEOPLE)(
    "lights the near side, on the screen's left, and shades the far one: $name",
    ({ look, cup }) => {
      for (const facing of [1, -1] as const) {
        const drawn = turned(look, facing, cup)
        const sun = facing === 1 ? 'left' : 'right'
        const people = [
          { root: drawn, person: look },
          ...(look.child
            ? [{ root: find(drawn, 'child'), person: look.child }]
            : []),
        ]
        for (const { root, person } of people) {
          const name = root === drawn ? 'adult' : 'child'
          const legs = find(root, 'legs') as Graphics
          expect(paints(legs)).toEqual([
            hex(LOOKS.trousers),
            hex(shaded(LOOKS.trousers, FIGURE.shade.leg)),
          ])
          expect(fillCentre(legs, 0).x, name).toBeLessThan(
            fillCentre(legs, 1).x,
          )
          const near = centreOf(find(root, 'nearArm'))
          const far = centreOf(find(root, 'farArm'))
          expect(near.x, `${name} arms`).toBeLessThan(far.x)
          const [left, right] = hands(root).sort((a, b) => a.x - b.x)
          expect(paints(left!.part)).toEqual([hex(person.skin)])
          expect(paints(right!.part)).toEqual([
            hex(shaded(person.skin, FIGURE.shade.hand)),
          ])
          // Each gradient lit from the side that shows on the screen's left.
          expect(paints(find(root, 'torso'))).toEqual([
            hex(person.clothes),
            SHADING.side(sun).label,
          ])
          expect(paints(find(root, 'head'))).toEqual([
            hex(person.skin),
            SHADING.round(sun).label,
          ])
        }
        if (look.segment === 'chic') {
          expect(paints(find(drawn, 'coat')).slice(0, 2)).toEqual([
            hex(LOOKS.coat),
            SHADING.side(sun).label,
          ])
        }
      }
    },
  )

  it('tones each arm as the reference does, near or far, hanging or bent', () => {
    const tone = (drawn: Container, part: string) => {
      const g = find(drawn, part)
      return [...colours(g, 'fill'), ...colours(g, 'stroke')]
    }
    const clothes = LOOK.clothes
    const hanging = drawCustomer(LOOK, STYLE, LOOKS)
    expect(tone(hanging, 'nearArm')).toEqual([
      hex(sunlit(clothes, FIGURE.lit.arm)),
    ])
    expect(tone(hanging, 'farArm')).toEqual([
      hex(shaded(clothes, FIGURE.shade.arm)),
    ])
    // The cup is in the hand on the left: near facing right, far facing left.
    const right = drawCustomer(LOOK, STYLE, LOOKS, 1, true)
    expect(tone(right, 'nearArm')).toEqual([
      hex(sunlit(clothes, FIGURE.lit.bentArm)),
    ])
    const left = drawCustomer(LOOK, STYLE, LOOKS, -1, true)
    expect(tone(left, 'farArm')).toEqual([
      hex(shaded(clothes, FIGURE.shade.arm)),
    ])
    // A coat's sleeves are the coat's.
    const chic = drawCustomer({ ...LOOK, segment: 'chic' }, STYLE, LOOKS)
    expect(tone(chic, 'farArm')).toEqual([
      hex(shaded(LOOKS.coat, FIGURE.shade.arm)),
    ])
  })

  it.each([106, 116, 126])(
    "keeps the reference's proportions at a height of %i",
    (h) => {
      const drawn = drawCustomer({ ...LOOK, height: h }, STYLE, LOOKS)
      const u = h / 116
      const head = find(drawn, 'head').getLocalBounds()
      expect(head.width).toBeCloseTo(32 * u)
      expect((head.minY + head.maxY) / 2).toBeCloseTo(-100 * u)
      expect(head.minY).toBeCloseTo(-h)
      const torso = find(drawn, 'torso').getLocalBounds()
      expect(torso.width).toBeCloseTo(36 * u)
      expect(torso.height).toBeCloseTo(52 * u)
      expect(torso.minY).toBeCloseTo(-82 * u)
      const legs = find(drawn, 'legs').getLocalBounds()
      expect(legs.maxY).toBeCloseTo(0)
      expect(legs.height).toBeCloseTo(36 * u)
      for (const { r } of hands(drawn)) expect(r).toBeCloseTo(5 * u)
    },
  )

  it('wears hair, a lit stroke over it, or a cap with a lit edge, in its colour', () => {
    const hair = LOOKS.hair.colors[2]!
    const bare = find(drawCustomer({ ...LOOK, hair }, STYLE, LOOKS), 'hair')
    expect(colours(bare, 'fill')).toEqual([hex(hair)])
    expect(colours(bare, 'stroke')).toEqual([
      hex(sunlit(hair, FIGURE.lit.hairEdge)),
    ])
    for (const facing of [1, -1] as const) {
      const look = { ...LOOK, hair, headwear: 'cap' as const }
      const cap = find(turned(look, facing), 'cap') as Graphics
      expect(paints(cap)).toEqual([
        hex(hair),
        hex(sunlit(hair, FIGURE.lit.capEdge)),
      ])
      // The lit edge is on the screen's left.
      expect(fillCentre(cap, 1).x).toBeLessThan(fillCentre(cap, 0).x)
    }
  })

  it.each(SEGMENTS)(
    'shows a %s customer by their accessory only',
    (segment) => {
      const drawn = labels(drawCustomer({ ...LOOK, segment }, STYLE, LOOKS))
      const own = SEGMENT_ACCESSORY[segment]
      expect(drawn).toContain(own)
      for (const other of Object.values(SEGMENT_ACCESSORY)) {
        if (other !== own) expect(drawn).not.toContain(other)
      }
    },
  )

  it('shows a regular by the newspaper under their arm, not a mug', () => {
    expect(SEGMENT_ACCESSORY.habitue).toBe('newspaper')
    const drawn = drawCustomer(LOOK, STYLE, LOOKS)
    expect(labels(drawn)).not.toContain('mug')
    // Behind the arms, so both hands show.
    const at = (part: string) => drawn.getChildIndex(find(drawn, part))
    expect(at('newspaper')).toBeLessThan(at('farArm'))
    expect(at('newspaper')).toBeLessThan(at('nearArm'))
  })

  it("hangs the chic customer's coat behind both arms, its fronts over the shirt", () => {
    const drawn = drawCustomer({ ...LOOK, segment: 'chic' }, STYLE, LOOKS)
    const at = (part: string) => drawn.getChildIndex(find(drawn, part))
    expect(at('coat')).toBeLessThan(at('farArm'))
    expect(at('torso')).toBeLessThan(at('lapels'))
    expect(at('lapels')).toBeLessThan(at('nearArm'))
    expect(fills(drawn)).toContain(hex(LOOK.clothes))
  })

  it('keeps the same body for every segment', () => {
    const body = (segment: SegmentId) => {
      const drawn = drawCustomer({ ...LOOK, segment }, STYLE, LOOKS)
      return ['torso', 'head', 'legs'].map((part) => paints(find(drawn, part)))
    }
    expect(body('aubaine')).toEqual(body('habitue'))
    expect(body('chic')).toEqual(body('habitue'))
  })

  it('changes only the skin when the skin tone changes', () => {
    const [light, dark] = [LOOKS.skinTones[0]!, LOOKS.skinTones[5]!]
    const far = (skin: string) => shaded(skin, FIGURE.shade.hand)
    const swap = new Map([
      [hex(light), hex(dark)],
      [hex(far(light)), hex(far(dark))],
    ])
    for (const segment of SEGMENTS) {
      const a = fills(
        drawCustomer({ ...LOOK, segment, skin: light }, STYLE, LOOKS),
      )
      const b = fills(
        drawCustomer({ ...LOOK, segment, skin: dark }, STYLE, LOOKS),
      )
      expect(a).toContain(hex(light))
      expect(a.map((c) => swap.get(c) ?? c)).toEqual(b)
    }
  })

  it('stands the child on the side the customer faces away from', () => {
    const family = { ...LOOK, child: CHILD }
    for (const facing of [1, -1] as const) {
      const drawn = turned(family, facing)
      const child = find(drawn, 'child').getGlobalPosition()
      expect(Math.sign(child.x)).toBe(-facing)
      expect(Math.abs(child.x)).toBeCloseTo(family.height * CHILD_OFFSET)
    }
  })

  it('draws a lanyard or a laptop bag for an office cue', () => {
    expect(
      labels(drawCustomer({ ...LOOK, office: 'lanyard' }, STYLE, LOOKS)),
    ).toContain('lanyard')
    const bag = labels(
      drawCustomer({ ...LOOK, office: 'laptopBag' }, STYLE, LOOKS),
    )
    expect(bag).toContain('laptopBag')
    expect(bag).not.toContain('lanyard')
    expect(labels(drawCustomer(LOOK, STYLE, LOOKS))).not.toContain('lanyard')
  })

  it('draws a child with their own body, skin and hair beside the adult', () => {
    const drawn = drawCustomer({ ...LOOK, child: CHILD }, STYLE, LOOKS)
    const child = find(drawn, 'child')
    expect(child.x).toBeLessThan(0)
    expect(paints(find(child, 'head'))[0]).toBe(hex(CHILD.skin))
    expect(paints(find(child, 'cap'))[0]).toBe(hex(CHILD.hair))
    expect(find(child, 'head').getLocalBounds().minY).toBeCloseTo(-CHILD.height)
    expect(labels(child)).not.toContain('newspaper')
    expect(labels(drawCustomer(LOOK, STYLE, LOOKS))).not.toContain('child')
  })

  /** The hands of `look` that hold what is labelled `item`. */
  function holdingHands(drawn: Container, item: string): Hand[] {
    const { minX, maxX, minY, maxY } = find(drawn, item).getBounds()
    return hands(drawn).filter(
      ({ x, y, r }) =>
        x >= minX - r && x <= maxX + r && y >= minY - r && y <= maxY + r,
    )
  }

  it('holds a cup only once served, in one of their own hands', () => {
    for (const segment of SEGMENTS) {
      const look = { ...LOOK, segment }
      expect(labels(drawCustomer(look, STYLE, LOOKS))).not.toContain('cup')
      const drawn = drawCustomer(look, STYLE, LOOKS, 1, true)
      expect(holdingHands(drawn, 'cup')).toHaveLength(1)
      const { color, band } = FIGURE.cup
      expect(colours(find(drawn, 'cup'), 'fill')).toEqual([
        hex(color),
        hex(band),
      ])
    }
  })

  it('holds a fan in the hand on the right, and a cup still in the left', () => {
    const look = { ...LOOK, fan: FAN }
    const drawn = drawCustomer(look, STYLE, LOOKS, 1, true)
    const fan = holdingHands(drawn, 'fan')
    const cup = holdingHands(drawn, 'cup')
    expect(fan).toHaveLength(1)
    expect(cup).toHaveLength(1)
    expect(fan[0]!.x).toBeGreaterThan(0)
    expect(cup[0]!.x).toBeLessThan(0)
    // Its leaves open above the hand, in its colour, its pleats in shade.
    expect(find(drawn, 'fan').getBounds().maxY).toBeLessThanOrEqual(
      fan[0]!.y + fan[0]!.r,
    )
    expect(colours(find(drawn, 'fan'), 'fill')).toEqual([hex(FAN)])
    expect(new Set(colours(find(drawn, 'fan'), 'stroke'))).toEqual(
      new Set([hex(shaded(FAN, LIGHT.shadeSide.slate))]),
    )
  })

  it('draws no fan for one who has none', () => {
    for (const segment of SEGMENTS) {
      const drawn = drawCustomer({ ...LOOK, segment }, STYLE, LOOKS)
      expect(labels(drawn)).not.toContain('fan')
    }
  })
})

describe('drawBubble', () => {
  it.each([
    ['happy', ['smile'], 'moneyGreen'],
    ['annoyed', ['brows', 'mouth'], 'warningAmber'],
    ['sad', ['frown', 'tear'], 'playerBlue'],
    ['neutral', ['dots'], 'ink'],
  ] as const)('draws a %s face', (mood, parts, colour) => {
    const bubble = drawBubble(mood, STYLE)
    const face = find(bubble, `face:${mood}`)
    expect(labels(face)).toEqual(expect.arrayContaining([...parts]))
    for (const part of parts) {
      const g = find(face, part)
      expect([...colours(g, 'fill'), ...colours(g, 'stroke')]).toContain(
        hex(STYLE.palette[colour]),
      )
    }
    expect(colours(find(bubble, 'back'), 'fill')).toEqual([
      hex(STYLE.palette.cream),
    ])
  })

  it('draws each mood with a face of its own', () => {
    const faces = (['happy', 'annoyed', 'sad', 'neutral'] as const).map(
      (mood) => labels(find(drawBubble(mood, STYLE), `face:${mood}`)).join(),
    )
    expect(new Set(faces).size).toBe(4)
  })

  it("draws each face in the colour the customer's card gives its mood", () => {
    for (const mood of ['happy', 'annoyed', 'sad', 'neutral'] as const) {
      const face = find(drawBubble(mood, STYLE), `face:${mood}`)
      const drawn = face.children.flatMap((g) => [
        ...colours(g, 'fill'),
        ...colours(g, 'stroke'),
      ])
      expect(new Set(drawn)).toEqual(
        new Set([hex(STYLE.palette[MOOD_COLORS[mood]])]),
      )
    }
  })
})

describe('drawPickMark', () => {
  it('rings the feet in player blue, wider than it is deep', () => {
    const mark = drawPickMark(150, STYLE)
    expect(mark.label).toBe('pickMark')
    expect(colours(mark, 'stroke')).toEqual([hex(STYLE.palette.playerBlue)])
    const { minX, maxX, minY, maxY } = mark.getLocalBounds()
    expect((minX + maxX) / 2).toBeCloseTo(0)
    expect((minY + maxY) / 2).toBeCloseTo(0)
    expect(maxX - minX).toBeGreaterThan(maxY - minY)
  })
})

describe('drawAvatar', () => {
  const SHIRT = STYLE.palette.playerBlue

  it('wears a blue shirt and a cream apron under the light, the far arm in shade', () => {
    const { root } = avatar()
    expect(paints(find(root, 'shirt'))).toEqual([hex(SHIRT)])
    expect(paints(find(root, 'apron'))).toEqual([
      hex(STYLE.palette.cream),
      SHADING.side('left').label,
    ])
    expect(paints(find(root, 'head'))).toEqual([
      hex(CROWD.avatar.skin),
      SHADING.round('left').label,
    ])
    expect(paints(find(root, 'otherArm'))).toEqual([
      hex(shaded(SHIRT, FIGURE.shade.arm)),
    ])
    expect(paints(find(root, 'reachingArm'))).toEqual([
      hex(sunlit(SHIRT, FIGURE.lit.arm)),
    ])
    const legs = find(root, 'legs') as Graphics
    expect(paints(legs)).toEqual([
      hex(LOOKS.trousers),
      hex(shaded(LOOKS.trousers, FIGURE.shade.leg)),
    ])
    expect(fillCentre(legs, 0).x).toBeLessThan(fillCentre(legs, 1).x)
    // The shaded arm hangs on the screen's right, the lit one on its left.
    expect(centreOf(find(root, 'otherArm')).x).toBeGreaterThan(0)
    expect(centreOf(find(root, 'reachingArm')).x).toBeLessThan(0)
  })

  it("stands the reference owner's height, the shirt from the chin to the counter's top", () => {
    const { root } = avatar()
    const v = CROWD.avatar.height / 130
    const head = find(root, 'head').getLocalBounds()
    expect(head.width).toBeCloseTo(40 * v)
    expect(head.minY).toBeCloseTo(-CROWD.avatar.height)
    const shirt = find(root, 'shirt').getLocalBounds()
    expect(shirt.width).toBeCloseTo(48 * v)
    expect(shirt.minY).toBeCloseTo(head.maxY)
    expect(shirt.maxY).toBeCloseTo(-50 * v)
  })

  it.each(['femme', 'homme'] as const)(
    'draws no dark outline, rested, exhausted or yawning: %s',
    (kind) => {
      const art = avatar(kind)
      expect(outlines(art.root)).toEqual([])
      art.circles.visible = true
      art.yawn.visible = true
      art.arm.rotation = Math.PI * 0.45
      expect(outlines(art.root)).toEqual([])
    },
  )

  it('has an arm that turns at the shoulder, hanging down at rest', () => {
    const { upper, arm } = avatar('homme')
    expect(arm.parent).toBe(upper)
    expect(arm.rotation).toBe(0)
    expect(arm.x).toBeLessThan(0)
  })

  it.each(['femme', 'homme'] as const)(
    'has two hands, one at the end of each sleeve, at rest and reaching: %s',
    (kind) => {
      const { root, arm } = avatar(kind)
      for (const rotation of [0, Math.PI * 0.45]) {
        arm.rotation = rotation
        const found = hands(root)
        expect(found).toHaveLength(2)
        const reaching = (hand: Hand) => drawOrder(arm).includes(hand.part)
        expect(found.filter(reaching)).toHaveLength(1)
        expect(found.find(reaching)!.part.parent).toBe(arm)
        expect(paints(found.find(reaching)!.part)).toEqual([
          hex(CROWD.avatar.skin),
        ])
        // The other hand ends the sleeve that hangs on the screen's right.
        const other = found.find((hand) => !reaching(hand))!
        expect(paints(other.part)).toEqual([
          hex(shaded(CROWD.avatar.skin, FIGURE.shade.hand)),
        ])
        const sleeve = find(root, 'otherArm') as Graphics
        expect(sleeve.containsPoint(sleeve.toLocal(other))).toBe(true)
        expect(shown(root, other)).toBeGreaterThan(0.5)
      }
      // Reaching, the hand goes out over the counter, left of the shirt.
      const shirt = find(root, 'shirt').getBounds()
      expect(hands(root).find((h) => h.part.parent === arm)!.x).toBeLessThan(
        shirt.minX,
      )
    },
  )

  it('wears the hair of the avatar the player picked, behind the head, with a lit hairline', () => {
    const femme = avatar('femme').root
    const homme = avatar('homme').root
    expect(femme.label).toBe('avatar:femme')
    expect(homme.label).toBe('avatar:homme')
    const hair = hex(CROWD.avatar.hair)
    // Her bun as well.
    expect(colours(find(femme, 'hair'), 'fill')).toEqual([hair, hair])
    expect(colours(find(homme, 'hair'), 'fill')).toEqual([hair])
    for (const root of [femme, homme]) {
      const face = find(root, 'face')
      expect(face.getChildIndex(find(root, 'hair'))).toBeLessThan(
        face.getChildIndex(find(root, 'head')),
      )
      expect(colours(find(root, 'hairTop'), 'stroke')).toEqual([
        hex(sunlit(CROWD.avatar.hair, FIGURE.lit.ownerHairEdge)),
      ])
    }
  })

  it('keeps the legs out of the upper body, which holds the rest', () => {
    const { root, upper, face } = avatar()
    expect(root.children.map((c) => c.label)).toEqual(['legs', 'upper'])
    expect(labels(upper)).toEqual(
      expect.arrayContaining(['otherArm', 'shirt', 'apron', 'face', 'arm']),
    )
    expect(face.parent).toBe(upper)
    expect(labels(face)).toEqual(
      expect.arrayContaining(['hair', 'head', 'eyes', 'hairTop']),
    )
  })

  it('turns the head at the chin, under the head', () => {
    const { face } = avatar()
    const head = find(face, 'head').getLocalBounds()
    expect(face.pivot.y).toBeCloseTo(head.maxY)
    expect(face.position.y).toBe(face.pivot.y)
    expect(face.rotation).toBe(0)
  })

  it('draws two ink eyes on the face, below the hair', () => {
    const { face, eyes } = avatar('homme')
    expect(colours(eyes, 'fill')).toEqual([hex(STYLE.palette.ink)])
    expect(eyes.visible).toBe(true)
    const head = find(face, 'head').getBounds()
    const cap = find(face, 'hairTop').getBounds()
    const { minX, maxX, minY, maxY } = eyes.getBounds()
    expect(minY).toBeGreaterThan(cap.maxY)
    expect(maxY).toBeLessThan(head.maxY)
    expect(minX).toBeGreaterThan(head.minX)
    expect(maxX).toBeLessThan(head.maxX)
  })

  it('draws dark circles and a yawn, both hidden at first', () => {
    const { face, circles, yawn } = avatar()
    expect(circles.parent).toBe(face)
    expect(yawn.parent).toBe(face)
    expect(circles.visible).toBe(false)
    expect(yawn.visible).toBe(false)
    expect(colours(circles, 'stroke')).toEqual([hex(CIRCLES), hex(CIRCLES)])
    expect(colours(yawn, 'fill')).toEqual([hex(STYLE.palette.ink)])
  })
})

describe('drawSpill', () => {
  const SPILL = CROWD.fatigue.spill

  it('draws a puddle and a drop in its colour where the settings put it, unoutlined', () => {
    const spill = drawSpill(SPILL)
    expect(spill.label).toBe('spill')
    expect(spill.position).toMatchObject({ x: SPILL.x, y: SPILL.y })
    expect(new Set(colours(spill, 'fill'))).toEqual(new Set([hex(SPILL.color)]))
    expect(colours(spill, 'stroke')).toEqual([])
  })

  it('is as wide as the settings say, with the drop running down', () => {
    const { minX, maxX, minY, maxY } = drawSpill(SPILL).getLocalBounds()
    expect(maxX - minX).toBeCloseTo(SPILL.width)
    expect(maxY).toBeGreaterThan(-minY * 2)
  })
})

describe('tourists and the winter (#264)', () => {
  /** `random` that counts its draws. */
  const counting = (seed: number) => {
    const random = seeded(seed)
    const counted = Object.assign(
      () => {
        counted.draws += 1
        return random()
      },
      { draws: 0 },
    )
    return counted
  }

  it('gives every tourist a hat, a camera or a map, from the settings', () => {
    const random = seeded(21)
    const kit = LOOKS.tourist
    let hats = 0
    for (let i = 0; i < 200; i += 1) {
      const { tourist } = pickLook('touriste', 'finDeSemaine', LOOKS, random)
      expect(tourist).not.toBeNull()
      const { hat, carries } = tourist!
      if (hat !== null) {
        hats += 1
        expect(kit.hats).toContain(hat)
      }
      expect(hat !== null || carries !== null).toBe(true)
    }
    expect(hats).toBeGreaterThan(80)
    expect(hats).toBeLessThan(160)
  })

  it('gives the other segments no tourist look, and bundles no one in summer', () => {
    const random = seeded(3)
    for (const segment of SEGMENTS) {
      const look = pickLook(segment, 'semaine', LOOKS, random)
      expect(look.tourist).toBeNull()
      expect(look.bundled).toBeNull()
    }
  })

  it('draws the others as before in summer: a tourist takes two or three draws more, the winter one', () => {
    const draws = (segment: SegmentId, winter = false) => {
      const random = counting(4)
      pickLook(segment, 'finDeSemaine', LOOKS, random, null, winter)
      return random.draws
    }
    // The same seed draws the same look up to the new draws, which come last.
    const before = pickLook('habitue', 'finDeSemaine', LOOKS, seeded(4))
    const touring = pickLook('touriste', 'finDeSemaine', LOOKS, seeded(4))
    const shared = (look: Look) => ({
      skin: look.skin,
      clothes: look.clothes,
      height: look.height,
      hair: look.hair,
      headwear: look.headwear,
      office: look.office,
      child: look.child,
      fan: look.fan,
    })
    expect(shared(touring)).toEqual(shared(before))
    // Whether they wear a hat, which one, and what they carry.
    expect(draws('touriste') - draws('habitue')).toBeGreaterThanOrEqual(2)
    expect(draws('touriste') - draws('habitue')).toBeLessThanOrEqual(3)
    expect(draws('habitue', true)).toBe(draws('habitue') + 1)
  })

  it('bundles everyone up in winter in a tuque of the settings', () => {
    const random = seeded(8)
    for (const segment of [...SEGMENTS, 'touriste'] as const) {
      const { bundled } = pickLook(
        segment,
        'semaine',
        LOOKS,
        random,
        null,
        true,
      )
      expect(LOOKS.winter.tuques).toContain(bundled?.tuque)
    }
  })

  it("draws a tourist's sun hat over their head, and their camera or map over all", () => {
    const tourist = (carries: 'camera' | 'map' | null, hat: string | null) =>
      drawCustomer(
        { ...LOOK, segment: 'touriste', tourist: { hat, carries } },
        STYLE,
        LOOKS,
      )
    const kit = LOOKS.tourist
    const hatted = tourist('camera', kit.hats[0]!)
    const drawn = find(hatted, 'tourist')
    // Over everything, the head too.
    expect(hatted.children.at(-1)).toBe(drawn)
    expect(colours(drawn, 'fill')).toEqual([
      hex(kit.hats[0]!),
      hex(kit.hats[0]!),
      hex(kit.band),
      hex(kit.camera),
      hex(kit.lens),
    ])
    expect(colours(drawn, 'stroke')).toEqual([hex(kit.camera)])
    const mapped = find(tourist('map', null), 'tourist')
    expect(colours(mapped, 'fill')).toEqual([hex(kit.map)])
    expect(colours(mapped, 'stroke')).toEqual([hex(kit.mapFold)])
    // A tourist drawn without a look still shows as one.
    expect(
      labels(drawCustomer({ ...LOOK, segment: 'touriste' }, STYLE, LOOKS)),
    ).toContain('tourist')
  })

  it('bundles someone up in a tuque with its pompom, a scarf and their coat’s hem', () => {
    const tuque = LOOKS.winter.tuques[0]!
    const drawn = drawCustomer(
      { ...LOOK, headwear: 'hair', bundled: { tuque } },
      STYLE,
      LOOKS,
    )
    const bundled = find(drawn, 'bundled')
    expect(colours(bundled, 'fill')).toEqual([
      hex(tuque),
      hex(LOOKS.winter.pompom),
      hex(LOOKS.winter.scarf),
      hex(LOOK.clothes),
    ])
    // A cap of the tuque's colour covers the head, whatever their hair.
    expect(labels(drawn)).toContain('cap')
    expect(labels(drawn)).not.toContain('hair')
    expect(paints(find(drawn, 'cap'))[0]).toBe(hex(tuque))
  })

  it('serves an employee behind the counter in the staff’s shirt', () => {
    const server = drawAvatar(
      'homme',
      STYLE,
      CROWD.avatar,
      LOOKS.trousers,
      CIRCLES,
      STYLE.palette.mustard,
    )
    expect(colours(find(server.root, 'shirt'), 'fill')).toEqual([
      hex(STYLE.palette.mustard),
    ])
    expect(colours(find(avatar().root, 'shirt'), 'fill')).toEqual([
      hex(STYLE.palette.playerBlue),
    ])
  })
})
