import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'

describe('App', () => {
  it('renders only the Magnat placeholder heading', () => {
    expect(renderToStaticMarkup(<App />)).toBe('<h1>Magnat</h1>')
  })
})
