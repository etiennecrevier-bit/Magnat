import { Container, Graphics, type StrokeStyle, type Texture } from 'pixi.js'
import type { Light } from '../content/assets.ts'
import type { AvatarFatigue } from '../content/avatarFatigue.ts'
import type { Avatar, DayTypeId, SegmentId } from '../content/schema.ts'
import type { CrowdSettings, FigureLight, Range } from './crowdSettings.ts'
import { mix, tonesOf } from './light.ts'
import { textureOf } from './materials.ts'
import { radialPixels, sideRampPixels } from './noise.ts'
import type { DrawStyle } from './placeholders.ts'
import type { Mood } from './replay.ts'

// The people, as `person()` draws them in the design reference's `rue.py`
// (#197), standing with their feet at 0, 0: no dark outlines, lit by the
// sun from the upper left (see light.ts). The parts toward the sun, on the
// screen's left, take their own colour or a little sun; the far arm, hand
// and leg take slate, and the torso and the head a gradient from sun to
// slate across them. A customer's segment shows only through what they
// carry or wear, never through their skin or their body; skin tones,
// clothes, hair and heights vary across everyone at random. Where the
// parts sit inside a person is the reference's geometry, kept here with
// the drawing: one person is 116 tall there, so every length is a share of
// that, and the owner's 130.

/** What the office cues of a weekday add to a customer. */
export type OfficeCue = 'lanyard' | 'laptopBag'

/** What covers the top of someone's head. */
export type Headwear = 'cap' | 'hair'

/** A child who comes with a customer on a weekend: one visit for both. */
export interface ChildLook {
  readonly skin: string
  readonly clothes: string
  readonly height: number
  /** The colour of their hair, or of their cap. */
  readonly hair: string
  readonly headwear: Headwear
}

/** How one customer looks. */
export interface Look {
  readonly segment: SegmentId
  readonly skin: string
  readonly clothes: string
  /** From their feet to the top of their head. */
  readonly height: number
  /** The colour of their hair, or of their cap. */
  readonly hair: string
  readonly headwear: Headwear
  readonly office: OfficeCue | null
  readonly child: ChildLook | null
  /** The colour of the fan they fan themselves with; null without one. */
  readonly fan: string | null
  /** A tourist's hat and what they carry (#264); none for the others. */
  readonly tourist?: TouristLook | null
  /** What someone wears bundled up in winter (#264); none in summer. */
  readonly bundled?: BundledLook | null
}

/** A tourist's sun hat, if any, and their camera or map, if any. */
export interface TouristLook {
  /** The colour of their hat; null without one. */
  readonly hat: string | null
  readonly carries: 'camera' | 'map' | null
}

/** Someone bundled up: a tuque with its pompom, a scarf, a coat's hem. */
export interface BundledLook {
  /** The colour of their tuque. */
  readonly tuque: string
}

/** The fans customers may carry: the chance of each, and their colour. */
export interface FanPick {
  readonly chance: number
  readonly color: string
}

/** The accessory that shows each segment. */
export const SEGMENT_ACCESSORY: Readonly<Record<SegmentId, string>> = {
  aubaine: 'bag',
  habitue: 'newspaper',
  chic: 'coat',
  // Their hat, camera or map (#264).
  touriste: 'tourist',
}

/** A side of a drawing, before it is turned. */
export type Side = 'left' | 'right'

/** Which way a customer faces: 1 to the right, -1 to the left. */
export type Facing = 1 | -1

/** How far a child stands from the adult they come with, left of their feet. */
export const CHILD_OFFSET = 0.32

/**
 * The gradients of the light on people, made once when the street starts
 * and shared by everyone: stretched over a shape, each lights it from the
 * sun's side.
 */
export interface PeopleShading {
  readonly figure: FigureLight
  /** Across a torso or a coat, from the `sun` side to the other. */
  side: (sun: Side) => Texture
  /** Over a head, its light toward the `sun` side's top. */
  round: (sun: Side) => Texture
  /** Frees them, when the street stops. */
  destroy: () => void
}

/** What people are drawn with: the style and the light's gradients. */
export interface PeopleStyle extends DrawStyle {
  readonly shading: PeopleShading
}

/** Makes the gradients of `figure` in the tones of `light`. */
export function createPeopleShading(
  light: Light,
  figure: FigureLight,
): PeopleShading {
  const toned = (stops: FigureLight['side']) =>
    stops.map(({ offset, tone, alpha }) => ({
      offset,
      alpha,
      color: light[tone],
    }))
  const side = toned(figure.side)
  const round = toned(figure.round.stops)
  const { centre, radius } = figure.round
  const textures = {
    side: {
      left: textureOf(sideRampPixels(side, false), 'people:side:left'),
      right: textureOf(sideRampPixels(side, true), 'people:side:right'),
    },
    round: {
      left: textureOf(radialPixels(round, centre, radius), 'people:round:left'),
      right: textureOf(
        radialPixels(round, { x: 1 - centre.x, y: centre.y }, radius),
        'people:round:right',
      ),
    },
  }
  return {
    figure,
    side: (sun) => textures.side[sun],
    round: (sun) => textures.round[sun],
    destroy: () => {
      for (const kind of Object.values(textures)) {
        kind.left.destroy(true)
        kind.right.destroy(true)
      }
    },
  }
}

