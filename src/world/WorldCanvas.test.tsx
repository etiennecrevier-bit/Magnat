import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import WorldCanvas from './WorldCanvas.tsx'

describe('WorldCanvas', () => {
  it('renders the layer the world is drawn in, hidden from screen readers', () => {
    expect(renderToStaticMarkup(<WorldCanvas />)).toBe(
      '<div class="world" aria-hidden="true"></div>',
    )
  })
})
