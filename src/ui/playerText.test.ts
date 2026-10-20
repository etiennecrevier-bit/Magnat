import { describe, expect, it } from 'vitest'

// The panel once called « Le rêve » is « Améliorations » (#207): the word
// is gone from the interface, its comments and docs, and the French text.
// Read from disk; the app's types leave Node's out, hence the cast.
const NODE_FS: string = 'node:fs'
const { readdirSync, readFileSync } = (await import(
  /* @vite-ignore */ NODE_FS
)) as {
  readdirSync: (path: URL, options: { recursive: true }) => string[]
  readFileSync: (path: URL, encoding: 'utf8') => string
}

const UI = new URL('./', import.meta.url)
const CONTENT = new URL('../content/', import.meta.url)

const DREAM_WORD = /(^|[^\p{L}])rêve/iu

/**
 * The files of `folder` named by `keep`, but not the tests, which may say
 * the word is gone.
 */
function files(folder: URL, keep: RegExp): URL[] {
  return readdirSync(folder, { recursive: true })
    .filter((file) => keep.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => new URL(file, folder))
}

describe('the player-facing text', () => {
  it('never says « rêve »', () => {
    const found = [
      ...files(UI, /\.(ts|tsx|css|md)$/),
      ...files(CONTENT, /\.fr\.json$/),
    ].flatMap((url) =>
      readFileSync(url, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          DREAM_WORD.test(line) ? [`${url.pathname}:${i + 1}`] : [],
        ),
    )
    expect(found).toEqual([])
  })
})
