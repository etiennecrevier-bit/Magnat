import { describe, expect, it } from 'vitest'
import {
  loadEventContent,
  type DifficultyId,
  type EventContent,
} from '../../src/content/schema.ts'
import { createInitialState, tick } from '../../src/engine/clock.ts'
import { ENERGY, EVENTS, FOOD_TRUCK } from '../../src/engine/day.ts'
import {
  applyDecision,
  type DecisionChange,
} from '../../src/engine/decisions.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { latestDecisions } from '../../src/engine/decisions.ts'
import { FULL_ENERGY, nightRest } from '../../src/engine/energy.ts'
import { cents } from '../../src/engine/money.ts'
import { isKept } from '../../src/engine/personal.ts'
import { defaultProfile } from '../../src/engine/profile.ts'
import type { DaySummary, PerProduct } from '../../src/engine/types.ts'
import { getAccount } from '../../src/finance/accounts.ts'
import { emptyJournal, postEntry } from '../../src/finance/journal.ts'
import {
  eventChooser,
  journalHash,
  modifierDays,
  simulate,
  type SimulationResult,
} from './simulate.ts'

// The headless runner: what it plays, how it splits the run into years, and
// that every number it sums up agrees with the books and the days played.
// The ten-year runs live in tests/invariants.test.ts.

const run = simulate(7, 400)

function units(counts: PerProduct): number {
  return PRODUCTS.reduce((total, product) => total + counts[product], 0)
}

function spans(result: {
  years: readonly { fromDay: number; toDay: number }[]
}) {
  return result.years.map(({ fromDay, toDay }) => [fromDay, toDay])
}

describe('simulate', () => {
  it("plays every day from day 0, at the new game screen's difficulty", () => {
    expect(run).toMatchObject({ seed: 7, difficulty: 'moyen', days: 400 })
    expect(run.daySummaries.map(({ day }) => day)).toEqual(
      Array.from({ length: 400 }, (_, day) => day),
    )
    // Nothing is owed on a closed day that is no 1st of the month nor
    // payday, so the last entry may come before the last day played.
    expect(run.journal.at(-1)?.day).toBeLessThanOrEqual(399)
    expect(run.journal.some(({ day }) => day >= 398)).toBe(true)
  })

  it('counts years from the first day of play, the last one cut short', () => {
    expect(run.years.map(({ year }) => year)).toEqual([1, 2])
    expect(spans(run)).toEqual([
      [0, 364],
      [365, 399],
    ])
  })

  it('ends a run of exactly one year without starting another', () => {
    expect(spans(simulate(7, 365))).toEqual([[0, 364]])
  })

  it('sums up a run shorter than a year as one year', () => {
    expect(spans(simulate(7, 40))).toEqual([[0, 39]])
  })

  it('reads revenue from the books, in agreement with the days played', () => {
    for (const year of run.years) {
      const played = run.daySummaries.slice(year.fromDay, year.toDay + 1)
      expect(year.revenue).toBe(
        played.reduce((total, { revenue }) => total + revenue, 0),
      )
      expect(year.revenue).toBeGreaterThan(0)
    }
  })

  it('reads net income and cash at year end from the books', () => {
    for (const year of run.years) {
      const inYear = run.journal.filter(
        ({ day }) => day >= year.fromDay && day <= year.toDay,
      )
      // Income and charge accounts are the only ones in net income: their
      // credits minus their debits.
      const netIncome = inYear
        .flatMap(({ lines }) => lines)
        .filter(({ account }) =>
          ['produit', 'charge'].includes(getAccount(account).type),
        )
        .reduce((total, { debit, credit }) => total + credit - debit, 0)
      expect(year.netIncome).toBe(netIncome)

      const cash = run.journal
        .filter(({ day }) => day <= year.toDay)
        .flatMap(({ lines }) => lines)
        .filter(({ account }) => account === '1000')
        .reduce((total, { debit, credit }) => total + debit - credit, 0)
      expect(year.cashAtYearEnd).toBe(cash)
    }
  })

  it('adds up spoiled units and lost sales over every product', () => {
    for (const year of run.years) {
      const played = run.daySummaries.slice(year.fromDay, year.toDay + 1)
      expect(year.unitsSpoiled).toBe(
        played.reduce((total, { spoiled }) => total + units(spoiled), 0),
      )
      expect(year.lostSales).toBe(
        played.reduce((total, { lostSales }) => total + units(lostSales), 0),
      )
    }
    expect(run.years[0]?.unitsSpoiled).toBeGreaterThan(0)
  })

  it('hashes the journal it returns', () => {
    const books = run.journal.reduce(postEntry, emptyJournal())
    expect(run.journalHash).toBe(journalHash(books))
  })

  it.each([0, -1, 1.5, Number.NaN, Infinity, 2 ** 53])(
    'rejects %s days',
    (days) => {
      expect(() => simulate(7, days)).toThrow(RangeError)
    },
  )

  it('rejects a seed the engine rejects', () => {
    expect(() => simulate(-1, 10)).toThrow(RangeError)
  })

  it('plays the difficulty it is given, from its own opening books', () => {
    const books = (difficulty: DifficultyId) =>
      simulate(7, 1, difficulty).journal.filter(({ day }) => day === 0)
    const memos = (difficulty: DifficultyId) =>
      books(difficulty).map(({ memo }) => memo)
    expect(simulate(7, 40, 'difficile')).toMatchObject({
      difficulty: 'difficile',
    })
    expect(memos('facile')).toContain('Camion apporté par le propriétaire')
    expect(memos('moyen')).toContain('Emprunt de démarrage')
    expect(memos('difficile')).toContain('Location du camion')
    expect(simulate(7, 40, 'moyen').journalHash).toBe(
      simulate(7, 40).journalHash,
    )
  })

  it('rejects a difficulty the engine does not know', () => {
    expect(() => simulate(7, 10, 'extreme' as DifficultyId)).toThrow(RangeError)
  })
})

