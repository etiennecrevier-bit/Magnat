import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import { NetWorthGaugeView } from './NetWorthGauge.tsx'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

function render(netWorth: number, change: number | null) {
  return renderToStaticMarkup(
    <NetWorthGaugeView
      netWorth={cents(netWorth)}
      change={change === null ? null : cents(change)}
    />,
  )
}

describe('NetWorthGaugeView', () => {
  it.each([
    { netWorth: 1_234_567, amount: `12${S}345,67${S}$` },
    { netWorth: -4_200_000, amount: `-42${S}000,00${S}$` },
  ])('shows « Valeur nette » $amount', ({ netWorth, amount }) => {
    expect(render(netWorth, null)).toBe(
      `<p class="net-worth-gauge"><span class="net-worth-gauge__label">Valeur nette</span> <span class="net-worth-gauge__amount">${amount}</span></p>`,
    )
  })

  it.each([
    {
      change: 123_400,
      direction: 'up',
      arrow: '▲',
      label: `+1${S}234${S}$ cette semaine`,
    },
    {
      change: -250,
      direction: 'down',
      arrow: '▼',
      label: `−2,50${S}$ cette semaine`,
    },
  ])(
    'adds an arrow $direction for a change of $change cents, which its label reads out',
    ({ change, direction, arrow, label }) => {
      expect(render(1_000_000, change)).toBe(
        `<p class="net-worth-gauge"><span class="net-worth-gauge__label">Valeur nette</span> <span class="net-worth-gauge__amount">10${S}000,00${S}$</span> <span class="net-worth-gauge__change net-worth-gauge__change--${direction}" role="img" aria-label="${label}">${arrow}</span></p>`,
      )
    },
  )

  it.each([0, null])('adds no arrow for a change of %j', (change) => {
    expect(render(1_000_000, change)).not.toContain('net-worth-gauge__change')
  })

  it('has no tooltip', () => {
    expect(render(1_000_000, 500)).not.toContain('title=')
  })
})
