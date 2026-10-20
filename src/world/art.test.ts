import { Texture, loadSvg, loadTextures } from 'pixi.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssetManifest } from '../content/assets.ts'
import { ART_URLS, loadArt } from './art.ts'
import { ASSETS } from './manifest.ts'

const RESOLUTION = ASSETS.artResolution

/** The shipped manifest with only `images`, given to the pieces they name. */
function withImages(images: Record<string, string>): AssetManifest {
  return {
    ...ASSETS,
    pieces: ASSETS.pieces.map((piece) => ({
      ...piece,
      image: images[piece.id],
    })),
  }
}

describe('ART_URLS', () => {
  it('finds the dummy image shipped under src/world/art/ by its path there', () => {
    const url = ART_URLS.get('dummy.png')
    expect(url).toBe('/src/world/art/dummy.png')
  })

  it('gives URLs Pixi loads as textures, SVG ones through its SVG loader', () => {
    for (const [image, url] of ART_URLS) {
      const parser = image.endsWith('.svg') ? loadSvg : loadTextures
      expect(parser.test?.(url), url).toBe(true)
    }
  })
})

describe('loadArt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("loads each of the shipped street's images once, the SVGs at the art's resolution", async () => {
    const loadTexture = vi.fn(async () => Texture.EMPTY)
    const images = new Set(ASSETS.pieces.flatMap((p) => p.image ?? []))
    expect(images.size).toBeGreaterThan(0)

    const textures = await loadArt(ASSETS.pieces, loadTexture, RESOLUTION)

    expect([...textures.keys()].sort()).toEqual([...images].sort())
    expect(loadTexture).toHaveBeenCalledTimes(images.size)
    for (const image of images) {
      expect(loadTexture).toHaveBeenCalledWith(ART_URLS.get(image), RESOLUTION)
    }
  })

  it('loads other images at their own pixels', async () => {
    const loadTexture = vi.fn(async () => Texture.EMPTY)
    const manifest = withImages({ truck: 'dummy.png', sky: 'street/sky.svg' })

    await loadArt(manifest.pieces, loadTexture, RESOLUTION)

    expect(loadTexture.mock.calls).toEqual(
      expect.arrayContaining([
        [ART_URLS.get('dummy.png')],
        [ART_URLS.get('street/sky.svg'), RESOLUTION],
      ]),
    )
    expect(loadTexture).toHaveBeenCalledTimes(2)
  })

  it('loads each image named in the manifest once, from its URL', async () => {
    const texture = new Texture()
    const loadTexture = vi.fn(async () => texture)
    const manifest = withImages({ truck: 'dummy.png', counter: 'dummy.png' })

    const textures = await loadArt(manifest.pieces, loadTexture, RESOLUTION)

    expect(loadTexture).toHaveBeenCalledExactlyOnceWith(
      ART_URLS.get('dummy.png'),
    )
    expect(textures).toEqual(new Map([['dummy.png', texture]]))
  })

  it('leaves out an image with no file, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loadTexture = vi.fn(async () => Texture.EMPTY)

    const textures = await loadArt(
      withImages({ truck: 'truck/body.png' }).pieces,
      loadTexture,
      RESOLUTION,
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
      withImages({ truck: 'dummy.png' }).pieces,
      loadTexture,
      RESOLUTION,
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
      withImages({ truck: 'truck.webp' }).pieces,
      loadTexture,
      RESOLUTION,
      new Map([['truck.webp', '/assets/truck-1a2b3c.webp']]),
    )
    expect(loadTexture).toHaveBeenCalledExactlyOnceWith(
      '/assets/truck-1a2b3c.webp',
    )
  })
})