/**
 * Picks how a customer of `segment` looks, from `looks`. On a weekday some
 * carry an office cue; on a weekend some come with a child. With `fans`,
 * as in a heat wave, some fan themselves: that takes one more draw, last,
 * so without it the draws are the same. A tourist then draws their hat and
 * what they carry (#264), and in `winter` everyone their tuque, so the
 * others' draws in summer are the same too.
 */
export function pickLook(
  segment: SegmentId,
  dayType: DayTypeId,
  looks: CrowdSettings['looks'],
  random: () => number,
  fans: FanPick | null = null,
  winter = false,
): Look {
  const skin = pick(looks.skinTones, random)
  const clothes = pick(looks.clothes, random)
  const height = within(looks.height, random)
  const { hair, headwear } = pickHair(looks.hair, random)
  let office: OfficeCue | null = null
  let child: ChildLook | null = null
  if (dayType === 'semaine' && random() < looks.officeChance) {
    office = random() < 0.5 ? 'lanyard' : 'laptopBag'
  }
  if (dayType === 'finDeSemaine' && random() < looks.familyChance) {
    child = {
      skin: pick(looks.skinTones, random),
      clothes: pick(looks.clothes, random),
      height: within(looks.childHeight, random),
      ...pickHair(looks.hair, random),
    }
  }
  const fan =
    fans !== null && fans.chance > 0 && random() < fans.chance
      ? fans.color
      : null
  const tourist =
    segment === 'touriste' ? pickTourist(looks.tourist, random) : null
  const bundled = winter ? { tuque: pick(looks.winter.tuques, random) } : null
  return {
    segment,
    skin,
    clothes,
    height,
    hair,
    headwear,
    office,
    child,
    fan,
    tourist,
    bundled,
  }
}

/**
 * Picks a tourist's hat, with its chance, and their camera or map: one
 * without a hat carries one of the two, so every tourist shows.
 */
function pickTourist(
  tourist: CrowdSettings['looks']['tourist'],
  random: () => number,
): TouristLook {
  const hat = random() < tourist.hatChance ? pick(tourist.hats, random) : null
  const draw = random()
  const carries =
    draw < tourist.cameraChance
      ? 'camera'
      : draw < tourist.cameraChance + tourist.mapChance || hat === null
        ? 'map'
        : null
  return { hat, carries }
}

/** Picks a hair colour, and whether a cap of it covers the head. */
function pickHair(
  hair: CrowdSettings['looks']['hair'],
  random: () => number,
): { hair: string; headwear: Headwear } {
  const colour = pick(hair.colors, random)
  return {
    hair: colour,
    headwear: random() < hair.capChance ? 'cap' : 'hair',
  }
}

/** How tall the reference draws a person. */
const REFERENCE = 116

/** One person to draw: their colours, and what covers their head. */
interface Person {
  readonly height: number
  readonly skin: string
  readonly clothes: string
  /** The colour of their arms: their clothes', or a coat's. */
  readonly sleeves: string
  readonly trousers: string
  readonly hair: string
  readonly headwear: Headwear
}

/** What a customer carries, in the order it is drawn among their parts. */
interface Carried {
  /** Behind the arms and the torso, over the legs. */
  readonly behind: readonly Container[]
  /** Over the torso, under the arms in front of it. */
  readonly over: readonly Container[]
  /** What each hand holds, around its centre, on that side's bent arm. */
  readonly held: Partial<Record<Side, (outward: number) => Container>>
  /** Over everything, the head too: a hat, a scarf, a camera, a map. */
  readonly top?: readonly Container[]
}

const NOTHING: Carried = { behind: [], over: [], held: {} }

/**
 * Draws a customer as `look` describes, with their accessory, office cue,
 * fan and child labelled by name. A child stands to the left of the adult.
 * With `cup`, once served a drink, they hold its cup in the hand on the
 * left; a fan is held in the hand on the right. With `flyer`, one whom
 * marketing brought (#284) holds its flyer in that hand, in the fan's
 * place; it draws nothing at random, so the look stays the same.
 * The drawing is for a customer turned to `facing` by mirroring it (its
 * container's `scale.x`): either way, it is lit on the side that shows on
 * the screen's left, while what they carry keeps its side.
 */
