import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import { CashGaugeView } from './CashGauge.tsx'
import { LOW_BELOW_MONTHS, MONTHLY_FIXED_COSTS } from './cashLevel.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'
const LOW_THRESHOLD = MONTHLY_FIXED_COSTS * LOW_BELOW_MONTHS

function render(cash: number) {
  return renderToStaticMarkup(<CashGaugeView cash={cents(cash)} />)
}

describe('CashGaugeView', () => {
  it.each([
    {
      cash: 1_000_000,
      level: 'healthy',
      word: 'Saine',
      amount: `10${S}000,00${S}$`,
    },
    { cash: LOW_THRESHOLD, level: 'healthy', word: 'Saine', amount: null },
    { cash: LOW_THRESHOLD - 1, level: 'low', word: 'Faible', amount: null },
    { cash: 0, level: 'low', word: 'Faible', amount: `0,00${S}$` },
    {
      cash: -12_345,
      level: 'negative',
      word: 'Négative',
      amount: `-123,45${S}$`,
    },
  ])('shows $cash cents as $word', ({ cash, level, word, amount }) => {
    const html = render(cash)
    expect(html).toMatch(
      new RegExp(`^<p class="cash-gauge cash-gauge--${level}">`),
    )
    expect(html).toContain('<span class="cash-gauge__label">Encaisse</span>')
    if (amount !== null) {
      expect(html).toContain(
        `<span class="cash-gauge__amount">${amount}</span>`,
      )
    }
    // The word is always there, so the level never rests on colour alone.
    expect(html).toMatch(
      new RegExp(
        `<span class="cash-gauge__state"><span aria-hidden="true">.+</span> ${word}</span>`,
      ),
    )
  })

  it('hides the icon from screen readers, which read the word', () => {
    const html = render(0)
    const icons = [
      ...html.matchAll(/<span aria-hidden="true">([^<]*)<\/span>/g),
    ]
    expect(icons).toHaveLength(1)
  })
})
