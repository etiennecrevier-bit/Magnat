import { z } from 'zod'
import assetsJson from './assets.json'

// The world's asset manifest: every piece of the street and the truck, where
// it sits and what it looks like. Every object is strict, so a mistyped key
// fails loudly instead of being silently dropped.

/**
 * The named colours of the art brief, plus a few the placeholders need. The
 * palette must give each one, and pieces name their colour from this list.
 */
export const colorNameSchema = z.enum([
  'ink',
  'cream',
  'sky',
  'brickRed',
  'brickDark',
  'brickLight',
  'mustard',
  'sidewalk',
  'moneyGreen',
  'warningAmber',
  'dangerRed',
  'playerBlue',
  'haze',
  'asphalt',
  'foliage',
  'wood',
  'glass',
  'steel',
])

export type ColorName = z.infer<typeof colorNameSchema>

/** What a piece is, which picks the placeholder the world draws for it. */
export const pieceKindSchema = z.enum([
  'cloud',
  'rooftops',
  'triplex',
  'sidewalk',
  'tree',
  'lampPost',
  'street',
  'laneMarkings',
  'truck',
  'rack',
  'croissants',
  'espressoMachine',
  'steam',
  'pot',
  'counter',
  'awning',
  'rolledAwning',
  'closedSign',
  'truckSign',
])

export type PieceKind = z.infer<typeof pieceKindSchema>

/**
 * The image formats the world loads. src/world/art.ts collects the files
 * with these extensions; keep the two lists the same.
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg']

// A file path under src/world/art/, such as `truck.png` or `truck/body.png`:
// no leading slash or dot, no `..`, and one of IMAGE_EXTENSIONS.
const IMAGE_PATH = new RegExp(
  `^[\\w-]+(/[\\w-]+)*\\.(${IMAGE_EXTENSIONS.join('|')})$`,
)

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'expected a colour such as #2B2622')

const size = z.number().positive()

const pieceSchema = z.strictObject({
  id: z.string().min(1),
  kind: pieceKindSchema,
  /** One of the manifest's `layers`. */
  layer: z.string().min(1),
  /** The top-left corner, in logical pixels of the design. */
  x: z.number(),
  y: z.number(),
  width: size,
  height: size,
  /** The placeholder's main colour, also shown when the image fails. */
  color: colorNameSchema,
  /** A file path under src/world/art/, such as `truck.png`. */
  image: z
    .string()
    .regex(IMAGE_PATH, 'expected a file path under src/world/art/')
    .optional(),
  /** Shows the piece only on days the truck is open, or only on closed ones. */
  shows: z.enum(['open', 'closed']).optional(),
  /** Reveals the piece from the bottom as the stock it shows grows. */
  fill: z
    .strictObject({
      /** The units that fill it to the top. */
      capacity: z.int().positive(),
      /** The shelves it fills by: each shows once a unit is on it. */
      steps: z.int().positive(),
    })
    .optional(),
})

export type Piece = z.output<typeof pieceSchema>

export const assetManifestSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** The logical size the scene is designed at, before it is scaled. */
    designSize: z.strictObject({
      width: z.int().positive(),
      height: z.int().positive(),
    }),
    // A record keyed by the enum needs every colour and rejects any other.
    palette: z.record(colorNameSchema, hexColor),
    /** The width of the placeholders' dark outlines. */
    outlineWidth: size,
    /** The espresso machine's steam: one puff rises and fades each period. */
    steamPuff: z.strictObject({
      periodMs: size,
      rise: z.number().nonnegative(),
    }),
    /** The business name written on the truck's sign. */
    signText: z.strictObject({
      fontSize: size,
      color: colorNameSchema,
      /** Room left on each side of the name, which shrinks to fit. */
      paddingX: z.number().nonnegative(),
    }),
    /** Layer ids, back to front. */
    layers: z.array(z.string().min(1)).min(1),
    pieces: z.array(pieceSchema),
  })
  .superRefine((manifest, ctx) => {
    const layers = new Set<string>()
    manifest.layers.forEach((layer, index) => {
      if (layers.has(layer)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate layer: ${layer}`,
          path: ['layers', index],
        })
      }
      layers.add(layer)
    })

    const ids = new Set<string>()
    manifest.pieces.forEach((piece, index) => {
      if (ids.has(piece.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate piece id: ${piece.id}`,
          path: ['pieces', index, 'id'],
        })
      }
      ids.add(piece.id)
      if (!layers.has(piece.layer)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown layer: ${piece.layer}`,
          path: ['pieces', index, 'layer'],
        })
      }
      if (piece.fill !== undefined && piece.kind !== 'croissants') {
        ctx.addIssue({
          code: 'custom',
          message: 'only the croissants fill with stock',
          path: ['pieces', index, 'fill'],
        })
      }
      if (piece.kind === 'croissants' && piece.fill === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'the croissants need a fill',
          path: ['pieces', index, 'fill'],
        })
      }
    })

    // The world writes the business name on the one sign and fills the one
    // croissant rack.
    for (const kind of ['truckSign', 'croissants'] as const) {
      const count = manifest.pieces.filter((p) => p.kind === kind).length
      if (count !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: `expected exactly one ${kind} piece, found ${count}`,
          path: ['pieces'],
        })
      }
    }
  })

export type AssetManifest = z.output<typeof assetManifestSchema>

export type Palette = AssetManifest['palette']

/**
 * Validates the world's asset manifest and returns it typed. Throws an Error
 * naming every invalid field. Pass `raw` only to check other data; by
 * default it reads `assets.json`.
 */
export function loadAssetManifest(raw: unknown = assetsJson): AssetManifest {
  const result = assetManifestSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`assets.json is invalid:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}