export function drawCustomer(
  look: Look,
  style: PeopleStyle,
  looks: CrowdSettings['looks'],
  facing: Facing = 1,
  cup = false,
  flyer = false,
): Container {
  const h = look.height
  const u = h / REFERENCE
  const root = new Container({ label: 'customer' })
  const sun: Side = facing === 1 ? 'left' : 'right'
  const { light, palette } = style

  if (look.child !== null) {
    const child = root.addChild(
      new Container({ label: 'child', x: -h * CHILD_OFFSET }),
    )
    drawPerson(
      child,
      { ...look.child, sleeves: look.child.clothes, trousers: looks.trousers },
      style,
      sun,
      NOTHING,
    )
  }

  const behind: Container[] = []
  const over: Container[] = []
  const held: Partial<Record<Side, (outward: number) => Container>> = {}
  if (look.office === 'laptopBag') {
    behind.push(
      twoTone(
        new Graphics({ label: 'laptopBag' }),
        [-42 * u, -58 * u, 26 * u, 21 * u, 3 * u],
        looks.laptopBag,
        light,
        sun,
      ),
    )
  }
  // A bargain hunter's tote hangs from their shoulder behind the arm, so
  // the hand on its side shows. Its straps are in its shade.
  if (look.segment === 'aubaine') {
    const tote = tonesOf(looks.tote, light)
    behind.push(
      new Graphics({ label: SEGMENT_ACCESSORY[look.segment] })
        .moveTo(21 * u, -58 * u)
        .lineTo(14 * u, -79 * u)
        .moveTo(36 * u, -58 * u)
        .lineTo(16 * u, -79 * u)
        .stroke({ width: 2 * u, color: tote.shade, cap: 'round' })
        .poly(TOTE.map((at) => at * u))
        .fill(tote.lit)
        .poly(toteShade(sun).map((at) => at * u))
        .fill(tote.shade),
    )
  }
  // A regular's folded newspaper, La Presse-Citron, is tucked under the arm
  // on the left, behind it, so the hand on its side shows.
  if (look.segment === 'habitue') {
    const paper = tonesOf(palette.cream, light)
    const scaled = (points: readonly number[]) => points.map((at) => at * u)
    const g = new Graphics({ label: 'newspaper' })
      .poly(scaled(NEWSPAPER.sheet))
      .fill(paper.lit)
      .poly(scaled(NEWSPAPER.masthead))
      .fill(palette.mustard)
    for (const [x0, y0, x1, y1] of NEWSPAPER.lines) {
      g.moveTo(x0 * u, y0 * u).lineTo(x1 * u, y1 * u)
    }
    behind.push(g.stroke({ width: 1.2 * u, color: paper.shade }))
  }
  // A chic customer's long coat, open on their shirt: it hangs behind the
  // arms, so both hands show, and its fronts lie over the torso.
  if (look.segment === 'chic') {
    const coat = tonesOf(looks.coat, light)
    behind.push(
      new Graphics({ label: 'coat' })
        .roundRect(-20 * u, -83 * u, 40 * u, 66 * u, 14 * u)
        .fill(coat.lit)
        .roundRect(-20 * u, -83 * u, 40 * u, 66 * u, 14 * u)
        .fill({ texture: style.shading.side(sun), textureSpace: 'local' })
        .rect(-0.6 * u, -30 * u, 1.2 * u, 13 * u)
        .fill(coat.shade),
    )
    // The front toward the sun (1) or away from it (-1), from the
    // reference's, which has the sun on the left.
    const front = (sign: number) =>
      LAPEL.map((at, i) => at * u * (i % 2 === 0 ? sign * -sideSign(sun) : 1))
    over.push(
      new Graphics({ label: 'lapels' })
        .poly(front(1))
        .fill(coat.lit)
        .poly(front(-1))
        .fill(coat.shade),
    )
  }
  if (look.office === 'laptopBag') {
    over.push(
      new Graphics({ label: 'laptopStrap' })
        .moveTo(14 * u, -80 * u)
        .lineTo(-23 * u, -58 * u)
        .stroke({
          width: 2.5 * u,
          color: tonesOf(looks.laptopBag, light).shade,
          cap: 'round',
        }),
    )
  }
  if (look.office === 'lanyard') {
    over.push(
      new Graphics({ label: 'lanyard' })
        .moveTo(-8 * u, -82 * u)
        .lineTo(0, -70 * u)
        .lineTo(8 * u, -82 * u)
        .stroke({ width: 1.5 * u, color: palette.dangerRed, cap: 'round' })
        .rect(-4.6 * u, -71 * u, 9.2 * u, 11.6 * u)
        .fill(palette.cream),
    )
  }
  if (cup) {
    const { color, band } = style.shading.figure.cup
    held.left = (outward) => {
      const left = outward < 0 ? -9 * u : -4 * u
      return new Graphics({ label: 'cup' })
        .roundRect(left, -12 * u, 13 * u, 16 * u, 3 * u)
        .fill(color)
        .rect(left, -8 * u, 13 * u, 4 * u)
        .fill(band)
    }
  }
  if (flyer) {
    held.right = () => drawFlyer(h, style)
  } else if (look.fan !== null) {
    const fan = look.fan
    held.right = () => drawFan(h, fan, light)
  }
  // As the reference's `bundled()` and `tourist()` draw them, over the
  // person: what they wear in winter, then a tourist's hat, camera or map.
  const top: Container[] = []
  const bundled = look.bundled ?? null
  if (bundled !== null) top.push(drawBundled(u, bundled, look.clothes, looks))
  if (look.segment === 'touriste') {
    top.push(drawTourist(u, look.tourist ?? DEFAULT_TOURIST, looks))
  }
  drawPerson(
    root,
    {
      height: h,
      skin: look.skin,
      clothes: look.clothes,
      sleeves: look.segment === 'chic' ? looks.coat : look.clothes,
      trousers: looks.trousers,
      // A tuque covers the head as a cap does, in its colour.
      hair: bundled?.tuque ?? look.hair,
      headwear: bundled === null ? look.headwear : 'cap',
    },
    style,
    sun,
    { behind, over, held, top },
  )
  return root
}