describe('simulate with decision changes', () => {
  const everyDay: DecisionChange = {
    kind: 'daysOpen',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  }
  const prices: DecisionChange[] = [
    { kind: 'price', product: 'cafe', price: cents(400) },
    { kind: 'price', product: 'chocolat', price: cents(425) },
    { kind: 'price', product: 'croissant', price: cents(450) },
  ]
  const croissants = (quantity: number): DecisionChange => ({
    kind: 'restock',
    product: 'croissant',
    rule: { kind: 'buyDaily', quantity },
  })

  function played(result: SimulationResult, day: number): DaySummary {
    const summary = result.daySummaries[day]
    if (summary === undefined) throw new Error(`Day ${day} was not played`)
    return summary
  }

  it('puts them in effect from day 0, a Monday', () => {
    // The starting days skip Monday, so day 0 has no walk-ins.
    expect(played(simulate(7, 1), 0).visits).toEqual([])
    const monday = played(simulate(7, 1, 'moyen', [...prices, everyDay]), 0)
    expect(monday.visits.length).toBeGreaterThan(0)
    expect(monday.revenue).toBe(
      400 * monday.sold.cafe +
        425 * monday.sold.chocolat +
        450 * monday.sold.croissant,
    )
  })

  it('makes them in order, the last one winning', () => {
    const run = simulate(7, 2, 'moyen', [croissants(20), croissants(110)])
    // A croissant keeps for one day, so what was bought on a day the truck
    // opens is sold or written off by its close.
    const { sold, spoiled } = played(run, 1)
    expect(sold.croissant + spoiled.croissant).toBe(110)
  })

  it('plays the same game with no changes as with the starting decisions', () => {
    const start = FOOD_TRUCK.startingDecisions
    const same: DecisionChange[] = [
      ...PRODUCTS.map((product): DecisionChange => ({
        kind: 'price',
        product,
        price: start.pricesCents[product],
      })),
      { kind: 'daysOpen', weekdays: start.daysOpen },
    ]
    const hash = simulate(7, 40).journalHash
    expect(simulate(7, 40, 'moyen', []).journalHash).toBe(hash)
    expect(simulate(7, 40, 'moyen', same).journalHash).toBe(hash)
    expect(simulate(7, 40, 'moyen', [croissants(110)]).journalHash).not.toBe(
      hash,
    )
  })

  it('rejects a change applyDecision rejects', () => {
    expect(() => simulate(7, 1, 'moyen', [croissants(501)])).toThrow(
      'restock.croissant.quantity',
    )
    expect(() =>
      simulate(7, 1, 'moyen', [
        { kind: 'price', product: 'cafe', price: cents(327) },
      ]),
    ).toThrow(RangeError)
  })
})

