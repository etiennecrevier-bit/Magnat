import { Container, Graphics, Sprite, Text, TilingSprite } from 'pixi.js'
import type {
  CityManifest,
  CityPiece,
  CityPieceKind,
  ColorName,
  Light,
} from '../content/assets.ts'
import { TITLE_FONT, TITLE_FONT_FAMILY } from './fonts.ts'
import {
  boxCorners,
  castShadow,
  raised,
  type BoxCorners,
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
  backdrop: (piece, style) => {
    const g = new Graphics({ label: 'backdrop' })
    // The island lies flat in its box; the sky and the clouds fill theirs.
    if (piece.depth === undefined) {
      return g.rect(0, 0, piece.width, piece.height).fill(color(piece, style))
    }
    const { left, front, right, back } = localCorners(piece)
    return g.poly(flat([left, front, right, back])).fill(top(piece, style))
  },

  // Each box's placeholder throws its own shadow.
  shadows: () => new Container({ label: 'shadows' }),

  scenery: (piece, style) =>
    drawBox(piece, style, { roof: color(piece, style), bricks: false }),

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
      const inside = tones(color(piece, style), style)
      g.rect(0, 0, w, h).fill(inside.lit)
      g.rect(0, 0, w, h * 0.25).fill(inside.shade)
    }),

  awning: (piece, style) =>
    onWall(piece, (face, w, h) =>
      awning(face, 0, 0, w, h, color(piece, style), style),
    ),

  shutter: (piece, style) =>
    onWall(piece, (face, w, h) => {
      const t = tones(color(piece, style), style)
      const g = face.addChild(new Graphics({ label: 'shutter' }))
      g.rect(0, 0, w, h).fill(t.lit)
      for (let y = 2; y < h; y += 3) {
        g.rect(0, y, w, 1).fill(t.shade)
      }
    }),

  sign: (piece, style) =>
    onWall(piece, (face, w, h) => {
      // The reference's board: white, a slate strip along its foot, and
      // its words in their colour.
      face.addChild(
        new Graphics({ label: 'board' })
          .rect(0, 0, w, h)
          .fill(color(piece, style))
          .rect(0, h - SIGN_STRIP * h, w, SIGN_STRIP * h)
          .fill({ color: style.light.slate, alpha: SIGN_STRIP_OPACITY }),
      )
      write(face, piece.text, w, h, piece.trim, style)
    }),

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
  const words = write(face, text, w, h, undefined, style)
  words?.position.set(x + w / 2, y + h / 2)
}

/**
 * Writes `text` in the middle of a board `w` by `h` from 0, 0, in `ink`
 * or the city's sign colour, shrunk to fit: in the title font, its strokes
 * thickened in their own colour, as the reference's words in weight 700.
 */
function write(
  face: Container,
  text: string | undefined,
  w: number,
  h: number,
  ink: ColorName | undefined,
  style: CityStyle,
): Text | null {
  if (text === undefined) return null
  const fill = style.palette[ink ?? style.sign.color]
  const words = face.addChild(
    new Text({
      label: 'text',
      text,
      style: {
        fontFamily: TITLE_FONT_FAMILY,
        fontWeight: TITLE_FONT.weight,
        fontSize: style.sign.fontSize,
        fill,
        stroke: { color: fill, width: SIGN_STROKE },
      },
      anchor: 0.5,
      x: w / 2,
      y: h / 2,
    }),
  )
  const room = w * 0.9
  const width = style.measureWidth(words)
  const tall = style.sign.fontSize / (h * 0.9)
  words.scale.set(Math.min(1, room / width, 1 / tall))
  return words
}

/** The share of a sign's height its slate strip takes, and its opacity. */
const SIGN_STRIP = 3 / 16
const SIGN_STRIP_OPACITY = 0.2
/** How much the words of a sign are thickened, as Fredoka 700. */
const SIGN_STROKE = 0.5

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

/**
 * The shadows a placeholder throws on the ground, for the kinds that throw
 * any: a box's from its walls.
 */
export const CITY_SHADOWS: Partial<
  Record<
    CityPieceKind,
    (piece: CityPiece, shadows: Shadows, light: Light) => readonly Container[]
  >
> = {
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

/**
 * The delivery van, as the reference's cars: a low box `van` sized, a
 * smaller one on it with its windows, both lit from the left, a stripe
 * along its lit side and two wheels, its footprint's middle at 0, 0.
 */
export function drawVan(
  van: CityManifest['deliveries']['van'],
  style: CityStyle,
): Container {
  const root = new Container({ label: 'van' })
  const g = root.addChild(new Graphics())
  const across = van.width - van.depth
  // A step along the van, and one across it, on the ground.
  const along: Vec = [van.depth, van.depth / 2]
  const side: Vec = [-across, across / 2]
  const at = (s: number, t: number, z = 0): Vec => [
    along[0] * (s - 0.5) + side[0] * (t - 0.5),
    along[1] * (s - 0.5) + side[1] * (t - 0.5) - z,
  ]
  const wall = van.height - van.width / 2
  const lower = wall * VAN_LOWER
  const body = tones(style.palette[van.color], style)
  const glass = tones(style.palette.glass, style)
  /** A box from `s0`, `t0` to `s1`, `t1` of the van, `z0` to `z1` up. */
  const box = (
    s0: number,
    t0: number,
    s1: number,
    t1: number,
    z0: number,
    z1: number,
  ) => {
    g.poly(
      flat([at(s0, t1, z0), at(s1, t1, z0), at(s1, t1, z1), at(s0, t1, z1)]),
    )
      .fill(body.lit)
      .poly(
        flat([at(s1, t1, z0), at(s1, t0, z0), at(s1, t0, z1), at(s1, t1, z1)]),
      )
      .fill(body.shade)
      .poly(
        flat([at(s0, t0, z1), at(s1, t0, z1), at(s1, t1, z1), at(s0, t1, z1)]),
      )
      .fill(body.top)
  }
  box(0, 0, 1, 1, 0, lower)
  g.poly(
    flat([
      at(0, 1, lower * 0.3),
      at(1, 1, lower * 0.3),
      at(1, 1, lower * 0.6),
      at(0, 1, lower * 0.6),
    ]),
  ).fill(tones(style.palette[van.stripe], style).lit)
  box(0.22, 0.08, 0.75, 0.92, lower, wall)
  const pane = (wall - lower) * 0.2
  g.poly(
    flat([
      at(0.26, 0.92, lower + pane),
      at(0.71, 0.92, lower + pane),
      at(0.71, 0.92, wall - pane),
      at(0.26, 0.92, wall - pane),
    ]),
  )
    .fill(glass.lit)
    .poly(
      flat([
        at(0.75, 0.88, lower + pane),
        at(0.75, 0.12, lower + pane),
        at(0.75, 0.12, wall - pane),
        at(0.75, 0.88, wall - pane),
      ]),
    )
    .fill(glass.shade)
  for (const s of [0.2, 0.8]) {
    const [x, y] = at(s, 1, VAN_WHEEL * 0.4)
    g.ellipse(x, y, VAN_WHEEL * 0.9, VAN_WHEEL).fill(style.palette.ink)
  }
  return root
}

/** The share of the van's height its lower box takes, and a wheel's size. */
const VAN_LOWER = 0.55
const VAN_WHEEL = 4.5

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
