import { describe, expect, it } from 'vitest'
import type {
  EventContent,
  PlaceId,
  ProductId,
  RungId,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, entriesOf, trialBalance } from '../finance/journal.ts'
import { createInitialState, startChallenge, tick } from './clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
  playDay,
} from './day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from './decisions.ts'
import { DREAM, rungOf } from './dream.ts'
import { applyEffect } from './effects.ts'
import { energyAtClose } from './energy.ts'
import { resolveEvent } from './events.ts'
import { FINANCING, appointmentLoan, loanPrincipal } from './financing.ts'
import {
  PRODUCTS,
  inventoryValue,
  onHand,
  orderSize,
  perProduct,
} from './inventory.ts'
import { cents, mulRatio, sub } from './money.ts'
import {
  PLACES,
  awayFromCounter,
  discountAtClose,
  goTo,
  loanAppointment,
  noTrips,
  placeOf,
  takesTheDay,
  tripRefusal,
  tripTime,
} from './places.ts'
import { deserialize, serialize } from './save.ts'
import type { DreamState, GameState, PerProduct, Visit } from './types.ts'

// « Aller à… » (#164): how long each trip takes, when the owner may go,
// what the truck does while they are away, what a trip costs them, and
// what the mill and the Caisse give.

const CASH: AccountCode = '1000'
const SEED = 42

/** Day 1, a Tuesday the truck opens, before it is played. */
const TUESDAY = tick(createInitialState(SEED))

/** The shipped cards the engine brings itself, which no draw brings. */
const CARDS: EventContent = {
  ...EVENTS,
  events: EVENTS.events.filter(({ id }) =>
    [
      FINANCING.loanEvent,
      FINANCING.investorEvent,
      FINANCING.appointmentEvent,
    ].includes(id),
  ),
}

/** The rungs `ids` of « Le rêve », bought on day 0. */
function owning(...ids: RungId[]): DreamState {
  return {
    bought: ids.map((id) => ({
      rung: id,
      day: 0,
      cost: rungOf(id).rung.priceCents,
    })),
    magnatOn: null,
  }
}

/** `state` with `changes` in effect that very morning. */
function deciding(
  state: GameState,
  ...changes: readonly DecisionChange[]
): GameState {
  const decided = changes.reduce(
    (next, change) => applyDecision(next, change),
    state,
  )
  return {
    ...decided,
    decisions: latestDecisions(decided),
    pendingDecisions: null,
  }
}

const AT_TRUCK: DecisionChange = {
  kind: 'hire',
  role: 'camion',
  candidate: 'amelie',
}

/** Tuesday with Amélie at the truck, hired the day before. */
const STAFFED_TUESDAY = tick(deciding(createInitialState(SEED), AT_TRUCK))

/** The next morning, with `events`. */
function next(state: GameState, events: EventContent = CARDS): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    events,
  )
}

/** Encaisse on the morning of `state`, all its entries so far. */
function cashOf(state: GameState): number {
  return balance(state.journal, CASH, { toDay: state.day })
}

/** `state` with Encaisse brought to `target` by a charge that morning. */
function withCash(state: GameState, target: number): GameState {
  return applyEffect(
    state,
    {
      kind: 'charge',
      amountCents: cents(cashOf(state) - target),
      description: 'Dépense',
    },
    FOOD_TRUCK,
    'essai',
  )
}

/** Whether a visit arrived in the window from `from` to `to`, excluded. */
function within(from: number, to: number) {
  return ({ arrivalMinute }: Visit) =>
    arrivalMinute >= from && arrivalMinute < to
}

function visitsOf(state: GameState): readonly Visit[] {
  return state.lastDay?.visits ?? []
}

