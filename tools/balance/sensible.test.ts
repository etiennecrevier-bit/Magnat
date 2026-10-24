import { describe, expect, it } from 'vitest'
import type { EventCard } from '../../src/content/schema.ts'
import { EVENTS, FOOD_TRUCK } from '../../src/engine/day.ts'
import { applyDecision, latestDecisions } from '../../src/engine/decisions.ts'
import { FINANCING } from '../../src/engine/financing.ts'
import { cents } from '../../src/engine/money.ts'
import type { GameState } from '../../src/engine/types.ts'
import { contractChoices, financingChoices, grocerOf } from '../sim/simulate.ts'
import { carefulSigning, contractReserve, grocersBySize } from './growth.ts'
import {
  LETTERS,
  RESTOCK_MARGIN,
  SENSIBLE_EVENTS,
  answerIndex,
  changesOn,
  choiceOf,
  lastDayOf,
  playSensibleGame,
  playUntil,
  restocked,
  sensiblePolicy,
  startPlayer,
  warnedBefore,
  type Player,
} from './sensible.ts'

// The sensible player of #298: how it restocks, answers each card and
// signs, that a game can be played on from any morning, and how it reads
// a bankruptcy's warnings.

function card(id: string): EventCard {
  const found = EVENTS.events.find((each) => each.id === id)
  if (found === undefined) throw new Error(`No card ${id}`)
  return found
}

const OFFERS = EVENTS.events.filter(
  ({ conditions }) => conditions?.grocer !== undefined,
)
const RENEWALS = EVENTS.events.filter(
  (each) => grocerOf(each) !== null && each.conditions?.grocer === undefined,
)

function offerOf(grocer: string): EventCard {
  const found = OFFERS.find(({ conditions }) => conditions?.grocer === grocer)
  if (found === undefined) throw new Error(`No offer from ${grocer}`)
  return found
}

/** `player` on `day`'s morning with `cash` at the last close. */
function on(player: Player, day: number, cash: number): Player {
  return {
    state: { ...player.state, day },
    memory: { ...player.memory, cash: cents(cash) },
  }
}

describe('the sensible policy', () => {
  it('plays every card of the content, Mme Prudhomme letters included', () => {
    for (const letter of LETTERS) {
      expect(SENSIBLE_EVENTS.events.some(({ id }) => id === letter)).toBe(true)
    }
    expect(LETTERS).toEqual(
      FINANCING.bankruptcy.notices.map(({ event }) => event),
    )
  })

  it('accepts the financing and the renewals, and restocks with its margin', () => {
    expect(sensiblePolicy()).toMatchObject({
      answers: 'random',
      offers: 'careful',
      renewals: true,
      financing: 'accept',
      restockMargin: RESTOCK_MARGIN,
    })
    expect(sensiblePolicy('first').answers).toBe('first')
  })
})

describe('restocked', () => {
  const { state } = startPlayer(1, 'moyen')

  it('decides croissants for the demand times the margin, rounded up', () => {
    const decided = restocked(state, 60, 1.15)
    expect(latestDecisions(decided).restock.croissant).toEqual({
      kind: 'buyDaily',
      quantity: 69,
    })
    // The day's own decisions stay: the change waits for the next morning.
    expect(decided.decisions.restock.croissant).toEqual(
      state.decisions.restock.croissant,
    )
  })

  it('stays within the content limits and leaves an equal rule alone', () => {
    const { max } = FOOD_TRUCK.decisionLimits.units
    expect(
      latestDecisions(restocked(state, 10_000, 1.15)).restock.croissant,
    ).toEqual({ kind: 'buyDaily', quantity: max })
    const seventy = restocked(state, 70, 1)
    expect(seventy).toBe(state)
  })

  it('decides what the bakery bakes when it makes the croissants', () => {
    const baking = [
      { kind: 'openBakery', oven: 'louer' },
      { kind: 'croissantSource', source: 'fabriquer' },
    ] as const
    const opened = baking.reduce<GameState>(
      (each, change) => applyDecision(each, change),
      state,
    )
    const decided = latestDecisions(restocked(opened, 100, 1.15))
    expect(decided.bake).toEqual({ kind: 'buyDaily', quantity: 115 })
    expect(decided.restock.croissant).toEqual(
      latestDecisions(opened).restock.croissant,
    )
  })
})

describe('answerIndex', () => {
  it('answers the first choice, or one drawn from the seed and the day alone', () => {
    expect(answerIndex('first', 7, 30, 3)).toBe(0)
    const drawn = Array.from({ length: 60 }, (_, day) =>
      answerIndex('random', 7, day, 3),
    )
    expect(new Set(drawn)).toEqual(new Set([0, 1, 2]))
    expect(drawn).toEqual(
      Array.from({ length: 60 }, (_, day) => answerIndex('random', 7, day, 3)),
    )
  })
})

