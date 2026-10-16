import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defiById } from '../engine/challenge.ts'
import { startChallenge, tick } from '../engine/clock.ts'
import { DEFIS } from '../engine/day.ts'
import { cents } from '../engine/money.ts'
import type { ChallengeState, GameState } from '../engine/types.ts'
import DefiEnd, { DefiEndView } from './DefiEnd.tsx'
import { formatMetric } from './defis.ts'
import { formatBriefMoney } from './formatMoney.ts'
import { gameStore, type GameStoreState } from './store.ts'

// A static render reads a Zustand store's initial state, so the connected
// screen reads the app store's current state through this stand-in.
vi.mock('./store.ts', async (importOriginal) => {
  const store = await importOriginal<typeof import('./store.ts')>()
  return {
    ...store,
    useGame: <T,>(selector: (state: GameStoreState) => T): T =>
      selector(store.gameStore.getState()),
  }
})

afterEach(() => {
  gameStore.setState(gameStore.getInitialState(), true)
})

// French puts a no-break space (U+00A0) in amounts and before a colon.
const S = ' '

const milleDollars = defiById(DEFIS, 'semaineDesMilleDollars')
const moisSansConge = defiById(DEFIS, 'moisSansConge')

function over(
  id: string,
  changes: Partial<ChallengeState>,
  progress: Partial<ChallengeState['progress']> = {},
): ChallengeState {
  const { challenge } = startChallenge(id, 7)
  return {
    ...challenge!,
    ...changes,
    progress: {
      ...challenge!.progress,
      daysPlayed: 7,
      sales: cents(250_700),
      netIncome: cents(89_048),
      lowestCash: cents(1_470_550),
      customersServed: 402,
      ...progress,
    },
  }
}

function render(defi = milleDollars, challenge = over(defi.id, {})) {
  return renderToStaticMarkup(
    <DefiEndView
      defi={defi}
      challenge={challenge}
      onReplay={() => {}}
      onMenu={() => {}}
    />,
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

/** The Défi `id` on `seed`, played with no event to its end. */
function playedOut(id: string, seed: number): GameState {
  let game = startChallenge(id, seed)
  while (game.challenge?.status === 'enCours') game = tick(game)
  return game
}

describe('DefiEndView', () => {
  it('announces a Défi réussi with its medal', () => {
    const html = render(
      milleDollars,
      over(milleDollars.id, { status: 'reussi', medal: 'argent' }),
    )
    expect(html).toContain(
      '<p class="defi-end__defi">La semaine des 1 000 $</p><h2 id="defi-end-title" tabindex="-1">Défi réussi</h2><p class="defi-end__medal defi-medal--argent">Médaille d&#x27;argent</p>',
    )
    expect(html).not.toContain('defi-end__why')
  })

  it.each([
    ['or', 'Médaille d&#x27;or'],
    ['bronze', 'Médaille de bronze'],
  ] as const)('names the %s medal', (medal, text) => {
    expect(
      render(milleDollars, over(milleDollars.id, { status: 'reussi', medal })),
    ).toContain(`>${text}</p>`)
  })

  it('tells why a Défi failed: the condition it broke', () => {
    const html = render(
      moisSansConge,
      over(moisSansConge.id, { status: 'echoue' }, { lowestEnergy: 19.4 }),
    )
    expect(html).toContain('>Défi échoué</h2>')
    const [floor] = moisSansConge.conditions
    if (floor?.kind !== 'minEnergy') throw new Error('It watches the energy')
    expect(html).toContain(
      `<p class="defi-end__why">Votre énergie est tombée sous ${formatMetric('lowestEnergy', floor.amount)}.</p>`,
    )
    expect(html).not.toContain('Médaille')
  })

  it('tells why a Défi failed: short of bronze', () => {
    // 12,50 $ short of the content's bronze.
    const { bronze } = milleDollars.goal.medals
    const netIncome = cents(bronze - 1_250)
    const html = render(
      milleDollars,
      over(milleDollars.id, { status: 'echoue' }, { netIncome }),
    )
    expect(html).toContain(
      `<p class="defi-end__why">Bénéfice net${S}: ${formatBriefMoney(netIncome)}. Le bronze demandait ${formatBriefMoney(cents(bronze))} ou plus.</p>`,
    )
  })

  it('lists the key numbers and the days played', () => {
    expect(render()).toContain(
      `<ul class="defi-end__figures"><li>Bénéfice net${S}: 890,48${S}$</li><li>Ventes${S}: 2${S}507${S}$</li><li>Encaisse la plus basse${S}: 14${S}705,50${S}$</li><li>Clients servis${S}: 402</li><li>Jours joués${S}: 7 sur 7</li></ul>`,
    )
  })

  it('offers « Rejouer » first, then « Retour au menu »', () => {
    expect(buttons(render())).toEqual([
      { text: 'Rejouer', primary: true },
      { text: 'Retour au menu', primary: false },
    ])
  })

  it('does not show the percentile of the simulated games yet (#102)', () => {
    expect(render()).not.toContain('parties simulées')
  })
})

describe('DefiEnd', () => {
  it('shows the end of the Défi the app store played, in a dialog', () => {
    gameStore.getState().startGame(playedOut('semaineDesMilleDollars', 7))
    const html = renderToStaticMarkup(<DefiEnd onMenu={() => {}} />)
    expect(html).toMatch(
      /^<dialog class="panel defi-end" aria-labelledby="defi-end-title"><div class="panel__content defi-end__content"><p class="defi-end__defi">La semaine des 1 000 \$<\/p><h2 id="defi-end-title" tabindex="-1">Défi réussi<\/h2>/,
    )
    expect(html).toContain(`Jours joués${S}: 7 sur 7`)
  })

  it('shows nothing outside a Défi', () => {
    expect(renderToStaticMarkup(<DefiEnd onMenu={() => {}} />)).toBe('')
  })
})
