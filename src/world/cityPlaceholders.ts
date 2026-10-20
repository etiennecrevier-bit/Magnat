import { Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js'
import type {
  CityManifest,
  CityPiece,
  CityPieceKind,
  Light,
} from '../content/assets.ts'
import type { Avatar } from '../content/schema.ts'
import { TITLE_FONT, TITLE_FONT_FAMILY } from './fonts.ts'
import {
  boxCorners,
  castShadow,
  raised,
  type BoxCorners,
  type BoxSize,
  type Vec,
} from './iso.ts'
import { mix, tonesOf, type Tones } from './light.ts'
import type { PlaceholderStyle } from './placeholders.ts'
import type { MeasureWidth } from './scene.ts'
import type { Shadows } from './shadows.ts'

// The city's placeholder art, in the look of #89 seen at an angle: a roof
// is a top face, mixed with the sun, with a bright rim along its front
// edges; the wall facing the lower left is lit, graded from light at the top
// to slate at its foot, with bricks; the wall facing the lower right is in
// shade. No outlines. Each piece is drawn from the top-left corner of its
// box; a piece on a wall from the top of its left edge, along the wall.
// Where the parts of a shape sit inside it is placeholder geometry, which
// real art replaces, so those proportions stay here; where each piece sits
// and how big it is lives in src/content/assets.json.

/** What the city is drawn with: the street's style, and how it writes. */
export interface CityStyle extends PlaceholderStyle {
  readonly sign: CityManifest['sign']
  /** How wide `text` is drawn. Pixi measures it in the browser only. */
  readonly measureWidth: MeasureWidth
}

/** Draws one kind of piece of the city, its top-left corner at 0, 0. */
export type DrawCityPiece = (piece: CityPiece, style: CityStyle) => Container

/**
 * How steep a wall's foot and top run on screen: half a pixel down, on the
 * lit wall, or up, on the shaded wall, for each pixel across.
 */
const WALL_SLOPE = Math.atan(0.5)

/** The placeholder for each kind of piece of the city. */
export const CITY_PLACEHOLDERS: Record<CityPieceKind, DrawCityPiece> = {
  ground: (piece, style) => {
    const { left, front, right, back } = localCorners(piece)
    const g = new Graphics({ label: 'ground' })
    return g.poly(flat([left, front, right, back])).fill(top(piece, style))
  },

  park: (piece, style) => {
    const box = localCorners(piece)
    const root = new Container()
    const grass = root.addChild(new Graphics({ label: 'grass' }))
    grass
      .poly(flat([box.left, box.front, box.right, box.back]))
      .fill(top(piece, style))
    // A gravel walk across it, corner to corner.
    const walk = tonesOf(style.palette.sidewalk, style.light).top
    const across = (s: number, t: number) => onGround(box, s, t)
    grass
      .poly(
        flat([
          across(0, 0.46),
          across(1, 0.46),
          across(1, 0.56),
          across(0, 0.56),
        ]),
      )
      .fill(walk)
    const trees = root.addChild(new Graphics({ label: 'trees' }))
    for (const [x, y] of treesOf(box)) tree(trees, x, y, box.wall, style)
    return root
  },

  triplex: (piece, style) =>
    drawBox(piece, style, {
      roof: style.palette.steel,
      bricks: true,
      lit: (face, w, h) => {
        const g = face.addChild(new Graphics({ label: 'openings' }))
        const iron = face.addChild(new Graphics({ label: 'iron' }))
        const storey = h / 3
        for (let floor = 0; floor < 3; floor += 1) {
          const y = floor * storey
          opening(
            g,
            w * 0.06,
            y + storey * 0.3,
            w * 0.14,
            storey * 0.7,
            style.palette.wood,
            style,
          )
          for (const x of [w * 0.32, w * 0.6]) {
            opening(
              g,
              x,
              y + storey * 0.2,
              w * 0.18,
              storey * 0.46,
              style.palette.glass,
              style,
            )
          }
          // The balcony of each floor above the ground, in iron.
          if (floor < 2) {
            iron
              .moveTo(0, y + storey)
              .lineTo(w * 0.3, y + storey)
              .moveTo(0, y + storey * 0.72)
              .lineTo(w * 0.3, y + storey * 0.72)
          }
        }
        // The outside stair, from the second floor down to the sidewalk.
        iron
          .moveTo(w * 0.3, storey * 2)
          .lineTo(w * 0.96, h)
          .moveTo(w * 0.3, storey)
          .lineTo(w * 0.62, storey * 2)
        iron.stroke({
          width: 1.5,
          color: tones(style.palette.ink, style).shade,
          cap: 'round',
        })
      },
      shade: (face, w, h) => windowRows(face, w, h, 3, 2, style),
    }),

  building: (piece, style) =>
    drawBox(piece, style, {
      roof: style.palette.steel,
      bricks: true,
      lit: (face, w, h) => {
        const g = face.addChild(new Graphics({ label: 'openings' }))
        const storey = h / 2
        const across = Math.max(2, Math.round(w / 26))
        for (let i = 0; i < across; i += 1) {
          const x = ((i + 0.25) * w) / across
          opening(
            g,
            x,
            storey * 0.2,
            (w / across) * 0.5,
            storey * 0.5,
            style.palette.glass,
            style,
          )
        }
        opening(
          g,
          w * 0.66,
          storey * 1.3,
          w * 0.16,
          storey * 0.7,
          style.palette.wood,
          style,
        )
        board(
          face,
          piece.text,
          w * 0.06,
          storey * 1.04,
          w * 0.56,
          storey * 0.34,
          style.palette.cream,
          style,
        )
      },
      shade: (face, w, h) => windowRows(face, w, h, 2, 2, style),
    }),

  mill: (piece, style) =>
    drawBox(piece, style, {
      roof: style.palette.asphalt,
      bricks: true,
      lit: (face, w, h) => windowRows(face, w, h, 4, 3, style, true),
      shade: (face, w, h) => {
        const g = face.addChild(new Graphics({ label: 'openings' }))
        opening(
          g,
          w * 0.52,
          h * 0.78,
          w * 0.2,
          h * 0.22,
          style.palette.wood,
          style,
          'shade',
        )
        board(
          face,
          piece.text,
          w * 0.12,
          h * 0.06,
          w * 0.76,
          h * 0.1,
          style.palette.cream,
          style,
        )
      },
    }),

  silo: (piece, style) => silo(piece, style),

  grocer: (piece, style) =>
    drawBox(piece, style, {
      roof: style.palette.steel,
      bricks: true,
      lit: (face, w, h) => {
        const g = face.addChild(new Graphics({ label: 'openings' }))
        const storey = h / 2
        opening(
          g,
          w * 0.08,
          storey * 1.3,
          w * 0.52,
          storey * 0.6,
          style.palette.glass,
          style,
        )
        opening(
          g,
          w * 0.7,
          storey * 1.2,
          w * 0.18,
          storey * 0.8,
          style.palette.wood,
          style,
        )
        for (const x of [w * 0.12, w * 0.58]) {
          opening(
            g,
            x,
            storey * 0.3,
            w * 0.24,
            storey * 0.42,
            style.palette.glass,
            style,
          )
        }
        awning(
          face,
          w * 0.04,
          storey * 1.08,
          w * 0.6,
          storey * 0.2,
          trim(piece, style),
          style,
        )
        board(
          face,
          piece.text,
          w * 0.04,
          storey * 0.8,
          w * 0.92,
          storey * 0.24,
          style.palette.cream,
          style,
        )
      },
      shade: (face, w, h) => windowRows(face, w, h, 2, 1, style),
    }),

  bakery: (piece, style) =>
    drawBox(piece, style, {
      roof: style.palette.steel,
      bricks: true,
      lit: (face, w, h) => {
        const g = face.addChild(new Graphics({ label: 'openings' }))
        const storey = h / 2
        // The shop window goes dark while the bakery is for rent; its lamps
        // are a piece of their own.
        opening(
          g,
          w * 0.6,
          storey * 1.18,
          w * 0.3,
          storey * 0.66,
          style.palette.glass,
          style,
          'shade',
        )
        opening(
          g,
          w * 0.08,
          storey * 1.22,
          w * 0.16,
          storey * 0.78,
          style.palette.wood,
          style,
        )
        for (const x of [w * 0.12, w * 0.6]) {
          opening(
            g,
            x,
            storey * 0.3,
            w * 0.24,
            storey * 0.42,
            style.palette.glass,
            style,
          )
        }
      },
      shade: (face, w, h) => windowRows(face, w, h, 2, 1, style),
    }),

  truck: (piece, style) =>
    drawBox(piece, style, {
      roof: style.palette.steel,
      bricks: false,
      lit: (face, w, h) => {
        const g = face.addChild(new Graphics({ label: 'body' }))
        g.rect(0, h * 0.7, w, h * 0.1).fill(
          tones(trim(piece, style), style).lit,
        )
        opening(
          g,
          w * 0.88,
          h * 0.18,
          w * 0.1,
          h * 0.36,
          style.palette.glass,
          style,
        )
        for (const x of [w * 0.18, w * 0.8]) {
          ball(g, x, h * 0.92, h * 0.16, style.palette.ink, style)
        }
      },
      shade: (face, w, h) => {
        const g = face.addChild(new Graphics({ label: 'cab' }))
        g.rect(w * 0.12, h * 0.16, w * 0.76, h * 0.38).fill(
          tones(style.palette.glass, style).shade,
        )
        g.rect(0, h * 0.78, w, h * 0.12).fill(
          tones(style.palette.steel, style).shade,
        )
      },
    }),

  hatch: (piece, style) =>
    onWall(piece, (face, w, h) => {
      const g = face.addChild(new Graphics({ label: 'hatch' }))
      const inside = mix(style.palette.ink, style.light.slate, 0.4)
      g.rect(w * 0.04, h * 0.28, w * 0.92, h * 0.72).fill(inside)
      g.rect(0, h * 0.84, w, h * 0.16).fill(
        tones(style.palette.wood, style).top,
      )
      awning(face, 0, 0, w, h * 0.3, color(piece, style), style)
    }),

  shutter: (piece, style) =>
    onWall(piece, (face, w, h) => {
      const t = tones(color(piece, style), style)
      const g = face.addChild(new Graphics({ label: 'shutter' }))
      g.rect(w * 0.04, h * 0.28, w * 0.92, h * 0.72).fill(t.lit)
      for (let y = h * 0.36; y < h; y += 3) {
        g.rect(w * 0.04, y, w * 0.92, 1).fill(t.shade)
      }
    }),

  sign: (piece, style) =>
    onWall(piece, (face, w, h) =>
      board(face, piece.text, 0, 0, w, h, color(piece, style), style),
    ),

  windows: (piece, style) =>
    onWall(piece, (face, w, h) => {
      const g = face.addChild(new Graphics({ label: 'lamplight' }))
      const lamp = color(piece, style)
      g.rect(0, 0, w, h).fill(lamp)
      g.rect(w * 0.2, h * 0.2, w * 0.6, h * 0.6).fill(
        mix(lamp, style.light.sun, 0.5),
      )
      g.rect(w * 0.48, 0, w * 0.04, h).fill(style.palette.wood)
    }),

  contractSign: (piece, style) =>
    onWall(piece, (face, w, h) => {
      const g = face.addChild(new Graphics({ label: 'contract' }))
      g.moveTo(0, h * 0.08)
        .lineTo(w, h * 0.08)
        .stroke({
          width: 1.5,
          color: tones(style.palette.ink, style).shade,
          cap: 'round',
        })
      const t = tones(color(piece, style), style)
      g.roundRect(w * 0.06, h * 0.22, w * 0.88, h * 0.72, 2).fill(t.lit)
      // A croissant: a crescent of two circles, in the colour of its crust.
      const cx = w * 0.5
      const cy = h * 0.6
      const r = Math.min(w, h) * 0.26
      g.circle(cx, cy, r).fill(style.palette.wood)
      g.circle(cx, cy - r * 0.55, r * 0.8).fill(t.lit)
    }),
}

/** What a box's walls show, past their colour, bricks and cornice. */
interface BoxLook {
  /** The roof's colour, lit from above. */
  readonly roof: string
  readonly bricks: boolean
  /** Draws on the lit wall, `w` across and `h` tall, from its top left. */
  readonly lit?: (face: Container, w: number, h: number) => void
  /** Draws on the shaded wall, from its top left, at the front corner. */
  readonly shade?: (face: Container, w: number, h: number) => void
}

/**
 * A box standing on its footprint: the shaded wall, the lit wall graded and
 * bricked, a cornice along the top of each with its shadow under it, then
 * the roof, a top face with a rim along its front edges.
 */
function drawBox(piece: CityPiece, style: CityStyle, look: BoxLook): Container {
  const box = localCorners(piece)
  const { left, front, right, back, wall } = box
  const base = color(piece, style)
  const root = new Container()
  const litWidth = front[0] - left[0]
  const shadeWidth = right[0] - front[0]
  const cornice = Math.min(wall * 0.08, 4)

  const shade = root.addChild(
    wallFace(raised(front, wall), -WALL_SLOPE, 'shade'),
  )
  shade.addChild(
    new Graphics({ label: 'wall' })
      .rect(0, 0, shadeWidth, wall)
      .fill(tones(base, style).shade),
  )
  look.shade?.(shade, shadeWidth, wall)

  const lit = root.addChild(wallFace(raised(left, wall), WALL_SLOPE, 'lit'))
  const facade = lit.addChild(
    new Sprite({ texture: style.materials.facade(base), label: 'facade' }),
  )
  facade.setSize(litWidth, wall)
  if (look.bricks) {
    lit.addChild(
      new TilingSprite({
        texture: style.materials.brick,
        width: litWidth,
        height: wall,
        label: 'bricks',
      }),
    )
  }
  look.lit?.(lit, litWidth, wall)

  for (const [face, width] of [
    [lit, litWidth],
    [shade, shadeWidth],
  ] as const) {
    face.addChild(ledge(0, cornice, width, style))
    face.addChild(
      new Graphics({ label: 'cornice' })
        .rect(0, 0, width, cornice)
        .fill(tonesOf(style.palette.cream, style.light).lit),
    )
  }

  const roofTones = tonesOf(look.roof, style.light)
  const roof = root.addChild(new Graphics({ label: 'roof' }))
  const corners = [left, front, right, back].map((corner) =>
    raised(corner, wall),
  )
  roof.poly(flat(corners)).fill(roofTones.top)
  roof
    .moveTo(...corners[0]!)
    .lineTo(...corners[1]!)
    .lineTo(...corners[2]!)
    .stroke({
      width: style.light.topFace.rim.width,
      color: roofTones.rim,
      join: 'round',
    })
  return root
}

/**
 * A wall's face: a container whose own drawing, `x` across and `y` down
 * from `origin`, runs along the wall at `slope`, so a rectangle drawn in it
 * fills a wall.
 */
function wallFace(origin: Vec, slope: number, label: string): Container {
  return new Container({
    label,
    x: origin[0],
    y: origin[1],
    skew: { x: 0, y: slope },
    scale: { x: 1 / Math.cos(slope), y: 1 },
  })
}

/** A piece painted on a lit wall, drawn along it by `draw`. */
function onWall(
  piece: CityPiece,
  draw: (face: Container, w: number, h: number) => void,
): Container {
  const root = new Container()
  const face = root.addChild(wallFace([0, 0], WALL_SLOPE, 'wall'))
  draw(face, piece.width, piece.height)
  return root
}

/**
 * A silo: a cylinder standing in its box's footprint, lit on its left and
 * in shade on its right, bands round it, and a domed top.
 */
function silo(piece: CityPiece, style: CityStyle): Container {
  const box = localCorners(piece)
  const { left, right, wall } = box
  const cx = (left[0] + right[0]) / 2
  const foot = (left[1] + right[1]) / 2
  const rx = (right[0] - left[0]) / 2
  const ry = rx / 2
  const t = tones(color(piece, style), style)
  const g = new Graphics()
  // The body in strips, from the lit side round to the shaded one.
  const strips = 8
  for (let i = 0; i < strips; i += 1) {
    const x0 = cx - rx + (2 * rx * i) / strips
    const x1 = cx - rx + (2 * rx * (i + 1)) / strips
    const shade = i / (strips - 1)
    g.rect(x0, foot - wall, x1 - x0, wall).fill(
      mix(mix(t.lit, style.light.sun, 0.2 * (1 - shade)), t.shade, shade),
    )
  }
  g.ellipse(cx, foot, rx, ry).fill(t.shade)
  // Its bands, as their front halves.
  for (const share of [0.25, 0.5, 0.75]) {
    const y = foot - wall * share
    g.moveTo(cx - rx, y)
      .arc(cx, y, rx, Math.PI, 0, true)
      .stroke({ width: 1.2, color: t.shade, alpha: 0.6 })
  }
  g.ellipse(cx, foot - wall, rx, ry).fill(t.top)
  g.ellipse(cx - rx * 0.2, foot - wall - ry * 0.1, rx * 0.5, ry * 0.45).fill(
    t.rim,
  )
  return g
}

/** A board with `text` on it, shrunk to fit, in the city's words. */
function board(
  face: Container,
  text: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  style: CityStyle,
): void {
  const t = tones(base, style)
  face.addChild(
    new Graphics({ label: 'board' })
      .rect(x, y, w, h)
      .fill(t.lit)
      .rect(x, y, w, Math.min(2, h / 4))
      .fill(t.top),
  )
  if (text === undefined) return
  const words = face.addChild(
    new Text({
      label: 'text',
      text,
      style: {
        fontFamily: TITLE_FONT_FAMILY,
        fontWeight: TITLE_FONT.weight,
        fontSize: style.sign.fontSize,
        fill: style.palette[style.sign.color],
      },
      anchor: 0.5,
      x: x + w / 2,
      y: y + h / 2,
    }),
  )
  const room = w * 0.9
  const width = style.measureWidth(words)
  const tall = style.sign.fontSize / (h * 0.9)
  words.scale.set(Math.min(1, room / width, 1 / tall))
}

/** An awning in stripes of `base` and cream, its shadow on the wall under it. */
function awning(
  face: Container,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  style: CityStyle,
): void {
  face.addChild(ledge(x, y + h, w, style))
  const g = face.addChild(new Graphics({ label: 'awning' }))
  const stripes = Math.max(3, Math.round(w / 6))
  const cream = tones(style.palette.cream, style).lit
  const lit = tones(base, style).lit
  for (let i = 0; i < stripes; i += 1) {
    g.rect(x + (i * w) / stripes, y, w / stripes, h).fill(
      i % 2 === 0 ? lit : cream,
    )
  }
  g.rect(x, y, w, h * 0.25).fill(tones(base, style).top)
}

/** The shadow a ledge throws on the wall under it, a city's ledge deep. */
function ledge(x: number, y: number, w: number, style: CityStyle): Sprite {
  const { opacity } = style.light.ledgeShadow
  const sprite = new Sprite({
    texture: style.materials.ledge,
    label: 'ledgeShadow',
    x,
    y,
    alpha: opacity,
  })
  sprite.setSize(w, LEDGE_DEPTH)
  return sprite
}

/** How far down a ledge's shadow fades out on a wall of the city. */
const LEDGE_DEPTH = 5

/** Rows of windows, `perRow` across each of `rows` storeys. */
function windowRows(
  face: Container,
  w: number,
  h: number,
  rows: number,
  perRow: number,
  style: CityStyle,
  lit = false,
): void {
  const g = face.addChild(new Graphics({ label: 'openings' }))
  const storey = h / rows
  for (let row = 0; row < rows; row += 1) {
    for (let i = 0; i < perRow; i += 1) {
      opening(
        g,
        ((i + 0.25) * w) / perRow,
        row * storey + storey * 0.24,
        (w / perRow) * 0.5,
        storey * 0.44,
        style.palette.glass,
        style,
        lit ? 'lit' : 'shade',
      )
    }
  }
}

/**
 * An opening in a wall, `fill` set back in it, in the wall's light: the
 * wall shades its left jamb and its head.
 */
function opening(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  style: CityStyle,
  side: 'lit' | 'shade' = 'lit',
): void {
  const t = tones(fill, style)
  const reveal = Math.min(w, h) * 0.16
  g.rect(x, y, w, h).fill(side === 'lit' ? t.lit : t.shade)
  g.rect(x, y, reveal, h).fill(t.shade)
  g.rect(x, y, w, reveal).fill(t.shade)
}

/** A ball lit from the upper left, as a tree's crown or a wheel. */
function ball(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  base: string,
  style: CityStyle,
): void {
  const t = tones(base, style)
  const d = r * 0.18
  g.circle(cx, cy, r)
    .fill(t.shade)
    .circle(cx - d, cy - d, r - d * Math.SQRT2)
    .fill(t.lit)
    .circle(cx - r * 0.38, cy - r * 0.38, r * 0.3)
    .fill(t.top)
}

/** A tree standing at `x`, `y`, `height` tall: its trunk, then its crown. */
function tree(
  g: Graphics,
  x: number,
  y: number,
  height: number,
  style: CityStyle,
): void {
  const crown = height * 0.36
  g.rect(x - 1.5, y - height * 0.5, 3, height * 0.5).fill(
    tones(style.palette.wood, style).shade,
  )
  ball(g, x, y - height + crown, crown, style.palette.foliage, style)
}

/** Where a park's trees stand, about one every 50 pixels each way. */
export function treesOf(box: BoxCorners): Vec[] {
  const along = Math.hypot(
    box.right[0] - box.back[0],
    box.right[1] - box.back[1],
  )
  const across = Math.hypot(
    box.left[0] - box.back[0],
    box.left[1] - box.back[1],
  )
  const rows = Math.max(1, Math.round(across / TREE_SPACING))
  const columns = Math.max(1, Math.round(along / TREE_SPACING))
  const trees: Vec[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const t = (row + 0.5) / rows
      // The walk runs across the middle; no tree stands on it.
      if (t > 0.4 && t < 0.62) continue
      trees.push(onGround(box, (column + 0.5) / columns, t))
    }
  }
  return trees
}

