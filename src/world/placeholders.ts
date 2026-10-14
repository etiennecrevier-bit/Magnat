import { Container, Graphics, Text, type StrokeStyle } from 'pixi.js'
import type { Palette, Piece, PieceKind } from '../content/assets.ts'
import { TITLE_FONT, TITLE_FONT_FAMILY } from './fonts.ts'

// Placeholder art: simple shapes in the palette's colours with dark
// outlines, drawn at each piece's size from its top-left corner. Where the
// parts of a shape sit inside it is placeholder geometry, which real art
// replaces, so those proportions stay here; where each piece sits and how
// big it is lives in src/content/assets.json.

/** The palette and outline width placeholders draw with. */
export interface PlaceholderStyle {
  readonly palette: Palette
  readonly outline: number
}

/** Draws one kind of piece at `piece`'s size, its top-left corner at 0, 0. */
export type DrawPlaceholder = (
  piece: Piece,
  style: PlaceholderStyle,
) => Container

/** The placeholder for each kind of piece. */
export const PLACEHOLDERS: Record<PieceKind, DrawPlaceholder> = {
  cloud: (piece, style) =>
    outlinedUnion(piece, style, (g, { width: w, height: h }) => {
      g.circle(w * 0.3, h * 0.6, h * 0.34)
        .circle(w * 0.5, h * 0.42, h * 0.42)
        .circle(w * 0.72, h * 0.58, h * 0.34)
        .roundRect(w * 0.12, h * 0.52, w * 0.76, h * 0.44, h * 0.22)
    }),

  rooftops: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    const widths = [150, 110, 170, 130, 190, 120, 160]
    const heights = [0.8, 0.9, 0.82, 1, 0.85, 0.95, 0.8]
    const soft = { ...line(style, style.outline * 0.6), alpha: 0.35 }
    for (let x = 0, i = 0; x < w; x += widths[i % widths.length]!, i += 1) {
      const bw = Math.min(widths[i % widths.length]!, w - x)
      const bh = h * heights[i % heights.length]!
      g.rect(x, h - bh, bw, bh)
        .fill(color(piece, style))
        .stroke(soft)
      if (i % 2 === 0) {
        g.rect(x + bw * 0.7, h - bh - 18, 14, 18)
          .fill(color(piece, style))
          .stroke(soft)
      }
    }
    return g
  },

  triplex: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(color(piece, style)).stroke(line(style))

    const cornice = h * 0.07
    const storey = (h - cornice) / 3
    for (let floor = 0; floor < 3; floor += 1) {
      const top = cornice + floor * storey
      const doorHeight = storey * 0.68
      g.rect(w * 0.07, top + storey - doorHeight, w * 0.14, doorHeight)
        .fill(palette.wood)
        .stroke(line(style))
      for (const left of [w * 0.3, w * 0.55]) {
        g.rect(left, top + storey * 0.2, w * 0.18, storey * 0.46)
          .fill(palette.glass)
          .stroke(line(style))
        g.rect(left - w * 0.015, top + storey * 0.12, w * 0.21, storey * 0.07)
          .fill(palette.cream)
          .stroke(line(style, style.outline * 0.6))
      }
    }
    g.rect(-w * 0.015, 0, w * 1.03, cornice)
      .fill(palette.wood)
      .stroke(line(style))

    // A wooden balcony in front of each upper floor.
    for (const floor of [1, 2]) {
      const deck = cornice + floor * storey
      const rail = deck - storey * 0.3
      const railing = (r: Graphics) => {
        r.moveTo(0, rail).lineTo(w, rail)
        for (let x = w / 24; x < w; x += w / 12) {
          r.moveTo(x, rail).lineTo(x, deck)
        }
      }
      railing(g)
      g.stroke(line(style, style.outline * 1.8))
      railing(g)
      g.stroke({ width: style.outline * 0.8, color: palette.wood })
      g.rect(0, deck - 5, w, 10)
        .fill(palette.wood)
        .stroke(line(style))
    }

    // The spiral staircase, from the sidewalk to the second floor's balcony.
    const centre = w * 0.88
    const radius = w * 0.08
    const landing = cornice + 2 * storey
    const helix = (r: Graphics, lift: number) => {
      const turns = 1.5
      const points = 48
      for (let i = 0; i <= points; i += 1) {
        const t = i / points
        const x = centre + radius * Math.sin(t * turns * 2 * Math.PI)
        const y = h - t * (h - landing) - lift
        if (i === 0) r.moveTo(x, y)
        else r.lineTo(x, y)
      }
    }
    g.moveTo(centre, landing).lineTo(centre, h).stroke(line(style))
    helix(g, 0)
    g.stroke(line(style, style.outline * 1.4))
    helix(g, storey * 0.22)
    g.stroke(line(style, style.outline * 0.7))
    return g
  },

  sidewalk: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(color(piece, style))
    for (let x = 96; x < w; x += 96) g.moveTo(x, 0).lineTo(x, h - 10)
    g.stroke({ ...line(style, style.outline * 0.5), alpha: 0.3 })
    g.moveTo(0, 0).lineTo(w, 0).stroke(line(style))
    g.rect(0, h - 10, w, 10)
      .fill(color(piece, style))
      .stroke(line(style))
    return g
  },

  tree: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.rect(w * 0.44, h * 0.45, w * 0.12, h * 0.55)
      .fill(style.palette.wood)
      .stroke(line(style))
    const canopy = outlinedUnion(piece, style, (c) => {
      c.circle(w * 0.5, h * 0.28, w * 0.3)
        .circle(w * 0.27, h * 0.42, w * 0.23)
        .circle(w * 0.73, h * 0.42, w * 0.23)
        .circle(w * 0.5, h * 0.5, w * 0.25)
    })
    return new Container({ children: [g, canopy] })
  },

  lampPost: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.rect(w * 0.4, h * 0.14, w * 0.2, h * 0.82).fill(color(piece, style))
    g.rect(w * 0.22, h * 0.93, w * 0.56, h * 0.07).fill(color(piece, style))
    g.poly([w * 0.5, 0, w, h * 0.05, 0, h * 0.05])
      .fill(color(piece, style))
      .stroke(line(style))
    g.rect(w * 0.12, h * 0.05, w * 0.76, h * 0.09)
      .fill(style.palette.cream)
      .stroke(line(style))
    return g
  },

  street: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(color(piece, style))
    g.moveTo(0, 14)
      .lineTo(w, 14)
      .stroke({ ...line(style), alpha: 0.35 })
    return g
  },

  laneMarkings: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    for (let x = 0; x < w; x += 110) g.rect(x, 0, Math.min(60, w - x), h)
    g.fill(color(piece, style))
    return g
  },

  truck: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const g = new Graphics()
    const axle = h * 0.87
    const wheel = h * 0.13

    // The cabin, then the box, its wall cut away to show the kitchen.
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
    ])
      .fill(color(piece, style))
      .stroke(line(style))
    g.poly([
      w * 0.79,
      h * 0.27,
      w * 0.885,
      h * 0.27,
      w * 0.95,
      h * 0.47,
      w * 0.79,
      h * 0.47,
    ])
      .fill(palette.glass)
      .stroke(line(style))
    g.circle(w * 0.985, h * 0.62, h * 0.03)
      .fill(palette.cream)
      .stroke(line(style))
    g.rect(w * 0.95, h * 0.78, w * 0.06, h * 0.07)
      .fill(palette.steel)
      .stroke(line(style))
    g.roundRect(0, 0, w * 0.76, axle, 14)
      .fill(color(piece, style))
      .stroke(line(style))
    g.rect(w * 0.045, h * 0.12, w * 0.66, h * 0.68)
      .fill(palette.cream)
      .stroke(line(style, style.outline * 2))
    g.rect(0, axle - h * 0.06, w * 0.76, h * 0.04).fill(palette.cream)

    for (const x of [w * 0.2, w * 0.82]) {
      g.circle(x, axle, wheel * 1.12).fill(palette.ink)
      g.circle(x, axle, wheel).fill(palette.ink).stroke(line(style))
      g.circle(x, axle, wheel * 0.45)
        .fill(palette.steel)
        .stroke(line(style))
    }
    return g
  },

  rack: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(style.palette.sidewalk).stroke(line(style))
    for (const [x, y, rw, rh] of [
      [0, 0, w * 0.08, h],
      [w * 0.92, 0, w * 0.08, h],
      [0, 0, w, h * 0.05],
    ] as const) {
      g.rect(x, y, rw, rh).fill(color(piece, style)).stroke(line(style))
    }
    return g
  },

  croissants: (piece, style) => {
    const { width: w, height: h } = piece
    const rows = piece.fill?.steps ?? 1
    const row = h / rows
    const g = new Graphics()
    for (let i = 0; i < rows; i += 1) {
      const floor = (i + 1) * row
      const across = 3
      const size = w / across
      for (let j = 0; j < across; j += 1) {
        const cx = size * (j + 0.5)
        const cy = floor - row * 0.34
        g.ellipse(cx, cy, size * 0.42, row * 0.28)
          .fill(color(piece, style))
          .stroke(line(style, style.outline * 0.7))
        g.moveTo(cx - size * 0.12, cy - row * 0.24)
          .lineTo(cx - size * 0.08, cy + row * 0.24)
          .moveTo(cx + size * 0.12, cy - row * 0.24)
          .lineTo(cx + size * 0.08, cy + row * 0.24)
          .stroke(line(style, style.outline * 0.5))
      }
      g.rect(0, floor - 4, w, 4)
        .fill(style.palette.wood)
        .stroke(line(style, style.outline * 0.5))
    }
    return g
  },

  espressoMachine: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const g = new Graphics()
    g.roundRect(0, h * 0.14, w, h * 0.86, 6)
      .fill(color(piece, style))
      .stroke(line(style))
    g.rect(w * 0.06, 0, w * 0.88, h * 0.14).fill(palette.ink)
    g.circle(w * 0.2, h * 0.32, w * 0.08)
      .fill(palette.cream)
      .stroke(line(style, style.outline * 0.6))
    g.rect(w * 0.36, h * 0.42, w * 0.28, h * 0.1).fill(palette.ink)
    g.moveTo(w * 0.62, h * 0.5)
      .lineTo(w * 0.86, h * 0.56)
      .stroke(line(style, style.outline * 1.5))
    g.rect(w * 0.42, h * 0.64, w * 0.16, h * 0.2)
      .fill(palette.cream)
      .stroke(line(style, style.outline * 0.6))
    g.rect(w * 0.18, h * 0.86, w * 0.64, h * 0.06).fill(palette.ink)
    return g
  },

  steam: (piece, style) =>
    outlinedUnion(
      piece,
      style,
      (g, { width: w, height: h }) => {
        g.circle(w * 0.5, h * 0.8, w * 0.2)
          .circle(w * 0.36, h * 0.52, w * 0.2)
          .circle(w * 0.58, h * 0.24, w * 0.22)
      },
      style.outline * 0.5,
    ),

  pot: (piece, style) => {
    const { width: w, height: h } = piece
    const { palette } = style
    const g = new Graphics()
    g.roundRect(w * 0.78, h * 0.36, w * 0.2, h * 0.34, 6).stroke(
      line(style, style.outline * 1.6),
    )
    g.roundRect(w * 0.1, h * 0.24, w * 0.72, h * 0.76, 8)
      .fill(color(piece, style))
      .stroke(line(style))
    g.rect(w * 0.1, h * 0.52, w * 0.72, h * 0.18).fill(palette.cream)
    g.rect(w * 0.04, h * 0.14, w * 0.84, h * 0.12)
      .fill(palette.steel)
      .stroke(line(style))
    g.circle(w * 0.46, h * 0.08, w * 0.07)
      .fill(palette.ink)
      .stroke(line(style, style.outline * 0.5))
    return g
  },

  counter: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.rect(0, 0, w, h).fill(color(piece, style)).stroke(line(style))
    for (let x = w / 8; x < w - 1; x += w / 8)
      g.moveTo(x, h * 0.16).lineTo(x, h)
    g.stroke({ ...line(style, style.outline * 0.5), alpha: 0.4 })
    g.rect(-4, 0, w + 8, h * 0.16)
      .fill(style.palette.steel)
      .stroke(line(style))
    return g
  },

  awning: (piece, style) => {
    const { width: w, height: h } = piece
    const stripes = 10
    const stripe = w / stripes
    const hem = h * 0.72
    const shape = (g: Graphics, i: number) => {
      g.rect(i * stripe, 0, stripe, hem)
        .moveTo(i * stripe + stripe, hem)
        .arc(i * stripe + stripe / 2, hem, stripe / 2, 0, Math.PI)
        .closePath()
    }
    const g = new Graphics()
    for (let i = 0; i < stripes; i += 1) shape(g, i)
    g.stroke(line(style, style.outline * 2))
    for (let i = 0; i < stripes; i += 1) {
      shape(g, i)
      g.fill(i % 2 === 0 ? color(piece, style) : style.palette.cream)
    }
    g.rect(-4, -4, w + 8, 8).fill(style.palette.ink)
    return g
  },

  rolledAwning: (piece, style) => {
    const { width: w, height: h } = piece
    const g = new Graphics()
    g.roundRect(0, 0, w, h, h / 2).fill(color(piece, style))
    const stripes = 10
    for (let i = 1; i < stripes - 1; i += 2) {
      g.rect((i * w) / stripes, h * 0.08, w / stripes, h * 0.84)
    }
    g.fill(style.palette.cream)
    g.roundRect(0, 0, w, h, h / 2).stroke(line(style))
    for (const x of [w * 0.25, w * 0.75]) g.moveTo(x, 0).lineTo(x, h)
    g.stroke(line(style, style.outline * 1.2))
    return g
  },

  closedSign: (piece, style) => {
    const { width: w, height: h } = piece
    const board = h * 0.3
    const g = new Graphics()
    g.moveTo(w * 0.18, board)
      .lineTo(w * 0.5, 0)
      .lineTo(w * 0.82, board)
      .stroke(line(style, style.outline * 0.7))
    g.circle(w * 0.5, 0, 3).fill(style.palette.ink)
    g.roundRect(0, board, w, h - board, 6)
      .fill(color(piece, style))
      .stroke(line(style))
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
    const g = new Graphics()
    g.roundRect(0, 0, w, h, 8).fill(color(piece, style)).stroke(line(style))
    g.roundRect(5, 5, w - 10, h - 10, 5).stroke({
      width: style.outline * 0.5,
      color: style.palette.cream,
    })
    return g
  },
}

/** The piece's own colour, from the palette. */
function color(piece: Piece, style: PlaceholderStyle): string {
  return style.palette[piece.color]
}

/** A dark outline, `width` wide. */
function line(
  style: PlaceholderStyle,
  width: number = style.outline,
): StrokeStyle {
  return { width, color: style.palette.ink, join: 'round', cap: 'round' }
}

/**
 * Fills overlapping shapes in the piece's colour with one outline around
 * them all: the shapes are stroked twice as wide first, and the fill on top
 * hides the inner half of every stroke.
 */
function outlinedUnion(
  piece: Piece,
  style: PlaceholderStyle,
  shapes: (g: Graphics, size: { width: number; height: number }) => void,
  outline: number = style.outline,
): Graphics {
  const g = new Graphics()
  shapes(g, piece)
  g.stroke(line(style, outline * 2))
  shapes(g, piece)
  g.fill(color(piece, style))
  return g
}
