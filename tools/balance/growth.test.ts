import { describe, expect, it } from 'vitest'
import type { EventCard } from '../../src/content/schema.ts'
import { endOfMonth } from '../../src/engine/calendar.ts'
import { GROCERS, noContracts } from '../../src/engine/contracts.ts'
import { DIFFICULTIES, EVENTS, FOOD_TRUCK } from '../../src/engine/day.ts'
import { DREAM, cashNeeded } from '../../src/engine/dream.ts'
import { FINANCING } from '../../src/engine/financing.ts'
import { cents } from '../../src/engine/money.ts'
import type { Delivery } from '../../src/engine/types.ts'
import { balance } from '../../src/finance/journal.ts'
import { financingChoices } from '../sim/simulate.ts'
import { AT_TRUCK_HIRE, BAKER_HIRE } from './bakery.ts'
import {
  BAKERY_OPENINGS,
  CONTRACT_PLANS,
  GROWTH_EVENTS,
  GROWTH_STRATEGIES,
  carefulSigning,
  contractReserve,
  duventWorth,
  grocersBySize,
  isLetter,
  letterChooser,
  loanOnlyChooser,
  monthOf,
  plannedGrocers,
  playGrowthGame,
  runGrowth,
  signingDay,
  strategyLabel,
  withLetters,
  type GrowthGame,
  type GrowthStrategy,
} from './growth.ts'

// The growth run of #166: its strategies, how a game signs, opens, hires,
// buys and borrows, and what it records.

const PLAIN: GrowthStrategy = {
  contracts: 'none',
  bakery: 'never',
  atTruck: false,
  dream: false,
  financing: 'accept',
}

/** The card of `events` with `id`. */
function card(id: string): EventCard {
  const found = EVENTS.events.find((each) => each.id === id)
  if (found === undefined) throw new Error(`No card ${id}`)
  return found
}

/** A delivery to `grocer` on `day`, paid on `dueDay`. */
function delivery(
  grocer: Delivery['grocer'],
  day: number,
  dueDay: number,
): Delivery {
  return { day, grocer, units: 1, baked: 0, amount: cents(100), dueDay }
}

describe('the grid', () => {
  it('plays 120 strategies, the contracts first and the financing last, each once', () => {
    expect(GROWTH_STRATEGIES).toHaveLength(120)
    expect(new Set(GROWTH_STRATEGIES.map(strategyLabel)).size).toBe(120)
    expect(GROWTH_STRATEGIES.slice(0, 3)).toEqual([
      PLAIN,
      { ...PLAIN, financing: 'refuse' },
      { ...PLAIN, dream: true },
    ])
    expect(GROWTH_STRATEGIES.at(-1)).toEqual({
      contracts: 'careful',
      bakery: 'month4',
      atTruck: true,
      dream: true,
      financing: 'refuse',
    })
    expect(CONTRACT_PLANS).toEqual(['none', 'one', 'two', 'three', 'careful'])
    expect(BAKERY_OPENINGS).toEqual(['never', 'day0', 'month4'])
  })

  it('signs the smallest grocers first', () => {
    const bySize = grocersBySize()
    const volumes = bySize.map((id) => GROCERS.grocers[id].unitsPerWeek)
    expect(volumes).toEqual([...volumes].sort((a, b) => a - b))
    expect(bySize).toEqual(['depanneur2424', 'chezNormand', 'marcheBioLogique'])
    expect(plannedGrocers('none')).toEqual([])
    expect(plannedGrocers('one')).toEqual(bySize.slice(0, 1))
    expect(plannedGrocers('two')).toEqual(bySize.slice(0, 2))
    expect(plannedGrocers('three')).toEqual(bySize)
    expect(plannedGrocers('careful')).toEqual(bySize)
  })

  it("signs from the grocers' first offer day in events.json", () => {
    const offers = EVENTS.events.filter(
      ({ conditions }) => conditions?.grocer !== undefined,
    )
    expect(offers).toHaveLength(3)
    expect(signingDay()).toBe(
      Math.min(...offers.map(({ conditions }) => conditions?.fromDay ?? 0)),
    )
    expect(signingDay()).toBe(30)
    expect(() => signingDay({ ...EVENTS, events: [] })).toThrow(RangeError)
  })

  it("keeps a reserve of a week's croissants for each week of the first payment, and one more", () => {
    const cost = FOOD_TRUCK.products.croissant.unitCostCents
    for (const grocer of grocersBySize()) {
      const { unitsPerWeek, paymentDays } = GROCERS.grocers[grocer]
      expect(contractReserve(grocer)).toBe(
        unitsPerWeek * cost * (Math.ceil(paymentDays / 7) + 1),
      )
    }
  })
})

