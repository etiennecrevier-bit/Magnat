import {
  Container,
  Graphics,
  Sprite,
  Text,
  type TextStyleOptions,
} from 'pixi.js'
import type { Light, Palette, Piece, PieceKind } from '../content/assets.ts'
import { TITLE_FONT, TITLE_FONT_FAMILY } from './fonts.ts'
import { mix, tonesOf, type Tones } from './light.ts'
import type { Materials } from './materials.ts'
import type { Shadows } from './shadows.ts'

// Placeholder art: simple shapes in the palette's colours, lit by one sun
// from the upper left (see light.ts and `light` in assets.json), with no
// outlines. Each surface takes three tones of its colour: faces looking up
// are lighter, with a bright rim on their front edge; faces looking at the
// viewer keep the colour, a facade graded from light at the top to slate at
// the foot; faces turned away are mixed with slate. Ledges throw a short
// shadow on the wall under them, from a texture made once (materials.ts).
// The street's scenery is art (`backdrop`), drawn here only as a flat shape
// when its image fails to load. Each piece is drawn
// at its size from its top-left corner. Where the parts of a shape sit
// inside it is placeholder geometry, which real art replaces, so those
// proportions stay here; where each piece sits and how big it is lives in
// src/content/assets.json. Real art is never lit again by code.

/** What everything on the street is drawn with. */
export interface DrawStyle {
  readonly palette: Palette
  /** The width of the dark outlines round people, bubbles and the tally. */
  readonly outline: number
  readonly light: Light
}

/** What placeholders are drawn with: the style and the textures made once. */
export interface PlaceholderStyle extends DrawStyle {
  readonly materials: Materials
}

/** Draws one kind of piece at `piece`'s size, its top-left corner at 0, 0. */
export type DrawPlaceholder = (
  piece: Piece,
  style: PlaceholderStyle,
) => Container

