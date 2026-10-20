import { describe, expect, it } from 'vitest'
import dreamJson from '../content/dream.json'
import { UPGRADE_ART_URLS, upgradeArtUrl } from './upgradeArt.ts'

// The shipped pictures are read from disk, not from UPGRADE_ART_URLS, as in
// portraits.test.ts: Vitest caches upgradeArt.ts with the files its glob
// matched when first transformed. The app's types leave Node's out, hence
// the cast.
const NODE_FS: string = 'node:fs'
const { readdirSync, readFileSync } = (await import(
  /* @vite-ignore */ NODE_FS
)) as {
  readdirSync: (path: URL) => string[]
  readFileSync: (path: URL, encoding: 'utf8') => string
}

const ART_FOLDER = new URL('./art/upgrades/', import.meta.url)
const REFERENCE_FOLDER = new URL(
  '../../docs/design/reference/',
  import.meta.url,
)

const ART_FILES = readdirSync(ART_FOLDER).filter((file) =>
  file.endsWith('.svg'),
)

const PERSONAL = dreamJson.personal.map(({ id }) => id)
const COMPANY = dreamJson.company.map(({ id }) => id)

/** The reference picture each personal rung's file is a copy of. */
const REFERENCE: Readonly<Record<string, string>> = {
  velo: 'upgrade-velo.svg',
  voitureOccasion: 'upgrade-occasion.svg',
  condo: 'upgrade-condo.svg',
  voitureLuxe: 'upgrade-luxe.svg',
  maison: 'upgrade-maison.svg',
  chalet: 'upgrade-chalet.svg',
}

const read = (file: string) => readFileSync(new URL(file, ART_FOLDER), 'utf8')

describe('upgradeArtUrl', () => {
  it("finds a rung's picture by its id", () => {
    const urls = new Map([['velo', '/assets/velo-abc.svg']])
    expect(upgradeArtUrl('velo', urls)).toBe('/assets/velo-abc.svg')
  })

  it('finds none for a rung with no file', () => {
    expect(upgradeArtUrl('velo', new Map())).toBeNull()
  })

  it('names the shipped pictures by rung id', () => {
    for (const id of UPGRADE_ART_URLS.keys()) {
      expect([...PERSONAL, ...COMPANY]).toContain(id)
    }
  })
})

describe('the shipped pictures', () => {
  it('are one for each rung of both ladders, and no other', () => {
    expect([...ART_FILES].sort()).toEqual(
      [...PERSONAL, ...COMPANY].map((id) => `${id}.svg`).sort(),
    )
  })

  it('are 300 × 150', () => {
    for (const file of ART_FILES) {
      expect(read(file), file).toMatch(
        /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="300" height="150" viewBox="0 0 300 150">/,
      )
    }
  })

  it("copy the reference's pictures for the owner's ladder", () => {
    expect(Object.keys(REFERENCE).sort()).toEqual([...PERSONAL].sort())
    for (const [id, reference] of Object.entries(REFERENCE)) {
      expect(read(`${id}.svg`), id).toBe(
        readFileSync(new URL(reference, REFERENCE_FOLDER), 'utf8'),
      )
    }
  })

  it("draw the company's in the same style: its sky, its ground, a slate shade on the right", () => {
    for (const id of COMPANY) {
      const svg = read(`${id}.svg`)
      expect(svg, id).toContain('<stop offset="0" stop-color="#bfe0ee"/>')
      expect(svg, id).toContain('<stop offset="1" stop-color="#f6e7cf"/>')
      expect(svg, id).toContain(
        '<rect y="118" width="300" height="32" fill="#d8cdb8"/><rect y="118" width="300" height="5" fill="#34404f" opacity=".12"/>',
      )
      const shades = [
        ...svg.matchAll(
          /<(?:rect|path)[^>]*fill="#34404f" opacity="([\d.]+)"/g,
        ),
      ].map((match) => Number(match[1]))
      expect(
        shades.some((opacity) => opacity >= 0.2 && opacity <= 0.35),
        id,
      ).toBe(true)
    }
  })
})
