import { Texture, loadTextures } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetManifest } from '../content/assets.ts'
import { ART_URLS, loadArt } from './art.ts'
import { ASSETS } from './manifest.ts'

/** The shipped manifest with `images` given to the pieces they name. */
function withImages(images: Record<string, string>): AssetManifest {
  return {
    ...ASSETS,
    pieces: ASSETS.pieces.map((piece) =>
      piece.id in images ? { ...piece, image: images[piece.id] } : piece,
    ),
  }
}

describe('ART_URLS', () => {
  it('finds the dummy image shipped under src/world/art/ by its path there', () => {
    const url = ART_URLS.get('dummy.png')
    expect(url).toBe('/src/world/art/dummy.png')
  })

  it('gives URLs Pixi loads as textures', () => {
    for (const url of ART_URLS.values()) {
      expect(loadTextures.test?.(url), url).toBe(true)
    }
  })
})

describe('loadArt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads nothing for the shipped manifest, which is all placeholders', async () => {
    const loadTexture = vi.fn(async () => Texture.EMPTY)
    expect(await loadArt(ASSETS, loadTexture)).toEqual(new Map())
    expect(loadTexture).not.toHaveBeenCalled()
  })

  it('loads each image named in the manifest once, from its URL', async () => {
    const texture = new Texture()
    const loadTexture = vi.fn(async () => texture)
    const manifest = withImages({ truck: 'dummy.png', counter: 'dummy.png' })

    const textures = await loadArt(manifest, loadTexture)

    expect(loadTexture).toHaveBeenCalledExactlyOnceWith(
      ART_URLS.get('dummy.png'),
    )
    expect(textures).toEqual(new Map([['dummy.png', texture]]))
  })

  it('leaves out an image with no file, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loadTexture = vi.fn(async () => Texture.EMPTY)

    const textures = await loadArt(
      withImages({ truck: 'truck/body.png' }),
      loadTexture,
    )

    expect(textures.size).toBe(0)
    expect(loadTexture).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('src/world/art/truck/body.png'),
    )
  })

  it('leaves out an image that fails to load, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('404')
    const loadTexture = vi.fn(async () => Promise.reject<Texture>(error))

    const textures = await loadArt(
      withImages({ truck: 'dummy.png' }),
      loadTexture,
    )

    expect(textures.size).toBe(0)
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('src/world/art/dummy.png'),
      error,
    )
  })

  it('resolves paths against the URLs it is given', async () => {
    const loadTexture = vi.fn(async () => Texture.EMPTY)
    await loadArt(
      withImages({ truck: 'truck.webp' }),
      loadTexture,
      new Map([['truck.webp', '/assets/truck-1a2b3c.webp']]),
    )
    expect(loadTexture).toHaveBeenCalledExactlyOnceWith(
      '/assets/truck-1a2b3c.webp',
    )
  })
})