/** The placeholder for each kind of piece. */
export const PLACEHOLDERS: Record<PieceKind, DrawPlaceholder> = {
  backdrop: (piece, style) => {
    // The image failed: a flat shape in its colour, unlit, so the street
    // keeps its layout.
    const g = new Graphics()
    g.rect(0, 0, piece.width, piece.height).fill(color(piece, style))
    return g
  },

  truck: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const body = tones(color(piece, style), style)
    const g = new Graphics()
    const axle = h * 0.87
    const wheel = h * 0.13

    // The cabin, its roof catching the sun and its nose in shade.
    g.poly([
      w * 0.72,
      h * 0.2,
      w * 0.9,
      h * 0.2,
      w,
      h * 0.5,
      w,
      axle,
      w * 0.72,
      axle,
    ]).fill(body.lit)
    g.rect(w * 0.965, h * 0.5, w * 0.035, axle - h * 0.5).fill(body.shade)
    topFace(g, w * 0.72, h * 0.2, w * 0.18, 6, color(piece, style), style)
    const glass = tones(palette.glass, style)
    g.poly([
      w * 0.79,
      h * 0.27,
      w * 0.885,
      h * 0.27,
      w * 0.95,
      h * 0.47,
      w * 0.79,
      h * 0.47,
    ]).fill(glass.lit)
    g.rect(w * 0.79, h * 0.27, w * 0.095, 4).fill(glass.shade)
    g.poly([
      w * 0.81,
      h * 0.45,
      w * 0.86,
      h * 0.3,
      w * 0.88,
      h * 0.3,
      w * 0.83,
      h * 0.45,
    ]).fill(glass.top)
    ball(g, w * 0.985, h * 0.62, h * 0.03, palette.cream, style)
    box(
      g,
      w * 0.95,
      h * 0.78,
      w * 0.06,
      h * 0.07,
      palette.steel,
      style,
      3,
      w * 0.012,
    )

    // The box, its wall cut away to show the kitchen, its roof lit.
    g.roundRect(0, 0, w * 0.76, axle, 14).fill(body.top)
    g.roundRect(0, 7, w * 0.76, axle - 7, 14).fill(body.lit)
    g.rect(14, 5, w * 0.76 - 28, 2).fill(body.rim)
    opening(g, w * 0.045, h * 0.12, w * 0.66, h * 0.68, palette.cream, style)
    g.rect(0, axle - h * 0.06, w * 0.76, h * 0.04).fill(
      tones(palette.cream, style).lit,
    )

    const tyre = tones(palette.ink, style)
    for (const x of [w * 0.2, w * 0.82]) {
      g.moveTo(...around(x, axle, wheel * 1.12, Math.PI))
        .arc(x, axle, wheel * 1.12, Math.PI, Math.PI * 2)
        .closePath()
        .fill(body.shade)
      g.circle(x, axle, wheel).fill(tyre.lit)
      g.moveTo(...around(x, axle, wheel * 0.86, Math.PI * 1.05))
        .arc(x, axle, wheel * 0.86, Math.PI * 1.05, Math.PI * 1.45)
        .stroke({
          width: 3,
          color: tyre.top,
          cap: 'round',
        })
      ball(g, x, axle, wheel * 0.45, palette.steel, style)
    }
    return g
  },

  rack: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(tones(style.palette.sidewalk, style).lit)
    box(g, 0, 0, w * 0.08, h, color(piece, style), style, 0, w * 0.03)
    box(g, w * 0.92, 0, w * 0.08, h, color(piece, style), style, 0, w * 0.03)
    box(g, 0, 0, w, h * 0.05, color(piece, style), style, h * 0.025)
    return g
  },

  croissants: (piece, style) => {
    const { width: w, height: h } = piece
    const rows = piece.fill?.steps ?? 1
    const row = h / rows
    const bun = tones(color(piece, style), style)
    const g = new Graphics()
    for (let i = 0; i < rows; i += 1) {
      const floor = (i + 1) * row
      const across = 3
      const size = w / across
      for (let j = 0; j < across; j += 1) {
        const cx = size * (j + 0.5)
        const cy = floor - row * 0.34
        const rx = size * 0.42
        const ry = row * 0.28
        g.ellipse(cx, cy, rx, ry).fill(bun.shade)
        g.ellipse(cx - rx * 0.12, cy - ry * 0.14, rx * 0.86, ry * 0.8).fill(
          bun.lit,
        )
        g.ellipse(cx - rx * 0.4, cy - ry * 0.4, rx * 0.3, ry * 0.22).fill(
          bun.top,
        )
        g.moveTo(cx - size * 0.12, cy - row * 0.24)
          .lineTo(cx - size * 0.08, cy + row * 0.24)
          .moveTo(cx + size * 0.12, cy - row * 0.24)
          .lineTo(cx + size * 0.08, cy + row * 0.24)
          .stroke({
            width: style.outline * 0.5,
            color: bun.shade,
            cap: 'round',
          })
      }
      box(g, 0, floor - 4, w, 4, style.palette.wood, style, 2)
    }
    return g
  },

  espressoMachine: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const steel = tones(color(piece, style), style)
    const g = new Graphics()
    g.roundRect(0, h * 0.14, w, h * 0.86, 6).fill(steel.shade)
    g.roundRect(0, h * 0.14, w * 0.86, h * 0.86, 6).fill(steel.lit)
    box(g, w * 0.06, 0, w * 0.88, h * 0.14, palette.ink, style, 3)
    ball(g, w * 0.2, h * 0.32, w * 0.08, palette.cream, style)
    g.rect(w * 0.36, h * 0.42, w * 0.28, h * 0.1).fill(palette.ink)
    g.moveTo(w * 0.62, h * 0.5)
      .lineTo(w * 0.86, h * 0.56)
      .stroke({ width: style.outline * 1.5, color: steel.shade, cap: 'round' })
    box(
      g,
      w * 0.42,
      h * 0.64,
      w * 0.16,
      h * 0.2,
      palette.cream,
      style,
      2,
      w * 0.04,
    )
    g.rect(w * 0.18, h * 0.86, w * 0.64, h * 0.06).fill(palette.ink)
    return g
  },

  steam: (piece, style) =>
    puffs(piece, style, (g, { width: w, height: h }, dx, dy) => {
      g.circle(w * 0.5 + dx, h * 0.8 + dy, w * 0.2)
        .circle(w * 0.36 + dx, h * 0.52 + dy, w * 0.2)
        .circle(w * 0.58 + dx, h * 0.24 + dy, w * 0.22)
    }),

  pot: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const pot = tones(color(piece, style), style)
    const g = new Graphics()
    g.roundRect(w * 0.78, h * 0.36, w * 0.2, h * 0.34, 6).stroke({
      width: style.outline * 1.6,
      color: pot.shade,
    })
    g.roundRect(w * 0.1, h * 0.24, w * 0.72, h * 0.76, 8).fill(pot.shade)
    g.roundRect(w * 0.1, h * 0.24, w * 0.58, h * 0.76, 8).fill(pot.lit)
    box(
      g,
      w * 0.1,
      h * 0.52,
      w * 0.72,
      h * 0.18,
      palette.cream,
      style,
      0,
      w * 0.14,
    )
    box(
      g,
      w * 0.04,
      h * 0.14,
      w * 0.84,
      h * 0.12,
      palette.steel,
      style,
      3,
      w * 0.12,
    )
    ball(g, w * 0.46, h * 0.08, w * 0.07, palette.ink, style)
    return g
  },

  counter: (piece, style) => {
    const { width: w, height: h } = piece
    const { lineOpacity } = style.light.material
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(tones(color(piece, style), style).lit)
    for (let x = w / 8; x < w - 1; x += w / 8)
      g.moveTo(x, h * 0.16).lineTo(x, h)
    g.stroke({ width: 2, color: style.light.slate, alpha: lineOpacity.max })
    const top = new Graphics({ label: 'top' })
    box(top, -4, 0, w + 8, h * 0.16, style.palette.steel, style, h * 0.1)
    const shadow = ledgeShadow(-4, h * 0.16, w + 8, 'sill', style)
    return new Container({ children: [g, shadow, top] })
  },

  awning: (piece, style) => {
    const { width: w, height: h } = piece
    const stripes = 10
    const stripe = w / stripes
    const hem = h * 0.72
    const g = new Graphics()
    for (let i = 0; i < stripes; i += 1) {
      const cloth = tones(
        i % 2 === 0 ? color(piece, style) : style.palette.cream,
        style,
      )
      g.rect(i * stripe, 0, stripe, hem).fill(cloth.top)
      g.moveTo(i * stripe + stripe, hem)
        .arc(i * stripe + stripe / 2, hem, stripe / 2, 0, Math.PI)
        .closePath()
        .fill(cloth.lit)
      g.rect(i * stripe, hem - 2, stripe, 2).fill(cloth.rim)
    }
    box(g, -4, -4, w + 8, 8, style.palette.ink, style, 3)
    // Its shadow falls on the kitchen under it.
    const shadow = ledgeShadow(0, hem, w, 'awning', style)
    return new Container({ children: [shadow, g] })
  },

  rolledAwning: (piece, style) => {
    const { width: w, height: h } = piece
    const cloth = tones(color(piece, style), style)
    const cream = tones(style.palette.cream, style)
    const g = new Graphics()
    g.roundRect(0, 0, w, h, h / 2).fill(cloth.shade)
    g.roundRect(0, 0, w, h * 0.72, h * 0.36).fill(cloth.lit)
    g.rect(h / 2, h * 0.08, w - h, h * 0.2).fill(cloth.top)
    const stripes = 10
    for (let i = 1; i < stripes - 1; i += 2) {
      const x = (i * w) / stripes
      g.rect(x, h * 0.08, w / stripes, h * 0.6).fill(cream.lit)
      g.rect(x, h * 0.68, w / stripes, h * 0.24).fill(cream.shade)
    }
    const strap = tones(style.palette.wood, style).shade
    for (const x of [w * 0.25, w * 0.75]) g.rect(x - 2, 0, 4, h).fill(strap)
    return g
  },

  closedSign: (piece, style) => {
    const { width: w, height: h } = piece
    const board = h * 0.3
    const sign = tones(color(piece, style), style)
    const g = new Graphics()
    g.moveTo(w * 0.18, board)
      .lineTo(w * 0.5, 0)
      .lineTo(w * 0.82, board)
      .stroke({
        width: 2,
        color: tones(style.palette.wood, style).shade,
        cap: 'round',
      })
    g.circle(w * 0.5, 0, 3).fill(style.palette.ink)
    g.roundRect(0, board, w, h - board, 6).fill(sign.shade)
    g.roundRect(0, board, w - 5, h - board - 4, 6).fill(sign.lit)
    g.rect(6, board, w - 17, 2).fill(sign.top)
    const text = new Text({
      text: 'Fermé',
      style: {
        fontFamily: TITLE_FONT_FAMILY,
        fontWeight: TITLE_FONT.weight,
        fontSize: (h - board) * 0.52,
        fill: style.palette.dangerRed,
      },
      anchor: 0.5,
      position: { x: w / 2, y: board + (h - board) / 2 },
    })
    return new Container({ children: [g, text] })
  },

  truckSign: (piece, style) => {
    const { width: w, height: h } = piece
    const board = tones(color(piece, style), style)
    const g = new Graphics()
    g.roundRect(0, 0, w, h, 8).fill(board.shade)
    g.roundRect(0, 0, w - 6, h - 4, 8).fill(board.lit)
    g.rect(8, 1, w - 22, 2).fill(board.top)
    g.roundRect(5, 5, w - 10, h - 10, 5).stroke({
      width: style.outline * 0.5,
      color: style.palette.cream,
    })
    return g
  },

  heatSky: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(color(piece, style))
    // The haze grows warmer and paler down to the rooftops: each band
    // adds a little more sun.
    for (let band = 1; band <= HAZE_BANDS; band += 1) {
      const top = h * (1 - band * 0.05)
      g.rect(0, top, w, h - top).fill({ color: style.light.sun, alpha: 0.16 })
    }
    return g
  },

  cones: (piece, style) => {
    const g = new Graphics()
    for (const cx of coneCentres(piece)) {
      cone(g, cx, piece.height, color(piece, style), style)
    }
    return g
  },

  roadSign: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const plate = h * 0.42
    const g = new Graphics()
    for (const x of signLegs(piece)) {
      box(
        g,
        x - w * 0.025,
        plate,
        w * 0.05,
        h - plate,
        palette.wood,
        style,
        0,
        w * 0.018,
      )
    }
    // The rail across the legs, in orange and cream blocks.
    const rail = { y: h * 0.56, height: h * 0.14 }
    const blocks = 6
    for (let i = 0; i < blocks; i += 1) {
      box(
        g,
        (i * w) / blocks,
        rail.y,
        w / blocks,
        rail.height,
        i % 2 === 0 ? color(piece, style) : palette.cream,
        style,
        rail.height * 0.25,
      )
    }
    const sign = tones(color(piece, style), style)
    g.roundRect(0, 0, w, plate, 6).fill(sign.shade)
    g.roundRect(0, 0, w - 5, plate - 4, 6).fill(sign.lit)
    g.rect(6, 1, w - 17, 2).fill(sign.top)
    const text = writing(piece.text, {
      fontSize: plate * 0.5,
      fill: palette.ink,
    })
    text.position.set((w - 5) / 2, (plate - 4) / 2)
    return new Container({ children: [g, text] })
  },

  rivalTruck: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const board = rivalBoard(piece)
    // The truck itself, as ours is drawn, in its own colour, but with its
    // side closed: a hatch at the back and a cream stripe along it.
    const bodyHeight = h - board.body
    const body = PLACEHOLDERS.truck({ ...piece, height: bodyHeight }, style)
    body.y = board.body
    const side = new Graphics({ label: 'side', y: board.body })
    side
      .rect(w * 0.045, bodyHeight * 0.12, w * 0.66, bodyHeight * 0.68)
      .fill(tones(color(piece, style), style).lit)
    opening(
      side,
      w * 0.08,
      bodyHeight * 0.18,
      w * 0.24,
      bodyHeight * 0.34,
      palette.cream,
      style,
    )
    side
      .rect(0, bodyHeight * 0.6, w * 0.76, bodyHeight * 0.07)
      .fill(tones(palette.cream, style).lit)
    const g = new Graphics()
    const post = tones(palette.ink, style)
    for (const x of [board.width * 0.2, board.width * 0.8]) {
      g.rect(board.x + x - 2, board.height, 4, board.body - board.height).fill(
        post.shade,
      )
    }
    const sign = tones(palette.dangerRed, style)
    g.roundRect(board.x, 0, board.width, board.height, 8).fill(sign.shade)
    g.roundRect(board.x, 0, board.width - 6, board.height - 4, 8).fill(sign.lit)
    g.rect(board.x + 8, 1, board.width - 22, 2).fill(sign.top)
    const text = writing(piece.text, {
      fontSize: board.height * 0.44,
      fill: palette.cream,
    })
    text.position.set(board.x + (board.width - 6) / 2, (board.height - 4) / 2)
    return new Container({ children: [body, side, g, text] })
  },

  bunting: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const span = h * 5
    const sag = h * 0.3
    const flags = 7
    const colours = [
      color(piece, style),
      palette.mustard,
      palette.cream,
      palette.foliage,
      palette.glass,
    ]
    const string = new Graphics({ label: 'string' })
    const g = new Graphics()
    let flag = 0
    for (let x0 = 0; x0 < w; x0 += span) {
      // A quadratic curve whose control point is twice the sag down hangs
      // the sag deep in its middle.
      const control = { x: x0 + span / 2, y: sag * 2 }
      string.moveTo(x0, 0).quadraticCurveTo(control.x, control.y, x0 + span, 0)
      for (let k = 0; k < flags; k += 1) {
        const t = (k + 0.5) / flags
        const px =
          (1 - t) ** 2 * x0 + 2 * (1 - t) * t * control.x + t ** 2 * (x0 + span)
        const py = 2 * (1 - t) * t * control.y
        const half = (span / flags) * 0.38
        const cloth = tones(colours[flag % colours.length]!, style)
        g.poly([px - half, py, px + half, py, px, py + h * 0.55]).fill(
          cloth.lit,
        )
        g.poly([px, py, px + half, py, px, py + h * 0.55]).fill(cloth.shade)
        flag += 1
      }
    }
    string.stroke({ width: 2, color: tones(palette.wood, style).shade })
    return new Container({ children: [string, g] })
  },

  banner: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const cords = new Graphics({ label: 'cords' })
    for (const x of [w * 0.06, w * 0.94]) cords.moveTo(x, 0).lineTo(x, -h * 0.7)
    cords.stroke({ width: 2, color: tones(palette.wood, style).shade })
    const cloth = tones(color(piece, style), style)
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(cloth.shade)
    g.rect(0, 0, w - 6, h - 4).fill(cloth.lit)
    g.rect(0, 0, w - 6, 3).fill(cloth.rim)
    for (const y of [h * 0.1, h * 0.8]) {
      g.rect(0, y, w - 6, h * 0.06).fill(tones(palette.mustard, style).lit)
    }
    const text = writing(piece.text, {
      fontSize: h * 0.46,
      fill: palette.dangerRed,
    })
    text.position.set((w - 6) / 2, (h - 4) / 2)
    return new Container({ children: [cords, g, text] })
  },

  outOfOrderCard: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const paper = tones(color(piece, style), style)
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(paper.shade)
    g.rect(0, 0, w - 3, h - 3).fill(paper.lit)
    // Two strips of tape across its top corners.
    const tape = {
      color: mix(palette.sidewalk, palette.cream, 0.4),
      alpha: 0.9,
    }
    g.poly([-4, 6, 8, -4, 18, 6, 6, 16]).fill(tape)
    g.poly([w - 18, 6, w - 8, -4, w + 4, 6, w - 6, 16]).fill(tape)
    const text = writing(piece.text, {
      fontSize: h * 0.3,
      fill: palette.dangerRed,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: w * 0.86,
      lineHeight: h * 0.34,
    })
    text.position.set((w - 3) / 2, (h - 3) / 2)
    // Taped on a little crooked.
    return new Container({
      children: [g, text],
      pivot: { x: w / 2, y: h / 2 },
      position: { x: w / 2, y: h / 2 },
      rotation: -0.06,
    })
  },
}

