import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import GameScreens, { GameScreensView, type Screen } from './GameScreens.tsx'

function render(screen: Screen) {
  return renderToStaticMarkup(
    <GameScreensView screen={screen} onScreenChange={() => {}} />,
  )
}

/** Each screen button's text and pressed state, in order. */
function screenButtons(html: string) {
  const nav = /<nav[^>]*>.*<\/nav>/.exec(html)?.[0] ?? ''
  return [...nav.matchAll(/aria-pressed="(true|false)">([^<]*)</g)].map(
    ([, pressed, label]) => ({ label, pressed }),
  )
}

describe('GameScreensView', () => {
  it("shows the Aujourd'hui panel under a labelled screen menu", () => {
    const html = render('today')
    expect(html).toMatch(/^<main><nav class="screen-nav" aria-label="Écrans">/)
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'true' },
      { label: 'États financiers', pressed: 'false' },
    ])
    expect(html).toContain('<h1>Aujourd&#x27;hui</h1>')
    expect(html).not.toContain('<h1>États financiers</h1>')
  })

  it('shows the États financiers screen', () => {
    const html = render('statements')
    expect(screenButtons(html)).toEqual([
      { label: 'Aujourd&#x27;hui', pressed: 'false' },
      { label: 'États financiers', pressed: 'true' },
    ])
    expect(html).toContain('<h1>États financiers</h1>')
    expect(html).not.toContain('<h1>Aujourd&#x27;hui</h1>')
  })
})

describe('GameScreens', () => {
  it("opens on Aujourd'hui", () => {
    expect(renderToStaticMarkup(<GameScreens />)).toBe(render('today'))
  })
})
