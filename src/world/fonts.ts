import type { UnresolvedAsset } from 'pixi.js'
import fredokaUrl from './fonts/fredoka-latin-600-normal.woff2?url'

/**
 * The font for titles, names and big numbers: Fredoka SemiBold (SIL Open
 * Font License, fonts/OFL.txt), its Latin subset, which holds French.
 */
export const TITLE_FONT = {
  family: 'Fredoka',
  weight: '600',
  /** What text falls back to while the font is missing. */
  fallback: 'sans-serif',
} as const

/**
 * The families a title's text style names. A string, not an array: Pixi
 * quotes the names of an array in place when it draws, which would change a
 * shared one.
 */
export const TITLE_FONT_FAMILY = `${TITLE_FONT.family}, ${TITLE_FONT.fallback}`

/**
 * The title font as Pixi's `Assets` loads it. The family and weight are
 * given, not guessed from the file name, which the build changes.
 */
export const TITLE_FONT_ASSET: UnresolvedAsset = {
  alias: 'title-font',
  src: fredokaUrl,
  parser: 'web-font',
  data: { family: TITLE_FONT.family, weights: [TITLE_FONT.weight] },
}
