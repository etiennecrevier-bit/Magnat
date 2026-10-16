import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import { cents } from '../engine/money.ts'
import type { ChallengeState } from '../engine/types.ts'
import { DefiPanelView } from './DefiPanel.tsx'
import { formatBriefMoney } from './formatMoney.ts'

// French puts a no-break space (U+00A0) in amounts, before a colon and a
// percent sign.
const S = ' '

const travaux = defiById(DEFIS, 'travauxSaintDenis')

/** « Les travaux de la rue Saint-Denis », 9 days in. */
const CHALLENGE: ChallengeState = {
  id: 'travauxSaintDenis',
  startDay: 14,
  progress: {
    daysPlayed: 9,
    sales: cents(212_000),
    netIncome: cents(-41_000),
    lowestCash: cents(187_000),
    customersServed: 330,
    unitsSold: 600,
    unitsSpoiled: 240,
    lowestEnergy: 80,
  },
  lowestEnergySinceClose: 80,
  status: 'enCours',
  medal: null,
}

function render(day = 23, defi = travaux) {
  return renderToStaticMarkup(
    <DefiPanelView
      defi={defi}
      challenge={{ ...CHALLENGE, id: defi.id }}
      day={day}
      energy={52.7}
      onClose={() => {}}
    />,
  )
}

describe('DefiPanelView', () => {
  it('has Fermer first, then the Défi and its week', () => {
    expect(render()).toMatch(
      /^<div class="panel__content"><div class="panel__header"><button type="button" class="toggle">Fermer<\/button><h2 id="defi-title">Les travaux de la rue Saint-Denis<\/h2><\/div><p class="defi-panel__week">Semaine 2 de 3<\/p>/,
    )
  })

  it('shows the goal, where the Défi stands and the thresholds', () => {
    const html = render()
    expect(html).toContain(
      '<h3>Objectif</h3><p>Gardez votre encaisse la plus haute possible, même à son plus bas.</p>',
    )
    expect(html).toContain(
      `<ul class="defi-progress"><li>Encaisse la plus basse${S}: 1${S}870${S}$</li></ul>`,
    )
    // The thresholds and the condition come from the content.
    const { medals } = travaux.goal
    const atLeast = (amount: number) =>
      `${formatBriefMoney(cents(amount))} ou plus`
    expect(html).toContain(
      `<h3>Médailles</h3><ul class="defi-panel__list"><li>Or${S}: ${atLeast(medals.or)}</li><li>Argent${S}: ${atLeast(medals.argent)}</li><li>Bronze${S}: ${atLeast(medals.bronze)}</li></ul>`,
    )
    const [minCash] = travaux.conditions
    if (minCash?.kind !== 'minCash') throw new Error('Saint-Denis watches cash')
    expect(html).toContain(
      `<h3>Conditions</h3><ul class="defi-panel__list"><li>L&#x27;encaisse ne doit jamais passer sous ${formatBriefMoney(minCash.amountCents)}.</li></ul>`,
    )
  })

  it('shows the energy against the floor of a Défi that sets one, and only then', () => {
    expect(render()).not.toContain('defi-panel__energy')
    const deuxSemaines = defiById(DEFIS, 'moisSansConge')
    const [floor] = deuxSemaines.conditions
    if (floor?.kind !== 'minEnergy') throw new Error('It sets an energy floor')
    expect(render(23, deuxSemaines)).toContain(
      `<ul class="defi-progress"><li>Bénéfice net${S}: -410${S}$</li><li>Énergie la plus basse${S}: 80</li></ul><p class="defi-panel__energy">Énergie${S}: 52 (plancher${S}: ${floor.amount})</p><h3>Médailles</h3>`,
    )
  })

  it('counts its weeks from its first day', () => {
    expect(render(14)).toContain('Semaine 1 de 3')
    expect(render(34)).toContain('Semaine 3 de 3')
  })
})
