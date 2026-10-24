import { describe, expect, it } from 'vitest'
import eventsJson from '../content/events.json'
import staffJson from '../content/staff.json'
import { TUTORIAL } from '../engine/tutorial.ts'
import { BANKER, PORTRAIT_URLS, portraitUrl } from './portraits.ts'

// The shipped portraits are read from disk, not from PORTRAIT_URLS: Vitest
// caches portraits.ts as first transformed, with the files its glob matched
// then, so the map can miss a portrait added or renamed since. The app's types
// leave Node's out, hence the cast.
const NODE_FS: string = 'node:fs'
const { readdirSync, readFileSync } = (await import(
  /* @vite-ignore */ NODE_FS
)) as {
  readdirSync: (path: URL) => string[]
  readFileSync: (path: URL) => Uint8Array
}

const PORTRAIT_FOLDER = new URL('./portraits/', import.meta.url)

/** Every portrait the game ships: the PNGs that portraits.ts collects. */
const PORTRAIT_FILES = readdirSync(PORTRAIT_FOLDER).filter((file) =>
  file.endsWith('.png'),
)

// The card shows a portrait at 96 px; 512 px is plenty for any screen.
const MAX_PORTRAIT_SIDE = 512
const MAX_PORTRAIT_BYTES = 400_000

// The card that checks the cards, which the player never sees.
const TEST_CHARACTER = 'essai'

// Characters whose portrait is not drawn yet: their card shows the silhouette.
// Take a character off the list when its file lands.
// Rita Esposito's (#262) waits for its file on #263.
const AWAITING_PORTRAIT: readonly string[] = ['ritaEsposito']

const CHARACTERS: readonly string[] = [
  ...new Set(eventsJson.events.map((event) => event.character.id)),
]

const CANDIDATE_PORTRAITS: readonly string[] = Object.values(
  staffJson.candidates,
).map((candidate) => candidate.portrait)

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The width and height of a PNG, from its IHDR chunk; null for no PNG. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('portraitUrl', () => {
  it("finds a character's portrait by its id", () => {
    const urls = new Map([['gilles', '/assets/gilles-abc.png']])
    expect(portraitUrl('gilles', urls)).toBe('/assets/gilles-abc.png')
  })

  it('finds none for a character with no file', () => {
    expect(portraitUrl('personne', new Map())).toBeNull()
  })

  it('names the shipped portraits by character id', () => {
    for (const id of PORTRAIT_URLS.keys()) {
      expect(id).toMatch(/^[a-z][A-Za-z0-9]*$/)
    }
  })
})

describe('the shipped portraits', () => {
  it('include one for every character of the event cards', () => {
    const missing = CHARACTERS.filter(
      (id) =>
        id !== TEST_CHARACTER &&
        !AWAITING_PORTRAIT.includes(id) &&
        !PORTRAIT_FILES.includes(`${id}.png`),
    )
    expect(missing).toEqual([])
  })

  it('include one for every candidate of staff.json', () => {
    const missing = CANDIDATE_PORTRAITS.filter(
      (id) => !PORTRAIT_FILES.includes(`${id}.png`),
    )
    expect(missing).toEqual([])
  })

  it("include the banker's, which the reports' advice shows", () => {
    expect(PORTRAIT_FILES).toContain(`${BANKER}.png`)
  })

  it("include Réal's, which the tour's bubble and his postcards show", () => {
    expect(PORTRAIT_FILES).toContain(`${TUTORIAL.coach.character}.png`)
  })

  it('leave out only characters that are on a card and have no file', () => {
    for (const id of AWAITING_PORTRAIT) {
      expect(CHARACTERS).toContain(id)
      expect(PORTRAIT_FILES).not.toContain(`${id}.png`)
    }
  })

  it(`are PNGs of at most ${MAX_PORTRAIT_SIDE} × ${MAX_PORTRAIT_SIDE} px`, () => {
    const wrong = PORTRAIT_FILES.flatMap((file) => {
      const size = pngSize(readFileSync(new URL(file, PORTRAIT_FOLDER)))
      if (size === null) return [`${file}: not a PNG`]
      return size.width > MAX_PORTRAIT_SIDE || size.height > MAX_PORTRAIT_SIDE
        ? [`${file}: ${size.width} × ${size.height}`]
        : []
    })
    expect(wrong).toEqual([])
  })

  it(`weigh at most ${MAX_PORTRAIT_BYTES} bytes each`, () => {
    const tooHeavy = PORTRAIT_FILES.flatMap((file) => {
      const bytes = readFileSync(new URL(file, PORTRAIT_FOLDER)).byteLength
      return bytes > MAX_PORTRAIT_BYTES ? [`${file}: ${bytes} bytes`] : []
    })
    expect(tooHeavy).toEqual([])
  })
})