/** What a tourist drawn without one shows: the reference's first. */
const DEFAULT_TOURIST: TouristLook = { hat: null, carries: 'camera' }

/**
 * A tourist's sun hat with its red band, their camera on its strap or the
 * map in their hand, as `tourist()` draws them in the reference's
 * `vieux.py` (#264), at `u` of its lengths, feet at 0, 0.
 */
function drawTourist(
  u: number,
  tourist: TouristLook,
  looks: CrowdSettings['looks'],
): Container {
  const kit = looks.tourist
  const g = new Graphics({ label: SEGMENT_ACCESSORY.touriste })
  if (tourist.hat !== null) {
    g.ellipse(0, -110 * u, 26 * u, 6 * u)
      .fill(tourist.hat)
      .roundRect(-14 * u, -124 * u, 28 * u, 14 * u, 6 * u)
      .fill(tourist.hat)
      .rect(-14 * u, -114 * u, 28 * u, 3 * u)
      .fill(kit.band)
  }
  if (tourist.carries === 'camera') {
    g.moveTo(-12 * u, -82 * u)
      .lineTo(-2 * u, -60 * u)
      .lineTo(12 * u, -82 * u)
      .stroke({ width: 1.6 * u, color: kit.camera })
      .roundRect(-10 * u, -64 * u, 18 * u, 12 * u, 2 * u)
      .fill(kit.camera)
      .circle(-1 * u, -58 * u, 3.4 * u)
      .fill(kit.lens)
  }
  if (tourist.carries === 'map') {
    g.poly([-34, -70, -8, -74, -8, -50, -34, -46].map((at) => at * u))
      .fill(kit.map)
      .moveTo(-25 * u, -71 * u)
      .lineTo(-25 * u, -47 * u)
      .moveTo(-16 * u, -73 * u)
      .lineTo(-16 * u, -49 * u)
      .stroke({ width: 1.4 * u, color: kit.mapFold })
  }
  return g
}

/**
 * Someone bundled up, as `bundled()` draws them in the reference's
 * `vieux.py` (#264), at `u` of its lengths, feet at 0, 0: a tuque with a
 * cream pompom over their cap, a scarf and the hem of their coat, which is
 * their `coat` colour.
 */
function drawBundled(
  u: number,
  bundled: BundledLook,
  coat: string,
  looks: CrowdSettings['looks'],
): Container {
  const { pompom, scarf } = looks.winter
  return new Graphics({ label: 'bundled' })
    .moveTo(-16 * u, -106 * u)
    .quadraticCurveTo(0, -134 * u, 16 * u, -106 * u)
    .closePath()
    .fill(bundled.tuque)
    .circle(0, -130 * u, 5 * u)
    .fill(pompom)
    .roundRect(-16 * u, -88 * u, 32 * u, 9 * u, 4 * u)
    .fill(scarf)
    .roundRect(-20 * u, -40 * u, 40 * u, 14 * u, 6 * u)
    .fill(coat)
}

/** -1 where the sun is on the drawing's left, 1 where it is on its right. */
function sideSign(sun: Side): number {
  return sun === 'left' ? -1 : 1
}

/**
 * The coat's front on the sun's side when it is on the left, in the
 * reference's lengths: inside the torso's edge, leaving the shirt showing
 * down the middle. The other front mirrors it, in the coat's shade.
 */
const LAPEL = [
  -18, -70, -16, -78, -12, -82, -7, -82, -5, -30, -10, -30, -15, -34, -18, -42,
]

/**
 * Draws a person in `parent`, feet at 0, 0, as the reference's `person()`
 * does, lit from the `sun` side: the legs, what is carried behind, the far
 * arm and hand in shade, the torso, what lies over it, the near arm and
 * hand, then the head with its hair or cap. An arm whose hand holds
 * something bends in front of the torso, the item in its hand. Each hand
 * is a part of its own, labelled `hand`.
 */