/**
 * Adds the shadows a piece's placeholder throws on the ground, where the
 * piece stands on the street: those standing on it cast one to the lower
 * right, with a contact shadow under each foot, wheel and post. Returns
 * them, so they show and hide with the piece.
 */
export const PLACEHOLDER_SHADOWS: Partial<
  Record<PieceKind, (piece: Piece, shadows: Shadows) => readonly Container[]>
> = {
  truck: (piece, shadows) => truckShadows(piece, shadows),
  rivalTruck: (piece, shadows) => {
    const { body } = rivalBoard(piece)
    return truckShadows(
      { ...piece, y: piece.y + body, height: piece.height - body },
      shadows,
    )
  },
  cones: (piece, shadows) => {
    const { id, x, y, height: h } = piece
    return coneCentres(piece).flatMap((cx) => [
      shadows.castBody(id, x + cx, y + h, h * 0.5, h),
      shadows.contactShadow(id, x + cx, y + h, h * 0.95, 'prop'),
    ])
  },
  roadSign: (piece, shadows) => {
    const { id, x, y, width: w, height: h } = piece
    return signLegs(piece).flatMap((leg) => [
      shadows.castBody(id, x + leg, y + h, w * 0.05, h),
      shadows.contactShadow(id, x + leg, y + h, w * 0.14, 'prop'),
    ])
  },
}