/** How far apart a park's trees stand, in pixels on the ground. */
const TREE_SPACING = 50

/**
 * The point on a box's footprint `s` of the way from its back corner to its
 * right one and `t` of the way to its left one.
 */
function onGround(box: BoxCorners, s: number, t: number): Vec {
  const { back, right, left } = box
  return [
    back[0] + (right[0] - back[0]) * s + (left[0] - back[0]) * t,
    back[1] + (right[1] - back[1]) * s + (left[1] - back[1]) * t,
  ]
}

/**
 * The shadows a placeholder throws on the ground, for the kinds that throw
 * any: a box's from its walls, a park's from its trees.
 */
export const CITY_SHADOWS: Partial<
  Record<
    CityPieceKind,
    (piece: CityPiece, shadows: Shadows, light: Light) => readonly Container[]
  >
> = {
  park: (piece, shadows) => {
    const box = boxCorners(piece)
    return treesOf(box).map(([x, y]) =>
      shadows.castMass(piece.id, x, y, box.wall * 0.36, box.wall * 0.7),
    )
  },
  triplex: (piece, shadows, light) => boxShadow(piece, shadows, light),
  building: (piece, shadows, light) => boxShadow(piece, shadows, light),
  mill: (piece, shadows, light) => boxShadow(piece, shadows, light),
  silo: (piece, shadows, light) => boxShadow(piece, shadows, light),
  grocer: (piece, shadows, light) => boxShadow(piece, shadows, light),
  bakery: (piece, shadows, light) => boxShadow(piece, shadows, light),
  truck: (piece, shadows, light) => boxShadow(piece, shadows, light),
}

