import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TopBar, { TopBarView } from './TopBar.tsx'

function render(day: number, speed: number) {
  return renderToStaticMarkup(
    <TopBarView day={day} speed={speed} onSpeedChange={() => {}} />,
  )
}

/** Each button's accessible label and pressed state, in order. */
function buttons(html: string) {
  return [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => ({
    label: /aria-label="([^"]*)"/.exec(tag)?.[1],
    pressed: /aria-pressed="([^"]*)"/.exec(tag)?.[1],
  }))
}

describe('TopBarView', () => {
  it('shows the game date in French', () => {
    expect(render(244, 1)).toContain(
      '<p class="top-bar__date">Dimanche 31 décembre, an 1</p>',
    )
  })

  it('has a labelled group of pause and speed buttons', () => {
    const html = render(0, 1)
    expect(html).toContain('role="group" aria-label="Vitesse du jeu"')
    expect(buttons(html).map(({ label }) => label)).toEqual([
      'Pause',
      'Vitesse normale',
      'Vitesse ×3',
      'Vitesse ×10',
    ])
    expect(html).not.toMatch(/<button(?![^>]*type="button")/)
  })

  it.each([
    { speed: 0, active: 'Pause' },
    { speed: 1, active: 'Vitesse normale' },
    { speed: 10, active: 'Vitesse ×10' },
  ])('marks only $active as pressed', ({ speed, active }) => {
    for (const { label, pressed } of buttons(render(0, speed))) {
      expect(pressed).toBe(label === active ? 'true' : 'false')
    }
  })
})

describe('TopBar', () => {
  it('shows the app store: day 0 at normal speed', () => {
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toContain('Lundi 1er mai, an 1')
    expect(buttons(html).find(({ pressed }) => pressed === 'true')).toEqual({
      label: 'Vitesse normale',
      pressed: 'true',
    })
  })
})