/** A truck's shadows: a box from its axle to the ground, and its wheels'. */
function truckShadows(
  { id, x, y, width: w, height: h }: Piece,
  shadows: Shadows,
): Container[] {
  const axle = y + h * 0.87
  const ground = y + h
  return [
    shadows.castBox(id, x + w * 0.02, x + w * 0.98, axle, ground, h * 0.87),
    ...[x + w * 0.2, x + w * 0.82].map((wheel) =>
      shadows.contactShadow(id, wheel, ground, h * 0.13 * 2.3, 'wheel'),
    ),
  ]
}

/** How many bands of haze a heat wave's sky has over the rooftops. */
const HAZE_BANDS = 4

/**
 * Where each cone of a row stands, from the row's left: one for every 1.4
 * times their height, spread evenly.
 */
function coneCentres({ width: w, height: h }: Piece): number[] {
  const count = Math.max(1, Math.floor(w / (h * 1.4)))
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * w) / count)
}

/**
 * A traffic cone standing at `cx`, its foot at `h`, `h` tall: a dark base,
 * an orange body in shade on its right, and two reflective cream bands.
 */
function cone(
  g: Graphics,
  cx: number,
  h: number,
  base: string,
  style: DrawStyle,
): void {
  const foot = h * 0.9
  const half = (y: number) => (y / foot) * h * 0.3
  // The line between the lit and the shaded side, from the tip down.
  const turn = (y: number) => cx + (y / foot) * h * 0.08
  box(
    g,
    cx - h * 0.42,
    foot,
    h * 0.84,
    h - foot,
    style.palette.ink,
    style,
    h * 0.04,
  )
  const body = tones(base, style)
  g.poly([cx, 0, cx - half(foot), foot, cx + half(foot), foot]).fill(body.lit)
  g.poly([cx, 0, turn(foot), foot, cx + half(foot), foot]).fill(body.shade)
  const band = tones(style.palette.cream, style)
  for (const [top, bottom] of [
    [h * 0.36, h * 0.48],
    [h * 0.6, h * 0.72],
  ] as const) {
    g.poly([
      cx - half(top),
      top,
      cx + half(top),
      top,
      cx + half(bottom),
      bottom,
      cx - half(bottom),
      bottom,
    ]).fill(band.lit)
    g.poly([
      turn(top),
      top,
      cx + half(top),
      top,
      cx + half(bottom),
      bottom,
      turn(bottom),
      bottom,
    ]).fill(band.shade)
  }
}

