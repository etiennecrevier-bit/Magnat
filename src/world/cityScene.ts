import { Container, Sprite, type Texture } from 'pixi.js'
import type {
  AssetManifest,
  CityOpens,
  CityPiece,
  CityShows,
} from '../content/assets.ts'
import { WALL_KINDS } from '../content/assets.ts'
import type { GrocerContent } from '../content/schema.ts'
import { GROCERS } from '../engine/contracts.ts'
import type { VisualEffects } from '../ui/settings.ts'
import {
  CITY_PLACEHOLDERS,
  CITY_SHADOWS,
  type CityStyle,
} from './cityPlaceholders.ts'
import { cityShowsOn, showsByMinute, type CityView } from './cityView.ts'
import {
  boxCorners,
  inside,
  rankBoxes,
  silhouette,
  type RankedBox,
  type Vec,
} from './iso.ts'
import { createMaterials } from './materials.ts'
import type { MeasureWidth } from './scene.ts'
import {
  createShadows,
  PIXI_FILTERS,
  type MakeFilters,
  type Shadows,
} from './shadows.ts'

/** The city, built once from the manifest and shown from the game. */
export interface CityScene {
  /**
   * The whole city at its design size: one child per layer, back to front,
   * labelled `layer:<id>`, holding one child per piece standing alone,
   * labelled with its id. A piece on a wall is a child of its box's.
   */
  readonly root: Container
  /**
   * The layer the people walking go in: the last over the shadow layer,
   * where the boxes are drawn from the farthest to the nearest.
   */
  readonly block: Container
  /** The ground, under the shadows: where the trip's way is painted. */
  readonly ground: Container
  /** What the city is drawn with, which its people share. */
  readonly style: CityStyle
  /** The shadows on the ground, where the people add theirs. */
  readonly shadows: Shadows
  /** The boxes of `block`, in the order they are drawn. */
  readonly boxes: readonly RankedBox[]
  /** The truck's own node, where who serves shows in the hatch. */
  readonly truck: Container
  /** Shows the day in `view`: the bakery, the grocers' contracts. */
  update: (view: CityView) => void
  /** Shows the truck serving, its hatch open, or closed. */
  showTruck: (open: boolean) => void
  /**
   * What a click at `point` of the design opens: the link of the nearest
   * box shown there, or null when it opens nothing or no box is there.
   */
  linkAt: (point: Vec) => CityOpens | null
  /** Softens the shadows' edge with the full visual effects only. */
  setEffects: (effects: VisualEffects) => void
  /** Takes the city down, with its textures and filters. */
  destroy: () => void
}

/**
 * Builds the city from `manifest.city`, in its palette and light. Each piece
 * is a container at its position holding its art: the image `textures`
 * holds for it, stretched to its size, or else its placeholder. A piece on
 * a wall goes in its box's container, so it is drawn with it. In the layers
 * under the shadow layer, the pieces are drawn in the order listed; in
 * those over it, the boxes are drawn from the farthest to the nearest (see
 * `rankBoxes`). Only a placeholder throws its shadows on the ground; they
 * show and hide with their piece. A grocer's shop writes the grocer's name
 * from `grocers`. Nothing shows the game until the first `update`.
 */