describe('places.json', () => {
  it('lists the Caisse, the mill, the permits office and the fournil, at 25, 40, a whole day and 15 minutes on foot', () => {
    expect(
      PLACES.places.map((place) => [
        place.id,
        'wholeDay' in place ? 'wholeDay' : place.walkMinutes,
      ]),
    ).toEqual([
      ['caisse', 25],
      ['meunerie', 40],
      ['bureauPermis', 'wholeDay'],
      ['fournil', 15],
    ])
    expect(PLACES.leavesAtMinute).toBe(600)
    expect(PLACES.energyCost).toBe(3)
    expect(placeOf('meunerie').effect).toEqual({
      kind: 'discount',
      share: 0.05,
    })
    expect(placeOf('caisse').effect).toEqual({ kind: 'loanAppointment' })
  })

  it('rejects an id that is no place', () => {
    expect(() => placeOf('banque' as PlaceId)).toThrow(RangeError)
  })
})

describe('tripTime', () => {
  it('walks there and back on foot, with the visit, from 10 h', () => {
    const none = owning()
    expect(tripTime('caisse', none)).toEqual({
      wholeDay: false,
      legMinutes: 25,
      visitMinutes: 30,
      leavesAtMinute: 600,
      backAtMinute: 680,
    })
    expect(tripTime('meunerie', none)).toMatchObject({
      legMinutes: 40,
      backAtMinute: 710,
    })
    expect(tripTime('fournil', none)).toMatchObject({
      legMinutes: 15,
      backAtMinute: 645,
    })
    expect(tripTime('bureauPermis', none)).toEqual({ wholeDay: true })
  })

  it.each<[RungId[], number]>([
    [['velo'], 18],
    [['velo', 'voitureOccasion'], 13],
    [['velo', 'voitureOccasion', 'condo', 'voitureLuxe'], 10],
  ])('shortens each walk with the best vehicle of %j', (rungs, leg) => {
    const dream = owning(...rungs)
    expect(tripTime('caisse', dream)).toEqual({
      wholeDay: false,
      legMinutes: leg,
      visitMinutes: 30,
      leavesAtMinute: 600,
      backAtMinute: 600 + 2 * leg + 30,
    })
    expect(tripTime('bureauPermis', dream)).toEqual({ wholeDay: true })
  })

  it("gives the counter's window in seconds, none for a whole day", () => {
    expect(awayFromCounter(TUESDAY)).toBeNull()
    expect(awayFromCounter(goTo(TUESDAY, 'meunerie'))).toEqual({
      from: 36_000,
      to: 42_600,
    })
    expect(awayFromCounter(goTo(TUESDAY, 'bureauPermis'))).toBeNull()
  })
})

