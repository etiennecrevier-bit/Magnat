import { Container, Graphics, type StrokeStyle } from 'pixi.js'
import type { AvatarFatigue } from '../content/avatarFatigue.ts'
import type { Avatar, DayTypeId, SegmentId } from '../content/schema.ts'
import type { CrowdSettings, Range } from './crowdSettings.ts'
import type { PlaceholderStyle } from './placeholders.ts'
import type { Mood } from './replay.ts'

// Placeholder people: a rounded torso and a round head with dark outlines,
// drawn standing with their feet at 0, 0. A customer's segment shows only
// through what they carry or wear, never through their skin or their body;
// skin tones, clothes and heights vary across everyone at random. Where the
// parts sit inside a person is placeholder geometry, which real art
// replaces, so those proportions stay here.

/** What the office cues of a weekday add to a customer. */
export type OfficeCue = 'lanyard' | 'laptopBag'

/** A child who comes with a customer on a weekend: one visit for both. */
export interface ChildLook {
  readonly skin: string
  readonly clothes: string
  readonly height: number
}

/** How one customer looks. */
export interface Look {
  readonly segment: SegmentId
  readonly skin: string
  readonly clothes: string
  /** From their feet to the top of their head. */
  readonly height: number
  readonly office: OfficeCue | null
  readonly child: ChildLook | null
}

/** The accessory that shows each segment. */
export const SEGMENT_ACCESSORY: Readonly<Record<SegmentId, string>> = {
  aubaine: 'bag',
  habitue: 'mug',
  chic: 'coat',
}

/** A side of a body, as the viewer sees it. */
type Side = 'left' | 'right'

/**
 * Picks how a customer of `segment` looks, from `looks`. On a weekday some
 * carry an office cue; on a weekend some come with a child.
 */
export function pickLook(
  segment: SegmentId,
  dayType: DayTypeId,
  looks: CrowdSettings['looks'],
  random: () => number,
): Look {
  const skin = pick(looks.skinTones, random)
  const clothes = pick(looks.clothes, random)
  const height = within(looks.height, random)
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
    }
  }
  return { segment, skin, clothes, height, office, child }
}

/**
 * Draws a customer as `look` describes, facing the viewer, with their
 * accessory, office cue and child labelled by name. A child stands to the
 * left of the adult.
 */