/** Where the road sign's two legs stand, from its left. */
function signLegs({ width: w }: Piece): readonly number[] {
  return [w * 0.18, w * 0.82]
}

/**
 * The rival truck's roof board, over the left of its roof: its left and
 * width, its height, and how far down the truck's body starts.
 */
function rivalBoard({ width: w, height: h }: Piece) {
  const height = h * 0.13
  return { x: w * 0.02, width: w * 0.5, height, body: height * 1.35 }
}

/** What a sign or a board says, in Fredoka, centred on where it is put. */
function writing(text: string | undefined, style: TextStyleOptions): Text {
  return new Text({
    label: 'text',
    text: text ?? '',
    style: {
      fontFamily: TITLE_FONT_FAMILY,
      fontWeight: TITLE_FONT.weight,
      ...style,
    },
    anchor: 0.5,
  })
}

/** The piece's own colour, from the palette. */
function color(piece: Piece, style: DrawStyle): string {
  return style.palette[piece.color]
}

/** The tones `base` takes under the style's light. */
function tones(base: string, style: DrawStyle): Tones {
  return tonesOf(base, style.light)
}

/**
 * A box at `x`, `y`, `w` × `h` lit from the upper left: its front in
 * `base`, a top face `top` deep along its top and a shade strip `side`
 * wide down its right.
 */