describe('goTo', () => {
  it('sends the owner that very morning, with no decision waiting', () => {
    const going = applyDecision(TUESDAY, { kind: 'goTo', place: 'fournil' })
    expect(going.town).toEqual({ trip: 'fournil', discount: 0 })
    expect(going.pendingDecisions).toBeNull()
    expect(going.ownerAway).toBe(false)
  })

  it('takes one trip a day: another place replaces it, and none keeps the owner in', () => {
    const fournil = goTo(TUESDAY, 'fournil')
    expect(goTo(fournil, 'meunerie').town.trip).toBe('meunerie')
    expect(goTo(fournil, null)).toEqual(TUESDAY)
  })

  it('sends the owner away all day to the permits office, and back for another place or none', () => {
    const office = goTo(TUESDAY, 'bureauPermis')
    expect(takesTheDay('bureauPermis')).toBe(true)
    expect(office.ownerAway).toBe(true)
    expect(goTo(office, 'meunerie').ownerAway).toBe(false)
    expect(goTo(office, null).ownerAway).toBe(false)
    // An owner away for another reason stays away.
    const away = { ...TUESDAY, ownerAway: true }
    expect(goTo(away, 'fournil').ownerAway).toBe(true)
  })

  it('refuses in a Défi, once the game ended, once the day is played, and an unknown place', () => {
    const defi = startChallenge('semaineDesMilleDollars', SEED)
    expect(tripRefusal(defi, 'fournil')).toBe('defi')
    expect(() => goTo(defi, 'fournil')).toThrow(RangeError)
    expect(() => goTo(defi, null)).toThrow(RangeError)
    const ended: GameState = {
      ...TUESDAY,
      ended: { reason: 'bankruptcy', day: 0 },
    }
    expect(tripRefusal(ended, 'fournil')).toBe('ended')
    expect(() => goTo(ended, 'fournil')).toThrow(RangeError)
    const played = playDay(TUESDAY)
    expect(tripRefusal(played, 'fournil')).toBe('played')
    expect(() => goTo(played, 'fournil')).toThrow(/cannot go to fournil/)
    expect(() => goTo(played, null)).toThrow(RangeError)
    expect(() => goTo(TUESDAY, 'banque' as PlaceId)).toThrow(
      'unknown place banque',
    )
    expect(() =>
      applyDecision(TUESDAY, { kind: 'goTo', place: 'banque' as PlaceId }),
    ).toThrow(RangeError)
  })

  it('refuses the Caisse while the lender would not lend the next morning', () => {
    // A full encaisse needs no loan.
    expect(tripRefusal(TUESDAY, 'caisse')).toBe('noNeed')
    const short = withCash(TUESDAY, 50_000)
    expect(tripRefusal(short, 'caisse')).toBeNull()
    expect(
      tripRefusal(short, 'caisse', PLACES, { ...EVENTS, events: [] }),
    ).toBe('noNeed')
    // She came this game year already.
    const visited: GameState = {
      ...short,
      financing: { ...short.financing, lastLoanRequestDay: 0 },
    }
    expect(tripRefusal(visited, 'caisse')).toBe('came')
    expect(() => goTo(visited, 'caisse')).toThrow(/came/)
    // The next morning starts another game year.
    const lastDay: GameState = {
      ...short,
      day: 364,
      financing: { ...short.financing, lastLoanRequestDay: 1 },
    }
    expect(tripRefusal(lastDay, 'caisse')).toBeNull()
    // A loan of hers is still open.
    const lent = resolveEvent(
      {
        ...short,
        events: {
          ...short.events,
          pending: { event: FINANCING.loanEvent, followUp: false },
        },
      },
      'accepter',
      CARDS,
    )
    expect(lent.financing.loans).toHaveLength(1)
    expect(
      tripRefusal(
        {
          ...withCash(lent, 50_000),
          financing: { ...lent.financing, lastLoanRequestDay: null },
        },
        'caisse',
      ),
    ).toBe('mayNotLend')
  })
})

describe('a trip without an employee', () => {
  const base = playDay(TUESDAY)
  const trip = playDay(goTo(TUESDAY, 'meunerie'))
  const inWindow = within(600, 710)

  it("loses that window's visits, and those outside it come as without the trip", () => {
    expect(visitsOf(base).filter(inWindow).length).toBeGreaterThan(0)
    expect(visitsOf(trip).filter(inWindow)).toEqual([])
    const arrivals = (visits: readonly Visit[]) =>
      visits.map(({ arrivalMinute, segment }) => [arrivalMinute, segment])
    expect(arrivals(visitsOf(trip))).toEqual(
      arrivals(visitsOf(base).filter((visit) => !inWindow(visit))),
    )
    const counted = (state: GameState) =>
      Object.values(state.lastDay?.segments ?? {}).reduce(
        (total, { visits }) => total + visits,
        0,
      )
    expect(counted(trip)).toBe(visitsOf(trip).length)
    // Everyone was drawn all the same.
    expect(trip.rngState).toBe(base.rngState)
  })

  it('starts serving nobody while the owner is away', () => {
    const starts = visitsOf(trip).flatMap(({ servedMinute }) =>
      servedMinute === null ? [] : [servedMinute],
    )
    expect(starts.length).toBeGreaterThan(0)
    expect(starts.filter((minute) => minute >= 600 && minute < 710)).toEqual([])
    expect(trip.lastDay?.revenue).toBeGreaterThan(0)
  })

  it('costs the owner the trip on top of the day', () => {
    const served = visitsOf(trip).filter(
      ({ servedMinute }) => servedMinute !== null,
    ).length
    expect(trip.energy).toBeCloseTo(
      energyAtClose(
        TUESDAY.energy,
        {
          worked: true,
          away: false,
          customersServed: served,
          stressed: false,
          bakingCost: 0,
          deliveryCost: 0,
          tripCost: PLACES.energyCost,
        },
        ENERGY,
      ),
      10,
    )
  })

  it('ends with the night: the next morning has no trip and the owner in', () => {
    const office = tick(goTo(TUESDAY, 'bureauPermis'))
    expect(office.town.trip).toBeNull()
    expect(office.ownerAway).toBe(false)
    expect(tick(goTo(TUESDAY, 'fournil')).town).toEqual(noTrips())
  })
})