export function drawCustomer(
  look: Look,
  style: PlaceholderStyle,
  looks: CrowdSettings['looks'],
): Container {
  const h = look.height
  const root = new Container({ label: 'customer' })
  const sleeves = look.segment === 'chic' ? looks.coat : look.clothes
  // A regular holds their mug in the hand on the left.
  const holding: Side | null = look.segment === 'habitue' ? 'left' : null

  if (look.child !== null) {
    const { skin, clothes, height } = look.child
    const child = root.addChild(new Container({ label: 'child', x: -h * 0.32 }))
    drawBody(child, height, skin, clothes, clothes, looks.trousers, style, null)
  }
  if (look.office === 'laptopBag') {
    root.addChild(
      new Graphics({ label: 'laptopBag' })
        .roundRect(-h * 0.36, -h * 0.5, h * 0.22, h * 0.18, 3)
        .fill(looks.laptopBag)
        .stroke(line(style)),
    )
  }
  drawBody(
    root,
    h,
    look.skin,
    look.clothes,
    sleeves,
    looks.trousers,
    style,
    holding,
  )

  const neck = -h * 0.77
  switch (look.segment) {
    case 'aubaine':
      root.addChild(
        new Graphics({ label: 'bag' })
          .moveTo(h * 0.18, -h * 0.5)
          .lineTo(h * 0.12, neck + h * 0.03)
          .moveTo(h * 0.31, -h * 0.5)
          .lineTo(h * 0.14, neck + h * 0.03)
          .stroke(line(style, style.outline * 0.7))
          .poly([
            h * 0.15,
            -h * 0.5,
            h * 0.34,
            -h * 0.5,
            h * 0.36,
            -h * 0.26,
            h * 0.13,
            -h * 0.26,
          ])
          .fill(looks.tote)
          .stroke(line(style)),
      )
      break
    case 'chic':
      root.addChild(
        new Graphics({ label: 'coat' })
          .roundRect(-h * 0.18, neck, h * 0.36, h * 0.62, h * 0.08)
          .fill(looks.coat)
          .stroke(line(style))
          .poly([-h * 0.07, neck, h * 0.07, neck, 0, neck + h * 0.12])
          .fill(look.clothes)
          .stroke(line(style, style.outline * 0.7))
          .moveTo(0, neck + h * 0.12)
          .lineTo(0, -h * 0.15)
          .stroke(line(style, style.outline * 0.6)),
      )
      break
  }

  if (look.office === 'laptopBag') {
    root.addChild(
      new Graphics({ label: 'laptopStrap' })
        .moveTo(h * 0.12, neck + h * 0.02)
        .lineTo(-h * 0.2, -h * 0.5)
        .stroke(line(style, style.outline * 1.4))
        .moveTo(h * 0.12, neck + h * 0.02)
        .lineTo(-h * 0.2, -h * 0.5)
        .stroke({ width: style.outline * 0.6, color: looks.laptopBag }),
    )
  }
  if (look.office === 'lanyard') {
    root.addChild(
      new Graphics({ label: 'lanyard' })
        .moveTo(-h * 0.07, neck)
        .lineTo(0, -h * 0.6)
        .lineTo(h * 0.07, neck)
        .stroke({ width: style.outline * 0.8, color: style.palette.dangerRed })
        .rect(-h * 0.04, -h * 0.61, h * 0.08, h * 0.1)
        .fill(style.palette.cream)
        .stroke(line(style, style.outline * 0.6)),
    )
  }
  if (holding !== null) {
    drawHeld(
      root,
      h,
      holding,
      new Graphics({ label: 'mug' })
        .roundRect(-h * 0.025, -h * 0.13, h * 0.09, h * 0.14, 3)
        .fill(style.palette.cream)
        .stroke(line(style))
        .rect(-h * 0.025, -h * 0.08, h * 0.09, h * 0.04)
        .fill(style.palette.wood)
        .roundRect(-h * 0.035, -h * 0.16, h * 0.11, h * 0.04, 2)
        .fill(style.palette.ink),
      sleeves,
      look.skin,
      style,
    )
  }
  return root
}

/**
 * Draws a body in `parent`, feet at 0, 0: legs, arms, torso and head, each
 * labelled. `sleeves` colours the arms, so a coat covers them. The arm on
 * the `holding` side stops at the elbow, for drawHeld to finish.
 */
function drawBody(
  parent: Container,
  h: number,
  skin: string,
  clothes: string,
  sleeves: string,
  trousers: string,
  style: PlaceholderStyle,
  holding: Side | null,
): void {
  const head = h * 0.115
  const neck = -h * 0.77
  const torso = h * 0.3
  parent.addChild(
    new Graphics({ label: 'legs' })
      .roundRect(-h * 0.11, -h * 0.45, h * 0.09, h * 0.45, h * 0.03)
      .roundRect(h * 0.02, -h * 0.45, h * 0.09, h * 0.45, h * 0.03)
      .fill(trousers)
      .stroke(line(style)),
  )
  const arms = new Graphics({ label: 'arms' })
  for (const side of ['left', 'right'] as const) {
    const { x, y, width } = shoulder(h, side)
    if (side === holding) {
      arms
        .roundRect(x, y, width, h * UPPER_ARM, width / 2)
        .fill(sleeves)
        .stroke(line(style))
      continue
    }
    arms
      .roundRect(x, y, width, h * 0.3, width / 2)
      .fill(sleeves)
      .stroke(line(style))
    arms
      .circle(x + width / 2, y + h * 0.31, width * 0.55)
      .fill(skin)
      .stroke(line(style, style.outline * 0.7))
  }
  parent.addChild(arms)
  parent.addChild(
    new Graphics({ label: 'torso' })
      .roundRect(-torso / 2, neck, torso, h * 0.36, torso * 0.35)
      .fill(clothes)
      .stroke(line(style)),
  )
  parent.addChild(
    new Graphics({ label: 'head' })
      .circle(0, -h + head, head)
      .fill(skin)
      .stroke(line(style)),
  )
}

/** How long an upper arm is, from the shoulder, as a share of the height. */
const UPPER_ARM = 0.22