describe('carefulSigning', () => {
  const [first = 'depanneur2424', second = 'chezNormand'] = grocersBySize()
  const plenty = cents(10_000_000)

  it('signs the first grocer once the reserve is on hand', () => {
    const state = { day: 30, contracts: noContracts() }
    const reserve = contractReserve(first)
    expect(carefulSigning(state, [], reserve)).toBe(first)
    expect(carefulSigning(state, [], cents(reserve - 1))).toBeNull()
  })

  it('waits for the last grocer signed to pay for a first delivery, before the morning', () => {
    const paid = (dueDay: number) => ({
      day: 80,
      contracts: {
        ...noContracts(),
        deliveries: [delivery(first, 35, dueDay)],
      },
    })
    // Due today: paid at the start of the day, after the morning's choice.
    expect(carefulSigning(paid(80), [first], plenty)).toBeNull()
    expect(carefulSigning(paid(79), [first], plenty)).toBe(second)
    // Another grocer's payment does not count.
    const other = {
      day: 80,
      contracts: {
        ...noContracts(),
        deliveries: [delivery(second, 35, 50)],
      },
    }
    expect(carefulSigning(other, [first], plenty)).toBeNull()
  })

  it("waits for the next grocer's reserve too, and stops once all are signed", () => {
    const state = {
      day: 80,
      contracts: { ...noContracts(), deliveries: [delivery(first, 35, 79)] },
    }
    const reserve = contractReserve(second)
    expect(carefulSigning(state, [first], cents(reserve - 1))).toBeNull()
    expect(carefulSigning(state, [first], reserve)).toBe(second)
    expect(carefulSigning(state, grocersBySize(), plenty)).toBeNull()
  })
})

describe('loanOnlyChooser', () => {
  it("takes Mme Prudhomme's loan, refuses Max Duvent, and leaves the rest to the fallback", () => {
    const choose = loanOnlyChooser(() => 'fallback')
    const loan = card(FINANCING.loanEvent)
    const investor = card(FINANCING.investorEvent)
    expect(choose(loan)).toBe(financingChoices(loan).accept)
    expect(choose(investor)).toBe(financingChoices(investor).refuse)
    expect(choose(card('renouvellementNormand'))).toBe('fallback')
    expect(() => loanOnlyChooser(null)(card('renouvellementNormand'))).toThrow(
      RangeError,
    )
  })

  it('is what a growth game plays with the financing cards', () => {
    const ids = GROWTH_EVENTS.events.map(({ id }) => id)
    expect(ids).toContain(FINANCING.loanEvent)
    expect(ids).toContain(FINANCING.investorEvent)
    expect(GROWTH_EVENTS.pacing.dailyChance).toBe(0)
  })
})

describe('monthOf', () => {
  it('counts the months from May 1st, day 0', () => {
    expect(monthOf(0)).toBe(1)
    expect(monthOf(30)).toBe(1)
    expect(monthOf(31)).toBe(2)
    expect(monthOf(endOfMonth(0, 2))).toBe(3)
    expect(monthOf(729)).toBe(24)
  })
})