describe('choiceOf', () => {
  const player = startPlayer(1, 'moyen')

  it('acknowledges each letter with its one choice', () => {
    for (const letter of LETTERS) {
      const [only] = card(letter).choices
      expect(choiceOf(card(letter), player, sensiblePolicy()).choice).toBe(
        only?.id,
      )
    }
  })

  it('answers the financing by the policy', () => {
    const loan = card(FINANCING.loanEvent)
    const shares = card(FINANCING.investorEvent)
    const policy = sensiblePolicy()
    expect(choiceOf(loan, player, policy).choice).toBe(
      financingChoices(loan).accept,
    )
    expect(
      choiceOf(shares, player, { ...policy, financing: 'loanOnly' }).choice,
    ).toBe(financingChoices(shares).refuse)
    expect(
      choiceOf(loan, player, { ...policy, financing: 'loanOnly' }).choice,
    ).toBe(financingChoices(loan).accept)
    expect(
      choiceOf(loan, player, { ...policy, financing: 'refuse' }).choice,
    ).toBe(financingChoices(loan).refuse)
  })

  it("signs only the careful chain's next grocer, with its reserve on hand", () => {
    const [first, second] = grocersBySize()
    if (first === undefined || second === undefined) throw new Error('grocers')
    const reserve = contractReserve(first)
    const policy = sensiblePolicy()
    const rich = on(player, 20, reserve)
    expect(choiceOf(offerOf(first), rich, policy)).toEqual({
      choice: contractChoices(offerOf(first)).accept,
      signs: first,
    })
    expect(choiceOf(offerOf(second), rich, policy).signs).toBeNull()
    const poor = on(player, 20, reserve - 1)
    expect(choiceOf(offerOf(first), poor, policy)).toEqual({
      choice: contractChoices(offerOf(first)).refuse,
      signs: null,
    })
    expect(
      choiceOf(offerOf(first), rich, { ...policy, offers: 'none' }).signs,
    ).toBeNull()
    expect(
      choiceOf(offerOf(second), poor, { ...policy, offers: 'all' }).signs,
    ).toBe(second)
  })

  it('signs no second grocer before month 2', () => {
    const [first, second] = grocersBySize()
    if (first === undefined || second === undefined) throw new Error('grocers')
    const signed: Player = {
      state: {
        ...player.state,
        day: 20,
        contracts: {
          ...player.state.contracts,
          deliveries: [
            {
              grocer: first,
              dueDay: 10,
            } as GameState['contracts']['deliveries'][number],
          ],
        },
      },
      memory: {
        ...player.memory,
        cash: cents(10_000_000),
        signings: [{ grocer: first, day: 5 }],
      },
    }
    expect(carefulSigning(signed.state, [first], signed.memory.cash)).toBe(
      second,
    )
    expect(choiceOf(offerOf(second), signed, sensiblePolicy()).signs).toBeNull()
    const june: Player = { ...signed, state: { ...signed.state, day: 31 } }
    expect(choiceOf(offerOf(second), june, sensiblePolicy()).signs).toBe(second)
  })

  it('accepts the renewals unless told not to', () => {
    const [renewal] = RENEWALS
    if (renewal === undefined) throw new Error('No renewal')
    const { accept, refuse } = contractChoices(renewal)
    expect(choiceOf(renewal, player, sensiblePolicy()).choice).toBe(accept)
    expect(
      choiceOf(renewal, player, { ...sensiblePolicy(), renewals: false })
        .choice,
    ).toBe(refuse)
  })
})

describe('playUntil', () => {
  it('plays on from any morning as one game would', () => {
    const policy = sensiblePolicy()
    const whole = playUntil(startPlayer(3, 'moyen'), policy, 120)
    const half = playUntil(startPlayer(3, 'moyen'), policy, 59)
    expect(half.state.day).toBe(60)
    const rest = playUntil(half, policy, 120)
    expect(rest.state.journal).toEqual(whole.state.journal)
    expect(rest.memory).toEqual(whole.memory)
  })

  it('restocks for the last open day, and makes the script and the signing', () => {
    const policy = { ...sensiblePolicy(), signAllOn: 3 }
    const script = changesOn(5, [{ kind: 'marketingDaily', budget: cents(0) }])
    const played = playUntil(
      startPlayer(2, 'moyen'),
      policy,
      10,
      undefined,
      script,
    )
    const { signings } = played.memory
    // Decided on day 10's morning, from the demand known then.
    const { lastDemand } = playUntil(
      startPlayer(2, 'moyen'),
      policy,
      9,
      undefined,
      script,
    ).memory
    expect(lastDemand).not.toBeNull()
    expect(latestDecisions(played.state).restock.croissant).toEqual({
      kind: 'buyDaily',
      quantity: Math.ceil((lastDemand ?? 0) * RESTOCK_MARGIN),
    })
    expect(signings.map(({ grocer, day }) => [grocer, day])).toEqual(
      grocersBySize().map((grocer) => [grocer, 3]),
    )
    expect(played.state.decisions.marketingDaily).toBe(0)
  })
})

describe('playSensibleGame', () => {
  it('is deterministic, and signs at most one grocer before month 2', () => {
    for (const seed of [1, 2, 3]) {
      const a = playSensibleGame(seed, 'difficile', 3).game
      const b = playSensibleGame(seed, 'difficile', 3).game
      expect(a).toEqual(b)
      expect(
        a.signings.filter(({ day }) => day < 31).length,
      ).toBeLessThanOrEqual(1)
    }
  })

  it('plays to the last close of its last month', () => {
    const { player } = playSensibleGame(1, 'facile', 2)
    expect(player.state.lastDay?.day).toBe(lastDayOf(2))
  })
})

describe('warnedBefore', () => {
  const { state } = startPlayer(1, 'moyen')
  const ended: GameState = {
    ...state,
    ended: { reason: 'bankruptcy', day: 200 },
  }
  const lettered = (days: readonly number[]): GameState => ({
    ...ended,
    events: {
      ...ended.events,
      history: days.map((day, index) => ({
        event: LETTERS[index] ?? '',
        day,
        followUp: false,
        choice: 'lu',
        outcome: 0,
      })),
    },
  })

  it('holds for a game that did not end', () => {
    expect(warnedBefore(state, null)).toBe(true)
  })

  it('needs a close below zero and every letter before the end', () => {
    expect(warnedBefore(lettered([40, 100, 160]), 10)).toBe(true)
    expect(warnedBefore(lettered([40, 100, 160]), null)).toBe(false)
    expect(warnedBefore(lettered([40, 100, 260]), 10)).toBe(false)
    expect(warnedBefore(lettered([40, 100]), 10)).toBe(false)
  })
})