function drawPerson(
  parent: Container,
  person: Person,
  style: PeopleStyle,
  sun: Side,
  carried: Carried,
): void {
  const u = person.height / REFERENCE
  const { light, shading } = style
  const { shade, lit } = shading.figure
  const near = sideSign(sun)
  const far = -near
  // The reference's x, drawn with the sun on the left, on this drawing.
  const x = (at: number) => at * -near
  /** A box from `left` to `left + w` in the reference's x, on this drawing. */
  const box = (left: number, w: number) =>
    near === -1 ? left * u : -(left + w) * u
  const sideOf = (sign: number): Side => (sign < 0 ? 'left' : 'right')

  parent.addChild(
    new Graphics({ label: 'legs' })
      .roundRect(box(-12, 10), -36 * u, 10 * u, 36 * u, 3 * u)
      .fill(person.trousers)
      .roundRect(box(2, 10), -36 * u, 10 * u, 36 * u, 3 * u)
      .fill(mix(person.trousers, light.slate, shade.leg)),
  )
  for (const item of carried.behind) parent.addChild(item)

  const farTone = {
    arm: mix(person.sleeves, light.slate, shade.arm),
    hand: mix(person.skin, light.slate, shade.hand),
  }
  const farHeld = carried.held[sideOf(far)]
  if (farHeld === undefined) {
    parent.addChild(
      new Graphics({ label: 'farArm' })
        .roundRect(box(13, 9), -78 * u, 9 * u, 36 * u, 4.5 * u)
        .fill(farTone.arm),
      hand(x(17.5) * u, -40 * u, 5 * u, farTone.hand),
    )
  }
  parent.addChild(
    new Graphics({ label: 'torso' })
      .roundRect(-18 * u, -82 * u, 36 * u, 52 * u, 14 * u)
      .fill(person.clothes)
      .roundRect(-18 * u, -82 * u, 36 * u, 52 * u, 14 * u)
      .fill({ texture: shading.side(sun), textureSpace: 'local' }),
  )
  for (const item of carried.over) parent.addChild(item)
  if (farHeld !== undefined) {
    bend(parent, u, far, 'farArm', farTone.arm, farTone.hand, farHeld(far))
  }
  const nearHeld = carried.held[sideOf(near)]
  if (nearHeld === undefined) {
    parent.addChild(
      new Graphics({ label: 'nearArm' })
        .roundRect(box(-21, 9), -78 * u, 9 * u, 36 * u, 4.5 * u)
        .fill(mix(person.sleeves, light.sun, lit.arm)),
      hand(x(-16.5) * u, -40 * u, 5 * u, person.skin),
    )
  } else {
    bend(
      parent,
      u,
      near,
      'nearArm',
      mix(person.sleeves, light.sun, lit.bentArm),
      person.skin,
      nearHeld(near),
    )
  }

  parent.addChild(
    new Graphics({ label: 'head' })
      .circle(0, -100 * u, 16 * u)
      .fill(person.skin)
      .circle(0, -100 * u, 16 * u)
      .fill({ texture: shading.round(sun), textureSpace: 'local' }),
  )
  if (person.headwear === 'cap') {
    parent.addChild(
      new Graphics({ label: 'cap' })
        .roundRect(-16 * u, -116 * u, 32 * u, 8 * u, 4 * u)
        .fill(person.hair)
        .roundRect(box(-16, 14), -116 * u, 14 * u, 3 * u, 1.5 * u)
        .fill(mix(person.hair, light.sun, lit.capEdge)),
    )
  } else {
    parent.addChild(
      new Graphics({ label: 'hair' })
        .ellipse(0, -111 * u, 17 * u, 8.5 * u)
        .fill(person.hair)
        .moveTo(x(-12) * u, -114 * u)
        .quadraticCurveTo(x(-4) * u, -120 * u, x(4) * u, -117 * u)
        .stroke({
          width: 2.5 * u,
          color: mix(person.hair, light.sun, lit.hairEdge),
          cap: 'round',
        }),
    )
  }
  for (const item of carried.top ?? []) parent.addChild(item)
}

/** A hand of `color`, `r` round, centred on `x`, `y`. */
function hand(x: number, y: number, r: number, color: string): Graphics {
  return new Graphics({ label: 'hand' }).circle(x, y, r).fill(color)
}

/**
 * Draws the arm on the side `sign` (-1 the drawing's left, 1 its right)
 * bent in front of the torso, as the reference's holds its cup: from the
 * shoulder out to the elbow and back in to the hand, which holds `item`,
 * drawn around the hand's centre.
 */
function bend(
  parent: Container,
  u: number,
  sign: number,
  label: string,
  sleeve: string,
  skin: string,
  item: Container,
): void {
  const at = { x: 12 * u * sign, y: -50 * u }
  parent.addChild(
    new Graphics({ label })
      .moveTo(14 * u * sign, -74 * u)
      .lineTo(24 * u * sign, -58 * u)
      .lineTo(14 * u * sign, -50 * u)
      .stroke({ width: 9 * u, color: sleeve, cap: 'round', join: 'round' }),
  )
  item.position.set(at.x, at.y)
  parent.addChild(item)
  parent.addChild(hand(at.x, at.y, 5 * u, skin))
}

/**
 * Fills the rounded box `shape` in `g` lit on the `sun` side: in shade,
 * then in `base` but for a strip on the other side.
 */
function twoTone(
  g: Graphics,
  [x, y, w, h, r]: Rounded,
  base: string,
  light: Light,
  sun: Side,
): Graphics {
  const tones = tonesOf(base, light)
  const lit = w * (1 - SHADE_SHARE)
  return g
    .roundRect(x, y, w, h, r)
    .fill(tones.shade)
    .roundRect(
      sun === 'left' ? x : x + w - lit,
      y,
      lit,
      h,
      Math.min(r, lit / 2),
    )
    .fill(tones.lit)
}

/** A rounded box: its left, top, width, height and corner radius. */
type Rounded = readonly [number, number, number, number, number]

/** How much of an accessory's width its shade takes, away from the sun. */
const SHADE_SHARE = 0.32

/**
 * A folding fan held upright, its pivot at 0, 0 in the hand: its leaves
 * spread above, with the pleats and the handle in its shade.
 */
