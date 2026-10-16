import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Medal } from '../content/schema.ts'
import { defiById } from '../engine/challenge.ts'
import { DEFIS } from '../engine/day.ts'
import { cents } from '../engine/money.ts'
import { lengthText } from './defis.ts'
import { DefiBriefingView, DefiListView } from './DefisScreen.tsx'
import { formatBriefMoney, formatMoney } from './formatMoney.ts'

// French puts a no-break space (U+00A0) in amounts, before a colon and a
// percent sign, and inside its quotation marks.
const S = ' '

function list(bestMedals: Readonly<Record<string, Medal>> = {}) {
  return renderToStaticMarkup(
    <DefiListView
      defis={DEFIS.defis}
      bestMedals={bestMedals}
      onOpen={() => {}}
      onBack={() => {}}
    />,
  )
}

function briefing(id: string, bestMedal?: Medal) {
  return renderToStaticMarkup(
    <DefiBriefingView
      defi={defiById(DEFIS, id)}
      bestMedal={bestMedal}
      onStart={() => {}}
      onBack={() => {}}
    />,
  )
}

/** The text of each Défi's card, its parts apart, in order. */
function cards(html: string) {
  return [
    ...html.matchAll(
      /<button type="button" class="defi-card">(.*?)<\/button>/g,
    ),
  ].map(([, inner]) =>
    [...(inner ?? '').matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(
      ([, text]) => text,
    ),
  )
}

/** Each button's text and whether it is the primary one, in order. */
function buttons(html: string) {
  return [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(
    ([, attributes, text]) => ({
      text,
      primary: /button--primary/.test(attributes ?? ''),
    }),
  )
}

/** The items of the list following the heading `title`. */
function listAfter(html: string, title: string): string[] {
  const at = html.indexOf(`<h2>${title}</h2>`)
  expect(at).toBeGreaterThanOrEqual(0)
  const list = /<ul[^>]*>(.*?)<\/ul>/.exec(html.slice(at))?.[1] ?? ''
  return [...list.matchAll(/<li>(.*?)<\/li>/g)].map(([, text]) => text ?? '')
}

describe('DefiListView', () => {
  it('shows every Défi in the content order, with its difficulty, length and no medal yet', () => {
    const html = list()
    expect(html).toContain('<h1 id="')
    expect(html).toContain('>Défis</h1>')
    // The titles and lengths come from the content.
    const names = { facile: 'Facile', moyen: 'Moyen', difficile: 'Difficile' }
    expect(cards(html)).toEqual(
      DEFIS.defis.map((defi) => [
        defi.title,
        `${names[defi.difficulty]} · ${lengthText(defi.lengthDays)}`,
        'Aucune médaille',
      ]),
    )
  })

  it('shows the best medal won in each Défi', () => {
    const shown = cards(
      list({ zeroGaspillage: 'or', moisSansConge: 'bronze' }),
    ).map((card) => card[2])
    expect(shown).toEqual([
      'Aucune médaille',
      'Aucune médaille',
      `Meilleure médaille${S}: Or`,
      'Aucune médaille',
      'Aucune médaille',
      `Meilleure médaille${S}: Bronze`,
    ])
    expect(list({ zeroGaspillage: 'or' })).toContain(
      'class="defi-card__medal defi-medal--or"',
    )
  })

  it('ends with « Retour »', () => {
    expect(buttons(list()).at(-1)).toEqual({ text: 'Retour', primary: false })
  })
})

describe('DefiBriefingView', () => {
  it('tells the story, how the game opens and when the Défi runs', () => {
    const html = briefing('travauxSaintDenis')
    expect(html).toContain('>Les travaux de la rue Saint-Denis</h1>')
    expect(html).toContain('La Ville refait la rue Saint-Denis')
    const { cashCents } = defiById(DEFIS, 'travauxSaintDenis').setup
    expect(cashCents).toBeDefined()
    expect(html).toContain(
      `Moyen${S}: Prêt de démarrage de 70${S}000,00${S}$ à la Caisse, ${formatMoney(cashCents ?? cents(0))} en banque`,
    )
    expect(html).toContain('Du 15 mai au 4 juin, an 1 (3 semaines)')
  })

  it('states the goal, the thresholds and the conditions', () => {
    const html = briefing('travauxSaintDenis')
    expect(html).toContain(
      '<h2>Objectif</h2><p>Gardez votre encaisse la plus haute possible, même à son plus bas.</p>',
    )
    // The thresholds and the condition come from the content.
    const { goal, conditions } = defiById(DEFIS, 'travauxSaintDenis')
    const atLeast = (amount: number) =>
      `${formatBriefMoney(cents(amount))} ou plus`
    expect(listAfter(html, 'Objectif')).toEqual([
      `Or${S}: ${atLeast(goal.medals.or)}`,
      `Argent${S}: ${atLeast(goal.medals.argent)}`,
      `Bronze${S}: ${atLeast(goal.medals.bronze)}`,
    ])
    const [minCash] = conditions
    if (minCash?.kind !== 'minCash') throw new Error('Saint-Denis watches cash')
    expect(listAfter(html, 'Conditions')).toEqual([
      `L&#x27;encaisse ne doit jamais passer sous ${formatBriefMoney(minCash.amountCents)}.`,
    ])
  })

  it('has no conditions for a Défi without any', () => {
    expect(briefing('semaineDesMilleDollars')).not.toContain(
      '<h2>Conditions</h2>',
    )
  })

  it('says what is locked: a kind of decision, a forced choice, or nothing', () => {
    expect(listAfter(briefing('moisSansConge'), 'Verrouillé')).toEqual([
      'Le Défi fixe l&#x27;horaire.',
    ])
    expect(listAfter(briefing('payeDans60Jours'), 'Verrouillé')).toEqual([
      `Le mercredi 10 mai${S}: «${S}La grosse commande${S}», choix imposé${S}: Accepter.`,
    ])
    expect(briefing('travauxSaintDenis')).toContain(
      '<h2>Verrouillé</h2><p>Toutes vos décisions sont libres.</p>',
    )
  })

  it('shows the best medal won, or that there is none yet', () => {
    expect(briefing('zeroGaspillage')).toContain(
      'Aucune médaille pour l&#x27;instant.',
    )
    expect(briefing('zeroGaspillage', 'argent')).toContain(
      `Meilleure médaille${S}: Argent`,
    )
  })

  it('says the Défi is not saved, then offers « Commencer » and « Retour »', () => {
    const html = briefing('zeroGaspillage')
    expect(html).toContain(
      `<p class="notice">Les Défis ne sont pas sauvegardés${S}: votre partie sauvegardée reste intacte.</p>`,
    )
    expect(buttons(html)).toEqual([
      { text: 'Commencer', primary: true },
      { text: 'Retour', primary: false },
    ])
  })
})
