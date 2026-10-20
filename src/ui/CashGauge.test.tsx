import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import { CashChipView } from './CashGauge.tsx'
import { cashTip, SPARKLINE, sparklinePoints } from './cashChip.ts'
import { LOW_BELOW_MONTHS } from './cashLevel.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '
const FIXED_COSTS = 355_000
const LOW_THRESHOLD = FIXED_COSTS * LOW_BELOW_MONTHS

function render(
  cash: number,
  fixedCosts = FIXED_COSTS,
  history: number[] = [],
) {
  return renderToStaticMarkup(
    <CashChipView
      cash={cents(cash)}
      fixedCosts={cents(fixedCosts)}
      history={history.map(cents)}
      onOpen={() => {}}
    />,
  )
}

/** Every element in `node` and its children, in order, `node` included. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return (node as ReactNode[]).flatMap(elements)
  if (!isValidElement(node)) return []
  const { children } = node.props as { children?: ReactNode }
  if (typeof children === 'function') return [node]
  return [node, ...elements(children)]
}

describe('CashChipView', () => {
  it.each([
    {
      cash: 1_000_000,
      level: 'healthy',
      word: 'Saine',
      amount: `10${S}000${S}$`,
    },
    { cash: LOW_THRESHOLD, level: 'healthy', word: 'Saine', amount: null },
    { cash: LOW_THRESHOLD - 1, level: 'low', word: 'Faible', amount: null },
    { cash: 0, level: 'low', word: 'Faible', amount: `0${S}$` },
    { cash: 879_749, level: 'healthy', word: 'Saine', amount: `8${S}797${S}$` },
    { cash: -12_345, level: 'negative', word: 'Négative', amount: `-123${S}$` },
  ])(
    'shows $cash cents as $word, to the dollar',
    ({ cash, level, word, amount }) => {
      const html = render(cash)
      expect(html).toMatch(
        new RegExp(
          `^<button type="button" class="cash-chip cash-chip--${level}" aria-haspopup="dialog" aria-describedby="[^"]+">`,
        ),
      )
      expect(html).toContain('<span class="cash-chip__label">Encaisse</span>')
      if (amount !== null) {
        expect(html).toContain(
          `<span class="cash-chip__amount">${amount}</span>`,
        )
      }
      // The word is always there, so the level never rests on colour alone.
      expect(html).toMatch(
        new RegExp(
          `<span class="cash-chip__state"><span aria-hidden="true">.+</span> ${word}</span>`,
        ),
      )
    },
  )

  it('reads the same cash against the fixed costs it is given', () => {
    expect(render(300_000, 175_000)).toContain('cash-chip--healthy')
    expect(render(300_000, 355_000)).toContain('cash-chip--low')
  })

  it('draws the sparkline of the closes, 70 x 22, hidden from screen readers', () => {
    const html = render(500_000, FIXED_COSTS, [400_000, 500_000, 450_000])
    expect(html).toContain(
      `<svg class="cash-chip__sparkline" width="70" height="22" viewBox="0 0 70 22" aria-hidden="true" focusable="false"><polyline points="${sparklinePoints([400_000, 500_000, 450_000])}"`,
    )
    expect(render(500_000, FIXED_COSTS, [400_000])).toContain(
      'focusable="false"></svg>',
    )
  })

  it('has the cents and the fixed costs in its tooltip, and opens the finances on a click', () => {
    const html = render(879_749)
    expect(html).toContain(`<dt>Aujourd&#x27;hui</dt><dd>8${S}797,49${S}$</dd>`)
    expect(html).toContain(
      `<dt>Frais fixes du mois</dt><dd>3${S}550,00${S}$</dd>`,
    )
    expect(html).toContain('<p class="tip__link">Ouvrir les finances')
    let opened = 0
    const view = CashChipView({
      cash: cents(0),
      fixedCosts: cents(FIXED_COSTS),
      history: [],
      onOpen: () => (opened += 1),
    })
    const tooltip = elements(view)[0]!
    const draw = (
      tooltip.props as { children: (a: object, t: object) => ReactNode }
    ).children
    const button = elements(draw({}, { open: () => {} }))[0]!
    ;(button.props as { onClick: () => void }).onClick()
    expect(opened).toBe(1)
  })

  it('hides the icon from screen readers, which read the word', () => {
    const html = render(0)
    const icons = [
      ...html.matchAll(/<span aria-hidden="true">([^<]*)<\/span>/g),
    ]
    // The level's icon, and the tooltip's link arrow.
    expect(icons.map((match) => match[1])).toEqual(['⚠︎', '▸'])
  })
})

describe('sparklinePoints', () => {
  it('spreads the values over the width, the lowest 2 px above the bottom and the highest 2 px under the top', () => {
    expect(sparklinePoints([10, 30, 20], 70, 22)).toBe(
      '0.0,20.0 35.0,2.0 70.0,11.0',
    )
  })

  it('draws equal values as a flat line through the middle', () => {
    expect(sparklinePoints([5, 5], SPARKLINE.width, SPARKLINE.height)).toBe(
      '0.0,11.0 70.0,11.0',
    )
  })

  it('draws nothing for fewer than two values', () => {
    expect(sparklinePoints([])).toBe('')
    expect(sparklinePoints([7])).toBe('')
  })
})

describe('cashTip', () => {
  it('gives the encaisse to the cent, the fixed costs and the link', () => {
    expect(
      cashTip({ cash: cents(-12_345), fixedCosts: cents(175_000) }),
    ).toEqual({
      title: 'Encaisse',
      rows: [
        { label: "Aujourd'hui", value: `-123,45${S}$` },
        { label: 'Frais fixes du mois', value: `1${S}750,00${S}$` },
      ],
      link: 'Ouvrir les finances',
    })
  })

  it('adds the last day on a phone, the lost sales in amber above zero', () => {
    const tip = cashTip({
      cash: cents(0),
      fixedCosts: cents(0),
      yesterday: { revenue: cents(39_900), customersServed: 60, lostSales: 12 },
    })
    expect(tip.rows?.slice(2)).toEqual([
      { label: 'Ventes hier', value: `399${S}$` },
      { label: 'Clients servis', value: '60' },
      { label: 'Ventes perdues', value: '12', warn: true },
    ])
  })

  it('shows dashes before the first day', () => {
    const tip = cashTip({
      cash: cents(0),
      fixedCosts: cents(0),
      yesterday: null,
    })
    expect(tip.rows?.slice(2)).toEqual([
      { label: 'Ventes hier', value: '—' },
      { label: 'Clients servis', value: '—' },
      { label: 'Ventes perdues', value: '—', warn: false },
    ])
  })
})
