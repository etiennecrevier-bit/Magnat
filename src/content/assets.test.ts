import { describe, expect, it } from 'vitest'
import assetsJson from './assets.json'
import { colorNameSchema, loadAssetManifest, type Shows } from './assets.ts'
import { loadEventContent } from './schema.ts'

/** A deep copy of the shipped manifest to break, one field at a time. */
function shipped() {
  return structuredClone(assetsJson) as {
    palette: Record<string, string>
    light: typeof assetsJson.light & Record<string, unknown>
    layers: string[]
    pieces: Record<string, unknown>[]
    [key: string]: unknown
  }
}

function piece(raw: ReturnType<typeof shipped>, id: string) {
  const found = raw.pieces.find((p) => p.id === id)
  if (found === undefined) throw new Error(`No piece ${id}`)
  return found
}

describe('assets.json', () => {
  it('loads with every piece in a layer it lists', () => {
    const manifest = loadAssetManifest()
    expect(manifest.designSize).toEqual({ width: 1440, height: 900 })
    expect(manifest.layers).toEqual([
      'sky',
      'rooftops',
      'buildings',
      'sidewalk',
      'street',
      'shadows',
      'furniture',
      'truck',
    ])
    for (const p of manifest.pieces) {
      expect(manifest.layers).toContain(p.layer)
    }
  })

  it('stands the tree and the lamp post over the shadows, which hold no piece', () => {
    const manifest = loadAssetManifest()
    const { layers, light, pieces } = manifest
    expect(light.shadowLayer).toBe('shadows')
    expect(pieces.filter((p) => p.layer === light.shadowLayer)).toEqual([])
    expect(layers.indexOf('shadows')).toBeGreaterThan(layers.indexOf('street'))
    for (const id of ['tree', 'lamp-post']) {
      expect(pieces.find((p) => p.id === id)?.layer, id).toBe('furniture')
    }
  })

  it('holds the light of the rule sheet', () => {
    const { light, palette } = loadAssetManifest()
    expect(light).toMatchObject({
      sun: '#FFF1CF',
      slate: '#34404F',
      topFace: { light: 0.22 },
      litSide: { topLight: 0.26, footSlate: 0.3 },
      shadeSide: { slate: 0.4 },
      castShadow: { opacity: 0.38, blur: 2 },
      ledgeShadow: { opacity: 0.55 },
      material: { lineOpacity: { min: 0.12, max: 0.2 } },
      unevenness: { blend: 'soft-light', opacity: 0.3 },
      grain: { blend: 'overlay', opacity: 0.4 },
      vignette: { color: 'ink', opacity: 0.26, clear: 0.62 },
    })
    expect(palette.ink).toBe('#2B2622')
    expect(palette.asphalt).toBe('#5C5752')
    for (const opacity of Object.values(light.contactShadow.opacity)) {
      expect(opacity).toBeGreaterThanOrEqual(0.45)
      expect(opacity).toBeLessThanOrEqual(0.55)
    }
    for (const depth of Object.values(light.ledgeShadow.depth)) {
      expect(depth).toBeLessThanOrEqual(30)
    }
  })

  it('holds the art brief palette', () => {
    expect(loadAssetManifest().palette).toMatchObject({
      ink: '#2B2622',
      cream: '#FFF7E8',
      sky: '#CFE8F3',
      brickRed: '#B4532F',
      brickDark: '#9E4A2C',
      brickLight: '#C06A43',
      mustard: '#E8A93A',
      sidewalk: '#D8D0C2',
      moneyGreen: '#2E7D4F',
      warningAmber: '#C27A00',
      dangerRed: '#B3261E',
      playerBlue: '#2F6FB0',
    })
  })

  it('draws the scene the card asks for', () => {
    const kinds = loadAssetManifest().pieces.map((p) => p.kind)
    const count = (kind: string) => kinds.filter((k) => k === kind).length
    expect(count('triplex')).toBe(5)
    expect(count('cloud')).toBeGreaterThan(0)
    for (const kind of [
      'rooftops',
      'sidewalk',
      'lampPost',
      'tree',
      'street',
      'laneMarkings',
      'truck',
      'counter',
      'rack',
      'croissants',
      'espressoMachine',
      'steam',
      'pot',
      'awning',
      'rolledAwning',
      'closedSign',
      'truckSign',
    ]) {
      expect(count(kind), kind).toBe(1)
    }
  })

  it('shows the awning when open, the steam while café sells, the rolled awning and sign when closed', () => {
    const shows = Object.fromEntries(
      loadAssetManifest().pieces.map((p) => [p.kind, p.shows]),
    )
    expect(shows).toMatchObject({
      awning: 'open',
      steam: { sells: 'cafe' },
      rolledAwning: 'closed',
      closedSign: 'closed',
      truck: undefined,
    })
  })

  it('shows each change to the street on its pieces, and the fans in a heat wave', () => {
    const { pieces, fans } = loadAssetManifest()
    const shows = Object.fromEntries(pieces.map((p) => [p.id, p.shows]))
    expect(shows).toMatchObject({
      'heat-sky': { event: 'canicule' },
      'cones-left': { event: 'conesOrange' },
      'cones-right': { event: 'conesOrange' },
      'road-sign': { event: 'conesOrange' },
      'rival-truck': { event: 'concurrence' },
      bunting: { event: 'festival' },
      'festival-banner': { event: 'festival' },
      'out-of-order': { unavailable: 'cafe' },
    })
    expect(fans.shows).toEqual({ event: 'canicule' })
  })

  it('names only event cards that exist', () => {
    const { pieces, fans } = loadAssetManifest()
    const cards = new Set(loadEventContent().events.map(({ id }) => id))
    const named = [...pieces.map((p) => p.shows), fans.shows].flatMap(
      (shows?: Shows) =>
        shows !== undefined && typeof shows === 'object' && 'event' in shows
          ? [shows.event]
          : [],
    )
    expect(named.length).toBeGreaterThan(0)
    for (const event of named) expect(cards, event).toContain(event)
  })

  it("names only the card's own choices in `except`", () => {
    const { pieces, fans } = loadAssetManifest()
    const { events } = loadEventContent()
    const except = [...pieces.map((p) => p.shows), fans.shows].flatMap(
      (shows?: Shows) =>
        shows !== undefined && typeof shows === 'object' && 'event' in shows
          ? (shows.except ?? []).map((choice) => [shows.event, choice])
          : [],
    )
    expect(except).toContainEqual(['conesOrange', 'changerDeCoin'])
    for (const [event, choice] of except) {
      const choices = events
        .find(({ id }) => id === event)
        ?.choices.map(({ id }) => id)
      expect(choices, `${event} ${choice}`).toContain(choice)
    }
  })

  it('writes the signs in French', () => {
    const text = Object.fromEntries(
      loadAssetManifest().pieces.map((p) => [p.id, p.text]),
    )
    expect(text).toMatchObject({
      'road-sign': 'Rue barrée',
      'rival-truck': 'La Patate Pressée',
      'festival-banner': 'Festival du Pas Pire',
      'out-of-order': 'Hors service',
      truck: undefined,
    })
  })

  it('accepts each way a piece shows', () => {
    for (const shows of [
      'open',
      'closed',
      { event: 'festival' },
      { event: 'conesOrange', except: ['changerDeCoin'] },
      { unavailable: 'croissant' },
      { sells: 'cafe' },
    ]) {
      const raw = shipped()
      piece(raw, 'bunting').shows = shows
      expect(() => loadAssetManifest(raw), JSON.stringify(shows)).not.toThrow()
    }
  })

  it('accepts an image path under the art folder', () => {
    const raw = shipped()
    piece(raw, 'truck').image = 'truck/body.png'
    piece(raw, 'counter').image = 'counter-2.webp'
    expect(() => loadAssetManifest(raw)).not.toThrow()
  })
})