describe('a trip with an employee at the truck', () => {
  const base = playDay(STAFFED_TUESDAY)
  const trip = playDay(goTo(STAFFED_TUESDAY, 'fournil'))
  const inWindow = within(600, 645)

  it("keeps that window's visits, served by the employee", () => {
    const window = visitsOf(trip).filter(inWindow)
    expect(window.length).toBeGreaterThan(0)
    expect(window).toHaveLength(visitsOf(base).filter(inWindow).length)
    expect(
      window.some(
        ({ servedMinute }) =>
          servedMinute !== null && servedMinute >= 600 && servedMinute < 645,
      ),
    ).toBe(true)
    expect(trip.rngState).toBe(base.rngState)
  })
})

describe('a trip that takes the whole day', () => {
  it('keeps the truck closed without an employee, the owner taking only the trip', () => {
    const morning = goTo(TUESDAY, 'bureauPermis')
    const close = playDay(morning)
    expect(visitsOf(close)).toEqual([])
    expect(close.lastDay?.revenue).toBe(0)
    expect(close.rngState).toBe(TUESDAY.rngState)
    expect(close.energy).toBe(TUESDAY.energy - PLACES.energyCost)
    expect(close.weekSoFar.days.at(-1)).toMatchObject({ day: 1, open: false })
  })

  it('opens the truck with an employee at it', () => {
    const close = playDay(goTo(STAFFED_TUESDAY, 'bureauPermis'))
    expect(visitsOf(close).length).toBeGreaterThan(0)
    expect(close.lastDay?.revenue).toBeGreaterThan(0)
    expect(close.energy).toBe(STAFFED_TUESDAY.energy - PLACES.energyCost)
  })

  it("misses the owner's delivery, but not a deliverer's", () => {
    const signed = applyEffect(
      TUESDAY,
      { kind: 'contract', grocer: 'chezNormand' },
      FOOD_TRUCK,
      'essai',
    )
    const monday = (state: GameState) => {
      let morning = state
      while (morning.day < 7) morning = tick(morning)
      return morning
    }
    const alone = playDay(goTo(monday(signed), 'bureauPermis'))
    expect(alone.lastDay?.deliveries).toEqual([])
    expect(alone.lastDay?.missed).toEqual([{ day: 7, grocer: 'chezNormand' }])
    const deliverer = deciding(signed, {
      kind: 'hire',
      role: 'livreur',
      candidate: 'kevin',
    })
    const delivered = playDay(goTo(monday(deliverer), 'bureauPermis'))
    expect(delivered.lastDay?.deliveries).toHaveLength(1)
    expect(delivered.lastDay?.missed).toEqual([])
  })

  it("bakes no croissant without a baker, but a baker's", () => {
    const BAKING: readonly DecisionChange[] = [
      { kind: 'openBakery', oven: 'louer' },
      { kind: 'croissantSource', source: 'fabriquer' },
      AT_TRUCK,
    ]
    const alone = playDay(
      goTo(tick(deciding(createInitialState(SEED), ...BAKING)), 'bureauPermis'),
    )
    expect(alone.lastDay?.sold.croissant).toBe(0)
    const baker = playDay(
      goTo(
        tick(
          deciding(createInitialState(SEED), ...BAKING, {
            kind: 'hire',
            role: 'boulanger',
            candidate: 'sophie',
          }),
        ),
        'bureauPermis',
      ),
    )
    expect(baker.lastDay?.sold.croissant).toBeGreaterThan(0)
  })
})

