import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { startContract } from '../engine/contracts.ts'
import { cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import ContractsScreen, { ContractsScreenView } from './ContractsScreen.tsx'
import { contractsBoard, type ContractsBoard } from './contractsBoard.ts'
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

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

function render(board: ContractsBoard) {
  return renderToStaticMarkup(<ContractsScreenView board={board} />)
}

/** The text of each paragraph and list item, in order, tags removed. */
function lines(html: string): string[] {
  return [...html.matchAll(/<(p|li)\b[^>]*>(.*?)<\/\1>/g)].map(([, , text]) =>
    (text ?? '').replace(/<[^>]*>/g, ''),
  )
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
      '<section class="contracts"><h1>Contrats</h1><p>Aucun contrat pour l&#x27;instant.</p></section>',
    )
  })

  it('shows each grocer in plain lines, then what they owe in all', () => {
    const html = render(contractsBoard(delivered()))
    expect(html).toMatch(/^<section class="contracts"><h1>Contrats<\/h1>/)
    expect(
      [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map(([, name]) => name),
    ).toEqual(['Épicerie Chez Normand', 'Marché Bio-Logique'])
    expect(lines(html)).toEqual([
      'Normand',
      `750 croissants par semaine à 2,10${S}$`,
      `11 semaines restantes · Livraisons manquées${S}: 0 sur 3`,
      `Cette semaine${S}: 750 croissants livrés lundi, 1${S}575,00${S}$`,
      `À recevoir${S}: 1${S}575,00${S}$`,
      `1${S}575,00${S}$ le 7 juillet`,
      'Solange Tremblay-Lévesque',
      `1${S}250 croissants par semaine à 2,25${S}$ · +0,40${S}$ par croissant du fournil`,
      `11 semaines restantes · Livraisons manquées${S}: 0 sur 3`,
      `Cette semaine${S}: 1${S}250 croissants livrés lundi, 2${S}812,50${S}$`,
      `À recevoir${S}: 2${S}812,50${S}$`,
      `2${S}812,50${S}$ le 7 juillet`,
      `Total à recevoir des épiceries${S}: 4${S}387,50${S}$`,
    ])
  })

  it('says when the delivery is due, missed, or the first is to come', () => {
    const board = contractsBoard(delivered())
    const [line] = board.grocers
    if (line?.contract == null) throw new Error('No contract')
    const withWeek = (week: NonNullable<typeof line.contract>['week']) =>
      lines(
        render({
          ...board,
          grocers: [{ ...line, contract: { ...line.contract!, week } }],
        }),
      ).find((text) => text.startsWith('Cette semaine'))
    expect(withWeek({ kind: 'due', day: 14 })).toBe(
      `Cette semaine${S}: livraison lundi`,
    )
    expect(withWeek({ kind: 'missed', day: 7 })).toBe(
      `Cette semaine${S}: livraison manquée lundi`,
    )
    expect(withWeek({ kind: 'first', day: 14 })).toBe(
      `Cette semaine${S}: aucune livraison, la première le 15 mai`,
    )
  })

  it('says « 1 semaine restante » for the last one', () => {
    const board = contractsBoard(delivered())
    const [line] = board.grocers
    if (line?.contract == null) throw new Error('No contract')
    const html = render({
      ...board,
      grocers: [{ ...line, contract: { ...line.contract, weeksLeft: 1 } }],
    })
    expect(html).toContain('1 semaine restante · ')
  })

  it('shows « Aucun contrat en cours » for a grocer who only owes', () => {
    const board = contractsBoard(delivered())
    const [line] = board.grocers
    if (line === undefined) throw new Error('No grocer')
    const html = render({ ...board, grocers: [{ ...line, contract: null }] })
    expect(lines(html).slice(0, 3)).toEqual([
      'Normand',
      'Aucun contrat en cours',
      `À recevoir${S}: 1${S}575,00${S}$`,
    ])
  })
})

describe('ContractsScreen', () => {
  it("shows the app store's contracts", () => {
    gameStore.getState().startGame(delivered())
    const html = renderToStaticMarkup(<ContractsScreen />)
    expect(html).toContain('<h2>Épicerie Chez Normand</h2>')
    expect(html).toContain(
      `Total à recevoir des épiceries${S}: <strong>4${S}387,50${S}$</strong>`,
    )
  })
})
