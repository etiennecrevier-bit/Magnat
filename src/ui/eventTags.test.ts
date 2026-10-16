import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import { formatChoiceTag } from './eventTags.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

describe('formatChoiceTag', () => {
  it('shows a tag with no amount as it is written', () => {
    expect(formatChoiceTag({ text: 'Risqué', amount: null })).toBe('Risqué')
  })

  it('writes money to the dollar, in fr-CA', () => {
    const sale = (amount: number) =>
      formatChoiceTag({
        text: 'Ventes +{montant}',
        amount: { unit: 'money', cents: cents(amount) },
      })
    expect(sale(97_500)).toBe(`Ventes +975${S}$`)
    expect(sale(123_550)).toBe(`Ventes +1${S}236${S}$`)
    expect(sale(4_049)).toBe(`Ventes +40${S}$`)
  })

  it('writes energy in whole points and a percentage whole', () => {
    expect(
      formatChoiceTag({
        text: 'Énergie −{montant}',
        amount: { unit: 'energy', points: 6.5 },
      }),
    ).toBe('Énergie −7')
    expect(
      formatChoiceTag({
        text: 'Clients −{montant} pendant 1 semaine',
        amount: { unit: 'percent', percent: 45.5 },
      }),
    ).toBe(`Clients −46${S}% pendant 1 semaine`)
  })
})
