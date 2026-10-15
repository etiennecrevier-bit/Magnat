import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Avatar } from '../content/schema.ts'
import { ENERGY } from '../engine/day.ts'
import { EnergyGaugeView } from './EnergyGauge.tsx'

function render(energy: number, avatar: Avatar = 'homme') {
  return renderToStaticMarkup(
    <EnergyGaugeView energy={energy} avatar={avatar} />,
  )
}

describe('EnergyGaugeView', () => {
  it('reads the thresholds of the content', () => {
    // The table below is written for these.
    expect(ENERGY.tired.below).toBe(50)
    expect(ENERGY.exhausted.below).toBe(25)
  })

  it.each([
    { energy: 100, state: 'rested', icon: '●', word: 'Reposé' },
    { energy: 50, state: 'rested', icon: '●', word: 'Reposé' },
    { energy: 49.9, state: 'tired', icon: '◐', word: 'Fatigué' },
    { energy: 25, state: 'tired', icon: '◐', word: 'Fatigué' },
    { energy: 24.9, state: 'exhausted', icon: '○', word: 'Épuisé' },
    { energy: 0, state: 'exhausted', icon: '○', word: 'Épuisé' },
  ])(
    'reads $energy as $word, with an icon and a word',
    ({ energy, state, icon, word }) => {
      const html = render(energy)
      expect(html).toMatch(
        new RegExp(`^<p class="energy-gauge energy-gauge--${state}">`),
      )
      expect(html).toContain(
        `<span class="energy-gauge__state"><span aria-hidden="true">${icon}</span> ${word}</span>`,
      )
      expect(html).toContain(`aria-valuetext="${word}"`)
    },
  )

  it.each([
    { energy: 80, word: 'Reposée' },
    { energy: 40, word: 'Fatiguée' },
    { energy: 10, word: 'Épuisée' },
  ])("agrees with a woman's avatar: $word", ({ energy, word }) => {
    const html = render(energy, 'femme')
    expect(html).toContain(`> ${word}</span>`)
    expect(html).toContain(`aria-valuetext="${word}"`)
  })

  it('labels the gauge Énergie, once for the eye and once for screen readers', () => {
    const html = render(100)
    expect(html).toContain(
      '<span class="energy-gauge__label" aria-hidden="true">Énergie</span>',
    )
    expect(html).toContain('role="meter" aria-label="Énergie"')
  })

  it('fills the bar to the energy, as a meter from 0 to 100', () => {
    const html = render(49.6)
    expect(html).toContain(
      'role="meter" aria-label="Énergie" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="Fatigué"',
    )
    expect(html).toContain(
      '<span class="energy-gauge__fill" style="width:49.6%"></span>',
    )
    expect(render(0)).toContain('style="width:0%"')
    expect(render(100)).toContain('style="width:100%"')
  })
})