describe('loadAssetManifest', () => {
  const rejects = (
    name: string,
    breakIt: (raw: ReturnType<typeof shipped>) => void,
    message: RegExp,
  ) =>
    it(`rejects ${name}`, () => {
      const raw = shipped()
      breakIt(raw)
      expect(() => loadAssetManifest(raw)).toThrow(message)
    })

  rejects(
    'a duplicate piece id',
    (raw) => {
      piece(raw, 'cloud-2').id = 'cloud-1'
    },
    /duplicate piece id: cloud-1/,
  )
  rejects(
    'a duplicate layer',
    (raw) => {
      raw.layers.push('sky')
    },
    /duplicate layer: sky/,
  )
  rejects(
    'a piece in an unknown layer',
    (raw) => {
      piece(raw, 'tree').layer = 'park'
    },
    /unknown layer: park/,
  )
  rejects(
    'an unknown colour name',
    (raw) => {
      piece(raw, 'tree').color = 'green'
    },
    /pieces\[\d+\]\.color/,
  )
  rejects(
    'a palette missing a colour',
    (raw) => {
      delete raw.palette.wood
    },
    /palette\.wood/,
  )
  rejects(
    'a colour that is not #RRGGBB',
    (raw) => {
      raw.palette.ink = '#2B26'
    },
    /palette\.ink/,
  )
  rejects(
    'an unknown key',
    (raw) => {
      piece(raw, 'tree').colour = 'foliage'
    },
    /colour/,
  )
  rejects(
    'an unknown piece kind',
    (raw) => {
      piece(raw, 'tree').kind = 'bush'
    },
    /pieces\[\d+\]\.kind/,
  )
  rejects(
    'a size of zero',
    (raw) => {
      piece(raw, 'tree').width = 0
    },
    /pieces\[\d+\]\.width/,
  )
  rejects(
    'a missing truck sign',
    (raw) => {
      raw.pieces = raw.pieces.filter((p) => p.kind !== 'truckSign')
    },
    /exactly one truckSign piece, found 0/,
  )
  rejects(
    'a second truck sign',
    (raw) => {
      raw.pieces.push({ ...piece(raw, 'truck-sign'), id: 'truck-sign-2' })
    },
    /exactly one truckSign piece, found 2/,
  )
  rejects(
    'missing croissants',
    (raw) => {
      raw.pieces = raw.pieces.filter((p) => p.kind !== 'croissants')
    },
    /exactly one croissants piece, found 0/,
  )
  rejects(
    'a second croissants piece',
    (raw) => {
      raw.pieces.push({ ...piece(raw, 'croissants'), id: 'croissants-2' })
    },
    /exactly one croissants piece, found 2/,
  )
  rejects(
    'croissants without a fill',
    (raw) => {
      delete piece(raw, 'croissants').fill
    },
    /the croissants need a fill/,
  )
  rejects(
    'a fill on another piece',
    (raw) => {
      piece(raw, 'counter').fill = { capacity: 10, steps: 2 }
    },
    /only the croissants fill with stock/,
  )
  rejects(
    'a fill of zero steps',
    (raw) => {
      piece(raw, 'croissants').fill = { capacity: 100, steps: 0 }
    },
    /fill\.steps/,
  )

  rejects(
    'a piece shown while an unknown product cannot be sold',
    (raw) => {
      piece(raw, 'out-of-order').shows = { unavailable: 'poutine' }
    },
    /pieces\[\d+\]\.shows/,
  )
  rejects(
    'a piece shown while an unknown product sells',
    (raw) => {
      piece(raw, 'steam').shows = { sells: 'poutine' }
    },
    /pieces\[\d+\]\.shows/,
  )
  rejects(
    'a piece shown with an empty event',
    (raw) => {
      piece(raw, 'bunting').shows = { event: '' }
    },
    /pieces\[\d+\]\.shows/,
  )
  rejects(
    'a piece shown with an empty except',
    (raw) => {
      piece(raw, 'road-sign').shows = { event: 'conesOrange', except: [] }
    },
    /pieces\[\d+\]\.shows/,
  )
  rejects(
    'a piece shown with an unknown key',
    (raw) => {
      piece(raw, 'bunting').shows = { event: 'festival', days: 3 }
    },
    /pieces\[\d+\]\.shows/,
  )
  rejects(
    'a piece shown on some other kind of day',
    (raw) => {
      piece(raw, 'awning').shows = 'weekend'
    },
    /pieces\[\d+\]\.shows/,
  )
  for (const id of [
    'road-sign',
    'rival-truck',
    'festival-banner',
    'out-of-order',
  ]) {
    rejects(
      `the ${id} without its text`,
      (raw) => {
        delete piece(raw, id).text
      },
      /pieces need a text/,
    )
  }
  rejects(
    'a text on a piece that writes none',
    (raw) => {
      piece(raw, 'tree').text = 'Arbre'
    },
    /tree pieces write no text/,
  )
  rejects(
    'an empty text',
    (raw) => {
      piece(raw, 'road-sign').text = ''
    },
    /expected text without spaces at its ends/,
  )
  rejects(
    'a text with a space at its end',
    (raw) => {
      piece(raw, 'road-sign').text = 'Rue barrée '
    },
    /expected text without spaces at its ends/,
  )
  rejects(
    'a fan chance above 1',
    (raw) => {
      ;(raw.fans as { chance: number }).chance = 1.5
    },
    /fans\.chance/,
  )
  rejects(
    'fans in an unknown colour',
    (raw) => {
      ;(raw.fans as { color: string }).color = 'pink'
    },
    /fans\.color/,
  )
  rejects(
    'fans that never swing back',
    (raw) => {
      ;(raw.fans as { periodMs: number }).periodMs = 0
    },
    /fans\.periodMs/,
  )

  rejects(
    'an opacity above 1',
    (raw) => {
      raw.light.castShadow.opacity = 1.2
    },
    /light\.castShadow\.opacity/,
  )
  rejects(
    'a light colour that is not #RRGGBB',
    (raw) => {
      raw.light.slate = 'slate'
    },
    /light\.slate/,
  )
  rejects(
    'a grain blended any other way',
    (raw) => {
      ;(raw.light.grain as { blend: string }).blend = 'multiply'
    },
    /light\.grain\.blend/,
  )
  rejects(
    'a shadow layer the manifest does not list',
    (raw) => {
      raw.light.shadowLayer = 'ground'
    },
    /unknown layer: ground/,
  )
  rejects(
    'a piece in the shadow layer',
    (raw) => {
      piece(raw, 'tree').layer = 'shadows'
    },
    /the shadow layer holds no piece/,
  )
  rejects(
    'material lines whose least opacity is above the most',
    (raw) => {
      raw.light.material.lineOpacity = { min: 0.3, max: 0.2 }
    },
    /the least line opacity is above the most/,
  )

  for (const image of [
    '/truck.png',
    './truck.png',
    '../truck.png',
    'art/../truck.png',
    'truck.gif',
    'truck',
  ]) {
    rejects(
      `the image path ${image}`,
      (raw) => {
        piece(raw, 'truck').image = image
      },
      /expected a file path under src\/world\/art\//,
    )
  }

  it('names the palette after the colour list', () => {
    expect(Object.keys(loadAssetManifest().palette).sort()).toEqual(
      [...colorNameSchema.options].sort(),
    )
  })
})