describe('playGrowthGame', () => {
  it('signs every contract of its plan on day 30, and the careful chain one at a time', () => {
    const signed = (contracts: GrowthStrategy['contracts']) =>
      playGrowthGame(1, 'moyen', { ...PLAIN, contracts }, 6).game.signings
    expect(signed('none')).toEqual([])
    expect(signed('one')).toEqual([{ grocer: 'depanneur2424', day: 30 }])
    expect(signed('three')).toEqual(
      grocersBySize().map((grocer) => ({ grocer, day: 30 })),
    )
    const { game, state } = playGrowthGame(
      1,
      'moyen',
      { ...PLAIN, contracts: 'careful' },
      6,
    )
    const [first, second] = game.signings
    expect(first).toEqual({ grocer: 'depanneur2424', day: 30 })
    expect(second?.grocer).toBe('chezNormand')
    // The Dépanneur paid for its first delivery before Normand signed.
    const firstPaid = Math.min(
      ...state.contracts.deliveries
        .filter(({ grocer }) => grocer === 'depanneur2424')
        .map(({ dueDay }) => dueDay),
    )
    expect(second?.day).toBeGreaterThan(firstPaid)
    // Renewals are accepted, and are not signings.
    const renewed = playGrowthGame(
      1,
      'moyen',
      { ...PLAIN, contracts: 'one' },
      4,
    ).state
    expect(
      renewed.events.history.map(({ event, choice }) => [event, choice]),
    ).toEqual([['renouvellementDepanneur', 'accepter']])
  })

  it('opens the bakery on day 0, or in effect the morning after the 1st of month 4, with a baker', () => {
    const opened = (bakery: GrowthStrategy['bakery']) =>
      playGrowthGame(1, 'facile', { ...PLAIN, bakery }, 4).state
    expect(opened('never').bakery.openedOnDay).toBeNull()
    expect(opened('day0').bakery).toMatchObject({
      openedOnDay: 0,
      oven: 'louer',
    })
    const late = opened('month4')
    expect(late.bakery.openedOnDay).toBe(endOfMonth(0, 2) + 2)
    for (const state of [opened('day0'), late]) {
      expect(state.staff.map(({ candidate }) => candidate)).toEqual([
        BAKER_HIRE.candidate,
      ])
      expect(state.decisions.croissantSource).toBe('fabriquer')
    }
  })

  it('hires the employee at the truck on day 0', () => {
    const { state } = playGrowthGame(
      1,
      'facile',
      { ...PLAIN, atTruck: true },
      1,
    )
    expect(state.staff).toMatchObject([
      { role: AT_TRUCK_HIRE.role, candidate: AT_TRUCK_HIRE.candidate },
    ])
  })

  it('buys each rung of « Le rêve » the first morning it can, and none without the dream', () => {
    const months = 12
    const dreaming = { ...PLAIN, dream: true }
    const { game, state } = playGrowthGame(1, 'facile', dreaming, months)
    const [personal, company] = [DREAM.personal[0], DREAM.company[0]]
    if (personal === undefined || company === undefined) {
      throw new Error('No rung')
    }
    // Facile opens with enough for both first rungs: both on day 0.
    const { startingCashCents, startingPersonalCashCents } =
      DIFFICULTIES.difficulties.facile
    expect(startingPersonalCashCents).toBeGreaterThanOrEqual(
      cashNeeded(personal),
    )
    expect(startingCashCents).toBeGreaterThanOrEqual(cashNeeded(company))
    expect(state.dream.bought.slice(0, 2)).toMatchObject([
      { rung: personal.id, day: 0 },
      { rung: company.id, day: 0 },
    ])
    expect(game.rungsBought).toBe(state.dream.bought.length)
    // A later company rung: Encaisse covered it that morning, and not the
    // morning before.
    const later = state.dream.bought.filter(({ rung, day }) =>
      DREAM.company.some((each) => each.id === rung && day > 0),
    )
    expect(later.length).toBeGreaterThan(0)
    for (const { rung, day } of later) {
      const needed = cashNeeded(
        DREAM.company.find((each) => each.id === rung) ?? company,
      )
      const morning = (on: number) =>
        balance(state.journal, '1000', { toDay: on - 1 })
      expect(morning(day)).toBeGreaterThanOrEqual(needed)
      expect(morning(day - 1)).toBeLessThan(needed)
    }
    // Each ladder in order.
    for (const ladder of [DREAM.personal, DREAM.company]) {
      const ids = ladder.map(({ id }) => id)
      const bought = state.dream.bought
        .map(({ rung }) => rung)
        .filter((rung) => ids.includes(rung))
      expect(bought).toEqual(ids.slice(0, bought.length))
    }
    expect(
      playGrowthGame(1, 'facile', PLAIN, months).state.dream.bought,
    ).toEqual([])
  })

  it('records the closes below zero, the lowest close and the net worth at each month end', () => {
    const months = 4
    const { game, state } = playGrowthGame(
      1,
      'difficile',
      { ...PLAIN, contracts: 'three' },
      months,
    )
    const closes = Array.from(
      { length: endOfMonth(0, months - 1) + 1 },
      (_, day) => balance(state.journal, '1000', { toDay: day }),
    )
    const firstBelow = closes.findIndex((cash) => cash < 0)
    expect(firstBelow).toBeGreaterThan(-1)
    expect(game.firstDayBelowZero).toBe(firstBelow)
    expect(game.lowestClose).toBe(Math.min(...closes))
    expect(game.netWorthAtMonthEnds).toHaveLength(months)
    expect(game.netWorthAtEnd).toBe(game.netWorthAtMonthEnds.at(-1))
    expect(game.emergencyLoans).toBe(state.financing.loans.length)
    expect(game.endedDay).toBeNull()
    // Never below zero: none recorded.
    const plain = playGrowthGame(1, 'difficile', PLAIN, 2).game
    expect(plain.firstDayBelowZero).toBeNull()
    expect(plain.lowestClose).toBeGreaterThanOrEqual(0)
  })

  it('stops at the close that ends the game in bankruptcy', () => {
    const strategy: GrowthStrategy = {
      ...PLAIN,
      bakery: 'day0',
      atTruck: true,
      financing: 'refuse',
    }
    const { game, state } = playGrowthGame(1, 'difficile', strategy, 24)
    expect(state.ended?.reason).toBe('bankruptcy')
    const ended = state.ended?.day ?? -1
    expect(game.endedDay).toBe(ended)
    expect(state.lastDay?.day).toBe(ended)
    expect(game.netWorthAtMonthEnds).toHaveLength(monthOf(ended))
    expect(game.netWorthAtEnd).toBe(game.netWorthAtMonthEnds.at(-1))
  })

  it('plays the same game from the same seed', () => {
    const strategy: GrowthStrategy = {
      contracts: 'careful',
      bakery: 'month4',
      atTruck: true,
      dream: true,
      financing: 'accept',
    }
    expect(playGrowthGame(3, 'moyen', strategy, 6).game).toEqual(
      playGrowthGame(3, 'moyen', strategy, 6).game,
    )
  })
})

