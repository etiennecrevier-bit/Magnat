import { describe, expect, it } from 'vitest'
import assetsJson from './assets.json'
import {
  colorNameSchema,
  districtStreetOf,
  loadAssetManifest,
  streetManifest,
  type Shows,
} from './assets.ts'
import {
  loadEventContent,
  loadGrocerContent,
  loadPlacesContent,
  loadStaffContent,
  type GrocerId,
} from './schema.ts'

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

/** The manifest with every district's street's pieces after the Plateau's. */
function everyStreet() {
  const manifest = loadAssetManifest()
  const streets = Object.values(manifest.districtStreets)
  return {
    ...manifest,
    pieces: [
      ...manifest.pieces,
      ...streets.flatMap((street) => street?.pieces ?? []),
    ],
  }
}

describe('assets.json', () => {
  it('loads with every piece in a layer it lists', () => {
    const manifest = loadAssetManifest()
    expect(manifest.designSize).toEqual({ width: 1440, height: 900 })
    expect(manifest.layers).toEqual([
      'sky',
      'far',
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

  it('stands the trees and the lamp post over the shadows, which hold no piece', () => {
    const manifest = loadAssetManifest()
    const { layers, light, pieces } = manifest
    expect(light.shadowLayer).toBe('shadows')
    expect(pieces.filter((p) => p.layer === light.shadowLayer)).toEqual([])
    expect(layers.indexOf('shadows')).toBeGreaterThan(layers.indexOf('street'))
    for (const id of ['tree-1', 'tree-2', 'lamp-post']) {
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
    const { pieces } = loadAssetManifest()
    const kinds = pieces.map((p) => p.kind)
    const count = (kind: string) => kinds.filter((k) => k === kind).length
    // The street's backdrop is art, each piece drawn by its image (#198).
    const images = (file: string) =>
      pieces.filter((p) => p.image === `street/${file}.svg`).length
    for (const triplex of [1, 2, 3, 4]) {
      expect(images(`triplex-${triplex}`), `triplex-${triplex}`).toBe(1)
    }
    expect(images('triplex-1-mirrored')).toBe(1)
    expect(images('triplex-5')).toBe(4)
    for (const file of ['sky', 'far', 'depanneur', 'lamp-post']) {
      expect(images(file), file).toBe(1)
    }
    for (const file of ['cloud-1', 'cloud-2', 'cloud-3', 'tree-1', 'tree-2']) {
      expect(images(file), file).toBe(1)
    }
    for (const file of ['sidewalk', 'curb', 'road']) {
      expect(images(file), file).toBe(3)
    }
    for (const piece of pieces.filter((p) => p.kind === 'backdrop')) {
      expect(piece.image, piece.id).toBeDefined()
    }
    // The truck is art too (#199), each file once, its shadow on the ground
    // under the people's.
    for (const file of [
      'truck',
      'espresso-machine',
      'croissant-rack',
      'croissants',
      'counter',
      'awning',
      'truck-sign',
      'truck-shadow',
    ]) {
      const named = pieces.filter((p) => p.image === `truck/${file}.svg`)
      expect(
        named.map((p) => p.id),
        file,
      ).toEqual([file])
    }
    expect(pieces.find((p) => p.id === 'truck-shadow')).toMatchObject({
      kind: 'backdrop',
      layer: 'street',
    })
    for (const kind of [
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
      'lettering',
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
    const { pieces, fans } = everyStreet()
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
    const { pieces, fans } = everyStreet()
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
      lettering: 'CAFÉ · CROISSANTS',
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
      'owner',
      'stored',
      { season: 'summer' },
      { season: 'winter' },
      { inSeason: 'limonade' },
      { outOfSeason: 'limonade' },
      { rival: true },
      { rival: false },
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

  it('stands the chalkboard on the sidewalk on open days, behind the road sign', () => {
    const { pieces } = loadAssetManifest()
    const chalkboard = pieces.find(({ id }) => id === 'chalkboard')
    expect(chalkboard).toMatchObject({
      layer: 'furniture',
      image: 'street/chalkboard.svg',
      shows: 'open',
    })
    const order = pieces.map(({ id }) => id)
    expect(order.indexOf('chalkboard')).toBeLessThan(order.indexOf('road-sign'))
  })

  it('gives each spot a box, what it opens and its label in French', () => {
    const { spots, streetLegend } = loadAssetManifest()
    expect(spots.map(({ id, piece, shows }) => ({ id, piece, shows }))).toEqual(
      [
        { id: 'menu', piece: 'chalkboard', shows: undefined },
        { id: 'stocks', piece: 'croissant-rack', shows: undefined },
        { id: 'owner', piece: undefined, shows: 'owner' },
        { id: 'employee', piece: undefined, shows: undefined },
        { id: 'city', piece: 'far', shows: undefined },
      ],
    )
    expect(streetLegend).toMatchObject({ days: 3, text: 'Cliquez sur la rue' })
  })
})

describe("Vieux-Montréal's street in assets.json (#264)", () => {
  const manifest = loadAssetManifest()
  const street = districtStreetOf(manifest, 'vieuxMontreal')
  if (street === null) throw new Error('No street for Vieux-Montréal')
  const byId = (id: string) => {
    const found = street.pieces.find((p) => p.id === id)
    if (found === undefined) throw new Error(`No piece ${id}`)
    return found
  }
  const plateau = (id: string) => {
    const found = manifest.pieces.find((p) => p.id === id)
    if (found === undefined) throw new Error(`No Plateau piece ${id}`)
    return found
  }

  it('is the street of every district but the Plateau, whose is the manifest', () => {
    expect(Object.keys(manifest.districtStreets)).toEqual(['vieuxMontreal'])
    expect(districtStreetOf(manifest, 'plateau')).toBeNull()
    expect(streetManifest(manifest, 'plateau')).toBe(manifest)
  })

  it('swaps its pieces, spots, frame and sign in for the Plateau’s', () => {
    const shown = streetManifest(manifest, 'vieuxMontreal')
    expect(shown.pieces).toBe(street.pieces)
    expect(shown.spots).toBe(street.spots)
    expect(shown.frame).toBe(street.frame)
    expect(shown.signText).toMatchObject({ suffix: 'Vieux-Port' })
    expect(shown.layers).toBe(manifest.layers)
    expect(shown.palette).toBe(manifest.palette)
    expect(manifest.signText.suffix).toBeUndefined()
  })

  it('draws every piece in a layer the manifest lists, none in the shadows', () => {
    for (const p of street.pieces) {
      expect(manifest.layers, p.id).toContain(p.layer)
      expect(p.layer, p.id).not.toBe(manifest.light.shadowLayer)
    }
  })

  it('has its winter from December 1st to March 31st', () => {
    expect(street.winter).toEqual({
      from: { month: 12, day: 1 },
      to: { month: 3, day: 31 },
    })
  })

  it('comes in summer and winter art, each season a backdrop of each', () => {
    const seasons = (season: 'summer' | 'winter') =>
      street.pieces
        .filter(
          ({ shows }) =>
            typeof shows === 'object' &&
            'season' in shows &&
            shows.season === season,
        )
        .map(({ id }) => id)
    for (const id of ['sky', 'far', 'building-1', 'building-5', 'lantern']) {
      expect(seasons('summer')).toContain(`${id}-summer`)
      expect(seasons('winter')).toContain(`${id}-winter`)
    }
    expect(seasons('summer')).toEqual(
      expect.arrayContaining(['cloud-1', 'cloud-2']),
    )
    expect(seasons('winter')).toEqual(
      expect.arrayContaining(['road-snow', 'snowbanks', 'roof-snow']),
    )
  })

  it('stands its truck 60 right of the Plateau’s, in teal, with the Plateau’s fittings', () => {
    expect(street.truckOffsetX).toBe(60)
    expect(byId('truck')).toMatchObject({ color: 'teal', x: 600, y: 450 })
    for (const id of [
      'espresso-machine',
      'croissant-rack',
      'croissants',
      'counter',
      'awning',
      'awning-rolled',
      'closed-sign',
      'truck-sign',
      'steam',
    ]) {
      expect(byId(id).x, id).toBe(plateau(id).x + 60)
      expect(byId(id).y, id).toBe(plateau(id).y)
    }
    for (const id of ['espresso-machine', 'croissant-rack', 'awning']) {
      expect(byId(id).image, id).toBe(plateau(id).image)
    }
  })

  it('shows the shutter and its card while stored, the cart open in the rival’s months', () => {
    expect(byId('shutter').shows).toBe('stored')
    expect(byId('stored-sign')).toMatchObject({
      kind: 'storedSign',
      shows: 'stored',
      text: "Fermé pour l'hiver · De retour en {mois}",
    })
    expect(byId('cart').shows).toEqual({ rival: true })
    expect(byId('cart-tarp').shows).toEqual({ rival: false })
    const order = street.pieces.map(({ id }) => id)
    for (const id of ['awning', 'awning-rolled', 'closed-sign', 'counter']) {
      expect(order.indexOf(id), id).toBeLessThan(order.indexOf('shutter'))
    }
    expect(order.indexOf('shutter')).toBeLessThan(order.indexOf('stored-sign'))
  })

  it('letters the truck by the products in season', () => {
    expect(byId('lettering-limonade')).toMatchObject({
      text: 'CAFÉ · CROISSANTS · LIMONADE',
      shows: { inSeason: 'limonade' },
    })
    expect(byId('lettering')).toMatchObject({
      text: 'CAFÉ · CROISSANTS',
      shows: { outOfSeason: 'limonade' },
    })
    expect(byId('lemonade-jar').shows).toEqual({ sells: 'limonade' })
    expect(byId('hot-chocolate-pot').shows).toEqual({ outOfSeason: 'limonade' })
  })

  it('puts up the new cards’ pieces: the festival’s banner, the shoot’s barriers', () => {
    const { events } = loadEventContent()
    const choices = (event: string) =>
      events.find(({ id }) => id === event)?.choices.map(({ id }) => id)
    const festival = { event: 'festivalJazz', except: ['rester'] }
    expect(byId('festival-banner')).toMatchObject({
      text: 'Festival de jazz',
      shows: festival,
    })
    expect(byId('bunting').shows).toEqual(festival)
    expect(choices('festivalJazz')).toContain('rester')
    expect(byId('barriers-left').shows).toEqual({ event: 'tournage' })
    expect(choices('tournage')).toBeDefined()
  })

  it('stands the employee between the truck and the cart', () => {
    const truck = byId('truck')
    const cart = byId('cart')
    expect(street.employeeX).toBeGreaterThan(truck.x + truck.width)
    expect(street.employeeX).toBeLessThan(cart.x)
  })

  it('frames the phone on its truck, 60 right of the Plateau’s', () => {
    expect(street.frame.focus).toEqual({
      ...manifest.frame.focus,
      x: manifest.frame.focus.x + 60,
    })
  })

  it('falls 170 flakes of snow, as the winter target, and crosses a calèche', () => {
    expect(street.snow).toMatchObject({ count: 170, color: 'white' })
    expect(street.caleche).toMatchObject({ image: 'vieux/caleche.svg' })
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
      piece(raw, 'tree-2').id = 'tree-1'
    },
    /duplicate piece id: tree-1/,
  )
  rejects(
    'a spot following a piece the manifest lacks',
    (raw) => {
      ;(raw.spots as Record<string, unknown>[])[0]!.piece = 'ardoise'
    },
    /unknown piece: ardoise/,
  )
  rejects(
    'a duplicate spot id',
    (raw) => {
      ;(raw.spots as Record<string, unknown>[])[1]!.id = 'menu'
    },
    /duplicate spot id: menu/,
  )
  rejects(
    'a spot with an unknown key',
    (raw) => {
      ;(raw.spots as Record<string, unknown>[])[0]!.hover = true
    },
    /spots\[0\]/,
  )
  rejects(
    'a spot opening a tab of a panel other than « Le camion »',
    (raw) => {
      ;(raw.spots as Record<string, unknown>[])[3]!.opens = {
        dock: 'ville',
        tab: 'menu',
      }
    },
    /spots\[3\]\.opens/,
  )
  rejects(
    'a spot following both a piece and its own days',
    (raw) => {
      ;(raw.spots as Record<string, unknown>[])[0]!.shows = 'open'
    },
    /a spot follows its piece, its own shows or the staff, one only/,
  )
  rejects(
    'a spot following both the staff and its own days',
    (raw) => {
      ;(raw.spots as Record<string, unknown>[])[3]!.shows = 'open'
    },
    /a spot follows its piece, its own shows or the staff, one only/,
  )
  rejects(
    'a legend shown no day',
    (raw) => {
      ;(raw.streetLegend as Record<string, unknown>).days = 0
    },
    /streetLegend\.days/,
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
      piece(raw, 'lamp-post').layer = 'park'
    },
    /unknown layer: park/,
  )
  rejects(
    'an unknown colour name',
    (raw) => {
      piece(raw, 'lamp-post').color = 'green'
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
      piece(raw, 'lamp-post').colour = 'foliage'
    },
    /colour/,
  )
  rejects(
    'an unknown piece kind',
    (raw) => {
      piece(raw, 'lamp-post').kind = 'bush'
    },
    /pieces\[\d+\]\.kind/,
  )
  rejects(
    'a size of zero',
    (raw) => {
      piece(raw, 'lamp-post').width = 0
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
    'lettering',
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
      piece(raw, 'lamp-post').text = 'Arbre'
    },
    /backdrop pieces write no text/,
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
      piece(raw, 'lamp-post').layer = 'shadows'
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

  for (const shows of [
    { season: 'spring' },
    { rival: 'yes' },
    { inSeason: 'pizza' },
    'stocked',
  ]) {
    rejects(
      `a piece shown ${JSON.stringify(shows)}`,
      (raw) => {
        piece(raw, 'bunting').shows = shows
      },
      /shows/,
    )
  }

  /** The shipped Vieux-Montréal street, to break. */
  const vieux = (raw: ReturnType<typeof shipped>) =>
    (
      raw.districtStreets as {
        vieuxMontreal: {
          pieces: Record<string, unknown>[]
          spots: Record<string, unknown>[]
          winter: unknown
        }
      }
    ).vieuxMontreal

  rejects(
    'a district without its street',
    (raw) => {
      raw.districtStreets = {}
    },
    /vieuxMontreal has no street/,
  )
  rejects(
    'a street for the Plateau, whose is the manifest’s own',
    (raw) => {
      const streets = raw.districtStreets as Record<string, unknown>
      streets.plateau = streets.vieuxMontreal
    },
    /the Plateau's street is the manifest's own/,
  )
  rejects(
    'a district street with two pieces of one id',
    (raw) => {
      const { pieces } = vieux(raw)
      pieces.push({ ...pieces[0] })
    },
    /duplicate piece id: sky-summer/,
  )
  rejects(
    'a district street with a piece in an unknown layer',
    (raw) => {
      vieux(raw).pieces[0]!.layer = 'moon'
    },
    /unknown layer: moon/,
  )
  rejects(
    'a district street whose spot follows a piece it lacks',
    (raw) => {
      vieux(raw).spots[1]!.piece = 'chalkboard'
    },
    /unknown piece: chalkboard/,
  )
  rejects(
    'a stored sign without its text',
    (raw) => {
      const sign = vieux(raw).pieces.find((p) => p.id === 'stored-sign')
      delete sign?.text
    },
    /storedSign pieces need a text/,
  )
  rejects(
    'a district street with two signs',
    (raw) => {
      const { pieces } = vieux(raw)
      const sign = pieces.find((p) => p.id === 'truck-sign')
      pieces.push({ ...sign, id: 'truck-sign-2' })
    },
    /expected exactly one truckSign piece, found 2/,
  )
  rejects(
    'a district street without its winter',
    (raw) => {
      delete (vieux(raw) as { winter?: unknown }).winter
    },
    /winter/,
  )

  it('names the palette after the colour list', () => {
    expect(Object.keys(loadAssetManifest().palette).sort()).toEqual(
      [...colorNameSchema.options].sort(),
    )
  })
})

type Vec = readonly [number, number]

/**
 * The corners of a city box on the ground, as the manifest's note defines
 * them: its lit wall `depth` across from the left corner to the front one.
 */
function boxCorners(p: {
  x: number
  y: number
  width: number
  height: number
  depth?: number
}) {
  const d = p.depth ?? p.width / 2
  const foot = p.y + p.height
  return {
    left: [p.x, foot - d / 2] as Vec,
    front: [p.x + d, foot] as Vec,
    right: [p.x + p.width, foot - (p.width - d) / 2] as Vec,
  }
}

/** A deep copy of the shipped city to break, one field at a time. */
function shippedCity() {
  const raw = shipped() as ReturnType<typeof shipped> & {
    city: {
      layers: string[]
      pieces: Record<string, unknown>[]
      routes: Record<string, unknown>
      deliveries: { window: { from: number; to: number } } & Record<
        string,
        unknown
      >
    }
  }
  const cityPiece = (id: string) => {
    const found = raw.city.pieces.find((p) => p.id === id)
    if (found === undefined) throw new Error(`No city piece ${id}`)
    return found
  }
  return { raw, cityPiece }
}

/**
 * Where a point of the city's design is on the grid of the reference's
 * `iso2.py`, `[gx, gy]`: 100 by 50 a square, from 720, 170.
 */
function onGrid([x, y]: readonly number[]): Vec {
  const across = (x! - 720) / 50
  const down = (y! - 170) / 25
  return [(across + down) / 2, (down - across) / 2]
}

/** The ground a city box stands on, on the grid: [gx0, gy0, gx1, gy1]. */
function gridFootprint(p: Parameters<typeof boxCorners>[0]) {
  const { left, right } = boxCorners(p)
  const [gx0, gy1] = onGrid(left)
  const [gx1, gy0] = onGrid(right)
  return [gx0, gy0, gx1, gy1] as const
}

/** The reference's avenue, east to west, and its street, north to south. */
const AVENUE = { gy0: 5, gy1: 6 }
const STREET = { gx0: 6, gx1: 7 }

describe('the city in assets.json', () => {
  const { city, light } = loadAssetManifest()
  const places = loadPlacesContent()
  const grocers = loadGrocerContent()
  const named = <K extends 'place' | 'grocer'>(key: K, id: string) =>
    city.pieces.filter((p) => p[key] === id)
  const boxes = city.pieces.filter(
    (p) =>
      p.depth !== undefined &&
      p.on === undefined &&
      p.layer === 'block' &&
      p.kind !== 'scenery',
  )
  const truck = city.pieces.find((p) => p.kind === 'truck')!

  it('lays the sky, the island, the shadows, then the block, in the 1440 × 900 design', () => {
    expect(city.designSize).toEqual({ width: 1440, height: 900 })
    expect(city.layers).toEqual(['sky', 'ground', 'shadows', 'block'])
    expect(city.layers).toContain(light.shadowLayer)
    for (const p of city.pieces) expect(city.layers).toContain(p.layer)
    expect(city.pieces.filter((p) => p.layer === light.shadowLayer)).toEqual([])
    expect(
      city.pieces.filter((p) => p.layer !== 'block').map((p) => p.id),
    ).toEqual(['sky', 'cloud-1', 'cloud-2', 'cloud-3', 'island', 'shadows'])
  })

  it('draws what city-target.svg draws, each from its art', () => {
    const count = (kind: string) =>
      city.pieces.filter((p) => p.kind === kind).length
    expect(count('triplex')).toBe(6)
    // The trees, the lamps, the cones and the cars.
    expect(count('scenery')).toBe(14 + 4 + 5 + 3)
    for (const kind of ['mill', 'silo', 'bakery', 'truck']) {
      expect(count(kind), kind).toBe(1)
    }
    expect(named('place', 'caisse')[0]?.id).toBe('bank')
    expect(named('place', 'bureauPermis')[0]?.id).toBe('permits')
    expect(named('place', 'meunerie')[0]?.kind).toBe('mill')
    // Every piece but those the world draws in code has its image.
    const coded = city.pieces.filter((p) => p.image === undefined)
    expect(coded.map((p) => p.kind).sort()).toEqual(
      [
        'contractSign',
        'contractSign',
        'contractSign',
        'shutter',
        'sign',
        'sign',
        'windows',
        'windows',
        'windows',
      ].sort(),
    )
  })

  it('names no building on its walls: their names show over them', () => {
    expect(
      city.pieces.filter((p) => p.text !== undefined && p.kind !== 'sign'),
    ).toEqual([])
  })

  it('has one building for each place in town, with its way there', () => {
    for (const { id } of places.places) {
      expect(named('place', id), id).toHaveLength(1)
      expect(city.routes[id]?.[0], id).toEqual(city.truck.counter)
    }
  })

  it('ends each way at the door of its place, a step out on the sidewalk', () => {
    for (const { id } of places.places) {
      const building = named('place', id)[0]!
      const corners = boxCorners(building)
      const door = city.routes[id].at(-1)!
      // In front of its lit wall, where iso2.py draws its door.
      const t =
        (door[0] - corners.left[0]) / (corners.front[0] - corners.left[0])
      expect(t, id).toBeGreaterThan(0)
      expect(t, id).toBeLessThan(0.25)
      const foot = corners.left[1] + (corners.front[1] - corners.left[1]) * t
      expect(door[1] - foot, id).toBeGreaterThan(1)
      expect(door[1] - foot, id).toBeLessThan(3)
    }
  })

  it('walks to the Caisse along the reference’s dashed way', () => {
    // city-target.svg: from 720, 410 to 860, 480, then to the bank's door,
    // not to its dot at 927, 446, which is beside it.
    expect(city.routes.caisse.slice(1, 3)).toEqual([
      [720, 410],
      [860, 480],
    ])
  })

  it('keeps each way on the island, through no building but its own at its door', () => {
    for (const { id } of places.places) {
      const route = city.routes[id]
      const own = named('place', id)[0]!.id
      for (let i = 1; i < route.length; i += 1) {
        const [a, b] = [route[i - 1]!, route[i]!]
        for (let k = 0; k <= 20; k += 1) {
          const at = onGrid([
            a[0] + ((b[0] - a[0]) * k) / 20,
            a[1] + ((b[1] - a[1]) * k) / 20,
          ])
          expect(at[0], id).toBeGreaterThanOrEqual(0)
          expect(at[1], id).toBeLessThanOrEqual(12)
          for (const box of boxes) {
            if (box.id === own && i === route.length - 1) continue
            const [gx0, gy0, gx1, gy1] = gridFootprint(box)
            const inside =
              at[0] > gx0 + 0.01 &&
              at[0] < gx1 - 0.01 &&
              at[1] > gy0 + 0.01 &&
              at[1] < gy1 - 0.01
            expect(inside, `${id} through ${box.id}`).toBe(false)
          }
        }
      }
    }
  })

  it('makes the bakery the fournil, which a click opens in « Gérer le camion »', () => {
    const [bakery] = named('place', 'fournil')
    expect(bakery?.kind).toBe('bakery')
    expect(bakery?.opens).toBe('fournil')
    const on = city.pieces.filter((p) => p.on === bakery?.id)
    expect(on.map((p) => [p.kind, p.text, p.shows])).toEqual([
      ['windows', undefined, 'bakeryRuns'],
      ['windows', undefined, 'bakeryRuns'],
      ['windows', undefined, 'bakeryRuns'],
      ['sign', 'À louer', 'bakeryForRent'],
      ['sign', 'Fournil', 'bakeryRuns'],
    ])
    for (const p of on.filter((p) => p.kind === 'windows')) {
      expect(p.color).toBe('lamplight')
    }
    // The reference's board: white, « À LOUER » in red.
    expect(
      on.filter((p) => p.kind === 'sign').map((p) => [p.color, p.trim]),
    ).toEqual([
      ['white', 'dangerRed'],
      ['white', 'ink'],
    ])
  })

  it('opens « Aller à… » from every other place', () => {
    for (const { id } of places.places) {
      if (id === 'fournil') continue
      expect(named('place', id)[0]?.opens, id).toEqual({ trip: id })
    }
  })

  it('has one shop for each grocer, with a stop for the van and a sign for its contract', () => {
    for (const grocer of Object.keys(grocers.grocers)) {
      const shops = named('grocer', grocer)
      expect(shops, grocer).toHaveLength(1)
      expect(shops[0]?.opens).toBe('contracts')
      expect(city.deliveries.stops[grocer as GrocerId], grocer).toBeDefined()
      const signs = city.pieces.filter((p) => p.on === shops[0]?.id)
      expect(
        signs.map((p) => [p.kind, p.shows]),
        grocer,
      ).toEqual([['contractSign', { contract: grocer }]])
    }
  })

  it('opens the hatch and its awning while the truck serves, and shuts it otherwise', () => {
    const on = city.pieces.filter((p) => p.on === truck.id)
    expect(on.map((p) => [p.kind, p.shows])).toEqual([
      ['hatch', 'truckOpen'],
      ['awning', 'truckOpen'],
      ['shutter', 'truckClosed'],
    ])
    expect(truck.opens).toBeUndefined()
    // The shutter shuts the hatch's window.
    const [hatch, , shutter] = on
    expect([shutter!.x, shutter!.y, shutter!.width, shutter!.height]).toEqual([
      hatch!.x,
      hatch!.y,
      hatch!.width,
      hatch!.height,
    ])
  })

  it('stands every building that opens something on the island', () => {
    for (const p of city.pieces.filter((p) => p.opens !== undefined)) {
      const [gx0, gy0, gx1, gy1] = gridFootprint(p)
      expect(Math.min(gx0, gy0), p.id).toBeGreaterThanOrEqual(0)
      expect(Math.max(gx1, gy1), p.id).toBeLessThanOrEqual(12)
    }
  })

  it('stands the line on the sidewalk, as the reference’s three customers', () => {
    const { first, step, max } = city.truck.line
    expect(first).toEqual([680, 380])
    expect(step).toEqual([20, 10])
    for (let i = 0; i < max; i += 1) {
      const [gx, gy] = onGrid([first[0] + step[0] * i, first[1] + step[1] * i])
      expect(gy, `${i}`).toBeLessThan(AVENUE.gy0)
      expect(gx < STREET.gx0 || gx > STREET.gx1, `${i}`).toBe(true)
      expect(Math.min(gx, gy)).toBeGreaterThan(0)
    }
  })

  it('drives the van along the avenue’s south lane, past the truck, to a stop by each shop', () => {
    const { from, stops, window, van } = city.deliveries
    expect(from.bakery.length).toBeGreaterThan(0)
    expect(from.truck.length).toBeGreaterThan(0)
    expect(window.from).toBeLessThan(window.to)
    const [, , truckEast] = gridFootprint(truck)
    // Half the van, along the avenue, in squares.
    const half = van.depth / 50 / 2
    const across = (van.width - van.depth) / 50 / 2
    for (const at of [...from.bakery, ...from.truck, ...Object.values(stops)]) {
      const [gx, gy] = onGrid(at)
      expect(gy - across).toBeGreaterThanOrEqual(AVENUE.gy0)
      expect(gy + across).toBeLessThanOrEqual(AVENUE.gy1)
      expect(gx - half).toBeGreaterThan(truckEast)
      expect(gx + half).toBeLessThanOrEqual(12)
    }
    // Every stop on one lane, so the van drives along it.
    const lanes = new Set(
      [...from.bakery, ...from.truck, ...Object.values(stops)].map((at) =>
        onGrid(at)[1].toFixed(2),
      ),
    )
    expect(lanes.size).toBe(1)
    for (const grocer of Object.keys(grocers.grocers) as GrocerId[]) {
      const [gx0, , gx1] = gridFootprint(named('grocer', grocer)[0]!)
      const [gx] = onGrid(stops[grocer])
      expect(gx, grocer).toBeGreaterThanOrEqual(gx0 - half)
      expect(gx, grocer).toBeLessThanOrEqual(gx1 + half)
    }
  })

  it('stands every baker and deliverer apart at the bakery, however the employees split', () => {
    const { maxEmployees } = loadStaffContent()
    const { deliverers } = city.deliveries
    const row = (
      first: readonly number[],
      step: readonly number[],
      n: number,
    ) =>
      Array.from({ length: n }, (_, i) => [
        first[0]! + step[0]! * i,
        first[1]! + step[1]! * i,
      ])
    for (let bakers = 0; bakers <= maxEmployees; bakers += 1) {
      const spots = [
        ...row(city.bakers.first, city.bakers.step, bakers),
        ...row(deliverers.first.bakery, deliverers.step, maxEmployees - bakers),
      ]
      spots.forEach(([x, y], i) =>
        spots.slice(i + 1).forEach(([u, v]) => {
          // Their feet a shoulder apart, as the line's.
          expect(
            Math.hypot(x! - u!, y! - v!),
            `${bakers} bakers: ${i}`,
          ).toBeGreaterThanOrEqual(13)
        }),
      )
    }
  })

  it('writes the signs in French', () => {
    const texts = city.pieces.flatMap((p) => p.text ?? [])
    expect(texts).toEqual(['À louer', 'Fournil'])
  })
})

describe('loadAssetManifest, the city', () => {
  const rejects = (
    name: string,
    breakIt: (city: ReturnType<typeof shippedCity>) => void,
    message: RegExp,
  ) =>
    it(`rejects ${name}`, () => {
      const broken = shippedCity()
      breakIt(broken)
      expect(() => loadAssetManifest(broken.raw)).toThrow(message)
    })

  rejects(
    'a duplicate piece id',
    ({ cityPiece }) => {
      cityPiece('bank').id = 'mill'
    },
    /duplicate piece id: mill/,
  )
  rejects(
    'a piece in the shadow layer',
    ({ cityPiece }) => {
      cityPiece('bank').layer = 'shadows'
    },
    /the shadow layer holds no piece/,
  )
  rejects(
    'a city without the shadow layer',
    ({ raw }) => {
      raw.city.layers = ['sky', 'ground', 'block']
    },
    /the city has no layer shadows/,
  )
  rejects(
    'a sign on no box',
    ({ cityPiece }) => {
      delete cityPiece('bakery-sign').on
    },
    /sign pieces go on a box listed before them/,
  )
  rejects(
    'a sign on a box listed after it',
    ({ raw, cityPiece }) => {
      const sign = cityPiece('bakery-sign')
      raw.city.pieces.splice(raw.city.pieces.indexOf(sign), 1)
      raw.city.pieces.unshift(sign)
    },
    /sign pieces go on a box listed before them/,
  )
  rejects(
    'a box without a depth',
    ({ cityPiece }) => {
      delete cityPiece('bank').depth
    },
    /building pieces need a depth/,
  )
  rejects(
    'a box less than half as tall as wide',
    ({ cityPiece }) => {
      cityPiece('bank').height = 50
    },
    /a box is at least half as tall as wide/,
  )
  rejects(
    'a second building for a place',
    ({ cityPiece }) => {
      cityPiece('permits').place = 'caisse'
    },
    /exactly one building for caisse, found 2/,
  )
  rejects(
    'a place without a building',
    ({ cityPiece }) => {
      delete cityPiece('rent').place
    },
    /exactly one building for fournil, found 0/,
  )
  rejects(
    'a place without a way there',
    ({ raw }) => {
      delete raw.city.routes.meunerie
    },
    /routes/,
  )
  rejects(
    'a trip to no place',
    ({ cityPiece }) => {
      cityPiece('bank').opens = { trip: 'banque' }
    },
    /opens/,
  )
  rejects(
    'a grocer without a shop',
    ({ cityPiece }) => {
      cityPiece('depanneur-24-24').kind = 'building'
      delete cityPiece('depanneur-24-24').grocer
    },
    /exactly one shop for depanneur2424, found 0/,
  )
  rejects(
    'a contract with no grocer',
    ({ cityPiece }) => {
      cityPiece('chez-normand-contract').shows = { contract: 'iga' }
    },
    /shows/,
  )
  rejects(
    'a link on a wall',
    ({ cityPiece }) => {
      cityPiece('bakery-sign').opens = 'fournil'
    },
    /a click opens a box, not what is on its wall/,
  )
  rejects(
    'text on the truck',
    ({ cityPiece }) => {
      cityPiece('truck').text = 'Le P’tit Camion'
    },
    /truck pieces write no text/,
  )
  rejects(
    'words on a building',
    ({ cityPiece }) => {
      cityPiece('bank').text = 'Caisse populaire'
    },
    /building pieces write no text/,
  )
  rejects(
    'an image drawn at no size',
    ({ cityPiece }) => {
      cityPiece('bank').art = { x: 0, y: 0, width: 0, height: 10 }
    },
    /art/,
  )
  rejects(
    'a backdrop over the shadows',
    ({ cityPiece }) => {
      cityPiece('island').layer = 'block'
    },
    /backdrop pieces go under the shadow layer/,
  )
  rejects(
    'a tree that opens something',
    ({ cityPiece }) => {
      cityPiece('tree-1').opens = 'fournil'
    },
    /a click opens nothing on scenery pieces/,
  )
  rejects(
    'a van that drives before it starts',
    ({ raw }) => {
      raw.city.deliveries.window = { from: 0.5, to: 0.2 }
    },
    /the van drives after it starts/,
  )
  rejects(
    'a second truck',
    ({ raw, cityPiece }) => {
      raw.city.pieces.push({ ...cityPiece('truck'), id: 'truck-2' })
    },
    /expected exactly one truck piece, found 2/,
  )
})
