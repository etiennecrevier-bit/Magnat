import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ASSETS } from './manifest.ts'
import WorldCanvas from './WorldCanvas.tsx'

// Vitest hands CSS imports to tests empty, `?raw` included, so the test reads
// the stylesheet from disk. The app's types leave Node's out, hence the cast.
const NODE_FS: string = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}
const worldCss = readFileSync(
  new URL('WorldCanvas.css', import.meta.url),
  'utf8',
)

/** The declarations of the first rule for `selector` in `css`, as written. */
function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start))
  return Object.fromEntries(
    body
      .split(';')
      .map((declaration) => declaration.split(':').map((part) => part.trim()))
      .filter(([property]) => property),
  )
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('WorldCanvas', () => {
  it('renders the layer the world is drawn in, hidden from screen readers', () => {
    expect(renderToStaticMarkup(<WorldCanvas />)).toBe(
      '<div class="world" aria-hidden="true"></div>',
    )
  })
})

describe('the panels over the street', () => {
  const card = declarations(worldCss, '.world ~ main')

  it('sit on an opaque card in the palette cream, outlined in ink', () => {
    expect(card.background).toMatch(/^#[0-9a-f]{6}$/)
    expect(card.background).toBe(ASSETS.palette.cream.toLowerCase())
    expect(card.border).toBe(`2px solid ${ASSETS.palette.ink.toLowerCase()}`)
  })

  it('write their text in ink, readable on the card (WCAG AA, 4.5:1)', () => {
    expect(card.color).toBe(ASSETS.palette.ink.toLowerCase())
    expect(contrast(card.color!, card.background!)).toBeGreaterThanOrEqual(4.5)
  })

  it('leave the tables their 40rem beside the street', () => {
    expect(card.width).toBe('42rem')
    expect(card['max-width']).toBe('calc(100% - 2rem)')
  })

  it('span the window on a phone, so the tables keep its whole width', () => {
    const phone = worldCss.slice(worldCss.indexOf('@media (max-width: 559px)'))
    expect(declarations(phone, '.world ~ main')).toEqual({
      width: 'auto',
      'max-width': 'none',
      margin: '0',
      'border-width': '0 0 2px',
      'border-radius': '0',
    })
  })
})