describe('duventWorth', () => {
  const game = (
    endedDay: number | null,
    netWorthAtEnd: number,
    twin: { endedDay: number | null; netWorthAtEnd: number } | null,
  ): GrowthGame => ({
    seed: 1,
    netWorthAtMonthEnds: [],
    netWorthAtEnd: cents(netWorthAtEnd),
    firstDayBelowZero: 40,
    lowestClose: cents(-1),
    emergencyLoans: 1,
    shareSales: twin === null ? 0 : 1,
    duventCame: twin !== null,
    endedDay,
    magnat: false,
    rungsBought: 0,
    signings: [],
    withoutDuvent:
      twin === null
        ? null
        : { endedDay: twin.endedDay, netWorthAtEnd: cents(twin.netWorthAtEnd) },
  })

  it('is worth it when it avoids a bankruptcy, or ends higher alike', () => {
    expect(
      duventWorth(game(null, 1, { endedDay: 200, netWorthAtEnd: 5 })),
    ).toBe(true)
    expect(
      duventWorth(game(200, 5, { endedDay: null, netWorthAtEnd: 1 })),
    ).toBe(false)
    expect(
      duventWorth(game(null, 5, { endedDay: null, netWorthAtEnd: 1 })),
    ).toBe(true)
    expect(
      duventWorth(game(null, 1, { endedDay: null, netWorthAtEnd: 1 })),
    ).toBe(false)
    expect(duventWorth(game(300, 2, { endedDay: 200, netWorthAtEnd: 1 }))).toBe(
      true,
    )
    expect(duventWorth(game(null, 1, null))).toBeNull()
  })
})

