import { describe, expect, it } from 'vitest'
import dreamJson from '../content/dream.json'
import {
  loadDreamContent,
  type DifficultyId,
  type DreamContent,
  type RungId,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  balance,
  entriesOf,
  postEntry,
  type JournalEntry,
} from '../finance/journal.ts'
import { balanceSheet, cashFlowStatement } from '../finance/statements.ts'
import { BAKERY, closedBakery } from './bakery.ts'
import { toCalendar } from './calendar.ts'
import { createInitialState, startChallenge, tick } from './clock.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
  TRUCK_MEMO,
  playDay,
  truckOnBooks,
} from './day.ts'
import { applyDecision } from './decisions.ts'
import {
  DREAM,
  crowned,
  dreamBonuses,
  dreamLimits,
  dreamService,
  housingOf,
  nextRung,
  nextTitle,
  noDream,
  personalAssetsOn,
  prerequisitesMet,
  titleOf,
  travelTimeFactor,
  withDreamStreet,
} from './dream.ts'
import { NO_EVENTS } from './events.ts'
import { FINANCING } from './financing.ts'
import { monthlyFixedCosts } from './fixedCosts.ts'
import { GROCERS } from './contracts.ts'
import { cents, sub, type Cents } from './money.ts'
import { netWorth, netWorthParts } from './netWorth.ts'
import { PERCENTILES } from './percentiles.ts'
import { LABELS } from './personal.ts'
import { defaultProfile } from './profile.ts'
import { deserialize, serialize } from './save.ts'
import { STAFF } from './staff.ts'
import { streetOn } from './street.ts'
import type { BoughtRung, Day, DreamState, GameState } from './types.ts'

const SEED = 42
const CASH: AccountCode = '1000'
const SHARE_CAPITAL: AccountCode = '3000'

// The 1sts of the first months: day 0 is May 1st.
const JUNE_1 = 31
const JULY_1 = 61
const AUGUST_1 = 92

