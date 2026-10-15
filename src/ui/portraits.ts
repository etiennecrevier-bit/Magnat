const PORTRAIT_FOLDER = './portraits/'
const PORTRAIT_EXTENSION = '.png'

// Every portrait under ./portraits/, as the URL the build serves it at,
// collected by Vite as the world's art is (src/world/art.ts). A file is
// named after the character's id in src/content/events.json:
// `gilles.png` for the character `gilles`.
const PORTRAIT_FILES = import.meta.glob<string>('./portraits/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})

/** Each portrait's URL, by the id of its character. */
export const PORTRAIT_URLS: ReadonlyMap<string, string> = new Map(
  Object.entries(PORTRAIT_FILES).map(([file, url]) => [
    file.slice(PORTRAIT_FOLDER.length, -PORTRAIT_EXTENSION.length),
    url,
  ]),
)

/** The URL of `character`'s portrait; null when it has none yet. */
export function portraitUrl(
  character: string,
  urls: ReadonlyMap<string, string> = PORTRAIT_URLS,
): string | null {
  return urls.get(character) ?? null
}