function drawFan(h: number, color: string, light: Light): Graphics {
  const reach = h * FAN.reach
  const inner = reach * 0.3
  const from = -Math.PI / 2 - FAN.spread
  const to = -Math.PI / 2 + FAN.spread
  const shade = tonesOf(color, light).shade
  const fan = new Graphics({ label: 'fan' })
    .moveTo(...along(inner, from))
    .arc(0, 0, reach, from, to)
    .lineTo(...along(inner, to))
    .arc(0, 0, inner, to, from, true)
    .closePath()
    .fill(color)
  const pleats = FAN.pleats
  for (let i = 1; i < pleats; i += 1) {
    const angle = from + ((to - from) * i) / pleats
    fan.moveTo(...along(inner, angle)).lineTo(...along(reach, angle))
  }
  return fan
    .stroke({ width: h * FAN.pleat, color: shade })
    .moveTo(0, 0)
    .lineTo(...along(inner, -Math.PI / 2))
    .stroke({ width: h * FAN.handle, color: shade, cap: 'round' })
}

/**
 * The flyer marketing handed out (#284), held up in the hand, its bottom
 * edge at 0, 0: a cream sheet with a red band across its top and lines of
 * print under it.
 */
function drawFlyer(h: number, style: DrawStyle): Graphics {
  const { palette } = style
  const width = h * FLYER.width
  const height = h * FLYER.height
  const left = -width / 2
  const top = -height
  const sheet = new Graphics({ label: 'flyer' })
    .rect(left, top, width, height)
    .fill(palette.cream)
    .rect(left, top, width, height * FLYER.band)
    .fill(palette.dangerRed)
  for (let line = 0; line < FLYER.lines; line += 1) {
    const y =
      top +
      height *
        (FLYER.band + ((line + 1) * (1 - FLYER.band)) / (FLYER.lines + 1))
    sheet.moveTo(left + width * 0.2, y).lineTo(left + width * 0.8, y)
  }
  return sheet.stroke({ width: h * FLYER.print, color: palette.ink })
}

/**
 * A flyer's size, as shares of the height of who holds it: its sheet, the
 * share of it its band takes, its lines of print and their width.
 */
const FLYER = {
  width: 0.1,
  height: 0.13,
  band: 0.3,
  lines: 3,
  print: 0.006,
} as const

/**
 * A fan's size, as shares of the height of who holds it, and how wide its
 * leaves open each way from upright, in radians.
 */
const FAN = {
  reach: 0.2,
  spread: 0.65,
  pleats: 5,
  pleat: 0.01,
  handle: 0.02,
} as const

/** The point `radius` from 0, 0 at `angle`. */
function along(radius: number, angle: number): [number, number] {
  return [radius * Math.cos(angle), radius * Math.sin(angle)]
}

/**
 * The regular's folded newspaper, leaning under the arm, in the
 * reference's lengths: the sheet, its masthead and its lines of print.
 */
const NEWSPAPER = {
  sheet: [-34, -73, -23, -79, -13, -52, -24, -46],
  masthead: [-34, -73, -23, -79, -21.5, -75, -32.5, -69],
  lines: [
    [-30.5, -66, -22, -70.5],
    [-28.5, -61, -20, -65.5],
    [-26.5, -56, -18, -60.5],
  ],
} as const

/** The bargain hunter's tote, in the reference's lengths. */
const TOTE = [17, -58, 39, -58, 42, -30, 15, -30]

/** The strip of the tote away from the sun on `sun`'s side. */
function toteShade(sun: Side): number[] {
  return sun === 'left'
    ? [34, -58, 39, -58, 42, -30, 36, -30]
    : [17, -58, 23, -58, 21, -30, 15, -30]
}

/** The bubble's size, its tail's tip at 0, 0. */
const BUBBLE = { width: 56, height: 40, tail: 9 } as const

/**
 * Draws a speech bubble with `mood`'s face, its tail's tip at 0, 0: a
 * smile in money green, brows and a flat mouth in warning amber, a frown
 * and a tear in player blue, or « … » in ink.
 */
export function drawBubble(mood: Mood, style: DrawStyle): Container {
  const { width: w, height: h, tail } = BUBBLE
  const top = -tail - h
  const shape = (g: Graphics) =>
    g.roundRect(-w / 2, top, w, h, 14).poly([-7, -tail - 2, 7, -tail - 2, 0, 0])
  const back = new Graphics({ label: 'back' })
  shape(back).stroke(line(style, style.outline * 2))
  shape(back).fill(style.palette.cream)

  const face = new Container({ label: `face:${mood}` })
  const cy = top + h / 2
  const { palette } = style
  const eyes = (color: string) =>
    new Graphics({ label: 'eyes' })
      .circle(-9, cy - 5, 2.6)
      .circle(9, cy - 5, 2.6)
      .fill(color)
  const stroke = (color: string): StrokeStyle => ({
    width: 3,
    color,
    cap: 'round',
    join: 'round',
  })
  switch (mood) {
    case 'happy':
      face.addChild(eyes(palette.moneyGreen))
      face.addChild(
        new Graphics({ label: 'smile' })
          .arc(0, cy, 10, Math.PI * 0.15, Math.PI * 0.85)
          .stroke(stroke(palette.moneyGreen)),
      )
      break
    case 'annoyed':
      face.addChild(eyes(palette.warningAmber))
      face.addChild(
        new Graphics({ label: 'brows' })
          .moveTo(-14, cy - 13)
          .lineTo(-5, cy - 9)
          .moveTo(14, cy - 13)
          .lineTo(5, cy - 9)
          .stroke(stroke(palette.warningAmber)),
      )
      face.addChild(
        new Graphics({ label: 'mouth' })
          .moveTo(-8, cy + 7)
          .lineTo(8, cy + 7)
          .stroke(stroke(palette.warningAmber)),
      )
      break
    case 'sad':
      face.addChild(eyes(palette.playerBlue))
      face.addChild(
        new Graphics({ label: 'frown' })
          .arc(0, cy + 13, 9, Math.PI * 1.2, Math.PI * 1.8)
          .stroke(stroke(palette.playerBlue)),
      )
      face.addChild(
        new Graphics({ label: 'tear' })
          .moveTo(13, cy - 3)
          .lineTo(16, cy + 3)
          .arc(13, cy + 3, 3, 0, Math.PI)
          .closePath()
          .fill(palette.playerBlue),
      )
      break
    case 'neutral':
      face.addChild(
        new Graphics({ label: 'dots' })
          .circle(-11, cy, 3)
          .circle(0, cy, 3)
          .circle(11, cy, 3)
          .fill(palette.ink),
      )
      break
  }
  return new Container({ label: 'bubble', children: [back, face] })
}

