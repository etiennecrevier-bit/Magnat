import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { saying, type CustomerCard } from './customerCard.ts'
import { ASSETS } from './manifest.ts'
import { PICKER, type PickerConnection } from './picker.ts'
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
const topBarCss = readFileSync(
  new URL('../ui/TopBar.css', import.meta.url),
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

const PICKER_CONTROLS =
  '<div class="world-picker" data-world-control="">' +
  '<button type="button" class="world-picker__button">Écouter un client</button>'

const CARD: CustomerCard = {
  segment: 'chic',
  name: 'Clientèle chic',
  mood: 'annoyed',
  line: 'Le prix est audacieux.',
}

describe('WorldCanvas', () => {
  let connection: PickerConnection | null = null
  /** Connects a street to the shared picker that finds `found` customers. */
  const connect = (found: boolean) => {
    connection = PICKER.connect({
      pickAt: () => {},
      isOver: () => found,
      pickNext: () => found,
      unpick: () => {},
    })
    return connection
  }
  afterEach(() => {
    connection?.disconnect()
    connection = null
  })

  it('renders the layer the world is drawn in, hidden from screen readers', () => {
    expect(renderToStaticMarkup(<WorldCanvas />)).toBe(
      '<div class="world" aria-hidden="true"></div>',
    )
  })

  it('adds the picker while a street runs, outside the hidden layer', () => {
    connect(true)
    expect(renderToStaticMarkup(<WorldCanvas />)).toBe(
      '<div class="world" aria-hidden="true"></div>' +
        PICKER_CONTROLS +
        '<p class="world-picker__status" role="status"></p></div>',
    )
  })

  it('shows the open card outside the world layer, and reads it out', () => {
    connect(true).show({
      card: CARD,
      place: { left: 412, bottom: 96, width: 260, side: 'right' },
    })
    const markup = renderToStaticMarkup(<WorldCanvas />)

    // The card comes after the world layer closes, not inside it.
    const card = markup.indexOf('<div class="customer-card"')
    expect(card).toBeGreaterThan(markup.indexOf('</div>'))
    expect(markup.slice(card)).toBe(
      '<div class="customer-card" data-world-control="" aria-hidden="true" ' +
        `style="left:412px;bottom:96px;width:260px;--mood-color:${ASSETS.palette.warningAmber}">` +
        '<p class="customer-card__name">Clientèle chic</p>' +
        '<p class="customer-card__mood">Agacement</p>' +
        '<p class="customer-card__line">«\u00a0Le prix est audacieux.\u00a0»</p>' +
        '</div>',
    )
    expect(markup).toContain(
      `<p class="world-picker__status" role="status">${saying(CARD)}</p>`,
    )
  })

  it('shows the status beside the button when no one is on the street', () => {
    connect(false)
    PICKER.next()
    expect(renderToStaticMarkup(<WorldCanvas />)).toContain(
      '<p class="world-picker__status world-picker__status--shown" role="status">' +
        'Personne dans la rue pour l&#x27;instant.</p>',
    )
  })
})

describe('the customer card', () => {
  const card = declarations(worldCss, '.customer-card')

  it('shows over the panels and the top bar, so neither hides it', () => {
    // The world layer's z-index of -1 puts everything inside it under the
    // panels; the card is fixed on the page instead, stacked over the panels'
    // card (main, not positioned) and the sticky top bar.
    const topBar = declarations(topBarCss, '.top-bar')
    expect(card.position).toBe('fixed')
    expect(Number(card['z-index'])).toBeGreaterThan(Number(topBar['z-index']))
    expect(declarations(worldCss, '.world ~ main')['z-index']).toBeUndefined()
  })

  it('writes in ink on the palette cream, readable (WCAG AA, 4.5:1)', () => {
    expect(card.background).toBe(ASSETS.palette.cream.toLowerCase())
    expect(card.color).toBe(ASSETS.palette.ink.toLowerCase())
    expect(card.border).toBe(`2px solid ${ASSETS.palette.ink.toLowerCase()}`)
    expect(contrast(card.color!, card.background!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the picker', () => {
  it('stays out of sight until it has focus, like a skip link', () => {
    expect(declarations(worldCss, '.world-picker:not(:focus-within)')).toEqual({
      position: 'fixed',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      'clip-path': 'inset(50%)',
      'white-space': 'nowrap',
    })
  })

  it('shows over the panels with focus, in ink on cream', () => {
    const shown = declarations(worldCss, '.world-picker:focus-within')
    expect(shown.position).toBe('fixed')
    expect(Number(shown['z-index'])).toBeGreaterThan(0)
    expect(shown.background).toBe(ASSETS.palette.cream.toLowerCase())
    expect(shown.color).toBe(ASSETS.palette.ink.toLowerCase())
  })

  it('shows a pointer over a customer', () => {
    expect(declarations(worldCss, 'html:has(.world--pointing)')).toEqual({
      cursor: 'pointer',
    })
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