function box(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  style: DrawStyle,
  top = 0,
  side = 0,
): Graphics {
  const t = tones(base, style)
  g.rect(x, y, w, h).fill(t.lit)
  if (side > 0) g.rect(x + w - side, y, side, h).fill(t.shade)
  if (top > 0) topFace(g, x, y, w, top, base, style)
  return g
}

/** A face looking up, at `x`, `y`, `w` × `depth`, its rim along the front. */
function topFace(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  depth: number,
  base: string,
  style: DrawStyle,
): Graphics {
  const t = tones(base, style)
  const rim = Math.min(style.light.topFace.rim.width, depth / 2)
  return g
    .rect(x, y, w, depth)
    .fill(t.top)
    .rect(x, y + depth - rim, w, rim)
    .fill(t.rim)
}

/**
 * A ball at `cx`, `cy`: in shade, lit but for a crescent to the lower
 * right, with a highlight toward the sun.
 */
function ball(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  base: string,
  style: DrawStyle,
): Graphics {
  const t = tones(base, style)
  const d = r * 0.16
  return g
    .circle(cx, cy, r)
    .fill(t.shade)
    .circle(cx - d, cy - d, r - d * Math.SQRT2)
    .fill(t.lit)
    .circle(cx - r * 0.38, cy - r * 0.38, r * 0.28)
    .fill(t.top)
}

