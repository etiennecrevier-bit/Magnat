import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import { cents } from '../engine/money.ts'
import type { ChallengeState } from '../engine/types.ts'
import { DefiPanelView } from './DefiPanel.tsx'

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

function render(day = 23) {
  return renderToStaticMarkup(
    <DefiPanelView
      defi={travaux}
      challenge={CHALLENGE}
      day={day}
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
    expect(html).toContain(
      `<h3>Médailles</h3><ul class="defi-panel__list"><li>Or${S}: 2${S}500${S}$ ou plus</li><li>Argent${S}: 1${S}000${S}$ ou plus</li><li>Bronze${S}: 0${S}$ ou plus</li></ul>`,
    )
    expect(html).toContain(
      `<h3>Conditions</h3><ul class="defi-panel__list"><li>L&#x27;encaisse ne doit jamais passer sous 0${S}$.</li></ul>`,
    )
  })

  it('counts its weeks from its first day', () => {
    expect(render(14)).toContain('Semaine 1 de 3')
    expect(render(34)).toContain('Semaine 3 de 3')
  })
})
