import type { Texture } from 'pixi.js'
import type { AssetManifest } from '../content/assets.ts'

const ART_FOLDER = './art/'

// Every image under ./art/, as the URL the build serves it at. Vite collects
// them when it builds, so adding a file there and naming it in the manifest
// is enough. The extensions are IMAGE_EXTENSIONS in src/content/assets.ts.
const ART_FILES = import.meta.glob<string>(
  './art/**/*.{png,jpg,jpeg,webp,avif,svg}',
  { eager: true, query: '?url', import: 'default' },
)

/** Each art file's URL, by its path under src/world/art/: `truck.png`. */
export const ART_URLS: ReadonlyMap<string, string> = new Map(
  Object.entries(ART_FILES).map(([file, url]) => [
    file.slice(ART_FOLDER.length),
    url,
  ]),
)

/** Loads the image at `url` as a texture, as Pixi's `Assets.load` does. */
export type LoadTexture = (url: string) => Promise<Texture>

/**
 * Loads the image of every piece that names one, each file once, and
 * returns the textures by image path. An image with no file under
 * src/world/art/, or that fails to load, is left out with a warning, and its
 * pieces keep their placeholders.
 */
export async function loadArt(
  manifest: AssetManifest,
  loadTexture: LoadTexture,
  urls: ReadonlyMap<string, string> = ART_URLS,
): Promise<ReadonlyMap<string, Texture>> {
  const images = new Set(manifest.pieces.flatMap((piece) => piece.image ?? []))
  const textures = new Map<string, Texture>()
  await Promise.all(
    [...images].map(async (image) => {
      const url = urls.get(image)
      if (url === undefined) {
        console.warn(
          `No file src/world/art/${image}; its pieces keep their placeholders.`,
        )
        return
      }
      try {
        textures.set(image, await loadTexture(url))
      } catch (error) {
        console.warn(
          `src/world/art/${image} could not load; its pieces keep their placeholders.`,
          error,
        )
      }
    }),
  )
  return textures
}
