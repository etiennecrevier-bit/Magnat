import { describe, expect, it } from 'vitest'
import type { DifficultyId, RungId } from '../content/schema.ts'
import { createInitialState } from '../engine/clock.ts'
import { applyDecision } from '../engine/decisions.ts'
import { cents } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState } from '../engine/types.ts'
import { dreamBoard, priceLine, rungLines } from './dreamBoard.ts'
import { DREAM } from '../engine/dream.ts'

// Every space in an amount is a no-break space (U+00A0), as before a colon
// or a percent sign.
const S = '\u00a0'

function started(difficulty: DifficultyId = 'facile'): GameState {
  return createInitialState(42, undefined, { ...defaultProfile(), difficulty })
}

/** `state` with the owner's own cash at `cash`. */
function withCash(state: GameState, cash: number): GameState {
  return { ...state, personal: { ...state.personal, cash: cents(cash) } }
}

function buying(state: GameState, ...ids: RungId[]): GameState {
  return ids.reduce(
    (game, rung) => applyDecision(game, { kind: 'buy', rung }),
    state,
  )
}

const rung = (id: RungId) => {
  const found = [...DREAM.personal, ...DREAM.company].find(
    (each) => each.id === id,
  )
  if (found === undefined) throw new Error(`no rung ${id}`)
  return found
}

describe('dreamBoard', () => {
  it('shows each ladder in order, the first rung next, the second truck coming soon', () => {
    const board = dreamBoard(started())
    expect(board.personal).toMatchObject({
      ladder: 'personal',
      title: 'Personnel',
      payer: 'Payé par vous',
      cash: 400_000,
      next: { id: 'velo', buyable: true },
      needed: 150_000,
      progress: 1,
    })
    expect(
      board.personal.rungs.map(({ id, status, price }) => [id, status, price]),
    ).toEqual([
      ['velo', 'next', 150_000],
      ['voitureOccasion', 'locked', 800_000],
      ['condo', 'locked', 4_000_000],
      ['voitureLuxe', 'locked', 4_500_000],
      ['maison', 'locked', 15_000_000],
      ['chalet', 'locked', 9_000_000],
    ])
    expect(board.company).toMatchObject({
      title: 'Entreprise',
      payer: "Payé par l'entreprise",
      cash: 1_500_000,
      next: { id: 'espresso', buyable: true },
    })
    expect(board.company.rungs.map(({ status }) => status)).toEqual([
      'next',
      'locked',
      'comingSoon',
    ])
    expect(
      board.company.rungs.every(
        ({ buyable, status }) => buyable === (status === 'next'),
      ),
    ).toBe(true)
  })

  it('tells how close the next rung is, and keeps it from being bought short', () => {
    const difficile = dreamBoard(started('difficile'))
    expect(difficile.company).toMatchObject({
      cash: 500_000,
      needed: 600_000,
      next: { id: 'espresso', buyable: false },
    })
    expect(difficile.company.progress).toBeCloseTo(5 / 6)
    expect(dreamBoard(withCash(started(), -1)).personal.progress).toBe(0)
  })

  it('counts the condo sold back toward the house', () => {
    const rich = withCash(started(), 100_000_000)
    const ready = buying(
      rich,
      'velo',
      'voitureOccasion',
      'condo',
      'voitureLuxe',
    )
    const before = dreamBoard(withCash(ready, 11_000_000)).personal
    expect(before).toMatchObject({
      next: { id: 'maison', buyable: true },
      needed: 11_000_000,
      progress: 1,
    })
    const house = buying(withCash(ready, 11_000_000), 'maison')
    expect(
      dreamBoard(house).personal.rungs.map(({ status }) => status),
    ).toEqual(['owned', 'owned', 'sold', 'owned', 'owned', 'next'])
  })

  it('has nothing next once a ladder is climbed but its rung coming soon', () => {
    const rich = {
      ...withCash(started(), 100_000_000),
    }
    const all = buying(
      rich,
      'velo',
      'voitureOccasion',
      'condo',
      'voitureLuxe',
      'maison',
      'chalet',
    )
    expect(dreamBoard(all).personal).toMatchObject({
      next: null,
      needed: null,
      progress: null,
    })
  })

  it('shows the title and the next one', () => {
    const game = started()
    const board = dreamBoard(game)
    expect(board.netWorth).toBe(netWorth(game))
    expect(board.titles).toEqual({
      title: 'Commerçant',
      next: {
        name: 'Entrepreneur',
        netWorth: 25_000_000,
        progress: netWorth(game) / 25_000_000,
      },
    })
    const broke = dreamBoard(withCash(started('difficile'), -10_000_000))
    expect(broke.titles).toMatchObject({
      title: null,
      next: { name: 'Débrouillard', progress: 0 },
    })
  })
})

describe('rungLines', () => {
  const game = started()

  it.each<[RungId, string[]]>([
    ['velo', [`Déplacements en ville${S}: −30${S}% de temps`]],
    ['voitureOccasion', [`Déplacements en ville${S}: −50${S}% de temps`]],
    [
      'condo',
      [
        `Hypothèque du condo${S}: 1${S}100,00${S}$ par mois`,
        `Remplace${S}: Loyer (1${S}300,00${S}$ par mois)`,
      ],
    ],
    [
      'voitureLuxe',
      [
        `Déplacements en ville${S}: −60${S}% de temps`,
        `Clientèle chic${S}: +5${S}% de passants`,
      ],
    ],
    [
      'maison',
      [
        `Hypothèque de la maison${S}: 2${S}200,00${S}$ par mois`,
        `Remplace${S}: Hypothèque du condo (1${S}100,00${S}$ par mois)`,
        `Revend${S}: Condo sur le Plateau (40${S}000,00${S}$)`,
      ],
    ],
    ['chalet', [`Jour de congé${S}: +15 d'énergie`]],
    ['espresso', [`Service au comptoir${S}: −20${S}% de temps`]],
    [
      'grandCamion',
      [
        `Stock par produit${S}: +50${S}%`,
        `File d'attente${S}: +50${S}% de clients`,
        `Clientèle chic${S}: +10${S}% de passants`,
        `L'ancien camion repris à sa valeur comptable${S}: 85${S}000,00${S}$`,
      ],
    ],
  ])('tells what %s gives, in plain facts', (id, lines) => {
    expect(rungLines(game, rung(id))).toEqual(lines)
  })

  it('tells the lease the bigger truck ends at difficile', () => {
    expect(rungLines(started('difficile'), rung('grandCamion')).at(-1)).toBe(
      `Fin de la location du camion${S}: 1${S}800,00${S}$ par mois`,
    )
  })

  it('reads the price and who pays for the confirmation', () => {
    const board = dreamBoard(game)
    const velo = board.personal.rungs[0]!
    expect(priceLine(board.personal, velo)).toBe(
      `1${S}500,00${S}$, payé par vous`,
    )
    const espresso = board.company.rungs[0]!
    expect(priceLine(board.company, espresso)).toBe(
      `6${S}000,00${S}$, payé par l'entreprise`,
    )
  })
})