/** A new game at `difficulty`. */
function started(difficulty: DifficultyId = 'facile'): GameState {
  return createInitialState(SEED, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
}

/** `state` played to the morning of `day`, with no event. */
function playedTo(day: Day, state: GameState = started()): GameState {
  let game = state
  while (game.day < day) game = tick(game)
  return game
}

/** `state` with `amount` more in the owner's own cash. */
function richer(state: GameState, amount: number): GameState {
  return {
    ...state,
    personal: { ...state.personal, cash: cents(state.personal.cash + amount) },
  }
}

/** `state` with `amount` more in Encaisse, paid in that morning. */
function funded(state: GameState, amount: number): GameState {
  return {
    ...state,
    journal: postEntry(state.journal, {
      day: state.day,
      memo: 'Mise de fonds',
      lines: [
        { account: CASH, debit: cents(amount), credit: cents(0) },
        { account: SHARE_CAPITAL, debit: cents(0), credit: cents(amount) },
      ],
    }),
  }
}

/** `state` with the rungs `ids` bought on `day`. */
function buying(
  state: GameState,
  ids: readonly RungId[],
  content: DreamContent = DREAM,
): GameState {
  return ids.reduce(
    (game, rung) =>
      applyDecision(
        game,
        { kind: 'buy', rung },
        FOOD_TRUCK,
        DEFIS,
        BAKERY,
        STAFF,
        content,
      ),
    state,
  )
}

/** A dream with `ids` owned, bought on day 0, at their price. */
function owning(...ids: RungId[]): DreamState {
  const bought: BoughtRung[] = ids.map((rung) => ({
    rung,
    day: 0,
    cost: cents(1),
  }))
  return { bought, magnatOn: null }
}

/** The entries of `state`'s journal on `day`. */
function entriesOn(state: GameState, day: Day): readonly JournalEntry[] {
  return entriesOf(state.journal).filter((entry) => entry.day === day)
}

function memosOn(state: GameState, day: Day): string[] {
  return entriesOn(state, day).map(({ memo }) => memo)
}

const price = (id: RungId): Cents => {
  const rung = [...DREAM.personal, ...DREAM.company].find(
    (each) => each.id === id,
  )
  if (rung === undefined) throw new Error(`no rung ${id}`)
  return rung.priceCents
}

const ALL_PERSONAL: readonly RungId[] = [
  'velo',
  'voitureOccasion',
  'condo',
  'voitureLuxe',
  'maison',
  'chalet',
]

describe('a personal rung', () => {
  it('moves the owner’s own cash, and posts nothing', () => {
    const morning = playedTo(3)
    const bought = buying(morning, ['velo'])
    expect(bought.personal.cash).toBe(morning.personal.cash - price('velo'))
    expect(bought.personal.movements.at(-1)).toEqual({
      day: 3,
      label: 'Achat · Vélo électrique',
      amount: -price('velo'),
    })
    expect(bought.journal).toBe(morning.journal)
    expect(bought.dream).toEqual({
      bought: [{ rung: 'velo', day: 3, cost: price('velo') }],
      magnatOn: null,
    })
    expect(bought.pendingDecisions).toBeNull()
  })

  it('buys once', () => {
    const bought = buying(richer(started(), 100_000), ['velo'])
    expect(() => buying(bought, ['velo'])).toThrow(/bought already/)
  })

  it('needs every rung before it in its ladder', () => {
    const rich = richer(started(), 100_000_000)
    expect(() => buying(rich, ['voitureOccasion'])).toThrow(/a rung before it/)
    expect(() => buying(rich, ['velo', 'voitureOccasion', 'maison'])).toThrow(
      /a rung before it/,
    )
    expect(prerequisitesMet(noDream(), 'maison')).toBe(false)
    expect(
      prerequisitesMet(
        owning('velo', 'voitureOccasion', 'condo', 'voitureLuxe'),
        'maison',
      ),
    ).toBe(true)
    const all = buying(rich, ALL_PERSONAL)
    expect(all.dream.bought.map(({ rung }) => rung)).toEqual(ALL_PERSONAL)
    expect(nextRung(all.dream, 'personal')).toBeNull()
  })

  it('needs its price in the owner’s cash, the condo sold back counting for the house', () => {
    const morning = started()
    const short = richer(morning, price('velo') - morning.personal.cash - 1)
    expect(() => buying(short, ['velo'])).toThrow(/the owner has/)
    const exact = richer(morning, price('velo') - morning.personal.cash)
    expect(buying(exact, ['velo']).personal.cash).toBe(0)

    const before = buying(richer(morning, 100_000_000), [
      'velo',
      'voitureOccasion',
      'condo',
      'voitureLuxe',
    ])
    const needed = price('maison') - price('condo')
    const justEnough = richer(before, needed - before.personal.cash)
    const house = buying(justEnough, ['maison'])
    expect(house.personal.cash).toBe(0)
    expect(house.personal.movements.slice(-2)).toEqual([
      { day: 0, label: 'Vente · Condo sur le Plateau', amount: price('condo') },
      { day: 0, label: 'Achat · Maison à Outremont', amount: -price('maison') },
    ])
    expect(() => buying(richer(justEnough, -1), ['maison'])).toThrow(
      /the owner has/,
    )
  })
})

describe('the purchases refused', () => {
  it('in a Défi', () => {
    const defi = startChallenge(DEFIS.defis[0]?.id ?? '', SEED)
    expect(() => buying(richer(defi, 1_000_000), ['velo'])).toThrow(
      /a Défi has no dream/,
    )
  })

  it('once the day is played, once the game ended, and for a rung that is none', () => {
    const close = playDay(richer(playedTo(2), 1_000_000))
    expect(() => buying(close, ['velo'])).toThrow(/is played already/)
    const ended: GameState = {
      ...richer(started(), 1_000_000),
      ended: { reason: 'bankruptcy', day: 0 },
    }
    expect(() => buying(ended, ['velo'])).toThrow(/has ended/)
    expect(() => buying(started(), ['yacht' as RungId])).toThrow(/no rung/)
  })

  it('for the second truck, which comes soon', () => {
    const rich = funded(started(), 100_000_000)
    const both = buying(rich, ['espresso', 'grandCamion'])
    expect(() => buying(both, ['deuxiemeCamion'])).toThrow(/not for sale/)
    expect(nextRung(both.dream, 'company')?.id).toBe('deuxiemeCamion')
  })

  it('when Encaisse falls short of a company rung', () => {
    const morning = started('difficile')
    const cash = balance(morning.journal, CASH, { toDay: 0 })
    const short = funded(morning, price('espresso') - cash - 1)
    expect(() => buying(short, ['espresso'])).toThrow(/Encaisse holds/)
    const exact = funded(short, 1)
    expect(
      balance(buying(exact, ['espresso']).journal, CASH, { toDay: 0 }),
    ).toBe(0)
  })
})

describe('the espresso machine', () => {
  it('posts its purchase and is depreciated from the next 1st', () => {
    const morning = funded(playedTo(10), 10_000_00)
    const bought = buying(morning, ['espresso'])
    expect(entriesOn(bought, 10).at(-1)).toEqual({
      day: 10,
      memo: 'Achat · Machine à espresso pro',
      lines: [
        { account: '1500', debit: price('espresso'), credit: 0 },
        { account: '1000', debit: 0, credit: price('espresso') },
      ],
    })
    const june = playDay(playedTo(JUNE_1, bought))
    const depreciation = entriesOn(june, JUNE_1).find(
      ({ memo }) => memo === 'Amortissement · Machine à espresso pro',
    )
    expect(depreciation?.lines).toEqual([
      { account: '6400', debit: price('espresso') / 60, credit: 0 },
      { account: '1510', debit: 0, credit: price('espresso') / 60 },
    ])
  })

  it('bought on the morning of a 1st waits for the next one', () => {
    const morning = funded(playedTo(JUNE_1), 10_000_00)
    const june = playDay(buying(morning, ['espresso']))
    expect(memosOn(june, JUNE_1)).not.toContain(
      'Amortissement · Machine à espresso pro',
    )
    const july = playDay(playedTo(JULY_1, june))
    expect(memosOn(july, JULY_1)).toContain(
      'Amortissement · Machine à espresso pro',
    )
  })

  it('serves faster: the same day waits less', () => {
    const morning = playedTo(5)
    const without = playDay(morning)
    const faster = playDay({ ...morning, dream: owning('espresso') })
    expect(without.lastDay?.averageWaitSeconds).toBeGreaterThan(0)
    expect(faster.lastDay?.averageWaitSeconds).toBeLessThan(
      without.lastDay?.averageWaitSeconds ?? 0,
    )
    expect(
      dreamService(FOOD_TRUCK.service, dreamBonuses(owning('espresso'))),
    ).toEqual({
      baseSeconds: FOOD_TRUCK.service.baseSeconds * 0.8,
      perItemSeconds: FOOD_TRUCK.service.perItemSeconds * 0.8,
      maxAheadInLine: FOOD_TRUCK.service.maxAheadInLine,
    })
  })
})

describe('the bigger truck', () => {
  const MONTHLY = Math.floor(FOOD_TRUCK.truck.priceCents / 120)

  it.each(['facile', 'moyen'] as const)(
    'at %s, takes the old truck back at its book value, so the company pays its price',
    (difficulty) => {
      const morning = funded(playedTo(45, started(difficulty)), 50_000_00)
      const bookValue = FOOD_TRUCK.truck.priceCents - 2 * MONTHLY
      expect(truckOnBooks(morning.journal, 45, difficulty)).toEqual({
        priceCents: FOOD_TRUCK.truck.priceCents,
        bookValue,
      })
      const before = balance(morning.journal, CASH, { toDay: 45 })
      const bought = buying(morning, ['espresso', 'grandCamion'])
      const [sale, purchase] = entriesOn(bought, 45).slice(-2)
      expect(sale).toEqual({
        day: 45,
        memo: "Vente de l'ancien camion",
        lines: [
          { account: '1000', debit: bookValue, credit: 0 },
          { account: '1510', debit: 2 * MONTHLY, credit: 0 },
          { account: '1500', debit: 0, credit: FOOD_TRUCK.truck.priceCents },
        ],
      })
      expect(purchase).toEqual({
        day: 45,
        memo: 'Achat · Camion plus grand',
        lines: [
          {
            account: '1500',
            debit: bookValue + price('grandCamion'),
            credit: 0,
          },
          {
            account: '1000',
            debit: 0,
            credit: bookValue + price('grandCamion'),
          },
        ],
      })
      expect(balance(bought.journal, CASH, { toDay: 45 })).toBe(
        before - price('espresso') - price('grandCamion'),
      )
      expect(bought.dream.bought.at(-1)).toEqual({
        rung: 'grandCamion',
        day: 45,
        cost: bookValue + price('grandCamion'),
      })
      // The company pays cash for equipment: its equity, and the owner's
      // net worth, stay as they were.
      expect(balanceSheet(bought.journal, 45).equity.total.amount).toBe(
        balanceSheet(morning.journal, 45).equity.total.amount,
      )
      expect(netWorth(bought)).toBe(netWorth(morning))

      const later = playDay(playedTo(AUGUST_1, bought))
      expect(memosOn(later, JUNE_1)).toContain(TRUCK_MEMO.depreciation)
      for (const day of [JULY_1, AUGUST_1]) {
        expect(memosOn(later, day)).not.toContain(TRUCK_MEMO.depreciation)
        expect(
          entriesOn(later, day).find(
            ({ memo }) => memo === 'Amortissement · Camion plus grand',
          )?.lines[0]?.debit,
        ).toBe(Math.floor((bookValue + price('grandCamion')) / 120))
      }
      if (difficulty === 'moyen') {
        expect(memosOn(later, JULY_1)).toContain("Intérêts sur l'emprunt")
        expect(memosOn(later, JULY_1)).toContain("Remboursement de l'emprunt")
      }
    },
  )

  it('at difficile, ends the lease, the old truck being leased', () => {
    const morning = funded(playedTo(45, started('difficile')), 50_000_00)
    expect(truckOnBooks(morning.journal, 45, 'difficile')).toBeNull()
    const bought = buying(morning, ['espresso', 'grandCamion'])
    expect(memosOn(bought, 45).slice(-2)).toEqual([
      'Achat · Machine à espresso pro',
      'Achat · Camion plus grand',
    ])
    expect(bought.dream.bought.at(-1)?.cost).toBe(price('grandCamion'))
    const later = playDay(playedTo(JULY_1, bought))
    expect(memosOn(later, JUNE_1)).toContain(TRUCK_MEMO.lease)
    expect(memosOn(later, JULY_1)).not.toContain(TRUCK_MEMO.lease)
    const { permitParkingAndCommissary, insurance } =
      FOOD_TRUCK.monthlyCostsCents
    const fixed = (replacedOn: Day | null) =>
      monthlyFixedCosts(
        50,
        'difficile',
        0,
        FOOD_TRUCK,
        DIFFICULTIES,
        closedBakery(),
        BAKERY,
        replacedOn,
      )
    expect(fixed(45)).toBe(permitParkingAndCommissary + insurance)
    expect(fixed(null)).toBeGreaterThan(fixed(45))
  })

  it('bought on the morning of a 1st takes that 1st’s depreciation off the old truck', () => {
    const morning = funded(playedTo(JUNE_1), 50_000_00)
    const bought = buying(morning, ['espresso', 'grandCamion'])
    const bookValue = FOOD_TRUCK.truck.priceCents - MONTHLY
    expect(bought.dream.bought.at(-1)?.cost).toBe(
      bookValue + price('grandCamion'),
    )
    const june = playDay(bought)
    expect(memosOn(june, JUNE_1)).not.toContain(TRUCK_MEMO.depreciation)
    expect(memosOn(june, JUNE_1)).not.toContain(
      'Amortissement · Camion plus grand',
    )
    expect(memosOn(playDay(playedTo(JULY_1, june)), JULY_1)).toContain(
      'Amortissement · Camion plus grand',
    )
  })

  it('makes a longer line and a bigger stock, and brings more chic walk-ins', () => {
    const bonuses = dreamBonuses(owning('espresso', 'grandCamion'))
    expect(dreamService(FOOD_TRUCK.service, bonuses).maxAheadInLine).toBe(12)
    expect(dreamLimits(FOOD_TRUCK.decisionLimits, bonuses).units.max).toBe(750)
    expect(withDreamStreet(streetOn([], 0), bonuses).walkIns).toEqual({
      aubaine: 1,
      habitue: 1,
      chic: 1.1,
    })

    const restock = {
      kind: 'restock',
      product: 'chocolat',
      rule: { kind: 'topUp', whenBelow: 100, upTo: 600 },
    } as const
    expect(() => applyDecision(started(), restock)).toThrow(RangeError)
    const truck = { ...started(), dream: owning('espresso', 'grandCamion') }
    expect(
      applyDecision(truck, restock).pendingDecisions?.restock.chocolat,
    ).toEqual(restock.rule)
  })
})

describe('the bonuses', () => {
  it('leave a game with nothing bought as it was', () => {
    const bonuses = dreamBonuses(noDream())
    expect(bonuses).toEqual({
      travelTime: 1,
      serviceTime: 1,
      line: 1,
      stock: 1,
      walkIns: { aubaine: 1, habitue: 1, chic: 1 },
      closedDayRecovery: 0,
    })
    expect(dreamService(FOOD_TRUCK.service, bonuses)).toBe(FOOD_TRUCK.service)
    expect(dreamLimits(FOOD_TRUCK.decisionLimits, bonuses)).toBe(
      FOOD_TRUCK.decisionLimits,
    )
    const street = streetOn([], 0)
    expect(withDreamStreet(street, bonuses)).toBe(street)
  })

  it('bring more chic walk-ins with the luxury car and the bigger truck', () => {
    const morning = playedTo(5)
    const chic = (state: GameState) =>
      playDay(state).lastDay?.segments.chic.visits ?? 0
    const all = owning('velo', 'voitureOccasion', 'condo', 'voitureLuxe')
    const both = {
      ...all,
      bought: [...all.bought, ...owning('espresso', 'grandCamion').bought],
    }
    expect(dreamBonuses(both).walkIns.chic).toBeCloseTo(1.155)
    expect(chic({ ...morning, dream: both })).toBeGreaterThan(chic(morning))
    expect(chic({ ...morning, dream: all })).toBeGreaterThanOrEqual(
      chic(morning),
    )
  })

  it('take the best vehicle’s trip time, not all of them together', () => {
    expect(travelTimeFactor(noDream())).toBe(1)
    expect(travelTimeFactor(owning('velo'))).toBe(0.7)
    expect(travelTimeFactor(owning('velo', 'voitureOccasion'))).toBe(0.5)
    expect(
      travelTimeFactor(
        owning('velo', 'voitureOccasion', 'condo', 'voitureLuxe'),
      ),
    ).toBe(0.4)
  })

  it('give a closed day 15 more energy with the chalet', () => {
    // Monday, day 7, is closed.
    const morning = { ...playedTo(7), energy: 40 }
    expect(toCalendar(7).weekday).toBe(1)
    const rest = playDay(morning).energy
    const chalet = playDay({
      ...morning,
      dream: owning(...ALL_PERSONAL),
    }).energy
    expect(rest).toBe(40 + ENERGY.closedDayRecovery)
    expect(chalet).toBe(rest + 15)
  })
})

describe('a home', () => {
  it('replaces the rent with its payment on the 1st', () => {
    const rich = richer(playedTo(20), 100_000_000)
    const condo = buying(rich, ['velo', 'voitureOccasion', 'condo'])
    expect(housingOf(condo.dream)).toEqual({
      label: 'Hypothèque du condo',
      amount: 110_000,
    })
    const june = playDay(playedTo(JUNE_1, condo))
    const firsts = june.personal.movements.filter(({ day }) => day === JUNE_1)
    expect(firsts).toContainEqual({
      day: JUNE_1,
      label: 'Hypothèque du condo',
      amount: -110_000,
    })
    expect(firsts.map(({ label }) => label)).not.toContain(LABELS.rent)

    const house = buying(playedTo(40, june), ['voitureLuxe', 'maison'])
    expect(housingOf(house.dream)?.label).toBe('Hypothèque de la maison')
    const july = playDay(playedTo(JULY_1, house))
    expect(
      july.personal.movements.filter(({ day }) => day === JULY_1),
    ).toContainEqual({
      day: JULY_1,
      label: 'Hypothèque de la maison',
      amount: -220_000,
    })
  })

  it('goes unpaid as the rent does, when it leaves the owner below zero', () => {
    const condo = buying(richer(playedTo(20), 100_000_000), [
      'velo',
      'voitureOccasion',
      'condo',
    ])
    const broke = playedTo(JUNE_1, condo)
    const poor = {
      ...broke,
      personal: { ...broke.personal, cash: cents(0) },
    }
    const june = playDay(poor)
    expect(june.personal.unpaidRents).toEqual([JUNE_1])
  })
})

describe('the net worth', () => {
  it('counts the personal rungs at their price, the condo no longer once sold', () => {
    const rich = richer(playedTo(3), 100_000_000)
    const all = buying(rich, ALL_PERSONAL)
    expect(netWorth(all)).toBe(netWorth(rich))
    expect(netWorthParts(all).personalAssets).toBe(
      ALL_PERSONAL.filter((id) => id !== 'condo')
        .map(price)
        .reduce((a, b) => a + b, 0),
    )
    expect(personalAssetsOn(all.dream, 2)).toBe(0)
    const condo = buying(rich, ['velo', 'voitureOccasion', 'condo'])
    expect(netWorthParts(condo).personalAssets).toBe(
      price('velo') + price('voitureOccasion') + price('condo'),
    )
  })
})

describe('the titles', () => {
  it('go up with the net worth', () => {
    const [first, second, , last] = DREAM.titles
    expect(titleOf(cents(first!.netWorthCents - 1))).toBeNull()
    expect(titleOf(first!.netWorthCents)?.name).toBe('Débrouillard')
    expect(titleOf(second!.netWorthCents)?.name).toBe('Commerçant')
    expect(titleOf(last!.netWorthCents)?.name).toBe('Magnat')
    expect(nextTitle(cents(0))?.name).toBe('Débrouillard')
    expect(nextTitle(last!.netWorthCents)).toBeNull()
  })

  it('crown the « Magnat » once, at the first close that reaches the last', () => {
    const last = DREAM.titles.at(-1)!.netWorthCents
    expect(crowned(noDream(), sub(last, cents(1)), 9)).toEqual(noDream())
    const once = crowned(noDream(), last, 9)
    expect(once.magnatOn).toBe(9)
    expect(crowned(once, last, 10)).toBe(once)

    const low = loadDreamContent({
      ...dreamJson,
      titles: [{ name: 'Magnat', netWorthCents: 1 }],
    })
    const close = playDay(
      started(),
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      DEFIS,
      BAKERY,
      GROCERS,
      STAFF,
      FINANCING,
      low,
    )
    expect(close.dream.magnatOn).toBe(0)
    expect(
      playDay(
        tick(close),
        FOOD_TRUCK,
        CUSTOMERS,
        DIFFICULTIES,
        PERSONAL,
        ENERGY,
        DEFIS,
        BAKERY,
        GROCERS,
        STAFF,
        FINANCING,
        low,
      ).dream.magnatOn,
    ).toBe(0)
  })
})

/**
 * « Le rêve » cheap enough to buy every rung in the first days, with short
 * useful lives so the depreciation ends within the run, and titles low
 * enough to crown the « Magnat ».
 */
const CHEAP = loadDreamContent({
  ...dreamJson,
  personal: dreamJson.personal.map((rung, index) => ({
    ...rung,
    priceCents: 1_000 * (index + 1),
  })),
  company: dreamJson.company.map((rung, index) => ({
    ...rung,
    priceCents: 5_000 * (index + 1),
    usefulLifeMonths: 6 + index,
  })),
  titles: dreamJson.titles.map((title, index) => ({
    ...title,
    netWorthCents: 1_000 * (index + 1),
  })),
})

/**
 * Plays `days` days of a game at `difficulty`, buying every rung of
 * `CHEAP` each morning it can, and checks that the bilan balances at every
 * close. Returns the last morning.
 */
function climbed(difficulty: DifficultyId, days: number): GameState {
  let state = started(difficulty)
  for (let day = 0; day < days; day += 1) {
    for (const rung of [...CHEAP.personal, ...CHEAP.company]) {
      try {
        state = buying(state, [rung.id], CHEAP)
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
      }
    }
    state = tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
      DEFIS,
      PERCENTILES,
      BAKERY,
      GROCERS,
      STAFF,
      FINANCING,
      CHEAP,
    )
    const sheet = balanceSheet(state.journal, day)
    expect(sheet.assets.total.amount, `day ${day}`).toBe(
      sheet.totalLiabilitiesAndEquity.amount,
    )
  }
  return state
}