/**
 * Draws the ring on the ground under a customer `height` tall whose card is
 * open, centred on their feet at 0, 0, in player blue.
 */
export function drawPickMark(height: number, style: DrawStyle): Graphics {
  return new Graphics({ label: 'pickMark' })
    .ellipse(0, 0, height * 0.3, height * 0.06)
    .stroke({ width: style.outline * 1.5, color: style.palette.playerBlue })
}

/** The avatar's drawing and the parts that move. */
export interface AvatarArt {
  readonly root: Container
  /** Everything above the waist, which sinks when the avatar slumps. */
  readonly upper: Container
  /** The head with its hair and face, which turns at the chin. */
  readonly face: Container
  /** Turns at the shoulder: 0 hangs down, a quarter turn reaches left. */
  readonly arm: Container
  readonly eyes: Container
  /** The dark circles under the eyes, hidden at first. */
  readonly circles: Container
  /** The open mouth of a yawn, hidden at first. */
  readonly yawn: Container
}

/**
 * Draws an employee who serves at the truck (#208), feet at 0, 0, as a
 * customer is drawn: in the staff's mustard shirt, with a cream apron like
 * the owner's, carrying nothing. Turned to `facing` by mirroring, lit on
 * the side that shows on the screen's left. The city draws the owner
 * walking so, as `owner`: in their shirt, and with the hair of their
 * `avatar`, its bun at the back of the head for `femme`.
 */
export function drawEmployee(
  look: CrowdSettings['employee'],
  style: PeopleStyle,
  trousers: string,
  owner?: { readonly shirt: string; readonly avatar: Avatar },
): Container {
  const u = look.height / REFERENCE
  const root = new Container({ label: 'employee' })
  const sun: Side = look.facing === 1 ? 'left' : 'right'
  const shirt = owner?.shirt ?? style.palette.mustard
  const apron = new Graphics({ label: 'apron' })
    .roundRect(-11 * u, -72 * u, 22 * u, 40 * u, 4 * u)
    .fill(style.palette.cream)
  // drawAvatar's bun, at the head's scale, behind the way they face.
  const behind =
    owner?.avatar === 'femme'
      ? [
          new Graphics({ label: 'bun' })
            .circle(-15.2 * u, -111.2 * u, 8 * u)
            .fill(look.hair),
        ]
      : []
  drawPerson(
    root,
    {
      height: look.height,
      skin: look.skin,
      clothes: shirt,
      sleeves: shirt,
      trousers,
      hair: look.hair,
      headwear: 'hair',
    },
    style,
    sun,
    { behind, over: [apron], held: {} },
  )
  root.scale.x = look.facing
  return root
}

/** How tall the reference draws the owner, from the feet the counter hides. */
const OWNER = 130

/**
 * Draws the player's avatar behind the counter, feet at 0, 0, as the
 * reference's owner, lit from the left: a blue shirt with a cream apron,
 * the hair of `avatar` and two eyes, with no outlines. The arm on the
 * screen's left can reach across the counter; the other hangs behind the
 * shirt, in shade. Dark circles under the eyes, in `circles`, and the open
 * mouth of a yawn are drawn hidden, for fatigue to show. With `shirt`, an
 * employee serving in the owner's place (#264), in that shirt.
 */