export function buildCityScene(
  manifest: AssetManifest,
  textures: ReadonlyMap<string, Texture>,
  measureWidth: MeasureWidth = (text) => text.width,
  makeFilters: MakeFilters | null = PIXI_FILTERS,
  grocers: GrocerContent = GROCERS,
): CityScene {
  const { city, light } = manifest
  const materials = createMaterials(light)
  const style: CityStyle = {
    palette: manifest.palette,
    outline: manifest.outlineWidth,
    light,
    materials,
    sign: city.sign,
    measureWidth,
  }
  const root = new Container({ label: 'city' })
  const layers = new Map<string, Container>()
  const over = city.layers.indexOf(light.shadowLayer)
  city.layers.forEach((id, index) => {
    const layer = new Container({
      label: `layer:${id}`,
      sortableChildren: index > over,
    })
    layers.set(id, root.addChild(layer))
  })
  const shadowLayer = layers.get(light.shadowLayer)
  const block = layers.get(city.layers.at(-1) ?? '')
  const ground = layers.get(city.layers[Math.max(0, over - 1)] ?? '')
  if (
    shadowLayer === undefined ||
    block === undefined ||
    ground === undefined
  ) {
    throw new Error(`The city has no layer ${light.shadowLayer}`)
  }
  const shadows = createShadows(shadowLayer, light, materials.spot, makeFilters)

  const standing = city.pieces.filter(
    (piece) => !WALL_KINDS.includes(piece.kind),
  )
  const ranked = new Map<string, RankedBox>()
  for (const id of city.layers.slice(over + 1)) {
    const boxes = standing
      .filter((piece) => piece.layer === id)
      .map((piece) => ({ id: piece.id, corners: boxCorners(piece) }))
    for (const [piece, box] of rankBoxes(boxes)) ranked.set(piece, box)
  }

  const nodes = new Map<string, Container>()
  const switched: {
    shows: CityShows
    byMinute: boolean
    nodes: readonly Container[]
  }[] = []
  const hits: {
    polygon: Vec[]
    node: Container
    opens: CityOpens | null
    layer: number
    rank: number
  }[] = []

  city.pieces.forEach((piece, order) => {
    const host = piece.on === undefined ? undefined : nodes.get(piece.on)
    const node = new Container({
      label: piece.id,
      x: piece.x - (host?.x ?? 0),
      y: piece.y - (host?.y ?? 0),
    })
    const written =
      piece.grocer === undefined
        ? piece
        : { ...piece, text: grocers.grocers[piece.grocer].name }
    const art = node.addChild(drawCityPiece(written, textures, style))
    const box = ranked.get(piece.id)
    if (box !== undefined) node.zIndex = box.rank
    ;(host ?? layers.get(piece.layer))?.addChild(node)
    nodes.set(piece.id, node)

    const thrown =
      art.label === 'placeholder'
        ? (CITY_SHADOWS[piece.kind]?.(piece, shadows, light) ?? [])
        : []
    if (piece.shows !== undefined) {
      switched.push({
        shows: piece.shows,
        byMinute: showsByMinute(piece.shows),
        nodes: [node, ...thrown],
      })
    }
    if (host === undefined) {
      hits.push({
        polygon: silhouette(boxCorners(piece)),
        node,
        opens: piece.opens ?? null,
        layer: city.layers.indexOf(piece.layer),
        rank: box?.rank ?? order,
      })
    }
  })
  // The nearest first: the last layer, then the last drawn in it.
  hits.sort((a, b) => b.layer - a.layer || b.rank - a.rank)

  const truckPiece = city.pieces.find((piece) => piece.kind === 'truck')
  const truck = truckPiece === undefined ? undefined : nodes.get(truckPiece.id)
  if (truck === undefined) throw new Error('The city has no truck')

  let shown: Pick<CityView, 'bakery' | 'contracts'> = {
    bakery: false,
    contracts: [],
  }
  let truckOpen = true
  const show = (byMinute: boolean) => {
    for (const piece of switched) {
      if (piece.byMinute !== byMinute) continue
      const visible = cityShowsOn(piece.shows, shown, truckOpen)
      for (const node of piece.nodes) node.visible = visible
    }
  }
  show(true)
  show(false)

  return {
    root,
    block,
    ground,
    style,
    shadows,
    boxes: [...ranked.values()].sort((a, b) => a.rank - b.rank),
    truck,
    update: (view) => {
      shown = view
      show(false)
    },
    showTruck: (open) => {
      if (open === truckOpen) return
      truckOpen = open
      show(true)
    },
    linkAt: (point) => {
      const hit = hits.find(
        ({ node, polygon }) => node.visible && inside(point, polygon),
      )
      return hit?.opens ?? null
    },
    setEffects: (effects) => shadows.setEffects(effects),
    destroy: () => {
      root.destroy({ children: true })
      shadows.destroy()
      materials.destroy()
    },
  }
}

/**
 * The piece's image stretched to its size, along its wall for a piece on
 * one, or else its placeholder.
 */
function drawCityPiece(
  piece: CityPiece,
  textures: ReadonlyMap<string, Texture>,
  style: CityStyle,
): Container {
  const texture =
    piece.image === undefined ? undefined : textures.get(piece.image)
  if (texture === undefined) {
    const placeholder = CITY_PLACEHOLDERS[piece.kind](piece, style)
    placeholder.label = 'placeholder'
    return placeholder
  }
  const sprite = new Sprite({ texture, label: 'image' })
  sprite.setSize(piece.width, piece.height)
  if (!WALL_KINDS.includes(piece.kind)) return sprite
  const slope = Math.atan(0.5)
  const wall = new Container({
    label: 'image',
    skew: { x: 0, y: slope },
    scale: { x: 1 / Math.cos(slope), y: 1 },
  })
  wall.addChild(sprite)
  return wall
}