describe('runGrowth', () => {
  it("plays its plan's strategies in the grid's order, a twin for each game that took Max Duvent's money, the same every time", () => {
    const job = {
      kind: 'growth',
      difficulty: 'difficile',
      contracts: 'three',
      games: 2,
      months: 3,
    } as const
    const run = runGrowth(job)
    expect(run).toMatchObject({
      difficulty: 'difficile',
      contracts: 'three',
      games: 2,
      months: 3,
    })
    expect(run.strategies.map(({ strategy }) => strategy)).toEqual(
      GROWTH_STRATEGIES.filter(({ contracts }) => contracts === 'three'),
    )
    const games = run.strategies.flatMap(({ strategy, games: played }) =>
      played.map((game) => ({ strategy, game })),
    )
    expect(games).toHaveLength(48)
    for (const { strategy, game } of games) {
      const took = strategy.financing === 'accept' && game.duventCame
      expect(game.withoutDuvent !== null).toBe(took)
      if (game.withoutDuvent !== null) {
        const twin = playGrowthGame(
          game.seed,
          'difficile',
          strategy,
          job.months,
          'loanOnly',
        ).game
        expect(game.withoutDuvent).toEqual({
          endedDay: twin.endedDay,
          netWorthAtEnd: twin.netWorthAtEnd,
        })
        expect(twin.shareSales).toBe(0)
      }
    }
    expect(games.some(({ game }) => game.withoutDuvent !== null)).toBe(true)
    expect(runGrowth(job)).toEqual(run)
  }, 30_000)
})

describe("Mme Prudhomme's letters in a growth game (#298)", () => {
  const letters = FINANCING.bankruptcy.notices.map(({ event }) => event)
  const lettered = withLetters(GROWTH_EVENTS)

  it('adds the letters once, after the content', () => {
    expect(GROWTH_EVENTS.events.some(isLetter)).toBe(false)
    expect(lettered.events.filter(isLetter).map(({ id }) => id)).toEqual(
      letters,
    )
    expect(withLetters(lettered)).toBe(lettered)
  })

  it('acknowledges a letter with its one choice, and nothing else', () => {
    const [letter] = lettered.events.filter(isLetter)
    if (letter === undefined) throw new Error('No letter')
    expect(letterChooser(null)(letter)).toBe(letter.choices[0]?.id)
    const loan = EVENTS.events.find(({ id }) => id === FINANCING.loanEvent)
    if (loan === undefined) throw new Error('No loan card')
    expect(() => letterChooser(null)(loan)).toThrow(RangeError)
    expect(letterChooser(() => 'autre')(loan)).toBe('autre')
    const twice = { ...letter, choices: [...letter.choices, ...letter.choices] }
    expect(() => letterChooser(null)(twice)).toThrow(RangeError)
  })

  it('gets a letter when its content holds them, and none when it does not', () => {
    const naive: GrowthStrategy = {
      ...PLAIN,
      contracts: 'three',
      financing: 'refuse',
    }
    const { state } = playGrowthGame(
      1,
      'difficile',
      naive,
      6,
      'refuse',
      lettered,
    )
    expect(
      state.events.history.filter(({ event }) => letters.includes(event)),
    ).not.toEqual([])
    const plain = playGrowthGame(1, 'difficile', naive, 6).state
    expect(
      plain.events.history.some(({ event }) => letters.includes(event)),
    ).toBe(false)
  })
})
