import { Container, Graphics } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import type { SegmentId } from '../content/schema.ts'
import { next, seedRng } from '../engine/rng.ts'
import { CROWD } from './crowdSettings.ts'
import { ASSETS } from './manifest.ts'
import { MOOD_COLORS } from './customerCard.ts'
import {
  drawAvatar,
  drawBubble,
  drawCustomer,
  drawPickMark,
  pickLook,
  SEGMENT_ACCESSORY,
  type Look,
} from './people.ts'
import type { PlaceholderStyle } from './placeholders.ts'

const STYLE: PlaceholderStyle = {
  palette: ASSETS.palette,
  outline: ASSETS.outlineWidth,
}
const LOOKS = CROWD.looks
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
    for (const segment of SEGMENTS) {
      const a = fills(
        drawCustomer({ ...LOOK, segment, skin: light }, STYLE, LOOKS),
      )
      const b = fills(
        drawCustomer({ ...LOOK, segment, skin: dark }, STYLE, LOOKS),
      )
      expect(a).toContain(hex(light))
      expect(a.map((c) => (c === hex(light) ? hex(dark) : c))).toEqual(b)
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
    expect(colours(find(child, 'head'), 'fill')).toEqual([hex(childSkin)])
    expect(labels(child)).not.toContain('mug')
    expect(labels(drawCustomer(LOOK, STYLE, LOOKS))).not.toContain('child')
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
  it('wears a blue shirt and a cream apron', () => {
    const { root } = drawAvatar('femme', STYLE, CROWD.avatar, LOOKS.trousers)
    expect(colours(find(root, 'shirt'), 'fill')).toEqual([
      hex(STYLE.palette.playerBlue),
    ])
    expect(colours(find(root, 'apron'), 'fill')).toContain(
      hex(STYLE.palette.cream),
    )
    expect(colours(find(root, 'head'), 'fill')).toEqual([
      hex(CROWD.avatar.skin),
    ])
  })

  it('has an arm that turns at the shoulder, hanging down at rest', () => {
    const { root, arm } = drawAvatar(
      'homme',
      STYLE,
      CROWD.avatar,
      LOOKS.trousers,
    )
    expect(arm.parent).toBe(root)
    expect(arm.rotation).toBe(0)
    expect(arm.x).toBeLessThan(0)
  })

  it('wears the hair of the avatar the player picked', () => {
    const femme = drawAvatar('femme', STYLE, CROWD.avatar, LOOKS.trousers).root
    const homme = drawAvatar('homme', STYLE, CROWD.avatar, LOOKS.trousers).root
    expect(femme.label).toBe('avatar:femme')
    expect(homme.label).toBe('avatar:homme')
    expect(colours(find(femme, 'hair'), 'fill')).toEqual([
      hex(CROWD.avatar.hair),
    ])
    expect(colours(find(homme, 'hair'), 'fill')).toEqual([])
  })
})