function boxShadow(
  piece: CityPiece,
  shadows: Shadows,
  light: Light,
): Container[] {
  const { reach, drop } = light.castShadow
  return [
    shadows.castShape(piece.id, castShadow(boxCorners(piece), reach, drop)),
  ]
}

/** What a tiny person of the city looks like. */
export interface FigureLook {
  readonly coat: string
  readonly skin: string
  readonly hair: string
  /** The owner's apron over their shirt. */
  readonly apron?: string
  /** The hair of the avatar the player picked: longer for `femme`. */
  readonly avatar?: Avatar
}

/**
 * A tiny person standing with their feet at 0, 0: legs, a coat lit on the
 * left, a head and hair. The `bust` is only the head and shoulders, with
 * their foot at 0, 0, for someone serving in the truck's hatch.
 */
export function drawFigure(
  look: FigureLook,
  style: CityStyle,
  size: Pick<CityManifest['figure'], 'height' | 'width'>,
  bust = false,
): Container {
  const { height: h, width: w } = size
  const root = new Container({ label: bust ? 'bust' : 'figure' })
  const g = root.addChild(new Graphics())
  // A bust stands as tall as the figure from its chest up.
  const lift = bust ? -h * 0.5 : 0
  const coat = tones(look.coat, style)
  const top = -h * 0.78 - lift
  const waist = bust ? 0 : -h * 0.36
  if (!bust) {
    const trousers = mix(look.coat, style.light.slate, 0.6)
    g.rect(-w * 0.36, -h * 0.4, w * 0.3, h * 0.4).fill(trousers)
    g.rect(w * 0.06, -h * 0.4, w * 0.3, h * 0.4).fill(
      mix(trousers, style.light.slate, 0.3),
    )
  }
  g.roundRect(-w / 2, top, w, waist - top, w * 0.3).fill(coat.lit)
  g.rect(w * 0.16, top + w * 0.2, w * 0.34, waist - top - w * 0.2).fill(
    coat.shade,
  )
  if (look.apron !== undefined) {
    g.rect(
      -w * 0.3,
      top + (waist - top) * 0.3,
      w * 0.6,
      (waist - top) * 0.7,
    ).fill(tones(look.apron, style).lit)
  }
  const head = h * 0.13
  const headY = top - head * 0.9
  if (look.avatar === 'femme') {
    g.roundRect(-head * 1.05, headY - head, head * 2.1, head * 2.2, head).fill(
      look.hair,
    )
  }
  const skin = tones(look.skin, style)
  g.circle(0, headY, head).fill(skin.shade)
  g.circle(-head * 0.15, headY - head * 0.15, head * 0.8).fill(skin.lit)
  g.moveTo(-head, headY - head * 0.1)
    .arc(0, headY, head, Math.PI * 1.05, Math.PI * 1.95)
    .fill(look.hair)
  return root
}

