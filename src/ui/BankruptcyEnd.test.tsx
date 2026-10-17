import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBankruptcyText } from '../content/bankruptcyText.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import BankruptcyEnd, { BankruptcyEndView } from './BankruptcyEnd.tsx'
import { bankruptcyFigures, figureLine } from './bankruptcyEnd.ts'
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

// French puts a no-break space (U+00A0) before a percent sign and a colon,
// and inside its quotation marks.
const S = '\u00a0'

/**
 * Seed 7 at Difficile for « Chez Mimi », its owner paying themself 3 000 $
 * a week from day 1: the close of November 30th, day 213, ends it in
 * bankruptcy. The morning after.
 */
function bankrupt(): GameState {
  let game = applyDecision(
    createInitialState(7, FOOD_TRUCK, {
      ...defaultProfile(),
      businessName: 'Chez Mimi',
      difficulty: 'difficile',
    }),
    { kind: 'ownerWeeklyPay', pay: cents(300_000) },
  )
  while (game.ended === null) game = tick(game)
  return game
}

const ENDED = bankrupt()
const END = { reason: 'bankruptcy', day: 213 } as const

function render(
  props: Partial<Parameters<typeof BankruptcyEndView>[0]> = {},
): string {
  return renderToStaticMarkup(
    <BankruptcyEndView
      game={ENDED}
      ended={END}
      onRestart={() => {}}
      onMenu={() => {}}
      {...props}
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

describe('BankruptcyEndView', () => {
  it('announces the « Faillite » of the business and the day its file closed', () => {
    expect(render()).toContain(
      '<p class="bankruptcy-end__business">Chez Mimi</p><h2 id="bankruptcy-title" tabindex="-1">Faillite</h2><p class="bankruptcy-end__date">Dossier fermé le 30 novembre, an 1</p>',
    )
  })

  it('lists the key numbers of the game', () => {
    const items = bankruptcyFigures(ENDED, END)
      .map((figure) => `<li>${figureLine(figure)}</li>`)
      .join('')
    expect(render()).toContain(
      `<ul class="bankruptcy-end__figures">${items}</ul>`,
    )
    expect(render()).toContain(`<li>Jours joués${S}: 214</li>`)
  })

  it('tells how the owner compares with the simulated owners, rounded down, when it is known', () => {
    expect(render({ percentile: 37.9 })).toContain(
      `<p class="bankruptcy-end__percentile">Mieux que 37${S}% des propriétaires</p>`,
    )
    expect(render()).not.toContain('Mieux que')
  })

  it('gives Mme Prudhomme’s word for the game’s seed, with her portrait', () => {
    const line = loadBankruptcyText().prudhomme[7 % 5]
    const html = render({ portrait: '/prudhomme.png' })
    expect(html).toContain(
      '<section class="prudhomme-advice" aria-label="Le mot de Mme Prudhomme"><img class="prudhomme-advice__portrait" src="/prudhomme.png"',
    )
    expect(html).toContain(
      `<p class="prudhomme-advice__title">Le mot de Mme Prudhomme</p><p class="prudhomme-advice__text">«${S}${line}${S}»</p>`,
    )
  })

  it('offers « Recommencer » first, then « Retour au menu »', () => {
    expect(buttons(render())).toEqual([
      { text: 'Recommencer', primary: true },
      { text: 'Retour au menu', primary: false },
    ])
  })
})

describe('BankruptcyEnd', () => {
  it('shows the « Faillite » of the game the app store played, in a dialog, with how the owner compares', () => {
    gameStore.getState().startGame(ENDED)
    const html = renderToStaticMarkup(<BankruptcyEnd onMenu={() => {}} />)
    expect(html).toMatch(
      /^<dialog class="panel bankruptcy-end" aria-labelledby="bankruptcy-title"><div class="panel__content bankruptcy-end__content"><p class="bankruptcy-end__business">Chez Mimi<\/p><h2 id="bankruptcy-title" tabindex="-1">Faillite<\/h2>/,
    )
    expect(html).toMatch(new RegExp(`Mieux que \\d+${S}% des propriétaires`))
    expect(html).toContain('class="prudhomme-advice__portrait"')
  })

  it('shows nothing for a game that goes on', () => {
    expect(renderToStaticMarkup(<BankruptcyEnd onMenu={() => {}} />)).toBe('')
  })
})
