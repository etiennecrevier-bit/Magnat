import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import { FinancingBlock } from './FinancingBlock.tsx'
import type { FinancingSummary } from './financingSummary.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

/** The block's lines, tags removed. */
function lines(financing: FinancingSummary): string[] {
  const html = renderToStaticMarkup(<FinancingBlock financing={financing} />)
  return [...html.matchAll(/<li>(.*?)<\/li>/g)].map(([, item]) =>
    (item ?? '').replace(/<[^>]*>/g, ''),
  )
}

describe('FinancingBlock', () => {
  it('shows each loan open, the shares sold and the next dividend so far', () => {
    expect(
      lines({
        hadLoans: true,
        loans: [
          {
            lender: 'Caisse populaire Saint-Prudent',
            owed: cents(1_234_567),
            next: { amount: cents(117_042), day: 61 },
          },
        ],
        shares: [{ investor: 'Duvent Capital', tenths: 200 }],
        dividend: { day: 61, amount: cents(45_678), final: false },
      }),
    ).toEqual([
      `Prêt d&#x27;urgence · Caisse populaire Saint-Prudent${S}: 12${S}345,67${S}$ à rembourser, prochain versement de 1${S}170,42${S}$ le 1er juillet`,
      `Duvent Capital${S}: 20${S}% des actions`,
      `Prochain dividende le 1er juillet${S}: 456,78${S}$ à ce jour`,
    ])
  })

  it("says when no loan is open any more, and shows the dividend on the morning it is paid, and a share's tenths", () => {
    expect(
      lines({
        hadLoans: true,
        loans: [],
        shares: [{ investor: 'Duvent Capital', tenths: 205 }],
        dividend: { day: 61, amount: cents(45_678), final: true },
      }),
    ).toEqual([
      'Aucun prêt d&#x27;urgence en cours',
      `Duvent Capital${S}: 20,5${S}% des actions`,
      `Dividende aujourd&#x27;hui${S}: 456,78${S}$`,
    ])
  })
})
