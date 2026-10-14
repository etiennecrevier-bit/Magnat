import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('opens on the start screen over the world, with no top bar yet', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => {} },
      location: { search: '' },
    })
    const html = renderToStaticMarkup(<App />)
    expect(html).toMatch(
      /^<div class="world" aria-hidden="true"><\/div><main><section class="start-screen"[^>]*><h1[^>]*>Magnat<\/h1>.*<\/section><\/main>$/,
    )
    expect(html).toContain('Nouvelle partie')
    expect(html).not.toContain('class="top-bar"')
    expect(html).not.toContain('class="screen-nav"')
  })
})