/** The top left corner and the width of `side`'s arm on a body `h` tall. */
function shoulder(
  h: number,
  side: Side,
): { x: number; y: number; width: number } {
  const torso = h * 0.3
  const width = h * 0.065
  const x = side === 'left' ? -torso / 2 - width * 0.8 : torso / 2 - width * 0.2
  return { x, y: -h * 0.73, width }
}

/**
 * Finishes the arm on `side` that drawBody stopped at the elbow: the
 * forearm bends toward the middle and its hand holds `item`, drawn around
 * the hand's centre at 0, 0. Both go in front of all the body wears.
 */
function drawHeld(
  parent: Container,
  h: number,
  side: Side,
  item: Container,
  sleeves: string,
  skin: string,
  style: PlaceholderStyle,
): void {
  const { x, y, width } = shoulder(h, side)
  const elbow = { x: x + width / 2, y: y + h * UPPER_ARM - width / 2 }
  const hand = { x: (side === 'left' ? -h : h) * 0.08, y: -h * 0.51 }
  const reach = Math.hypot(hand.x - elbow.x, hand.y - elbow.y)
  item.position.set(hand.x, hand.y)
  parent.addChild(item)
  parent.addChild(
    new Graphics({
      label: 'forearm',
      x: elbow.x,
      y: elbow.y,
      rotation: Math.atan2(hand.y - elbow.y, hand.x - elbow.x),
    })
      .roundRect(-width / 2, -width / 2, reach + width / 2, width, width / 2)
      .fill(sleeves)
      .stroke(line(style))
      .circle(reach, 0, width * 0.55)
      .fill(skin)
      .stroke(line(style, style.outline * 0.7)),
  )
}

/** The bubble's size, its tail's tip at 0, 0. */
const BUBBLE = { width: 56, height: 40, tail: 9 } as const

/**
 * Draws a speech bubble with `mood`'s face, its tail's tip at 0, 0: a
 * smile in money green, brows and a flat mouth in warning amber, a frown
 * and a tear in player blue, or « … » in ink.
 */
