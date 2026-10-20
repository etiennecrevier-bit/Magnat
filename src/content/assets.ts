import { z } from 'zod'
import assetsJson from './assets.json'
import {
  grocerIdSchema,
  placeIdSchema,
  productIdSchema,
  type GrocerId,
  type PlaceId,
} from './schema.ts'

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
  'lamplight',
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
 * ones; while a change to the street that an event card made is in effect,
 * unless one of the card's choices in `except` made it; while a product
 * cannot be sold; or on open days while a product can be sold.
 */
const showsSchema = z.union([
  z.enum(['open', 'closed']),
  z.strictObject({
    /** The id of the event card, in events.json. */
    event: z.string().min(1),
    /** The ids of the card's choices whose changes don't show the piece. */
    except: z.array(z.string().min(1)).min(1).optional(),
  }),
  z.strictObject({ unavailable: productIdSchema }),
  z.strictObject({ sells: productIdSchema }),
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

// The city (#165): the block of the Plateau seen at an angle, in 2:1
// isometric. The sun is the street's, from the upper left: of a building's
// two walls, the one facing the lower left is lit and the one facing the
// lower right is in shade, and shadows fall to the lower right.

/** A point of the city's design, `[x, y]` in its logical pixels. */
const pointSchema = z.tuple([z.number(), z.number()])

export type CityPoint = z.output<typeof pointSchema>

/** What a piece of the city is, which picks its placeholder. */
export const cityPieceKindSchema = z.enum([
  'ground',
  'park',
  'triplex',
  'building',
  'mill',
  'silo',
  'grocer',
  'bakery',
  'truck',
  'hatch',
  'shutter',
  'sign',
  'windows',
  'contractSign',
])

export type CityPieceKind = z.infer<typeof cityPieceKindSchema>

/**
 * The pieces painted on the lit wall of another (`on`), which the world
 * draws with it. Every other piece is a box standing on the ground.
 */
export const WALL_KINDS: readonly CityPieceKind[] = [
  'hatch',
  'shutter',
  'sign',
  'windows',
  'contractSign',
]

/** The pieces that write their `text`; a sign must have one. */
const CITY_WRITTEN: readonly CityPieceKind[] = ['sign', 'building', 'mill']

/**
 * When a piece of the city shows: while the truck serves or is closed, a
 * minute at a time; on the days the bakery runs, or those it is for rent;
 * or while a grocer's contract runs.
 */
const cityShowsSchema = z.union([
  z.enum(['truckOpen', 'truckClosed', 'bakeryRuns', 'bakeryForRent']),
  z.strictObject({ contract: grocerIdSchema }),
])

export type CityShows = z.output<typeof cityShowsSchema>

/**
 * What a click on a piece opens: « Aller à… », for a trip to the place it
 * names; « Fournil », in « Gérer le camion »; or the « Contrats » screen.
 */
const cityOpensSchema = z.union([
  z.enum(['fournil', 'contracts']),
  z.strictObject({ trip: placeIdSchema }),
])

export type CityOpens = z.output<typeof cityOpensSchema>

const cityPieceSchema = z.strictObject({
  id: z.string().min(1),
  kind: cityPieceKindSchema,
  /** One of the city's `layers`. */
  layer: z.string().min(1),
  /**
   * A box: the top-left corner and the size of the box that holds it on
   * screen, in logical pixels of the design. A piece on a wall: the top of
   * its left edge, how wide it is across and how tall that edge is; it runs
   * down the wall by half its width.
   */
  x: z.number(),
  y: z.number(),
  width: size,
  height: size,
  /**
   * A box's lit wall, how wide across from its left corner to its front
   * corner; its shaded wall takes the rest of `width`. Its walls stand
   * `height` − `width` / 2 tall, so a flat piece is half as tall as wide.
   * Pieces on a wall have none.
   */
  depth: size.optional(),
  /** The placeholder's main colour, also shown when the image fails. */
  color: colorNameSchema,
  /** A second colour: a grocer's awning, the truck's stripe. */
  trim: colorNameSchema.optional(),
  /** A file path under src/world/art/, such as `city/caisse.png`. */
  image: z
    .string()
    .regex(IMAGE_PATH, 'expected a file path under src/world/art/')
    .optional(),
  /** What a sign or a building's board says, in French. */
  text: z
    .string()
    .regex(/^\S(.*\S)?$/, 'expected text without spaces at its ends')
    .optional(),
  /** Shows the piece only at some times; always without it. */
  shows: cityShowsSchema.optional(),
  /** What a click on it opens; nothing without it. */
  opens: cityOpensSchema.optional(),
  /** The place in town it is: the owner's trip there ends at its door. */
  place: placeIdSchema.optional(),
  /** The grocer whose shop it is: the van stops there. */
  grocer: grocerIdSchema.optional(),
  /** The id of the box whose lit wall it is painted on, listed before it. */
  on: z.string().min(1).optional(),
})

export type CityPiece = z.output<typeof cityPieceSchema>

const citySchema = z.strictObject({
  _note: z.string().optional(),
  /** The logical size the city is designed at, before it is scaled. */
  designSize: z.strictObject({
    width: z.int().positive(),
    height: z.int().positive(),
  }),
  /**
   * Layer ids, back to front. They hold the light's shadow layer, which no
   * piece goes in. The layers under it draw their pieces in the order
   * listed; in those over it, the boxes and the people walking are drawn
   * from the farthest to the nearest.
   */
  layers: z.array(z.string().min(1)).min(1),
  pieces: z.array(cityPieceSchema),
  /** Where the truck's people stand. */
  truck: z.strictObject({
    /** Where the owner steps out to walk to a place, and comes back to. */
    counter: pointSchema,
    /**
     * Who serves, in the hatch: the owner at `first`, then each employee
     * at the truck one `step` further.
     */
    window: z.strictObject({ first: pointSchema, step: pointSchema }),
    /** The line: the first customer at `first`, each next one a `step` on. */
    line: z.strictObject({
      first: pointSchema,
      step: pointSchema,
      /** The most in line at once. */
      max: z.int().positive(),
      /**
       * A customer stands in line for this many minutes of the day after
       * they came, as the day replays.
       */
      minutes: z.int().positive(),
    }),
  }),
  /** Each place's way from `truck.counter` to its door, in order. */
  routes: z.record(placeIdSchema, z.array(pointSchema).min(2)),
  /** Monday's delivery van. */
  deliveries: z.strictObject({
    /**
     * The van's way out from where it starts, the bakery when it runs or
     * else the truck, to the street the grocers are on: it parks at the
     * first point, and comes back the same way.
     */
    from: z.strictObject({
      bakery: z.array(pointSchema).min(1),
      truck: z.array(pointSchema).min(1),
    }),
    /** Where the deliverer stands by the van parked there. */
    standAt: z.strictObject({ bakery: pointSchema, truck: pointSchema }),
    /** Where it stops for each grocer. */
    stops: z.record(grocerIdSchema, pointSchema),
    /** When it drives, as shares of the day replayed. */
    window: z.strictObject({ from: share, to: share }),
    /** The van, a box centred on its point, as a box piece is sized. */
    van: z.strictObject({
      width: size,
      height: size,
      depth: size,
      color: colorNameSchema,
      stripe: colorNameSchema,
    }),
  }),
  /** Where the baker stands while the bakery runs. */
  baker: pointSchema,
  /** The tiny people: the owner, the employees and the customers. */
  figure: z.strictObject({
    height: size,
    width: size,
    /** The owner's shirt and apron, as on the street. */
    shirt: colorNameSchema,
    apron: colorNameSchema,
    /** The employees' shirt. */
    staffShirt: colorNameSchema,
    /** The customers' coats, one after the other in line. */
    coats: z.array(colorNameSchema).min(1),
    skins: z.array(hexColor).min(1),
    hair: hexColor,
  }),
  /** The dashed way of the day's trip, on the ground. */
  path: z.strictObject({
    dash: size,
    gap: size,
    width: size,
    color: colorNameSchema,
  }),
  /** « En route vers la Caisse », over its door. */
  label: z.strictObject({
    fontSize: size,
    paddingX: z.number().nonnegative(),
    paddingY: z.number().nonnegative(),
    /** How far over the door the label's foot is. */
    rise: z.number().nonnegative(),
    color: colorNameSchema,
    background: colorNameSchema,
  }),
  /** The words a building's board and a sign are written in. */
  sign: z.strictObject({ fontSize: size, color: colorNameSchema }),
})

export type CityManifest = z.output<typeof citySchema>

/** Checks the city's pieces against its layers, the places and the grocers. */
function checkCity(
  city: CityManifest,
  shadowLayer: string,
  ctx: z.RefinementCtx,
): void {
  const layers = new Set(city.layers)
  if (layers.size !== city.layers.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'duplicate layer',
      path: ['city', 'layers'],
    })
  }
  if (!layers.has(shadowLayer)) {
    ctx.addIssue({
      code: 'custom',
      message: `the city has no layer ${shadowLayer}`,
      path: ['city', 'layers'],
    })
  }
  const boxes = new Map<string, CityPiece>()
  const ids = new Set<string>()
  const places = new Map<PlaceId, number>()
  const grocers = new Map<GrocerId, number>()
  city.pieces.forEach((piece, index) => {
    const at = (key: string) => ['city', 'pieces', index, key]
    const issue = (key: string, message: string) =>
      ctx.addIssue({ code: 'custom', message, path: at(key) })
    if (ids.has(piece.id)) issue('id', `duplicate piece id: ${piece.id}`)
    ids.add(piece.id)
    if (!layers.has(piece.layer))
      issue('layer', `unknown layer: ${piece.layer}`)
    if (piece.layer === shadowLayer) {
      issue('layer', 'the shadow layer holds no piece')
    }
    const onWall = WALL_KINDS.includes(piece.kind)
    if (onWall) {
      const host = piece.on === undefined ? undefined : boxes.get(piece.on)
      if (host === undefined) {
        issue('on', `${piece.kind} pieces go on a box listed before them`)
      } else if (host.layer !== piece.layer) {
        issue('layer', `expected the layer of ${host.id}`)
      }
      if (piece.depth !== undefined) issue('depth', 'a wall has no depth')
    } else {
      if (piece.on !== undefined)
        issue('on', `${piece.kind} pieces stand alone`)
      if (piece.depth === undefined) {
        issue('depth', `${piece.kind} pieces need a depth`)
      } else if (piece.depth >= piece.width) {
        issue('depth', 'the lit wall is narrower than the box')
      }
      if (piece.height < piece.width / 2) {
        issue('height', 'a box is at least half as tall as wide')
      }
      boxes.set(piece.id, piece)
    }
    const written = CITY_WRITTEN.includes(piece.kind)
    if (piece.kind === 'sign' && piece.text === undefined) {
      issue('text', 'sign pieces need a text')
    }
    if (!written && piece.text !== undefined) {
      issue('text', `${piece.kind} pieces write no text`)
    }
    if (piece.place !== undefined) {
      if (onWall) issue('place', 'a place is a box')
      places.set(piece.place, (places.get(piece.place) ?? 0) + 1)
    }
    if (piece.grocer !== undefined) {
      if (piece.kind !== 'grocer') issue('grocer', 'only a grocer is a shop')
      grocers.set(piece.grocer, (grocers.get(piece.grocer) ?? 0) + 1)
    }
    if (piece.kind === 'grocer' && piece.grocer === undefined) {
      issue('grocer', 'a grocer names its grocer')
    }
    if (piece.opens !== undefined && onWall) {
      issue('opens', 'a click opens a box, not what is on its wall')
    }
  })

  // The trip to each place ends at its building, and the van stops at each
  // grocer's shop: one each.
  for (const place of placeIdSchema.options) {
    const count = places.get(place) ?? 0
    if (count !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `expected exactly one building for ${place}, found ${count}`,
        path: ['city', 'pieces'],
      })
    }
  }
  for (const grocer of grocerIdSchema.options) {
    const count = grocers.get(grocer) ?? 0
    if (count !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `expected exactly one shop for ${grocer}, found ${count}`,
        path: ['city', 'pieces'],
      })
    }
  }
  // The world puts the people at the one truck and shows the one bakery.
  for (const kind of ['truck', 'bakery'] as const) {
    const count = city.pieces.filter((piece) => piece.kind === kind).length
    if (count !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: `expected exactly one ${kind} piece, found ${count}`,
        path: ['city', 'pieces'],
      })
    }
  }
  if (city.deliveries.window.from >= city.deliveries.window.to) {
    ctx.addIssue({
      code: 'custom',
      message: 'the van drives after it starts',
      path: ['city', 'deliveries', 'window'],
    })
  }
}

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
    /** The city, drawn with the same palette and light. */
    city: citySchema,
  })
  .superRefine((manifest, ctx) => {
    checkCity(manifest.city, manifest.light.shadowLayer, ctx)

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
