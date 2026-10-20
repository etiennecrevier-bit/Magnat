import type { RungId } from '../content/schema.ts'

const ART_FOLDER = './art/upgrades/'
const ART_EXTENSION = '.svg'

// Every rung's illustration under ./art/upgrades/, as the URL the build
// serves it at, collected as the portraits are (portraits.ts). A file is
// named after the rung's id in src/content/dream.json: `velo.svg` for the
// rung `velo`. Each is 300 x 150, in the style of
// docs/design/reference/upgrade-*.svg.
const ART_FILES = import.meta.glob<string>('./art/upgrades/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
})

/** Each rung's illustration URL, by its id. */
export const UPGRADE_ART_URLS: ReadonlyMap<string, string> = new Map(
  Object.entries(ART_FILES).map(([file, url]) => [
    file.slice(ART_FOLDER.length, -ART_EXTENSION.length),
    url,
  ]),
)

/** The URL of the rung `id`'s illustration; null when it has none. */
export function upgradeArtUrl(
  id: RungId,
  urls: ReadonlyMap<string, string> = UPGRADE_ART_URLS,
): string | null {
  return urls.get(id) ?? null
}
