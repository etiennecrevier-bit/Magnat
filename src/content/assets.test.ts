import { describe, expect, it } from 'vitest'
import assetsJson from './assets.json'
import { colorNameSchema, loadAssetManifest } from './assets.ts'

/** A deep copy of the shipped manifest to break, one field at a time. */
function shipped() {
  return structuredClone(assetsJson) as {
    palette: Record<string, string>
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
      'truck',
    ])
    for (const p of manifest.pieces) {
      expect(manifest.layers).toContain(p.layer)
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

  it('shows the awning and steam when open, the rolled awning and sign when closed', () => {
    const shows = Object.fromEntries(
      loadAssetManifest().pieces.map((p) => [p.kind, p.shows]),
    )
    expect(shows).toMatchObject({
      awning: 'open',
      steam: 'open',
      rolledAwning: 'closed',
      closedSign: 'closed',
      truck: undefined,
    })
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