export function drawAvatar(
  avatar: Avatar,
  style: PeopleStyle,
  settings: CrowdSettings['avatar'],
  trousers: string,
  circles: string,
  shirt: string = style.palette.playerBlue,
): AvatarArt {
  const v = settings.height / OWNER
  const { palette, light, shading } = style
  const { shade, lit } = shading.figure
  const root = new Container({ label: `avatar:${avatar}` })
  // The avatar faces the viewer, so the sun lights their left.
  const sun: Side = 'left'

  // The counter, whose bottom edge the feet stand on, hides them.
  root.addChild(
    new Graphics({ label: 'legs' })
      .roundRect(-14 * v, -50 * v, 12 * v, 50 * v, 3 * v)
      .fill(trousers)
      .roundRect(2 * v, -50 * v, 12 * v, 50 * v, 3 * v)
      .fill(mix(trousers, light.slate, shade.leg)),
  )
  const upper = root.addChild(new Container({ label: 'upper' }))
  upper.addChild(
    new Graphics({ label: 'otherArm' })
      .roundRect(18 * v, -86 * v, 10 * v, 38 * v, 5 * v)
      .fill(mix(shirt, light.slate, shade.arm)),
    hand(23 * v, -48 * v, 5.5 * v, mix(settings.skin, light.slate, shade.hand)),
  )
  upper.addChild(
    new Graphics({ label: 'shirt' })
      .roundRect(-24 * v, -90 * v, 48 * v, 40 * v, 12 * v)
      .fill(shirt),
  )
  // The shirt's light goes over the apron too.
  upper.addChild(
    new Graphics({ label: 'apron' })
      .rect(-14 * v, -82 * v, 28 * v, 32 * v)
      .fill(palette.cream)
      .roundRect(-24 * v, -90 * v, 48 * v, 40 * v, 12 * v)
      .fill({ texture: shading.side(sun), textureSpace: 'local' }),
  )

  // The head turns at the chin, so it can droop without leaving the neck.
  const head = 20 * v
  const cy = -110 * v
  const chin = cy + head
  const face = upper.addChild(new Container({ label: 'face' }))
  face.pivot.set(0, chin)
  face.position.set(0, chin)
  // Behind the head, which leaves it showing round the top.
  const hair = new Graphics({ label: 'hair' })
    .ellipse(0, cy - 16 * v, 21 * v, 11 * v)
    .fill(settings.hair)
  if (avatar === 'femme') {
    hair.circle(head * 0.95, cy - head * 0.7, head * 0.5).fill(settings.hair)
  }
  face.addChild(hair)
  face.addChild(
    new Graphics({ label: 'head' })
      .circle(0, cy, head)
      .fill(settings.skin)
      .circle(0, cy, head)
      .fill({ texture: shading.round(sun), textureSpace: 'local' }),
  )
  // Just under the hairline.
  const eyeX = head * 0.35
  const eyeY = cy - head * 0.05
  // Drawn around their own middle, so they can squint in place.
  const eyes = face.addChild(
    new Graphics({ label: 'eyes', y: eyeY })
      .circle(-eyeX, 0, head * 0.11)
      .circle(eyeX, 0, head * 0.11)
      .fill(palette.ink),
  )
  // Each circle hugs the bottom of its eye, so it reads as a bag rather
  // than a smile.
  const under: StrokeStyle = {
    width: head * 0.12,
    color: circles,
    cap: 'round',
  }
  const bag = (x: number) =>
    [
      x,
      eyeY - head * 0.04,
      head * 0.19,
      Math.PI * 0.18,
      Math.PI * 0.82,
    ] as const
  const darkCircles = face.addChild(
    new Graphics({ label: 'circles', visible: false })
      .arc(...bag(-eyeX))
      .stroke(under)
      .arc(...bag(eyeX))
      .stroke(under),
  )
  const yawn = face.addChild(
    new Graphics({ label: 'yawn', visible: false })
      .ellipse(0, cy + head * 0.66, head * 0.18, head * 0.22)
      .fill(palette.ink),
  )
  // The hairline across the top of the head, lit.
  face.addChild(
    new Graphics({ label: 'hairTop' })
      .moveTo(-18 * v, cy - 12 * v)
      .bezierCurveTo(
        -12 * v,
        cy - 22 * v,
        8 * v,
        cy - 24 * v,
        18 * v,
        cy - 14 * v,
      )
      .stroke({
        width: 3 * v,
        color: mix(settings.hair, light.sun, lit.ownerHairEdge),
        cap: 'round',
      }),
  )

  const arm = upper.addChild(
    new Container({ label: 'arm', x: -21 * v, y: -84 * v }),
  )
  // It hangs toward the sun, lit; as it reaches across the counter, it
  // keeps its tone.
  arm.addChild(
    new Graphics({ label: 'reachingArm' })
      .roundRect(-5 * v, -5 * v, 10 * v, 40 * v, 5 * v)
      .fill(mix(shirt, light.sun, lit.arm)),
    hand(0, 36 * v, 5.5 * v, settings.skin),
  )
  return { root, upper, face, arm, eyes, circles: darkCircles, yawn }
}

/**
 * Draws the spill a botched unit leaves on the counter, `spill.width` wide,
 * at `spill.x`, `spill.y`: a flat puddle centred there, and a drop running
 * down from it over the counter's front edge.
 */
export function drawSpill(spill: AvatarFatigue['spill']): Graphics {
  const w = spill.width
  return new Graphics({ label: 'spill', x: spill.x, y: spill.y })
    .roundRect(w * 0.1, 0, w * 0.12, w * 0.42, w * 0.06)
    .circle(w * 0.16, w * 0.46, w * 0.09)
    .fill(spill.color)
    .ellipse(0, 0, w / 2, w * 0.13)
    .fill(spill.color)
}

/** The dark outline round a bubble, `width` wide. */
function line(style: DrawStyle, width: number = style.outline): StrokeStyle {
  return { width, color: style.palette.ink, join: 'round', cap: 'round' }
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[
    Math.min(items.length - 1, Math.floor(random() * items.length))
  ] as T
}

function within({ min, max }: Range, random: () => number): number {
  return min + random() * (max - min)
}
