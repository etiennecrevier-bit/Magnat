import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import TopBar, { TopBarView } from './TopBar.tsx'

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

function render(day: number, speed: number, cash = cents(1_000_000)) {
  return renderToStaticMarkup(
    <TopBarView day={day} cash={cash} speed={speed} onSpeedChange={() => {}} />,
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

  it('shows the cash gauge between the date and the buttons', () => {
    const html = render(0, 1, cents(-12_345))
    expect(html).toMatch(
      /^<header class="top-bar"><p class="top-bar__date">.*<\/p><p class="cash-gauge cash-gauge--negative">.*<\/p><div class="top-bar__speeds"/,
    )
    expect(html).toContain(`-123,45${S}$`)
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
  it('shows the app store: day 0 at normal speed, with the starting cash', () => {
    const html = renderToStaticMarkup(<TopBar />)
    expect(html).toContain('Lundi 1er mai, an 1')
    expect(html).toContain('cash-gauge--healthy')
    expect(html).toContain(`10${S}000,00${S}$`)
    expect(html).toContain('Saine')
    expect(buttons(html).find(({ pressed }) => pressed === 'true')).toEqual({
      label: 'Vitesse normale',
      pressed: 'true',
    })
  })
})
