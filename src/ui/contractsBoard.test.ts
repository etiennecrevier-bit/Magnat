import { describe, expect, it } from 'vitest'
import type { GrocerId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { GROCERS, startContract } from '../engine/contracts.ts'
import { cents } from '../engine/money.ts'
import type { Day, GameState } from '../engine/types.ts'
import {
  contractsBoard,
  grocerLine,
  grocerTip,
  withGrocer,
  type GrocerLine,
} from './contractsBoard.ts'

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

// Every space before a colon and in an amount is a no-break space (U+00A0).
const S = '\u00a0'

/** Normand's contract signed on day 0, played to the morning of day 8. */
function normandDelivered(): GrocerLine {
  const line = contractsBoard(playedTo(signed(START, 'chezNormand'), 8))
    .grocers[0]
  if (line === undefined) throw new Error('No grocer')
  return line
}

describe('withGrocer', () => {
  it('adds the grocer the city picked, with no contract and nothing owed, in the content’s order', () => {
    const board = contractsBoard(playedTo(signed(START, 'depanneur2424'), 8))
    expect(
      withGrocer(board, 'chezNormand').map(({ grocer }) => grocer),
    ).toEqual(['chezNormand', 'depanneur2424'])
    expect(withGrocer(board, 'chezNormand')[0]).toEqual({
      grocer: 'chezNormand',
      name: NORMAND.name,
      owner: NORMAND.owner,
      contract: null,
      owed: [],
      owedTotal: 0,
    })
  })

  it('leaves the board as it is with no grocer, or one already on it', () => {
    const board = contractsBoard(playedTo(signed(START, 'chezNormand'), 8))
    expect(withGrocer(board, null)).toBe(board.grocers)
    expect(withGrocer(board, 'chezNormand')).toBe(board.grocers)
  })
})

describe('grocerLine', () => {
  const line = normandDelivered()
  const contract = line.contract!
  const week = (w: NonNullable<GrocerLine['contract']>['week']) =>
    grocerLine({ ...line, contract: { ...contract, week: w } }).fact

  it('says this week’s delivery, in a tone for each', () => {
    expect(grocerLine(line)).toEqual({
      fact: {
        tone: 'ok',
        text: `750 croissants livrés lundi, 1${S}575,00${S}$`,
      },
      tomorrow: null,
    })
    expect(week({ kind: 'due', day: 14 })).toEqual({
      tone: 'warn',
      text: 'Livraison lundi',
    })
    expect(week({ kind: 'missed', day: 7 })).toEqual({
      tone: 'bad',
      text: 'Livraison manquée lundi',
    })
    expect(week({ kind: 'first', day: 14 })).toEqual({
      tone: 'off',
      text: 'Première livraison le 15 mai',
    })
  })

  it('says « Aucun contrat en cours » for a grocer without one', () => {
    expect(grocerLine({ ...line, contract: null }).fact).toEqual({
      tone: 'off',
      text: 'Aucun contrat en cours',
    })
  })
})

describe('grocerTip', () => {
  it('names the grocer and who runs it, their contract, then what they owe by due day', () => {
    expect(grocerTip(normandDelivered())).toEqual({
      title: 'Épicerie Chez Normand',
      text: 'Normand',
      rows: [
        { label: 'Par semaine', value: `750 croissants à 2,10${S}$` },
        { label: 'Semaines restantes', value: '11' },
        { label: 'Livraisons manquées', value: '0 sur 3', warn: false },
        { label: 'À recevoir', value: `1${S}575,00${S}$`, divider: true },
        { label: 'Le 7 juillet', value: `1${S}575,00${S}$` },
      ],
    })
  })

  it('adds the bakery’s premium, and warns of a missed delivery', () => {
    const line = normandDelivered()
    const contract = { ...line.contract!, premium: cents(40), strikes: 1 }
    const { rows } = grocerTip({ ...line, contract })
    expect(rows).toContainEqual({
      label: 'Prime du fournil',
      value: `+0,40${S}$ par croissant`,
    })
    expect(rows).toContainEqual({
      label: 'Livraisons manquées',
      value: '1 sur 3',
      warn: true,
    })
  })

  it('shows only who runs it for a grocer with no contract and nothing owed', () => {
    const line = withGrocer(contractsBoard(START), 'depanneur2424')[0]!
    expect(grocerTip(line)).toEqual({
      title: 'Dépanneur 24/24',
      text: 'M. Kim',
      rows: [],
    })
  })
})