/**
 * An opening in a wall, `fill` set back in it: the wall shades its left
 * jamb and its head, which face away from the sun.
 */
function opening(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  style: DrawStyle,
): Graphics {
  const t = tones(fill, style)
  const reveal = Math.min(w, h) * 0.12
  return g
    .rect(x, y, w, h)
    .fill(t.lit)
    .rect(x, y, reveal, h)
    .fill(t.shade)
    .rect(x, y, w, reveal)
    .fill(t.shade)
}

/**
 * The short shadow a ledge of `kind` throws on the wall under it, from
 * `x`, `y` and `w` wide: slate, fading out down its depth.
 */
function ledgeShadow(
  x: number,
  y: number,
  w: number,
  kind: keyof Light['ledgeShadow']['depth'],
  style: PlaceholderStyle,
): Sprite {
  const { opacity, depth } = style.light.ledgeShadow
  const sprite = new Sprite({
    texture: style.materials.ledge,
    label: `ledgeShadow:${kind}`,
    x,
    y,
    alpha: opacity,
  })
  sprite.setSize(w, depth[kind])
  return sprite
}

/**
 * Soft puffs, as clouds and steam: `shapes` drawn in shade, then again in
 * the piece's colour a little toward the sun, which leaves the shade on
 * their lower right.
 */
function puffs(
  piece: Piece,
  style: DrawStyle,
  shapes: (
    g: Graphics,
    size: { width: number; height: number },
    dx: number,
    dy: number,
  ) => void,
): Graphics {
  const t = tones(color(piece, style), style)
  const shift = Math.min(piece.width, piece.height) * 0.06
  const g = new Graphics()
  shapes(g, piece, 0, 0)
  g.fill(t.shade)
  shapes(g, piece, -shift, -shift)
  g.fill(t.lit)
  return g
}

/**
 * The point at `angle` on the circle of `radius` round `cx`, `cy`: where an
 * arc starts. Without a move there first, Pixi joins an arc to the last
 * point drawn, or to the corner of the piece.
 */
function around(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
}
