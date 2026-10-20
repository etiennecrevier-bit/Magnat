import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { startContract } from '../engine/contracts.ts'
import { cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import ContractsScreen, { ContractsScreenView } from './ContractsScreen.tsx'
import { contractsBoard, type ContractsBoard } from './contractsBoard.ts'
import { gameStore, type CityPick, type GameStoreState } from './store.ts'

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

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

function render(board: ContractsBoard, pick: CityPick | null = null) {
  return renderToStaticMarkup(<ContractsScreenView board={board} pick={pick} />)
}

/** Each card's class and text, tags removed, its parts apart by « | ». */
function cards(html: string): { className: string; text: string }[] {
  return [
    ...html.matchAll(
      /<article id="[^"]*" class="([^"]*)"[^>]*>(.*?)<\/article>/g,
    ),
  ].map(([, className, inner]) => ({
    className: className ?? '',
    text: (inner ?? '')
      .replace(/<\/(h3|p)>/g, '|')
      .replace(/<[^>]*>/g, '')
      .replace(/\|+$/, ''),
  }))
}

/**
 * Normand's and Bio-Logique's contracts signed on day 0, a Monday, played
 * to the morning of day 8: the first delivery made on day 7.
 */
function delivered(): GameState {
  const start = createInitialState(42)
  let game: GameState = {
    ...start,
    contracts: startContract(
      startContract(start.contracts, 0, 'marcheBioLogique'),
      0,
      'chezNormand',
    ),
  }
  while (game.day < 8) game = tick(game)
  return game
}

describe('ContractsScreenView', () => {
  it('says so before the first contract', () => {
    expect(render({ grocers: [], owedTotal: cents(0) })).toBe(
      '<section class="contracts"><p class="contracts__empty">Aucun contrat pour l&#x27;instant.</p></section>',
    )
  })

  it('shows a card per grocer with this week’s delivery, then what they owe in all', () => {
    const html = render(contractsBoard(delivered()))
    expect(cards(html)).toEqual([
      {
        className: 'contracts__card',
        text: `Épicerie Chez Normand|750 croissants livrés lundi, 1${S}575,00${S}$`,
      },
      {
        className: 'contracts__card',
        text: `Marché Bio-Logique|1${S}250 croissants livrés lundi, 2${S}812,50${S}$`,
      },
    ])
    expect(html).toContain(
      '<article id="contracts-chezNormand" class="contracts__card" tabindex="0" aria-labelledby="contracts-chezNormand-name" aria-describedby=',
    )
    expect(html).toContain(
      '<p id="contracts-chezNormand-status" class="status-line"><span class="status-line__dot status-line__dot--ok" aria-hidden="true"></span>',
    )
    expect(html).toMatch(
      new RegExp(
        `<p class="contracts__total">Total à recevoir des épiceries${S}: <strong>4${S}387,50${S}\\$</strong></p></section>$`,
      ),
    )
  })

  it('puts the rest in each card’s tooltip', () => {
    const html = render(contractsBoard(delivered()))
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('<p class="tip__title">Épicerie Chez Normand</p>')
  })

  it('shows the grocer the city picked, with no contract, beside the others', () => {
    const board = contractsBoard(delivered())
    const html = render(board, { grocer: 'depanneur2424', count: 1 })
    expect(cards(html).map(({ className, text }) => [className, text])).toEqual(
      [
        ['contracts__card', expect.stringMatching(/^Épicerie Chez Normand\|/)],
        ['contracts__card', expect.stringMatching(/^Marché Bio-Logique\|/)],
        [
          'contracts__card contracts__card--picked',
          'Dépanneur 24/24|Aucun contrat en cours',
        ],
      ],
    )
    expect(html).toContain(
      `Total à recevoir des épiceries${S}: <strong>4${S}387,50${S}$`,
    )
  })

  it('marks a grocer the city picked who already has a card, once', () => {
    const html = render(contractsBoard(delivered()), {
      grocer: 'marcheBioLogique',
      count: 2,
    })
    expect(cards(html).map(({ className }) => className)).toEqual([
      'contracts__card',
      'contracts__card contracts__card--picked',
    ])
  })

  it('keeps « Aucun contrat pour l’instant. » under a picked grocer before the first contract', () => {
    const html = render(
      { grocers: [], owedTotal: cents(0) },
      { grocer: 'chezNormand', count: 1 },
    )
    expect(cards(html)).toEqual([
      {
        className: 'contracts__card contracts__card--picked',
        text: 'Épicerie Chez Normand|Aucun contrat en cours',
      },
    ])
    expect(html).toContain(
      '<p class="contracts__empty">Aucun contrat pour l&#x27;instant.</p></section>',
    )
    expect(html).not.toContain('Total à recevoir')
  })
})

describe('ContractsScreen', () => {
  it("shows the app store's contracts", () => {
    gameStore.getState().startGame(delivered())
    const html = renderToStaticMarkup(<ContractsScreen />)
    expect(html).toContain(
      '<h3 id="contracts-chezNormand-name" class="contracts__name">Épicerie Chez Normand</h3>',
    )
    expect(html).toContain(
      `Total à recevoir des épiceries${S}: <strong>4${S}387,50${S}$</strong>`,
    )
  })

  it('shows the grocer the city picked in « Ville », and only there', () => {
    gameStore.getState().openPanel('trip')
    gameStore.getState().pickGrocer('depanneur2424')
    expect(renderToStaticMarkup(<ContractsScreen followsCity />)).toContain(
      'class="contracts__card contracts__card--picked"',
    )
    expect(renderToStaticMarkup(<ContractsScreen />)).toBe(
      '<section class="contracts"><p class="contracts__empty">Aucun contrat pour l&#x27;instant.</p></section>',
    )
  })
})