describe("simulate's owner", () => {
  const lowPay: DecisionChange = { kind: 'ownerWeeklyPay', pay: cents(40_000) }

  it('reads the energy each morning, before the day is played', () => {
    const days = 60
    const result = simulate(7, days)
    // The same game by hand: no changes, so the starting decisions.
    let state = createInitialState(7, FOOD_TRUCK, {
      ...defaultProfile(),
      difficulty: 'moyen',
    })
    state = {
      ...state,
      decisions: latestDecisions(state),
      pendingDecisions: null,
    }
    const mornings: number[] = []
    for (let day = 0; day < days; day += 1) {
      mornings.push(state.energy)
      state = tick(state)
    }
    expect(result.owner.morningEnergy).toEqual(mornings)
    expect(result.owner.morningEnergy[0]).toBe(FULL_ENERGY)
    expect(result.owner.personalCash).toBe(state.personal.cash)
    // Each morning is the day before's close, after its night.
    expect(result.owner.morningEnergy.slice(1)).toEqual(
      result.daySummaries
        .slice(0, -1)
        .map(({ energy }) => nightRest(energy, ENERGY)),
    )
  })

  it('counts every unpaid rent, longer ago than the account keeps', () => {
    const days = 2 * 365
    const result = simulate(7, days, 'moyen', [lowPay])
    const { unpaidRents } = result.owner
    // The 1sts of the month, in order, from the first unpaid one.
    expect(unpaidRents.length).toBeGreaterThan(12)
    expect(unpaidRents).toEqual([...unpaidRents].sort((a, b) => a - b))
    // Each is a day the game's own account recorded while it kept it.
    let state = createInitialState(7, FOOD_TRUCK, {
      ...defaultProfile(),
      difficulty: 'moyen',
    })
    state = applyDecision(state, lowPay)
    state = {
      ...state,
      decisions: latestDecisions(state),
      pendingDecisions: null,
    }
    const seen = new Set<number>()
    for (let day = 0; day < days; day += 1) {
      state = tick(state)
      for (const rentDay of state.personal.unpaidRents) seen.add(rentDay)
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(unpaidRents)
    // The account itself only keeps the last 12 months of them.
    const lastDay = days - 1
    expect(state.personal.unpaidRents).toEqual(
      unpaidRents.filter((day) => isKept(day, lastDay)),
    )
    expect(state.personal.unpaidRents.length).toBeLessThan(unpaidRents.length)
  })

  it('keeps an owner who pays the rent free of unpaid rents', () => {
    expect(simulate(7, 365, 'facile').owner.unpaidRents).toEqual([])
  })
})

describe('journalHash', () => {
  it('is the same for the same seed and differs for another', () => {
    const hash = simulate(7, 40).journalHash
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(simulate(7, 40).journalHash).toBe(hash)
    expect(simulate(8, 40).journalHash).not.toBe(hash)
  })

  it('changes when a single cent changes', () => {
    function books(amount: number) {
      return postEntry(emptyJournal(), {
        day: 0,
        memo: 'Mise de fonds',
        lines: [
          { account: '1000', debit: cents(amount), credit: cents(0) },
          { account: '3000', debit: cents(0), credit: cents(amount) },
        ],
      })
    }
    expect(journalHash(books(100_000))).toBe(journalHash(books(100_000)))
    expect(journalHash(books(100_001))).not.toBe(journalHash(books(100_000)))
  })
})

/**
 * A card that comes up every morning from day 1, whose three choices each
 * leave their mark on the owner's own account.
 */
const EVERY_MORNING: EventContent = loadEventContent({
  pacing: { firstDay: 1, minDaysBetween: 0, dailyChance: 1 },
  events: [
    {
      id: 'chaqueMatin',
      weight: 1,
      character: { id: 'normand', name: 'Normand', role: 'Votre voisin' },
      title: 'Chaque matin',
      situation: 'Normand passe vous voir.',
      choices: ['un', 'deux', 'trois'].map((id, index) => ({
        id,
        label: id,
        tags: ['Rien ne change'],
        outcomes: [
          {
            chance: 1,
            result: 'Merci.',
            effects: [
              { kind: 'personal', amountCents: index + 1, label: 'Normand' },
            ],
          },
        ],
      })),
    },
  ],
})

describe('simulate with event cards', () => {
  const DAYS = 30
  const choices = (result: SimulationResult) =>
    result.eventHistory.map(({ choice }) => choice)

  it('plays none by default, whatever the content', () => {
    const none = simulate(3, DAYS, 'moyen', [], 'none', EVERY_MORNING)
    expect(none.events).toBe('none')
    expect(none.eventHistory).toEqual([])
    expect(simulate(3, DAYS)).toEqual(none)
  })

  it("answers each morning's card with its first choice", () => {
    const first = simulate(3, DAYS, 'moyen', [], 'first', EVERY_MORNING)
    expect(first.events).toBe('first')
    // Days 1 to 29: day 0 has no morning draw, and the run ends before day 30.
    expect(first.eventHistory.map(({ day }) => day)).toEqual(
      Array.from({ length: DAYS - 1 }, (_, i) => i + 1),
    )
    expect(new Set(choices(first))).toEqual(new Set(['un']))
  })

  it('answers at random, the same way for the same seed', () => {
    const random = simulate(3, DAYS, 'moyen', [], 'random', EVERY_MORNING)
    expect(random.events).toBe('random')
    expect(new Set(choices(random))).toEqual(new Set(['un', 'deux', 'trois']))
    expect(simulate(3, DAYS, 'moyen', [], 'random', EVERY_MORNING)).toEqual(
      random,
    )
    expect(
      choices(simulate(4, DAYS, 'moyen', [], 'random', EVERY_MORNING)),
    ).not.toEqual(choices(random))
  })

  it("answers before the morning's energy is read", () => {
    const tiring = loadEventContent({
      ...EVERY_MORNING,
      events: EVERY_MORNING.events.map((event) => ({
        ...event,
        choices: event.choices.map((choice) => ({
          ...choice,
          outcomes: [
            {
              ...choice.outcomes[0],
              effects: [{ kind: 'energy', amount: -40 }],
            },
          ],
        })),
      })),
    })
    const tired = simulate(3, 5, 'moyen', [], 'first', tiring)
    const rested = simulate(3, 5)
    expect(tired.owner.morningEnergy[0]).toBe(rested.owner.morningEnergy[0])
    expect(tired.owner.morningEnergy[1]).toBe(
      (rested.owner.morningEnergy[1] ?? 0) - 40,
    )
  })

  it('leaves the books as they would be without a card that changes none', () => {
    const first = simulate(3, DAYS, 'moyen', [], 'first', EVERY_MORNING)
    expect(first.journalHash).toBe(simulate(3, DAYS).journalHash)
  })
})

describe("simulate's changes to the street", () => {
  const summary = (day: number, kinds: readonly string[]): DaySummary => {
    const played = simulate(7, 1).daySummaries[0]
    if (played === undefined) throw new Error('No day played')
    return {
      ...played,
      day,
      modifiers: kinds.map((kind) => ({
        event: 'essai',
        change:
          kind === 'closed'
            ? { kind: 'closed' }
            : { kind: 'walkIns', factor: 0.5 },
        fromDay: 0,
        lastDay: 9,
      })),
    }
  }

  it('counts a day once for each kind in effect, however many of that kind', () => {
    expect(
      modifierDays([
        summary(0, ['walkIns', 'walkIns']),
        summary(1, ['walkIns', 'closed']),
        summary(2, []),
      ]),
    ).toEqual({
      walkIns: 2,
      appeal: 0,
      willingness: 0,
      unavailable: 0,
      closed: 1,
    })
    expect(modifierDays([])).toEqual(modifierDays([summary(0, [])]))
  })

  it('counts none in a game with no event', () => {
    expect(Object.values(run.modifierDays)).toEqual([0, 0, 0, 0, 0])
  })

  it('counts the days of the essai card, from the days played', () => {
    const essai: EventContent = {
      pacing: { firstDay: 1, minDaysBetween: 30, dailyChance: 1 },
      events: EVENTS.events.map((event) => ({ ...event, weight: 1 })),
    }
    const result = simulate(3, 60, 'moyen', [], 'first', essai)
    expect(result.modifierDays).toEqual(modifierDays(result.daySummaries))
    expect(result.eventHistory.map(({ day }) => day)).toEqual([1, 31])
    // « Tout essayer » on days 1 and 31: walk-ins for 15 days each time,
    // chocolat for 5, café for 2, willingness and closed for 1.
    expect(result.modifierDays).toEqual({
      walkIns: 30,
      appeal: 10,
      willingness: 2,
      unavailable: 4,
      closed: 2,
    })
  })
})

describe('eventChooser', () => {
  const [card] = EVERY_MORNING.events
  if (card === undefined) throw new Error('No card')

  it('picks the first choice', () => {
    const choose = eventChooser('first', 1)
    expect([choose(card), choose(card)]).toEqual(['un', 'un'])
  })

  it('picks at random from a stream of its own, the same for the same seed', () => {
    const picks = (seed: number) => {
      const choose = eventChooser('random', seed)
      return Array.from({ length: 40 }, () => choose(card))
    }
    expect(picks(9)).toEqual(picks(9))
    expect(picks(9)).not.toEqual(picks(10))
    expect(new Set(picks(9))).toEqual(new Set(['un', 'deux', 'trois']))
  })

  it('answers nothing for none', () => {
    expect(() => eventChooser('none', 1)).toThrow(RangeError)
  })
})