/**
 * The delivery van: a box `van` sized, with a stripe along its lit side,
 * its footprint's middle at 0, 0.
 */
export function drawVan(
  van: CityManifest['deliveries']['van'],
  style: CityStyle,
): Container {
  const size: BoxSize = {
    x: 0,
    y: 0,
    width: van.width,
    height: van.height,
    depth: van.depth,
  }
  const { left, right } = boxCorners(size)
  const middle: Vec = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]
  const piece: CityPiece = {
    id: 'van',
    kind: 'truck',
    layer: '',
    ...size,
    color: van.color,
    trim: van.stripe,
  }
  const art = CITY_PLACEHOLDERS.truck(piece, style)
  art.position.set(-middle[0], -middle[1])
  const root = new Container({ label: 'van' })
  root.addChild(art)
  return root
}

/**
 * The words of the day's trip on a board in `label`'s colours, outlined,
 * its foot's middle at 0, 0.
 */
export function drawLabel(
  text: string,
  label: CityManifest['label'],
  style: CityStyle,
): Container {
  const root = new Container({ label: 'tripLabel' })
  const background = root.addChild(new Graphics({ label: 'background' }))
  const words = root.addChild(
    new Text({
      label: 'text',
      text,
      style: {
        fontFamily: TITLE_FONT_FAMILY,
        fontWeight: TITLE_FONT.weight,
        fontSize: label.fontSize,
        fill: style.palette[label.color],
      },
      anchor: { x: 0.5, y: 1 },
      y: -label.paddingY,
    }),
  )
  const width = style.measureWidth(words) + 2 * label.paddingX
  const height = label.fontSize * 1.25 + 2 * label.paddingY
  background
    .roundRect(-width / 2, -height, width, height, height / 2)
    .fill(style.palette[label.background])
    .stroke({ width: style.outline / 1.5, color: style.palette.ink })
  return root
}

/** The corners of `piece`'s box, from its own top-left corner. */
function localCorners(piece: CityPiece): BoxCorners {
  return boxCorners({ ...piece, x: 0, y: 0 })
}

/** Points as Pixi's flat list of coordinates. */
export function flat(points: readonly Vec[]): number[] {
  return points.flatMap(([x, y]) => [x, y])
}

function color(piece: CityPiece, style: CityStyle): string {
  return style.palette[piece.color]
}

function trim(piece: CityPiece, style: CityStyle): string {
  return style.palette[piece.trim ?? piece.color]
}

function top(piece: CityPiece, style: CityStyle): string {
  return tones(color(piece, style), style).top
}

function tones(base: string, style: { readonly light: Light }): Tones {
  return tonesOf(base, style.light)
}