describe('a trip on a day the truck is closed', () => {
  it('takes the trip from the day back', () => {
    // Day 7, a Monday: the truck stays closed.
    let monday = TUESDAY
    while (monday.day < 7) monday = tick(monday)
    const rest = playDay(monday)
    const trip = playDay(goTo(monday, 'fournil'))
    expect(rest.lastDay?.visits).toEqual([])
    expect(rest.energy - trip.energy).toBe(PLACES.energyCost)
  })
})

describe("the mill's discount", () => {
  const listed = perProduct(
    (product) => FOOD_TRUCK.products[product].unitCostCents,
  )
  const discounted = perProduct((product) => {
    const cost = FOOD_TRUCK.products[product].unitCostCents
    return sub(cost, mulRatio(cost, 0.05))
  })

  /**
   * What the restock of `morning` costs at `unitCosts`: the units each
   * product's rule buys, from the stock on hand that morning.
   */
  function restockCost(morning: GameState, unitCosts: PerProduct): number {
    return PRODUCTS.reduce(
      (total, product) =>
        total +
        orderSize(
          morning.decisions.restock[product],
          onHand(morning.inventory, product),
        ) *
          unitCosts[product],
      0,
    )
  }

  /** What « Achat de marchandises » cost on `state`'s day. */
  function purchases(state: GameState): number {
    return entriesOf(state.journal)
      .filter(
        ({ day, memo }) =>
          day === state.day && memo === 'Achat de marchandises',
      )
      .reduce((total, { lines }) => total + (lines[0]?.debit ?? 0), 0)
  }

  /** The unit cost of each lot still on hand that was bought on `state`'s day. */
  function lotsOf(state: GameState): Partial<Record<ProductId, number>> {
    return Object.fromEntries(
      state.inventory
        .filter(({ boughtOnDay }) => boughtOnDay === state.day)
        .map(({ product, unitCost }) => [product, unitCost]),
    )
  }

  it('takes 5 % off each unit of the next restock that buys anything, then is used up', () => {
    expect(discounted).toEqual({ cafe: 43, chocolat: 52, croissant: 104 })
    // The mill comes after the morning's restock.
    const tuesday = playDay(goTo(TUESDAY, 'meunerie'))
    expect(purchases(tuesday)).toBe(restockCost(TUESDAY, listed))
    expect(tuesday.town.discount).toBe(0.05)
    const wednesdayMorning = tick(tuesday)
    expect(wednesdayMorning.town).toEqual({ trip: null, discount: 0.05 })
    const wednesday = playDay(wednesdayMorning)
    expect(purchases(wednesday)).toBeGreaterThan(0)
    expect(purchases(wednesday)).toBe(restockCost(wednesdayMorning, discounted))
    for (const [product, unitCost] of Object.entries(lotsOf(wednesday))) {
      expect(unitCost, product).toBe(discounted[product as ProductId])
    }
    expect(wednesday.town.discount).toBe(0)
    const thursdayMorning = tick(wednesday)
    expect(purchases(playDay(thursdayMorning))).toBe(
      restockCost(thursdayMorning, listed),
    )
  })

  it('waits through closed days and restocks that buy nothing', () => {
    // Sunday, day 6, then Monday, closed, then a Tuesday that buys nothing.
    let sunday = TUESDAY
    while (sunday.day < 6) sunday = tick(sunday)
    const nothing = deciding(
      goTo(sunday, 'meunerie'),
      ...PRODUCTS.map((product): DecisionChange => ({
        kind: 'restock',
        product,
        rule:
          product === 'croissant'
            ? { kind: 'buyDaily', quantity: 0 }
            : { kind: 'topUp', whenBelow: 0, upTo: 0 },
      })),
    )
    const monday = tick(nothing)
    expect(monday.town.discount).toBe(0.05)
    const tuesday = tick(monday)
    expect(tuesday.town.discount).toBe(0.05)
    const tuesdayClose = playDay(tuesday)
    expect(purchases(tuesdayClose)).toBe(0)
    expect(tuesdayClose.town.discount).toBe(0.05)
    const buying = deciding(tick(tuesday), {
      kind: 'restock',
      product: 'croissant',
      rule: { kind: 'buyDaily', quantity: 70 },
    })
    expect(buying.town.discount).toBe(0.05)
    const wednesday = playDay(buying)
    expect(purchases(wednesday)).toBe(70 * discounted.croissant)
    expect(wednesday.town.discount).toBe(0)
  })

  it('never stacks on a discount waiting', () => {
    const again = goTo(tick(playDay(goTo(TUESDAY, 'meunerie'))), 'meunerie')
    const twice = playDay(again)
    expect(purchases(twice)).toBe(restockCost(again, discounted))
    expect(twice.town.discount).toBe(0.05)
    const after = tick(twice)
    expect(purchases(playDay(after))).toBe(restockCost(after, discounted))
  })

  it('keeps the stock at what the Stocks account carries, through a save', () => {
    let state = goTo(TUESDAY, 'meunerie')
    for (let day = 1; day < 5; day += 1) {
      state = tick(state)
      expect(inventoryValue(state.inventory)).toBe(
        balance(state.journal, '1200', { toDay: state.day }),
      )
    }
    const waiting = goTo(state, 'meunerie')
    const saved = tick(waiting)
    expect(saved.town.discount).toBe(0.05)
    expect(deserialize(serialize(saved))).toStrictEqual(saved)
  })

  it.each([
    [null, 0, false, 0],
    [null, 0.05, false, 0.05],
    [null, 0.05, true, 0],
    ['meunerie', 0, false, 0.05],
    ['meunerie', 0.05, true, 0.05],
    ['fournil', 0.05, false, 0.05],
    ['caisse', 0.05, true, 0],
  ] as const)(
    'after a trip to %s, with %d waiting, used %s, leaves %d',
    (trip, discount, used, after) => {
      expect(discountAtClose(trip, discount, used)).toBe(after)
    },
  )
})

