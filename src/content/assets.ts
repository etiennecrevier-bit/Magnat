import { z } from 'zod'
import assetsJson from './assets.json'
import { productIdSchema } from './schema.ts'

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
  'coneOrange',
  'heatSky',
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
  'heatSky',
  'cones',
  'roadSign',
  'rivalTruck',
  'bunting',
  'banner',
  'outOfOrderCard',
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

/** A share or an opacity, from 0 (none) to 1 (all). */
const share = z.number().min(0).max(1)

/** How dark or light a material's lines are, from the light's two colours. */
const tone = z.enum(['sun', 'slate'])

/** The seed of a texture's noise, for the engine's generator. */
const seed = z.int().nonnegative()

/**
 * The sun, the shade and the textures of the look approved for #89. Only
 * placeholders are lit this way: real art comes with its own light.
 */
const lightSchema = z.strictObject({
  _note: z.string().optional(),
  /** The warm light everything lit is mixed with. */
  sun: hexColor,
  /** The shade colour: never black, never purple. */
  slate: hexColor,
  /** A face looking up: mixed with the sun, a bright rim on its front edge. */
  topFace: z.strictObject({
    light: share,
    rim: z.strictObject({ light: share, width: size }),
  }),
  /** A face looking at the viewer: lighter at the top, darker at the foot. */
  litSide: z.strictObject({ topLight: share, footSlate: share }),
  /** A face turned away from the sun. */
  shadeSide: z.strictObject({ slate: share }),
  /** The shadows thrown on the ground, all shown at one opacity. */
  castShadow: z.strictObject({
    opacity: share,
    /** The blur of their edge, in pixels. */
    blur: z.number().nonnegative(),
    /** How far right and down they reach, as shares of their caster's height. */
    reach: z.number().nonnegative(),
    drop: z.number().nonnegative(),
  }),
  /** The tight ellipse under what stands on the ground. */
  contactShadow: z.strictObject({
    /** How deep the ellipse is, as a share of its width. */
    depth: size,
    opacity: z.strictObject({
      person: share,
      wheel: share,
      tree: share,
      lampPost: share,
      /** A cone's foot, a sign's leg. */
      prop: share,
    }),
  }),
  /** The short shadow a ledge throws on the wall under it. */
  ledgeShadow: z.strictObject({
    opacity: share,
    /** How far down each kind of ledge's shadow fades out, in pixels. */
    depth: z.strictObject({
      cornice: size,
      balcony: size,
      sill: size,
      awning: size,
      curb: size,
    }),
  }),
  /** Bricks, tiles and the asphalt's speckle, at low contrast. */
  material: z.strictObject({
    lineOpacity: z.strictObject({ min: share, max: share }),
    /** One brick and one tile, their joints `line` pixels wide. */
    brick: z.strictObject({
      width: size,
      height: size,
      line: size,
      tone,
      seed,
    }),
    tile: z.strictObject({
      width: size,
      height: size,
      line: size,
      tone,
      seed,
    }),
    /** `count` specks in a tile `size` pixels square. */
    speckle: z.strictObject({
      size: z.int().positive(),
      count: z.int().nonnegative(),
      tone,
      seed,
    }),
  }),
  /** Large soft blotches over the world. */
  unevenness: z.strictObject({
    blend: z.literal('soft-light'),
    opacity: share,
    /** How many blotches across the screen. */
    cells: z.int().positive(),
    amplitude: share,
    seed,
  }),
  /** Fine noise over the world, tiled. */
  grain: z.strictObject({
    blend: z.literal('overlay'),
    opacity: share,
    size: z.int().positive(),
    amplitude: share,
    seed,
  }),
  /** The darker corners. */
  vignette: z.strictObject({
    color: colorNameSchema,
    opacity: share,
    /** The share of the radius, from the middle, it leaves clear. */
    clear: share,
  }),
  /** The sun's warmth from the upper left corner. */
  glow: z.strictObject({ opacity: share, reach: size }),
  /** The layer the shadows on the ground go in, under what stands there. */
  shadowLayer: z.string().min(1),
})

export type Light = z.output<typeof lightSchema>

/**
 * When a piece shows: only on days the truck is open, or only on closed
 * ones; while a change to the street that an event card made is in effect;
 * or while a product cannot be sold.
 */
const showsSchema = z.union([
  z.enum(['open', 'closed']),
  z.strictObject({
    /** The id of the event card, in events.json. */
    event: z.string().min(1),
  }),
  z.strictObject({ unavailable: productIdSchema }),
])

export type Shows = z.output<typeof showsSchema>

/** The pieces that write their `text`, which they must have. */
const WRITTEN: readonly PieceKind[] = [
  'roadSign',
  'rivalTruck',
  'banner',
  'outOfOrderCard',
]

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
  /** Shows the piece only on some days; on every day without it. */
  shows: showsSchema.optional(),
  /** What a sign or a board says, in French, without spaces at its ends. */
  text: z
    .string()
    .regex(/^\S(.*\S)?$/, 'expected text without spaces at its ends')
    .optional(),
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
    /** The width of the dark outlines round people, bubbles and the tally. */
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
    /** How the placeholders are lit, and the textures over the world. */
    light: lightSchema,
    /** The customers who fan themselves, as in a heat wave. */
    fans: z.strictObject({
      /** While the fans show; customers who come then may carry one. */
      shows: showsSchema,
      /** The chance each customer who comes then fans themselves. */
      chance: share,
      /** One swing back and forth, in real milliseconds. */
      periodMs: size,
      /** How far the fan turns each way from upright, in radians. */
      swing: z.number().nonnegative(),
      color: colorNameSchema,
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

    // The world fills the shadow layer itself.
    const { shadowLayer, material } = manifest.light
    if (!layers.has(shadowLayer)) {
      ctx.addIssue({
        code: 'custom',
        message: `unknown layer: ${shadowLayer}`,
        path: ['light', 'shadowLayer'],
      })
    }
    if (material.lineOpacity.min > material.lineOpacity.max) {
      ctx.addIssue({
        code: 'custom',
        message: 'the least line opacity is above the most',
        path: ['light', 'material', 'lineOpacity'],
      })
    }

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
      if (piece.layer === shadowLayer) {
        ctx.addIssue({
          code: 'custom',
          message: 'the shadow layer holds no piece',
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
      const written = WRITTEN.includes(piece.kind)
      if (written && piece.text === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `${piece.kind} pieces need a text`,
          path: ['pieces', index, 'text'],
        })
      }
      if (!written && piece.text !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `${piece.kind} pieces write no text`,
          path: ['pieces', index, 'text'],
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