describe.each(['facile', 'moyen', 'difficile'] as const)(
  'a game at %s climbing every rung',
  (difficulty) => {
    const DAYS = 3 * 365
    const game = climbed(difficulty, DAYS)

    it('buys them all but the one coming soon, and balances every day', () => {
      expect(game.dream.bought.map(({ rung }) => rung)).toEqual([
        ...ALL_PERSONAL,
        'espresso',
        'grandCamion',
      ])
      expect(game.dream.magnatOn).not.toBeNull()
      // The état des flux de trésorerie reads every entry the dream posted.
      expect(() => cashFlowStatement(game.journal, 0, DAYS - 1)).not.toThrow()
      // Each company rung was depreciated to its cost over its life.
      for (const { rung, cost } of game.dream.bought) {
        const name = CHEAP.company.find(({ id }) => id === rung)?.name
        if (name === undefined) continue
        const depreciated = entriesOf(game.journal)
          .filter(({ memo }) => memo === `Amortissement · ${name}`)
          .reduce((total, { lines }) => total + (lines[0]?.debit ?? 0), 0)
        expect(depreciated).toBe(cost)
      }
    })

    it('plays the same game again', () => {
      expect(serialize(climbed(difficulty, DAYS))).toBe(serialize(game))
    })

    it('saves and loads', () => {
      const text = serialize(game)
      expect(
        deserialize(
          text,
          FOOD_TRUCK,
          undefined,
          DIFFICULTIES,
          DEFIS,
          BAKERY,
          GROCERS,
          STAFF,
          FINANCING,
          CHEAP,
        ),
      ).toStrictEqual(game)
    })
  },
)
