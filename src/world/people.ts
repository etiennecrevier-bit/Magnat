import { Container, Graphics, type StrokeStyle } from 'pixi.js'
import type { AvatarFatigue } from '../content/avatarFatigue.ts'
import type { Avatar, DayTypeId, SegmentId } from '../content/schema.ts'
import type { CrowdSettings, Range } from './crowdSettings.ts'
import { tonesOf } from './light.ts'
import type { DrawStyle } from './placeholders.ts'
import type { Mood } from './replay.ts'

// Placeholder people: a rounded torso and a round head with dark outlines,
// drawn standing with their feet at 0, 0. The sun from the upper left
// lights each part of a body on the screen's left and leaves its right in
// shade (see light.ts). A customer's segment shows only through what they
// carry or wear, never through their skin or their body; skin tones,
// clothes and heights vary across everyone at random. Where the parts sit
// inside a person is placeholder geometry, which real art replaces, so
// those proportions stay here.

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

/** A side of a drawing, before it is turned. */
type Side = 'left' | 'right'

/** Which way a customer faces: 1 to the right, -1 to the left. */
export type Facing = 1 | -1

/** How far a child stands from the adult they come with, left of their feet. */
export const CHILD_OFFSET = 0.32

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
 * Draws a customer as `look` describes, with their accessory, office cue
 * and child labelled by name. A child stands to the left of the adult.
 * The drawing is for a customer turned to `facing` by mirroring it (its
 * container's `scale.x`): either way, it is lit on the side that shows on
 * the screen's left.
 */
export function drawCustomer(
  look: Look,
  style: DrawStyle,
  looks: CrowdSettings['looks'],
  facing: Facing = 1,
): Container {
  const h = look.height
  const root = new Container({ label: 'customer' })
  const sleeves = look.segment === 'chic' ? looks.coat : look.clothes
  // A regular holds their mug in the hand on the left.
  const holding: Side | null = look.segment === 'habitue' ? 'left' : null
  const sun: Side = facing === 1 ? 'left' : 'right'

  if (look.child !== null) {
    const { skin, clothes, height } = look.child
    const child = root.addChild(
      new Container({ label: 'child', x: -h * CHILD_OFFSET }),
    )
    drawBody(
      child,
      height,
      skin,
      clothes,
      clothes,
      looks.trousers,
      style,
      null,
      sun,
    )
  }
  if (look.office === 'laptopBag') {
    root.addChild(
      shadedRect(
        new Graphics({ label: 'laptopBag' }),
        [-h * 0.36, -h * 0.5, h * 0.22, h * 0.18, 3],
        looks.laptopBag,
        style,
        sun,
      ),
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
    sun,
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
          .poly(TOTE.map((share) => share * h))
          .fill(tonesOf(looks.tote, style.light).lit)
          .poly(toteShade(sun).map((share) => share * h))
          .fill(tonesOf(looks.tote, style.light).shade)
          .poly(TOTE.map((share) => share * h))
          .stroke(line(style)),
      )
      break
    case 'chic':
      root.addChild(
        shadedRect(
          new Graphics({ label: 'coat' }),
          [-h * 0.18, neck, h * 0.36, h * 0.62, h * 0.08],
          looks.coat,
          style,
          sun,
        )
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
      sun,
    )
  }
  return root
}

/** The bargain hunter's tote, as shares of the height. */
const TOTE = [0.15, -0.5, 0.34, -0.5, 0.36, -0.26, 0.13, -0.26]

/** The strip of the tote away from the sun on `sun`'s side. */
function toteShade(sun: Side): number[] {
  return sun === 'left'
    ? [0.29, -0.5, 0.34, -0.5, 0.36, -0.26, 0.31, -0.26]
    : [0.15, -0.5, 0.2, -0.5, 0.18, -0.26, 0.13, -0.26]
}

/**
 * Draws a body in `parent`, feet at 0, 0: legs, arms, torso and head, each
 * labelled and lit on the `sun` side. `sleeves` colours the arms, so a coat
 * covers them. The arm on the `holding` side stops at the elbow, for
 * drawHeld to finish.
 */
function drawBody(
  parent: Container,
  h: number,
  skin: string,
  clothes: string,
  sleeves: string,
  trousers: string,
  style: DrawStyle,
  holding: Side | null,
  sun: Side,
): void {
  const head = h * 0.115
  const neck = -h * 0.77
  const torso = h * 0.3
  const legs = new Graphics({ label: 'legs' })
  for (const x of [-h * 0.11, h * 0.02]) {
    shadedRect(
      legs,
      [x, -h * 0.45, h * 0.09, h * 0.45, h * 0.03],
      trousers,
      style,
      sun,
    )
  }
  parent.addChild(legs)
  const arms = new Graphics({ label: 'arms' })
  for (const side of ['left', 'right'] as const) {
    const { x, y, width } = shoulder(h, side)
    if (side === holding) {
      shadedRect(
        arms,
        [x, y, width, h * UPPER_ARM, width / 2],
        sleeves,
        style,
        sun,
      )
      continue
    }
    shadedRect(arms, [x, y, width, h * 0.3, width / 2], sleeves, style, sun)
    shadedCircle(
      arms,
      x + width / 2,
      y + h * 0.31,
      width * 0.55,
      skin,
      style,
      sun,
      0.7,
    )
  }
  parent.addChild(arms)
  parent.addChild(
    shadedRect(
      new Graphics({ label: 'torso' }),
      [-torso / 2, neck, torso, h * 0.36, torso * 0.35],
      clothes,
      style,
      sun,
    ),
  )
  parent.addChild(
    shadedCircle(
      new Graphics({ label: 'head' }),
      0,
      -h + head,
      head,
      skin,
      style,
      sun,
    ),
  )
}

/** A rounded box: its left, top, width, height and corner radius. */
type Rounded = readonly [number, number, number, number, number]

/** How much of a part's width the shade takes, on the side away from the sun. */
const SHADE_SHARE = 0.32

/**
 * Fills the rounded box `shape` in `g` lit on the `sun` side: in shade,
 * then in `base` but for a strip on the other side, then outlined.
 */
function shadedRect(
  g: Graphics,
  [x, y, w, h, r]: Rounded,
  base: string,
  style: DrawStyle,
  sun: Side,
): Graphics {
  const tones = tonesOf(base, style.light)
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
    .roundRect(x, y, w, h, r)
    .stroke(line(style))
}

/**
 * Fills a circle in `g` lit on the `sun` side: in shade, then a smaller
 * disc in `base` touching its edge toward the sun, then outlined `outline`
 * times the style's width.
 */
function shadedCircle(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  base: string,
  style: DrawStyle,
  sun: Side,
  outline = 1,
): Graphics {
  const tones = tonesOf(base, style.light)
  const toward = sun === 'left' ? -1 : 1
  return g
    .circle(cx, cy, r)
    .fill(tones.shade)
    .circle(cx + toward * r * 0.2, cy, r * 0.8)
    .fill(tones.lit)
    .circle(cx, cy, r)
    .stroke(line(style, style.outline * outline))
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
  style: DrawStyle,
  sun: Side,
): void {
  const { x, y, width } = shoulder(h, side)
  const elbow = { x: x + width / 2, y: y + h * UPPER_ARM - width / 2 }
  const hand = { x: (side === 'left' ? -h : h) * 0.08, y: -h * 0.51 }
  const reach = Math.hypot(hand.x - elbow.x, hand.y - elbow.y)
  const rotation = Math.atan2(hand.y - elbow.y, hand.x - elbow.x)
  item.position.set(hand.x, hand.y)
  parent.addChild(item)
  // The forearm is drawn along its own x axis, then turned: the sun comes
  // from `sun`'s side of the body, which is turned the other way here.
  const toward = sun === 'left' ? -1 : 1
  const sunX = toward * Math.cos(rotation)
  const sunY = -toward * Math.sin(rotation)
  const sleeve = tonesOf(sleeves, style.light)
  const lit = width * (1 - SHADE_SHARE)
  const forearm = new Graphics({
    label: 'forearm',
    x: elbow.x,
    y: elbow.y,
    rotation,
  })
    .roundRect(-width / 2, -width / 2, reach + width / 2, width, width / 2)
    .fill(sleeve.shade)
    .roundRect(
      -width / 2,
      sunY < 0 ? -width / 2 : width / 2 - lit,
      reach + width / 2,
      lit,
      lit / 2,
    )
    .fill(sleeve.lit)
    .roundRect(-width / 2, -width / 2, reach + width / 2, width, width / 2)
    .stroke(line(style))
  const palm = width * 0.55
  const tones = tonesOf(skin, style.light)
  forearm
    .circle(reach, 0, palm)
    .fill(tones.shade)
    .circle(reach + sunX * palm * 0.2, sunY * palm * 0.2, palm * 0.8)
    .fill(tones.lit)
    .circle(reach, 0, palm)
    .stroke(line(style, style.outline * 0.7))
  parent.addChild(forearm)
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
 * Draws the player's avatar behind the counter, feet at 0, 0: a blue shirt,
 * a cream apron, the hair of `avatar` and two eyes. Its left arm can reach
 * across the counter. Dark circles under the eyes, in `circles`, and the
 * open mouth of a yawn are drawn hidden, for fatigue to show.
 */
export function drawAvatar(
  avatar: Avatar,
  style: DrawStyle,
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

  // The avatar faces the viewer, so the sun lights their left.
  const sun: Side = 'left'
  const legs = root.addChild(new Graphics({ label: 'legs' }))
  for (const x of [-h * 0.11, h * 0.02]) {
    shadedRect(
      legs,
      [x, -h * 0.45, h * 0.09, h * 0.45, h * 0.03],
      trousers,
      style,
      sun,
    )
  }
  const upper = root.addChild(new Container({ label: 'upper' }))
  upper.addChild(
    shadedRect(
      new Graphics({ label: 'otherArm' }),
      [
        torso / 2 - armWidth * 0.2,
        neck + h * 0.04,
        armWidth,
        h * 0.3,
        armWidth / 2,
      ],
      shirt,
      style,
      sun,
    ),
  )
  upper.addChild(
    shadedRect(
      new Graphics({ label: 'shirt' }),
      [-torso / 2, neck, torso, h * 0.36, torso * 0.35],
      shirt,
      style,
      sun,
    ),
  )
  const apron = new Graphics({ label: 'apron' })
    .moveTo(-h * 0.07, neck + h * 0.02)
    .lineTo(-h * 0.06, neck - h * 0.02)
    .moveTo(h * 0.07, neck + h * 0.02)
    .lineTo(h * 0.06, neck - h * 0.02)
    .stroke(line(style, style.outline * 0.6))
  shadedRect(
    apron,
    [-h * 0.08, neck + h * 0.02, h * 0.16, h * 0.14, 3],
    palette.cream,
    style,
    sun,
  )
  shadedRect(
    apron,
    [-h * 0.14, neck + h * 0.14, h * 0.28, h * 0.28, 0],
    palette.cream,
    style,
    sun,
  )
  upper.addChild(apron)

  // The head turns at the chin, so it can droop without leaving the neck.
  const cy = -h + head
  const chin = cy + head
  const face = upper.addChild(new Container({ label: 'face' }))
  face.pivot.set(0, chin)
  face.position.set(0, chin)
  const hair = new Graphics({ label: 'hair' })
  if (avatar === 'femme') {
    shadedCircle(
      hair,
      head * 0.95,
      cy - head * 0.7,
      head * 0.5,
      settings.hair,
      style,
      sun,
    )
  }
  face.addChild(hair)
  face.addChild(
    shadedCircle(
      new Graphics({ label: 'head' }),
      0,
      cy,
      head,
      settings.skin,
      style,
      sun,
    ),
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
  // Lit as it hangs: as it reaches across the counter, the shade turns
  // under it, away from the sun.
  const reaching = new Graphics()
  shadedRect(
    reaching,
    [-armWidth / 2, -armWidth / 2, armWidth, h * 0.3, armWidth / 2],
    shirt,
    style,
    sun,
  )
  shadedCircle(
    reaching,
    0,
    h * 0.3 - armWidth * 0.2,
    armWidth * 0.55,
    settings.skin,
    style,
    sun,
    0.7,
  )
  arm.addChild(reaching)
  return { root, upper, face, arm, eyes, circles: darkCircles, yawn }
}

/**
 * Draws the spill a botched unit leaves on the counter, `spill.width` wide,
 * at `spill.x`, `spill.y`: a flat puddle centred there, and a drop running
 * down from it over the counter's front edge.
 */
export function drawSpill(
  spill: AvatarFatigue['spill'],
  style: DrawStyle,
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
