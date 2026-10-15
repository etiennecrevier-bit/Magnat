import { Container, Graphics } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import type { SegmentId } from '../content/schema.ts'
import { next, seedRng } from '../engine/rng.ts'
import { CROWD } from './crowdSettings.ts'
import { ASSETS } from './manifest.ts'
import { MOOD_COLORS } from './customerCard.ts'
import {
  CHILD_OFFSET,
  drawAvatar,
  drawBubble,
  drawCustomer,
  drawPickMark,
  drawSpill,
  pickLook,
  SEGMENT_ACCESSORY,
  type ChildLook,
  type Look,
} from './people.ts'
import { tonesOf } from './light.ts'
import type { DrawStyle } from './placeholders.ts'

const STYLE: DrawStyle = {
  palette: ASSETS.palette,
  outline: ASSETS.outlineWidth,
  light: ASSETS.light,
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
  height: 150,
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

/** Every fill colour under `root`, depth first. */
function fills(root: Container): number[] {
  return root.children.flatMap((child) => [
    ...colours(child, 'fill'),
    ...fills(child),
  ])
}

const hex = (colour: string) => Number.parseInt(colour.slice(1), 16)

/** A colour in shade, as the light mixes it. */
const shade = (colour: string) => tonesOf(colour, ASSETS.light).shade

/**
 * Each shade fill of `g` and the lit fill drawn over it, as where their
 * shapes' centres are drawn on the stage.
 */
function shading(g: Graphics): { shade: Point; lit: Point }[] {
  const centres = g.context.instructions
    .flatMap((i) => (i.action === 'fill' ? [i.data] : []))
    .map((data) => {
      const { shape, transform } = data.path.shapePath.shapePrimitives[0]!
      const box = shape.getBounds()
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      return g.toGlobal(transform ? transform.apply(centre) : centre)
    })
  const pairs: { shade: Point; lit: Point }[] = []
  for (let i = 0; i + 1 < centres.length; i += 2) {
    pairs.push({ shade: centres[i]!, lit: centres[i + 1]! })
  }
  return pairs
}

interface Point {
  readonly x: number
  readonly y: number
}

/** `look` drawn to face `facing`, turned as the street turns it. */
function turned(look: Look, facing: 1 | -1): Container {
  const drawn = drawCustomer(look, STYLE, LOOKS, facing)
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

/** A hand: its centre under the root, half its size and the part it is in. */
interface Hand {
  readonly x: number
  readonly y: number
  readonly r: number
  readonly part: Graphics
}

/**
 * The hands of the person whose skin is `skin`, anywhere under `root`: every
 * shape filled with their skin outside their head.
 */
function hands(root: Container, skin: string): Hand[] {
  const found: Hand[] = []
  const visit = (node: Container) => {
    if (node instanceof Graphics && node.label !== 'head') {
      for (const { action, data } of node.context.instructions) {
        if (action !== 'fill' || data.style.color !== hex(skin)) continue
        for (const { shape, transform } of data.path.shapePath
          .shapePrimitives) {
          const box = shape.getBounds()
          const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          const local = transform ? transform.apply(centre) : centre
          const { x, y } = node.toGlobal(local)
          const r = Math.max(box.width, box.height) / 2
          found.push({ x, y, r, part: node })
        }
      }
    }
    for (const child of node.children) visit(child)
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
 * part drawn after its own fills or outlines, the parts labelled `worn`
 * aside.
 */
function shown(
  root: Container,
  hand: Hand,
  worn: readonly string[] = [],
): number {
  const order = drawOrder(root)
  const above = order
    .slice(order.indexOf(hand.part) + 1)
    .filter(
      (node): node is Graphics =>
        node instanceof Graphics && !worn.includes(node.label),
    )
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

describe('pickLook', () => {
  it('draws skin, clothes and height from the settings for every segment', () => {
    const random = seeded(5)
    for (let i = 0; i < 200; i += 1) {
      const segment = SEGMENTS[i % 3]!
      const look = pickLook(segment, 'semaine', LOOKS, random)
      expect(look.segment).toBe(segment)
      expect(LOOKS.skinTones).toContain(look.skin)
      expect(LOOKS.clothes).toContain(look.clothes)
      expect(look.height).toBeGreaterThanOrEqual(LOOKS.height.min)
      expect(look.height).toBeLessThanOrEqual(LOOKS.height.max)
    }
  })

  it('varies skin tones and heights within each segment', () => {
    const random = seeded(9)
    for (const segment of SEGMENTS) {
      const looks = Array.from({ length: 60 }, () =>
        pickLook(segment, 'semaine', LOOKS, random),
      )
      expect(new Set(looks.map((l) => l.skin)).size).toBeGreaterThan(3)
      expect(new Set(looks.map((l) => l.height)).size).toBeGreaterThan(30)
    }
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
    }
    expect(cues).toEqual(new Set(['lanyard', 'laptopBag']))
  })

  it('dresses everyone in the warm palette, never in purple', () => {
    const worn = [
      ...LOOKS.clothes,
      LOOKS.coat,
      LOOKS.tote,
      LOOKS.laptopBag,
      LOOKS.trousers,
      CROWD.avatar.hair,
    ]
    for (const colour of worn) {
      const { hue, saturation } = hueOf(colour)
      const purple = hue >= 250 && hue <= 330 && saturation > 0.08
      expect(purple, colour).toBe(false)
    }
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

describe('drawCustomer', () => {
  it('draws a torso, a head and legs, each outlined', () => {
    const drawn = drawCustomer(LOOK, STYLE, LOOKS)
    for (const part of ['torso', 'head', 'legs', 'arms']) {
      expect(colours(find(drawn, part), 'stroke')).toContain(
        hex(STYLE.palette.ink),
      )
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

  it('keeps the same body for every segment', () => {
    const body = (segment: SegmentId) => {
      const drawn = drawCustomer({ ...LOOK, segment }, STYLE, LOOKS)
      return ['torso', 'head', 'legs'].map((part) =>
        colours(find(drawn, part), 'fill'),
      )
    }
    expect(body('aubaine')).toEqual(body('habitue'))
    expect(body('chic')).toEqual(body('habitue'))
  })

  it('changes only the skin when the skin tone changes', () => {
    const [light, dark] = [LOOKS.skinTones[0]!, LOOKS.skinTones[5]!]
    const swap = new Map([
      [hex(light), hex(dark)],
      [hex(shade(light)), hex(shade(dark))],
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

  it('fills each part in its colour in shade, then lit, both outlined', () => {
    const drawn = drawCustomer(LOOK, STYLE, LOOKS)
    expect(colours(find(drawn, 'torso'), 'fill')).toEqual([
      hex(shade(LOOK.clothes)),
      hex(LOOK.clothes),
    ])
    expect(colours(find(drawn, 'head'), 'fill')).toEqual([
      hex(shade(LOOK.skin)),
      hex(LOOK.skin),
    ])
    // Slate, never black.
    expect(shade(LOOK.clothes)).toBe(tonesOf(LOOK.clothes, ASSETS.light).shade)
    expect(colours(find(drawn, 'head'), 'stroke')).toEqual([
      hex(STYLE.palette.ink),
    ])
  })

  const FAMILY: Look = {
    ...LOOK,
    office: 'laptopBag',
    child: {
      skin: LOOKS.skinTones[3]!,
      clothes: LOOKS.clothes[2]!,
      height: 90,
    },
  }

  it.each([1, -1] as const)(
    'lights every part on the left of the screen, facing %i',
    (facing) => {
      for (const segment of SEGMENTS) {
        const drawn = turned({ ...FAMILY, segment }, facing)
        const parts = ['torso', 'head', 'legs', 'arms', 'laptopBag']
        if (segment === 'chic') parts.push('coat')
        if (segment === 'habitue') parts.push('forearm')
        for (const part of parts) {
          const pairs = shading(find(drawn, part) as Graphics)
          expect(pairs.length, `${segment} ${part}`).toBeGreaterThan(0)
          for (const { shade, lit } of pairs) {
            expect(lit.x, `${segment} ${part}`).toBeLessThan(shade.x)
          }
        }
        const child = find(drawn, 'child')
        for (const part of ['torso', 'head', 'legs']) {
          for (const { shade, lit } of shading(find(child, part) as Graphics)) {
            expect(lit.x, `child ${part}`).toBeLessThan(shade.x)
          }
        }
      }
    },
  )

  it('stands the child on the side the customer faces away from', () => {
    for (const facing of [1, -1] as const) {
      const drawn = turned(FAMILY, facing)
      const child = find(drawn, 'child').getGlobalPosition()
      expect(Math.sign(child.x)).toBe(-facing)
      expect(Math.abs(child.x)).toBeCloseTo(FAMILY.height * CHILD_OFFSET)
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

  it('draws a child with their own body and skin beside the adult', () => {
    const childSkin = LOOKS.skinTones[3]!
    const drawn = drawCustomer(
      {
        ...LOOK,
        child: { skin: childSkin, clothes: LOOKS.clothes[2]!, height: 90 },
      },
      STYLE,
      LOOKS,
    )
    const child = find(drawn, 'child')
    expect(child.x).toBeLessThan(0)
    expect(colours(find(child, 'head'), 'fill')).toEqual([
      hex(shade(childSkin)),
      hex(childSkin),
    ])
    expect(labels(child)).not.toContain('mug')
    expect(labels(drawCustomer(LOOK, STYLE, LOOKS))).not.toContain('child')
  })

  const CHILD: ChildLook = {
    skin: LOOKS.skinTones[3]!,
    clothes: LOOKS.clothes[2]!,
    height: 90,
  }
  const FAN = LOOKS.clothes[4]!
  const PEOPLE = SEGMENTS.flatMap((segment) =>
    ([null, 'lanyard', 'laptopBag'] as const).flatMap((office) =>
      [null, CHILD].flatMap((child) =>
        [null, FAN].map((fan) => ({
          name: [segment, office, child && 'child', fan && 'fan']
            .filter(Boolean)
            .join(', '),
          look: { ...LOOK, segment, office, child, fan },
        })),
      ),
    ),
  )

  it.each(PEOPLE)('draws exactly two hands per person: $name', ({ look }) => {
    for (const facing of [1, -1] as const) {
      const drawn = turned(look, facing)
      expect(hands(drawn, look.skin)).toHaveLength(2)
      if (look.child !== null) {
        expect(hands(drawn, look.child.skin)).toHaveLength(2)
      }
    }
  })

  it.each(PEOPLE)(
    'keeps most of each hand in sight of what they carry: $name',
    ({ look }) => {
      for (const facing of [1, -1] as const) {
        const drawn = turned(look, facing)
        const skins = [look.skin, ...(look.child ? [look.child.skin] : [])]
        for (const hand of skins.flatMap((skin) => hands(drawn, skin))) {
          // A coat is worn over the arms, not carried.
          expect(
            shown(drawn, hand, ['coat']),
            `facing ${facing}, hand at ${hand.x.toFixed(0)}`,
          ).toBeGreaterThan(0.5)
        }
      }
    },
  )

  /** The hands of `look` that hold what is labelled `item`. */
  function holdingHands(drawn: Container, look: Look, item: string): Hand[] {
    const { minX, maxX, minY, maxY } = find(drawn, item).getBounds()
    return hands(drawn, look.skin).filter(
      ({ x, y, r }) =>
        x >= minX - r && x <= maxX + r && y >= minY - r && y <= maxY + r,
    )
  }

  it('holds the mug in one of their own hands', () => {
    const drawn = drawCustomer(LOOK, STYLE, LOOKS)
    expect(holdingHands(drawn, LOOK, 'mug')).toHaveLength(1)
  })

  it('holds a fan in the hand on the right, and a mug still in the left', () => {
    const look = { ...LOOK, fan: FAN }
    const drawn = drawCustomer(look, STYLE, LOOKS)
    const fan = holdingHands(drawn, look, 'fan')
    const mug = holdingHands(drawn, look, 'mug')
    expect(fan).toHaveLength(1)
    expect(mug).toHaveLength(1)
    expect(fan[0]!.x).toBeGreaterThan(0)
    expect(mug[0]!.x).toBeLessThan(0)
    // Its leaves open above the hand, in its colour, outlined like the mug.
    expect(find(drawn, 'fan').getBounds().maxY).toBeLessThanOrEqual(
      fan[0]!.y + fan[0]!.r,
    )
    expect(colours(find(drawn, 'fan'), 'fill')).toContain(hex(FAN))
    expect(colours(find(drawn, 'fan'), 'stroke')).toContain(
      hex(STYLE.palette.ink),
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
  it('wears a blue shirt and a cream apron, lit on the left', () => {
    const { root } = avatar()
    expect(colours(find(root, 'shirt'), 'fill')).toEqual([
      hex(shade(STYLE.palette.playerBlue)),
      hex(STYLE.palette.playerBlue),
    ])
    expect(colours(find(root, 'apron'), 'fill')).toContain(
      hex(STYLE.palette.cream),
    )
    expect(colours(find(root, 'head'), 'fill')).toEqual([
      hex(shade(CROWD.avatar.skin)),
      hex(CROWD.avatar.skin),
    ])
    for (const part of ['shirt', 'head', 'legs', 'otherArm']) {
      for (const { shade, lit } of shading(find(root, part) as Graphics)) {
        expect(lit.x, part).toBeLessThan(shade.x)
      }
    }
  })

  it('has an arm that turns at the shoulder, hanging down at rest', () => {
    const { upper, arm } = avatar('homme')
    expect(arm.parent).toBe(upper)
    expect(arm.rotation).toBe(0)
    expect(arm.x).toBeLessThan(0)
  })

  it.each(['femme', 'homme'] as const)(
    'has two hands, one at the end of each sleeve: %s',
    (kind) => {
      const { root, arm } = avatar(kind)
      const found = hands(root, CROWD.avatar.skin)
      expect(found).toHaveLength(2)
      const reaching = (hand: Hand) => drawOrder(arm).includes(hand.part)
      expect(found.filter(reaching)).toHaveLength(1)
      // The other hand ends the sleeve that hangs on the screen's right.
      const other = found.find((hand) => !reaching(hand))!
      const sleeve = find(root, 'otherArm') as Graphics
      const steps = 4
      let touching = false
      for (let i = -steps; i <= steps; i += 1) {
        for (let j = -steps; j <= steps; j += 1) {
          if (i * i + j * j > steps * steps) continue
          const point = {
            x: other.x + (other.r * i) / steps,
            y: other.y + (other.r * j) / steps,
          }
          touching ||= sleeve.containsPoint(sleeve.toLocal(point))
        }
      }
      expect(touching).toBe(true)
    },
  )

  it('wears the hair of the avatar the player picked', () => {
    const femme = avatar('femme').root
    const homme = avatar('homme').root
    expect(femme.label).toBe('avatar:femme')
    expect(homme.label).toBe('avatar:homme')
    expect(colours(find(femme, 'hair'), 'fill')).toEqual([
      hex(shade(CROWD.avatar.hair)),
      hex(CROWD.avatar.hair),
    ])
    expect(colours(find(homme, 'hair'), 'fill')).toEqual([])
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
    expect(face.pivot.y).toBeCloseTo(head.maxY - STYLE.outline / 2, 0)
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

  it('draws a puddle and a drop in its colour where the settings put it', () => {
    const spill = drawSpill(SPILL, STYLE)
    expect(spill.label).toBe('spill')
    expect(spill.position).toMatchObject({ x: SPILL.x, y: SPILL.y })
    expect(new Set(colours(spill, 'fill'))).toEqual(new Set([hex(SPILL.color)]))
  })

  it('is as wide as the settings say, with the drop running down', () => {
    const { minX, maxX, minY, maxY } = drawSpill(SPILL, STYLE).getLocalBounds()
    expect(maxX - minX).toBeCloseTo(SPILL.width + STYLE.outline * 0.6, 0)
    expect(maxY).toBeGreaterThan(-minY * 2)
  })
})
