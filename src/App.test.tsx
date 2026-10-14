import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'

describe('App', () => {
  it('renders the top bar, running at ×1 on day 0, above the main heading', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toMatch(/^<header class="top-bar">.*<\/header><main>/)
    expect(html).toContain('Lundi 1er mai, an 1')
    expect(html).toContain('aria-label="Vitesse normale" aria-pressed="true"')
    expect(html).toMatch(/<main><h1>Magnat<\/h1><\/main>$/)
  })
})