describe("the appointment at Mme Prudhomme's Caisse", () => {
  const short = withCash(TUESDAY, 50_000)
  const terms = appointmentLoan(EVENTS)

  it('brings her card the next morning, which counts as her visit of the year', () => {
    const trip = goTo(short, 'caisse')
    expect(loanAppointment(trip)).toBe(true)
    const morning = next(trip)
    expect(morning.events.pending).toEqual({
      event: 'rendezVousCaisse',
      followUp: false,
    })
    expect(morning.financing.lastLoanRequestDay).toBe(2)
    if (terms === null) throw new Error('No appointment loan')
    const principal = loanPrincipal(morning, terms, FOOD_TRUCK)
    expect(principal).toBeGreaterThan(0)
    const lent = resolveEvent(morning, 'accepter', CARDS)
    expect(lent.financing.loans).toEqual([
      expect.objectContaining({ day: 2, principal }),
    ])
    expect(cashOf(lent) - cashOf(morning)).toBe(
      principal - lent.financing.loans[0]!.fee,
    )
  })

  it('brings no card without a trip there, nor with events that lack it', () => {
    expect(next(short).events.pending).toBeNull()
    expect(next(goTo(short, 'fournil')).events.pending).toBeNull()
    const trip = goTo(short, 'caisse')
    const morning = tick(trip)
    expect(morning.events.pending).toBeNull()
    expect(morning.financing.lastLoanRequestDay).toBeNull()
  })

  it('brings no card when the day left the encaisse at what she would lend for', () => {
    const trip = goTo(short, 'caisse')
    const rich = applyEffect(
      trip,
      { kind: 'cashSale', amountCents: cents(5_000_000), description: 'Vente' },
      FOOD_TRUCK,
      'essai',
    )
    const morning = next(rich)
    expect(morning.events.pending).toBeNull()
    expect(morning.financing.lastLoanRequestDay).toBeNull()
  })

  it('gives way to her card of a close below zero, the same morning', () => {
    const broke = goTo(withCash(TUESDAY, -500_000), 'caisse')
    const morning = next(broke)
    expect(morning.financing.belowZeroSince).toBe(1)
    expect(morning.events.pending).toEqual({
      event: FINANCING.loanEvent,
      followUp: false,
    })
    expect(morning.financing.lastLoanRequestDay).toBe(2)
  })

  it('still counts as her visit when refused: no trip there nor loan of a close below zero that year', () => {
    const refused = resolveEvent(next(goTo(short, 'caisse')), 'refuser', CARDS)
    expect(refused.financing.loans).toEqual([])
    expect(refused.financing.lastLoanRequestDay).toBe(2)
    expect(tripRefusal(refused, 'caisse')).toBe('came')
    const morning = next(withCash(refused, -500_000))
    expect(morning.financing.belowZeroSince).toBe(2)
    expect(morning.events.pending?.event).not.toBe(FINANCING.loanEvent)
  })
})