export function drawBubble(mood: Mood, style: PlaceholderStyle): Container {
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
export function drawPickMark(
  height: number,
  style: PlaceholderStyle,
): Graphics {
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
 * Draws the player's avatar behind the counter, feet at 0, 0: a blue shirt,
 * a cream apron, the hair of `avatar` and two eyes. Its left arm can reach
 * across the counter. Dark circles under the eyes, in `circles`, and the
 * open mouth of a yawn are drawn hidden, for fatigue to show.
 */
export function drawAvatar(
  avatar: Avatar,
  style: PlaceholderStyle,
  settings: CrowdSettings['avatar'],
  trousers: string,
  circles: string,
): AvatarArt {
  const h = settings.height
  const { palette } = style
  const shirt = palette.playerBlue
  const root = new Container({ label: `avatar:${avatar}` })
  const head = h * 0.115
  const neck = -h * 0.77
  const torso = h * 0.3
  const armWidth = h * 0.065

  root.addChild(
    new Graphics({ label: 'legs' })
      .roundRect(-h * 0.11, -h * 0.45, h * 0.09, h * 0.45, h * 0.03)
      .roundRect(h * 0.02, -h * 0.45, h * 0.09, h * 0.45, h * 0.03)
      .fill(trousers)
      .stroke(line(style)),
  )
  const upper = root.addChild(new Container({ label: 'upper' }))
  upper.addChild(
    new Graphics({ label: 'otherArm' })
      .roundRect(
        torso / 2 - armWidth * 0.2,
        neck + h * 0.04,
        armWidth,
        h * 0.3,
        armWidth / 2,
      )
      .fill(shirt)
      .stroke(line(style)),
  )
  upper.addChild(
    new Graphics({ label: 'shirt' })
      .roundRect(-torso / 2, neck, torso, h * 0.36, torso * 0.35)
      .fill(shirt)
      .stroke(line(style)),
  )
  upper.addChild(
    new Graphics({ label: 'apron' })
      .moveTo(-h * 0.07, neck + h * 0.02)
      .lineTo(-h * 0.06, neck - h * 0.02)
      .moveTo(h * 0.07, neck + h * 0.02)
      .lineTo(h * 0.06, neck - h * 0.02)
      .stroke(line(style, style.outline * 0.6))
      .roundRect(-h * 0.08, neck + h * 0.02, h * 0.16, h * 0.14, 3)
      .rect(-h * 0.14, neck + h * 0.14, h * 0.28, h * 0.28)
      .fill(palette.cream)
      .stroke(line(style)),
  )

  // The head turns at the chin, so it can droop without leaving the neck.
  const cy = -h + head
  const chin = cy + head
  const face = upper.addChild(new Container({ label: 'face' }))
  face.pivot.set(0, chin)
  face.position.set(0, chin)
  const hair = new Graphics({ label: 'hair' })
  if (avatar === 'femme') {
    hair
      .circle(head * 0.95, cy - head * 0.7, head * 0.5)
      .fill(settings.hair)
      .stroke(line(style))
  }
  face.addChild(hair)
  face.addChild(
    new Graphics({ label: 'head' })
      .circle(0, cy, head)
      .fill(settings.skin)
      .stroke(line(style)),
  )
  // Below the hairline, which runs across the middle of the head.
  const eyeX = head * 0.38
  const eyeY = cy + head * 0.25
  // Drawn around their own middle, so they can squint in place.
  const eyes = face.addChild(
    new Graphics({ label: 'eyes', y: eyeY })
      .circle(-eyeX, 0, head * 0.11)
      .circle(eyeX, 0, head * 0.11)
      .fill(palette.ink),
  )
  const under: StrokeStyle = { width: head * 0.1, color: circles, cap: 'round' }
  const ring = head * 0.2
  const darkCircles = face.addChild(
    new Graphics({ label: 'circles', visible: false })
      .arc(-eyeX, eyeY + head * 0.08, ring, Math.PI * 0.15, Math.PI * 0.85)
      .stroke(under)
      .arc(eyeX, eyeY + head * 0.08, ring, Math.PI * 0.15, Math.PI * 0.85)
      .stroke(under),
  )
  const yawn = face.addChild(
    new Graphics({ label: 'yawn', visible: false })
      .ellipse(0, cy + head * 0.66, head * 0.18, head * 0.22)
      .fill(palette.ink),
  )
  const cap = new Graphics({ label: 'hairTop' })
    .arc(0, cy, head, Math.PI, Math.PI * 2)
    .lineTo(head, cy - head * (avatar === 'femme' ? 0 : 0.3))
    .lineTo(-head, cy - head * (avatar === 'femme' ? 0 : 0.3))
    .closePath()
    .fill(settings.hair)
    .stroke(line(style))
  face.addChild(cap)

  const arm = upper.addChild(
    new Container({
      label: 'arm',
      x: -torso / 2 + armWidth * 0.3,
      y: neck + h * 0.06,
    }),
  )
  arm.addChild(
    new Graphics()
      .roundRect(-armWidth / 2, -armWidth / 2, armWidth, h * 0.3, armWidth / 2)
      .fill(shirt)
      .stroke(line(style))
      .circle(0, h * 0.3 - armWidth * 0.2, armWidth * 0.55)
      .fill(settings.skin)
      .stroke(line(style, style.outline * 0.7)),
  )
  return { root, upper, face, arm, eyes, circles: darkCircles, yawn }
}

/**
 * Draws the spill a botched unit leaves on the counter, `spill.width` wide,
 * at `spill.x`, `spill.y`: a flat puddle centred there, and a drop running
 * down from it over the counter's front edge.
 */
export function drawSpill(
  spill: AvatarFatigue['spill'],
  style: PlaceholderStyle,
): Graphics {
  const w = spill.width
  return new Graphics({ label: 'spill', x: spill.x, y: spill.y })
    .roundRect(w * 0.1, 0, w * 0.12, w * 0.42, w * 0.06)
    .circle(w * 0.16, w * 0.46, w * 0.09)
    .fill(spill.color)
    .ellipse(0, 0, w / 2, w * 0.13)
    .fill(spill.color)
    .stroke(line(style, style.outline * 0.6))
}

/** A dark outline, `width` wide. */
function line(
  style: PlaceholderStyle,
  width: number = style.outline,
): StrokeStyle {
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
