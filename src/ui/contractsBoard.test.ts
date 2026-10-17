import { describe, expect, it } from 'vitest'
import type { GrocerId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { GROCERS, startContract } from '../engine/contracts.ts'
import { cents } from '../engine/money.ts'
import type { Day, GameState } from '../engine/types.ts'
import { contractsBoard } from './contractsBoard.ts'

const START = createInitialState(42)

/** `state` with a contract signed that morning with `grocer`. */
function signed(state: GameState, grocer: GrocerId): GameState {
  return {
    ...state,
    contracts: startContract(state.contracts, state.day, grocer),
  }
}

/** `state` played to the morning of `day`, the owner away on `away`. */
function playedTo(
  state: GameState,
  day: Day,
  away: readonly Day[] = [],
): GameState {
  let game = state
  while (game.day < day) {
    game = tick({ ...game, ownerAway: away.includes(game.day) })
  }
  return game
}

const NORMAND = GROCERS.grocers.chezNormand

describe('contractsBoard', () => {
  it('lists nobody before the first contract', () => {
    expect(contractsBoard(START)).toEqual({ grocers: [], owedTotal: 0 })
  })

  it('shows a contract signed on a Monday morning, with its first delivery the Monday after', () => {
    // Day 0 is a Monday, the grocers' delivery weekday.
    const game = signed(START, 'chezNormand')
    const board = contractsBoard(game)
    expect(board.grocers).toEqual([
      {
        grocer: 'chezNormand',
        name: 'Épicerie Chez Normand',
        owner: 'Normand',
        contract: {
          unitsPerWeek: 750,
          unitPrice: 210,
          premium: 0,
          weeksLeft: NORMAND.weeks,
          strikes: 0,
          maxStrikes: GROCERS.maxStrikes,
          week: { kind: 'first', day: 7 },
        },
        owed: [],
        owedTotal: 0,
      },
    ])
    expect(
      contractsBoard(playedTo(game, 3)).grocers[0]?.contract?.week,
    ).toEqual({ kind: 'first', day: 7 })
  })

  it('shows the delivery due this morning, then made, with what the grocer owes', () => {
    const game = playedTo(signed(START, 'chezNormand'), 7)
    expect(contractsBoard(game).grocers[0]?.contract?.week).toEqual({
      kind: 'due',
      day: 7,
    })

    const after = tick(game)
    const amount = 750 * 210
    const [line] = contractsBoard(after).grocers
    expect(line?.contract).toMatchObject({
      weeksLeft: NORMAND.weeks - 1,
      week: { kind: 'delivered', day: 7, units: 750, amount },
    })
    expect(line?.owed).toEqual([{ amount, dueDay: 7 + NORMAND.paymentDays }])
    expect(line?.owedTotal).toBe(amount)
    // Later in the week, the delivery stays this week's.
    expect(
      contractsBoard(playedTo(after, 13)).grocers[0]?.contract?.week,
    ).toEqual({ kind: 'delivered', day: 7, units: 750, amount })
  })

  it('shows a delivery nobody made, and the strike against the contract', () => {
    const after = playedTo(signed(START, 'chezNormand'), 8, [7])
    expect(after.contracts.missed).toEqual([{ day: 7, grocer: 'chezNormand' }])
    const [line] = contractsBoard(after).grocers
    expect(line?.contract).toMatchObject({
      weeksLeft: NORMAND.weeks - 1,
      strikes: 1,
      week: { kind: 'missed', day: 7 },
    })
    expect(line?.owed).toEqual([])
  })

  it('keeps a grocer whose contract ended while they still owe, and only what they owe', () => {
    const last = {
      ...signed(START, 'depanneur2424'),
      receivables: [
        {
          client: 'Gilles Lacasse',
          amount: cents(50_000),
          soldOnDay: 0,
          dueDay: 30,
        },
      ],
    }
    const game = {
      ...last,
      contracts: {
        ...last.contracts,
        running: last.contracts.running.map((contract) => ({
          ...contract,
          weeksLeft: 1,
        })),
      },
    }
    const after = playedTo(game, 8)
    expect(after.contracts.running).toEqual([])
    const amount = 500 * 195
    expect(contractsBoard(after)).toEqual({
      grocers: [
        {
          grocer: 'depanneur2424',
          name: 'Dépanneur 24/24',
          owner: 'M. Kim',
          contract: null,
          owed: [{ amount, dueDay: 7 + 45 }],
          owedTotal: amount,
        },
      ],
      owedTotal: amount,
    })
  })

  it("lists the grocers in the content's order, with Bio-Logique's premium, and adds up what they owe", () => {
    const game = signed(
      signed(signed(START, 'depanneur2424'), 'marcheBioLogique'),
      'chezNormand',
    )
    const after = playedTo(game, 8)
    const board = contractsBoard(after)
    expect(board.grocers.map(({ grocer }) => grocer)).toEqual([
      'chezNormand',
      'marcheBioLogique',
      'depanneur2424',
    ])
    expect(board.grocers[1]?.contract).toMatchObject({
      unitPrice: 225,
      premium: 40,
    })
    expect(board.owedTotal).toBe(750 * 210 + 1250 * 225 + 500 * 195)
  })
})