describe('a game of trips', () => {
  const ORDER: readonly (PlaceId | null)[] = [
    null,
    'meunerie',
    'fournil',
    'bureauPermis',
    'caisse',
  ]

  /** 40 days of seed `seed`, a trip each day it may go, in turn. */
  function tripping(seed: number, staff: boolean): GameState {
    let state = createInitialState(seed)
    if (staff) state = deciding(state, AT_TRUCK)
    for (let day = 0; day < 40; day += 1) {
      const place = ORDER[day % ORDER.length] ?? null
      if (place !== null && tripRefusal(state, place) === null) {
        state = goTo(state, place)
      }
      state = tick(state)
      const { totalDebit, totalCredit } = trialBalance(state.journal, day)
      expect(totalDebit, `day ${day}`).toBe(totalCredit)
      expect(inventoryValue(state.inventory), `day ${day}`).toBe(
        balance(state.journal, '1200', { toDay: state.day }),
      )
    }
    return state
  }

  it.each([false, true])(
    'plays the same twice, and saves, with an employee: %s',
    (staff) => {
      const once = tripping(7, staff)
      expect(serialize(tripping(7, staff))).toBe(serialize(once))
      expect(deserialize(serialize(once))).toStrictEqual(once)
    },
  )

  it('plays as a game without trips does when none is made', () => {
    let state = createInitialState(SEED)
    for (let day = 0; day < 10; day += 1) state = goTo(tick(state), null)
    let plain = createInitialState(SEED)
    for (let day = 0; day < 10; day += 1) plain = tick(plain)
    expect(serialize(state)).toBe(serialize(plain))
  })
})

describe('the shipped vehicles', () => {
  it('are those of « Le rêve » with a travel time', () => {
    const vehicles = DREAM.personal.flatMap(({ id, bonuses }) =>
      bonuses.flatMap((bonus) =>
        bonus.kind === 'travelTime' ? [[id, bonus.factor]] : [],
      ),
    )
    expect(vehicles).toEqual([
      ['velo', 0.7],
      ['voitureOccasion', 0.5],
      ['voitureLuxe', 0.4],
    ])
  })
})
