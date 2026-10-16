import { describe, expect, it } from 'vitest'
import {
  loadEventContent,
  loadReportContent,
  weekFactIdSchema,
  type DifficultyId,
  type EventCard,
  type EventContent,
  type ReportContent,
} from '../content/schema.ts'
import { entriesOf, type Journal } from '../finance/journal.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
} from '../finance/statements.ts'
import { mondayOf, sundayOf, toCalendar } from './calendar.ts'
import { createInitialState, tick } from './clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
  openingJournal,
} from './day.ts'
import { applyDecision } from './decisions.ts'
import { NO_EVENTS, resolveEvent } from './events.ts'
import { perProduct } from './inventory.ts'
import { cents, type Cents } from './money.ts'
import { defaultProfile } from './profile.ts'
import { next, seedRng } from './rng.ts'
import { deserialize, serialize } from './save.ts'
import type { DaySummary, GameState, WeekReport } from './types.ts'
import {
  REPORT,
  WEEKS_KEPT,
  openingWeek,
  recordDay,
  weekFacts,
  type WeekFact,
} from './week.ts'

const SEED = 42

/** A new game of `difficulty`, with the default name and avatar. */
function startedAs(
  difficulty: DifficultyId = defaultProfile().difficulty,
): GameState {
  return createInitialState(SEED, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
}

/** What a game went through, day by day. */
interface Run {
  /** The morning after the last day played. */
  state: GameState
  /** Each day's summary, by day. */
  days: DaySummary[]
  /** Each week reported, oldest first. */
  weeks: WeekReport[]
}

/**
 * Plays `from` up to the morning of day `until` with `events`, each event
 * answered with `choose`. `onSunday` sees the morning after each Sunday,
 * before its event, if any, is answered.
 */
function play(
  from: GameState,
  until: number,
  events: EventContent = NO_EVENTS,
  choose: (state: GameState) => string = () => 'rienFaire',
  onSunday: (state: GameState) => void = () => {},
): Run {
  let state = from
  const days: DaySummary[] = []
  const weeks: WeekReport[] = []
  while (state.day < until) {
    if (state.events.pending !== null) {
      state = resolveEvent(state, choose(state), events)
    }
    state = tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      events,
    )
    if (state.lastDay !== null) days[state.lastDay.day] = state.lastDay
    if (
      state.lastWeek !== null &&
      state.lastWeek !== (weeks.at(-1) ?? from.lastWeek)
    ) {
      weeks.push(state.lastWeek)
      onSunday(state)
    }
  }
  return { state, days, weeks }
}

function lastWeekOf(state: GameState): WeekReport {
  if (state.lastWeek === null) {
    throw new Error(`No week reported by day ${state.day}`)
  }
  return state.lastWeek
}

/** Encaisse on the bilan at the close of `day`. */
function encaisse(journal: Journal, day: number): Cents {
  const row = balanceSheet(journal, day).assets.current.lines.find(
    ({ account }) => account === '1000',
  )
  if (row === undefined) throw new Error('The bilan has no Encaisse')
  return row.amount
}

/** « Encaissements des clients » on the état des flux de trésorerie of `day`. */
function fromCustomers(journal: Journal, day: number): Cents {
  const row = cashFlowStatement(journal, day, day).operating.lines.find(
    ({ label }) => label === 'Encaissements des clients',
  )
  if (row === undefined) throw new Error('No Encaissements des clients')
  return row.amount
}

/** What the « Ventes au comptant » of `day` brought in. */
function cashSalesOn(journal: Journal, day: number): number {
  return entriesOf(journal)
    .filter((entry) => entry.day === day && entry.memo === 'Ventes au comptant')
    .flatMap(({ lines }) => lines)
    .reduce((total, { account, credit }) => {
      return account === '4000' ? total + credit : total
    }, 0)
}

/** The Encaisse the books of `difficulty` open with. */
function openingCash(difficulty = defaultProfile().difficulty): Cents {
  return encaisse(openingJournal(difficulty), 0)
}

/**
 * Expects `report` to agree with the books `journal` at its Sunday's close,
 * with `opening` as the Encaisse a week from day 0 starts with.
 */
function expectAsTheBooks(
  report: WeekReport,
  journal: Journal,
  opening: Cents,
): void {
  const sunday = sundayOf(report.firstDay)
  const first = report.days[0]?.day ?? sunday
  const income = incomeStatement(journal, first, sunday)
  expect(report.sales).toBe(income.sales.amount)
  expect(report.netIncome).toBe(income.netIncome.amount)
  expect(report.cashAtStart).toBe(
    first === 0 ? opening : encaisse(journal, first - 1),
  )
  const closes = report.days.map(({ day }) => encaisse(journal, day))
  expect(report.days.map(({ cashAtClose }) => cashAtClose)).toEqual(closes)
  expect(report.cashAtEnd).toBe(encaisse(journal, sunday))
  expect(report.lowestCash).toBe(Math.min(...closes))
  for (const { day, sales, cashReceived } of report.days) {
    expect(sales, `day ${day}`).toBe(
      incomeStatement(journal, day, day).sales.amount,
    )
    expect(cashReceived, `day ${day}`).toBe(fromCustomers(journal, day))
  }
}

/** Each event's choice picked by a generator of its own, seeded `seed`. */
function chooser(
  seed: number,
  content: EventContent,
): (state: GameState) => string {
  let rng = seedRng(seed)
  return (state) => {
    const card = content.events.find(
      ({ id }) => id === state.events.pending?.event,
    )
    const [value, after] = next(rng)
    rng = after
    const choices = card?.choices ?? []
    return choices[Math.floor(value * choices.length)]?.id ?? ''
  }
}

/**
 * A card that comes up once, the first morning from `fromDay` on one of
 * `weekdays`, whose « Oui » has `effects` and whose « Non » does nothing.
 */
function card(
  id: string,
  fromDay: number,
  effects: readonly unknown[],
  weekdays?: readonly number[],
): unknown {
  return {
    id,
    weight: 1,
    character: { id: 'gilles', name: 'Gilles Lacasse', role: 'Voisin' },
    title: 'Une carte',
    situation: 'Il se passe quelque chose.',
    conditions: { fromDay, oncePerGame: true, weekdays },
    choices: [
      {
        id: 'oui',
        label: 'Oui',
        tags: ['Ça change'],
        outcomes: [{ chance: 1, result: 'Fait.', effects }],
      },
      {
        id: 'non',
        label: 'Non',
        tags: ['Rien ne change'],
        outcomes: [{ chance: 1, result: 'Rien.', effects: [] }],
      },
    ],
  }
}

function cardsOf(...events: unknown[]): EventContent {
  return loadEventContent({
    pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
    events,
  })
}

function shipped(id: string): EventCard {
  const found = EVENTS.events.find((event) => event.id === id)
  if (found === undefined) throw new Error(`No event ${id}`)
  return found
}

/**
 * « La grosse commande » on the morning of day 14, a Monday, whose order
 * comes on Thursday, day 17, and the cheque it may bring back.
 */
const BIG_ORDER: EventContent = {
  pacing: { firstDay: 14, minDaysBetween: 1000, dailyChance: 1 },
  events: [shipped('grosseCommande'), shipped('chequeDansLaMalle')],
}
const THURSDAY = 17

/** Answers the order with `choice`, and waits for a late cheque. */
function answer(choice: string): (state: GameState) => string {
  return (state) =>
    state.events.pending?.event === 'grosseCommande' ? choice : 'patienter'
}

/** A seed-42 Moyen game up to the morning after the order's Sunday. */
function bigOrderWeek(choice: string): Run {
  return play(startedAs('moyen'), 21, BIG_ORDER, answer(choice))
}

function hasFact(report: WeekReport, id: WeekFact['id']): boolean {
  return weekFacts(report).some((fact) => fact.id === id)
}

describe('openingWeek', () => {
  it('starts a partial week from the Encaisse the books open with', () => {
    for (const difficulty of ['facile', 'moyen', 'difficile'] as const) {
      expect(openingWeek(openingJournal(difficulty))).toEqual({
        cashAtStart: openingCash(difficulty),
        partial: true,
        days: [],
        modifiers: [],
      })
    }
  })
})

describe('recordDay', () => {
  it('adds each day to the week under way, and nothing else, until the Sunday', () => {
    let state = startedAs()
    for (let day = 0; day < 6; day += 1) {
      state = tick(state)
      expect(state.weekSoFar.days.map((record) => record.day)).toEqual(
        Array.from({ length: day + 1 }, (_, index) => index),
      )
      expect(state.weekSoFar.partial).toBe(true)
      expect(state.weekSoFar.cashAtStart).toBe(openingCash())
      expect(state.lastWeek).toBeNull()
      expect(state.weekHistory).toEqual([])
    }
    // Day 0's close counts the entries that open the books once.
    expect(state.weekSoFar.days[0]?.cashAtClose).toBe(
      encaisse(state.journal, 0),
    )
  })

  it('throws before a day is played', () => {
    expect(() => recordDay(startedAs(), true, cents(0))).toThrow(
      'No day was played',
    )
  })

  it('reports the first week at the close of day 6, partial, from the cash the books open with', () => {
    const { state } = play(startedAs(), 7)
    const report = lastWeekOf(state)
    expect(report.firstDay).toBe(0)
    expect(report.partial).toBe(true)
    expect(report.days.map(({ day }) => day)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(report.cashAtStart).toBe(openingCash())
    expectAsTheBooks(report, state.journal, openingCash())
    expect(report.previousBest).toBeNull()
    expect(report.energy).toBe(state.lastDay?.energy)
    expect(state.weekHistory).toEqual([
      {
        firstDay: 0,
        sales: report.sales,
        netIncome: report.netIncome,
        cashAtEnd: report.cashAtEnd,
      },
    ])
    expect(state.weekSoFar).toEqual({
      cashAtStart: report.cashAtEnd,
      partial: false,
      days: [],
      modifiers: [],
    })
  })
})

describe('the week of « La grosse commande »', () => {
  const accepted = bigOrderWeek('accepter')
  const report = lastWeekOf(accepted.state)
  const { journal } = accepted.state
  const thursday = report.days.find(({ day }) => day === THURSDAY)

  it('sums up the week as the état des résultats and the bilan have it', () => {
    expect(report.firstDay).toBe(14)
    expect(report.partial).toBe(false)
    expect(report.days.map(({ day }) => day)).toEqual([
      14, 15, 16, 17, 18, 19, 20,
    ])
    const income = incomeStatement(journal, 14, 20)
    expect(report.sales).toBe(income.sales.amount)
    expect(report.netIncome).toBe(income.netIncome.amount)
    expect(report.cashAtStart).toBe(encaisse(journal, 13))
    expect(report.cashAtEnd).toBe(encaisse(journal, 20))
    expectAsTheBooks(report, journal, openingCash('moyen'))
  })

  it('counts the order in Thursday’s ventes, not in its cash received', () => {
    // The truck stays closed on Thursday to deliver the order: it sells
    // nothing else that day.
    expect(thursday?.open).toBe(false)
    expect(cashSalesOn(journal, THURSDAY)).toBe(0)
    expect(thursday?.sales).toBe(75_000)
    expect(thursday?.cashReceived).toBe(0)
    // The other days, cash sales alone.
    for (const { day, sales, cashReceived, open } of report.days) {
      if (day === THURSDAY) continue
      expect(cashReceived, `day ${day}`).toBe(cashSalesOn(journal, day))
      expect(sales, `day ${day}`).toBe(cashReceived)
      expect(cashReceived > 0, `day ${day}`).toBe(open)
    }
  })

  it('holds what Gilles Lacasse owes and the choice made', () => {
    expect(report.receivables).toEqual([
      {
        client: 'Gilles Lacasse',
        amount: 75_000,
        soldOnDay: THURSDAY,
        dueDay: THURSDAY + 60,
      },
    ])
    expect(report.events).toEqual(accepted.state.events.history)
    expect(report.events).toMatchObject([
      { day: 14, event: 'grosseCommande', choice: 'accepter' },
    ])
  })

  it('tells first that the bénéfice is up while the encaisse is not', () => {
    const cashChange = report.cashAtEnd - report.cashAtStart
    // The encaisse went up, far less than the bénéfice.
    expect(cashChange).toBeGreaterThan(0)
    expect(report.netIncome - cashChange).toBeGreaterThanOrEqual(
      REPORT.facts.profitUpCashDown.minGapCents,
    )
    expect(weekFacts(report)[0]).toEqual({
      id: 'profitUpCashDown',
      weight: REPORT.facts.profitUpCashDown.weight,
      numbers: { netIncome: report.netIncome, cashChange },
    })
  })

  it('tells nothing of the kind when the order is refused', () => {
    const refused = lastWeekOf(bigOrderWeek('refuser').state)
    expect(refused.receivables).toEqual([])
    expect(refused.netIncome).toBeGreaterThan(0)
    expect(hasFact(refused, 'profitUpCashDown')).toBe(false)
  })

  it('counts the order paid on delivery as Thursday’s cash received', () => {
    const { state } = bigOrderWeek('payeLivraison')
    const paid = lastWeekOf(state).days.find(({ day }) => day === THURSDAY)
    const cashSales = cashSalesOn(state.journal, THURSDAY)
    expect(paid?.sales).toBe(cashSales + 67_500)
    expect(paid?.cashReceived).toBe(cashSales + 67_500)
  })

  it('counts what Gilles pays later as cash received that day, not as ventes', () => {
    const { state, weeks } = play(
      startedAs('moyen'),
      7 * 17,
      BIG_ORDER,
      answer('accepter'),
    )
    const collection = entriesOf(state.journal).find(
      ({ memo }) => memo === 'Encaissement · Gilles Lacasse',
    )
    expect(collection).toBeDefined()
    const day = collection?.day ?? -1
    const paid = weeks
      .find(({ firstDay }) => firstDay === mondayOf(day))
      ?.days.find((record) => record.day === day)
    expect(paid?.cashReceived).toBe(cashSalesOn(state.journal, day) + 75_000)
    expect(paid?.sales).toBe(cashSalesOn(state.journal, day))
  })
})

describe('a year of weeks', () => {
  it.each<DifficultyId>(['facile', 'moyen', 'difficile'])(
    'with no event never tells of a bénéfice up while the encaisse is not, at %s',
    (difficulty) => {
      const { weeks } = play(startedAs(difficulty), 7 * 53)
      expect(weeks).toHaveLength(53)
      expect(
        weeks
          .filter((week) => hasFact(week, 'profitUpCashDown'))
          .map(({ firstDay }) => firstDay),
      ).toEqual([])
    },
  )

  it('with the events agrees with the books every Sunday', () => {
    let checked = 0
    let eventful = 0
    let onCredit = 0
    const { weeks } = play(
      startedAs(),
      7 * 53,
      EVENTS,
      chooser(7, EVENTS),
      (state) => {
        const report = lastWeekOf(state)
        expectAsTheBooks(report, state.journal, openingCash())
        const first = report.days[0]?.day ?? 0
        expect(report.events).toEqual(
          state.events.history.filter(({ day }) => day >= first),
        )
        expect(report.receivables).toEqual(state.receivables)
        expect(state.weekHistory.at(-1)).toEqual({
          firstDay: report.firstDay,
          sales: report.sales,
          netIncome: report.netIncome,
          cashAtEnd: report.cashAtEnd,
        })
        checked += 1
        if (report.events.length > 0) eventful += 1
        if (
          report.days.some(({ sales, cashReceived }) => sales !== cashReceived)
        ) {
          onCredit += 1
        }
      },
    )
    expect(checked).toBe(53)
    expect(weeks).toHaveLength(53)
    expect(eventful).toBeGreaterThan(10)
    expect(onCredit).toBeGreaterThan(0)
  })

  it('keeps the last 52 weeks in the history, and the best ventes of them all', () => {
    const { state, weeks } = play(startedAs(), 7 * 53)
    expect(WEEKS_KEPT).toBe(52)
    expect(state.weekHistory.map(({ firstDay }) => firstDay)).toEqual(
      weeks.slice(1).map(({ firstDay }) => firstDay),
    )
    expect(state.weekHistory[0]?.firstDay).toBe(7)
    expect(state.weekHistory.at(-1)?.firstDay).toBe(7 * 52)
    weeks.forEach((week, index) => {
      const earlier = weeks.slice(0, index).map(({ sales }) => sales)
      expect(week.previousBest).toBe(index === 0 ? null : Math.max(...earlier))
    })
  })

  it('plays the same twice', () => {
    const once = play(startedAs(), 60, EVENTS, chooser(3, EVENTS))
    const twice = play(startedAs(), 60, EVENTS, chooser(3, EVENTS))
    expect(twice.state).toEqual(once.state)
    expect(twice.weeks).toEqual(once.weeks)
  })
})

describe('the days of a week', () => {
  const { state, days, weeks } = play(startedAs(), 7 * 5)

  it('count what each day spoiled, lost and served, as its summary has it', () => {
    let lost = 0
    for (const week of weeks) {
      for (const record of week.days) {
        const summary = days[record.day]
        const segments = Object.values(summary?.segments ?? {})
        expect(record).toMatchObject({
          open: toCalendar(record.day).weekday !== 1,
          spoiled: summary?.spoiled,
          lostToLine: summary?.leftLine,
          lostToPrices: segments.reduce((n, s) => n + s.tooExpensive, 0),
          lostToStockouts: segments.reduce((n, s) => n + s.soldOut, 0),
          customersServed: summary?.visits.filter(
            ({ servedMinute }) => servedMinute !== null,
          ).length,
        })
        lost += record.lostToLine + record.lostToPrices + record.lostToStockouts
      }
      expect(week.lostToLine).toBe(sumOf(week, 'lostToLine'))
      expect(week.lostToPrices).toBe(sumOf(week, 'lostToPrices'))
      expect(week.lostToStockouts).toBe(sumOf(week, 'lostToStockouts'))
    }
    expect(lost).toBeGreaterThan(0)
  })

  it('cost what the « Marchandises périmées » entries wrote off', () => {
    let written = 0
    for (const week of weeks) {
      const first = week.days[0]?.day ?? week.firstDay
      const spoilage = entriesOf(state.journal)
        .filter(
          ({ day, memo }) =>
            memo === 'Marchandises périmées' &&
            day >= first &&
            day <= sundayOf(week.firstDay),
        )
        .reduce((total, { lines }) => total + (lines[0]?.debit ?? 0), 0)
      expect(week.spoiledCost).toBe(spoilage)
      expect(week.spoiled).toEqual(
        perProduct((product) =>
          week.days.reduce((units, day) => units + day.spoiled[product], 0),
        ),
      )
      written += spoilage
    }
    expect(written).toBeGreaterThan(0)
  })
})

function sumOf(
  week: WeekReport,
  field: 'lostToLine' | 'lostToPrices' | 'lostToStockouts',
): number {
  return week.days.reduce((total, day) => total + day[field], 0)
}

describe('days open in a row and the street', () => {
  // Open every day from day 1, with a festival from Saturday, day 12, to
  // Monday, and the truck closed on Wednesday, day 16, by construction
  // that also cuts the crowd to Thursday.
  const STREET = cardsOf(
    card('festival', 12, [{ kind: 'walkIns', factor: 1.8, days: 3 }], [6]),
    card(
      'travaux',
      16,
      [
        { kind: 'closed', days: 1 },
        { kind: 'walkIns', factor: 0.65, days: 2 },
      ],
      [3],
    ),
  )
  const everyDay = applyDecision(startedAs(), {
    kind: 'daysOpen',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  const { weeks } = play(everyDay, 7 * 4, STREET, () => 'oui')
  const changes = (report: WeekReport | undefined) =>
    report?.modifiers.map(({ event, change, fromDay, lastDay }) => [
      event,
      change.kind,
      fromDay,
      lastDay,
    ])

  it('adds up the days open across the weeks, until a day closed', () => {
    expect(weeks.map(({ daysOpenInARow }) => daysOpenInARow)).toEqual([
      6, 13, 4, 11,
    ])
    expect(weeks[2]?.days.map(({ open }) => open)).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
      true,
    ])
    expect(weeks[2]?.days[2]?.customersServed).toBe(0)
    const told = weeks.map((week) =>
      weekFacts(week).find(({ id }) => id === 'daysOpenInARow'),
    )
    expect(told.map((fact) => fact?.numbers)).toEqual([
      undefined,
      { days: 13 },
      undefined,
      { days: 11 },
    ])
  })

  it('lists every change to the street in effect on a day of the week, those ended included', () => {
    expect(weeks.map(changes)).toEqual([
      [],
      [['festival', 'walkIns', 12, 14]],
      [
        ['festival', 'walkIns', 12, 14],
        ['travaux', 'closed', 16, 16],
        ['travaux', 'walkIns', 16, 17],
      ],
      [],
    ])
  })
})

describe('an unpaid rent', () => {
  it('is in the week it went unpaid, and told', () => {
    const lowPay = applyDecision(startedAs(), {
      kind: 'ownerWeeklyPay',
      pay: cents(40_000),
    })
    const { state, weeks } = play(lowPay, 7 * 29)
    const unpaid = weeks.flatMap(({ unpaidRents }) => unpaidRents)
    expect(unpaid.length).toBeGreaterThan(1)
    expect(unpaid).toEqual(state.personal.unpaidRents)
    for (const week of weeks) {
      const [day] = week.unpaidRents
      if (day === undefined) continue
      expect(mondayOf(day)).toBe(week.firstDay)
      expect(weekFacts(week)).toContainEqual({
        id: 'unpaidRent',
        weight: REPORT.facts.unpaidRent.weight,
        numbers: { day },
      })
    }
  })
})

describe('the best week', () => {
  // A record week first, a week that beats all those kept once the record
  // has left the history, then a new record.
  const RECORDS = cardsOf(
    card('record', 2, [
      { kind: 'cashSale', amountCents: 1_000_000, description: 'Vente record' },
    ]),
    card('presque', 7 * 55 + 2, [
      { kind: 'cashSale', amountCents: 500_000, description: 'Belle vente' },
    ]),
    card('nouveau', 7 * 57 + 2, [
      { kind: 'cashSale', amountCents: 2_000_000, description: 'Vente record' },
    ]),
  )
  const before = play(startedAs(), 7 * 57, RECORDS, () => 'oui')
  const after = play(before.state, 7 * 58, RECORDS, () => 'oui')
  const weeks = [...before.weeks, ...after.weeks]
  const record = weeks[0]?.sales ?? 0

  it('is still the record once it has left the history', () => {
    const almost = weeks[55]
    expect(almost?.firstDay).toBe(7 * 55)
    const kept = weeks.slice(4, 55).map(({ sales }) => sales)
    expect(almost?.sales).toBeGreaterThan(Math.max(...kept))
    expect(almost?.sales).toBeLessThan(record)
    expect(almost?.previousBest).toBe(record)
    expect(almost && hasFact(almost, 'bestWeek')).toBe(false)
    expect(
      before.state.weekHistory.map(({ firstDay }) => firstDay),
    ).not.toContain(0)
  })

  it('is told when a week beats it', () => {
    const best = weeks[57]
    expect(best?.sales).toBeGreaterThan(record)
    expect(best && weekFacts(best)).toContainEqual({
      id: 'bestWeek',
      weight: REPORT.facts.bestWeek.weight,
      numbers: { sales: best?.sales, previousBest: record },
    })
  })

  it('goes through a save', () => {
    const loaded = deserialize(serialize(before.state), FOOD_TRUCK, RECORDS)
    expect(loaded.lastWeek?.previousBest).toBe(record)
    const resumed = play(loaded, 7 * 58, RECORDS, () => 'oui')
    expect(resumed.state).toEqual(after.state)
  })
})

describe('weekFacts', () => {
  const RULES: ReportContent = loadReportContent({
    maxFacts: 4,
    facts: {
      profitUpCashDown: { weight: 100, minGapCents: 40_000 },
      unpaidRent: { weight: 90 },
      receivableDue: { weight: 80, withinDays: 28 },
      spoilage: { weight: 70, aboveCents: 5_000 },
      bestWeek: { weight: 60 },
      lostToLine: { weight: 50, aboveVisits: 20 },
      daysOpenInARow: { weight: 40, atLeast: 10 },
    },
  })

  /** A week of June 1st, day 31, with nothing worth telling. */
  const QUIET: WeekReport = {
    firstDay: 28,
    partial: false,
    days: [],
    sales: cents(300_000),
    netIncome: cents(100_000),
    cashAtStart: cents(1_000_000),
    cashAtEnd: cents(1_100_000),
    lowestCash: cents(1_000_000),
    spoiled: perProduct(() => 0),
    spoiledCost: cents(0),
    lostToLine: 0,
    lostToPrices: 0,
    lostToStockouts: 0,
    energy: 80,
    daysOpenInARow: 6,
    receivables: [],
    unpaidRents: [],
    events: [],
    modifiers: [],
    previousBest: cents(400_000),
  }

  const OWED = {
    client: 'Gilles Lacasse',
    amount: cents(75_000),
    soldOnDay: 17,
  }

  /** The same week, with every fact worth telling. */
  const LOUD: WeekReport = {
    ...QUIET,
    sales: cents(500_000),
    cashAtEnd: cents(990_000),
    spoiled: { cafe: 2, chocolat: 3, croissant: 50 },
    spoiledCost: cents(6_000),
    lostToLine: 25,
    daysOpenInARow: 12,
    receivables: [
      { ...OWED, dueDay: 62 },
      { ...OWED, client: 'Client douteux', dueDay: 62 },
    ],
    unpaidRents: [31],
  }

  const ALL: WeekFact[] = [
    {
      id: 'profitUpCashDown',
      weight: 100,
      numbers: { netIncome: cents(100_000), cashChange: cents(-10_000) },
    },
    { id: 'unpaidRent', weight: 90, numbers: { day: 31 } },
    {
      id: 'receivableDue',
      weight: 80,
      numbers: { client: 'Gilles Lacasse', amount: cents(75_000), dueDay: 62 },
    },
    { id: 'spoilage', weight: 70, numbers: { cost: cents(6_000), units: 55 } },
    {
      id: 'bestWeek',
      weight: 60,
      numbers: { sales: cents(500_000), previousBest: cents(400_000) },
    },
    { id: 'lostToLine', weight: 50, numbers: { visits: 25 } },
    { id: 'daysOpenInARow', weight: 40, numbers: { days: 12 } },
  ]

  const facts = (change: Partial<WeekReport>, rules = RULES) =>
    weekFacts({ ...QUIET, ...change }, rules)

  it('tells nothing of a quiet week', () => {
    expect(facts({})).toEqual([])
  })

  it('tells at most maxFacts, most important first', () => {
    expect(weekFacts(LOUD, RULES)).toEqual(ALL.slice(0, 4))
    expect(weekFacts(LOUD, { ...RULES, maxFacts: 7 })).toEqual(ALL)
    expect(weekFacts(LOUD, { ...RULES, maxFacts: 1 })).toEqual(ALL.slice(0, 1))
  })

  it('reads the shipped report.json by default', () => {
    expect(weekFacts(LOUD)).toEqual(weekFacts(LOUD, REPORT))
    expect(weekFacts(LOUD).length).toBe(REPORT.maxFacts)
  })

  it.each([
    [
      'a small bénéfice while the encaisse falls a little',
      10_000,
      -5_000,
      true,
    ],
    ['a bénéfice of 1 ¢ while the encaisse falls 1 ¢', 1, -1, true],
    ['a bénéfice while the encaisse stays the same', 10_000, 0, false],
    ['the encaisse up exactly minGapCents less', 50_000, 10_000, true],
    ['the encaisse up 1 ¢ short of the gap', 50_000, 10_001, false],
    ['the encaisse up as much as the bénéfice', 100_000, 100_000, false],
    ['the encaisse down with no bénéfice', 0, -50_000, false],
    ['the encaisse down with a loss', -10_000, -50_000, false],
  ])(
    'tells of the bénéfice up, encaisse down for %s: %i, %i',
    (_, netIncome, cashChange, holds) => {
      const told = facts({
        netIncome: cents(netIncome),
        cashAtEnd: cents(1_000_000 + cashChange),
      })
      expect(told).toEqual(
        holds
          ? [
              {
                id: 'profitUpCashDown',
                weight: 100,
                numbers: {
                  netIncome: cents(netIncome),
                  cashChange: cents(cashChange),
                },
              },
            ]
          : [],
      )
    },
  )

  it.each<[string, Partial<WeekReport>, WeekFact | null]>([
    ['no unpaid rent', { unpaidRents: [] }, null],
    [
      'an unpaid rent',
      { unpaidRents: [31] },
      { id: 'unpaidRent', weight: 90, numbers: { day: 31 } },
    ],
    [
      'a receivable due 29 days after the Sunday',
      { receivables: [{ ...OWED, dueDay: 63 }] },
      null,
    ],
    [
      'a receivable due 28 days after the Sunday',
      {
        receivables: [
          { ...OWED, dueDay: 62 },
          { ...OWED, dueDay: 63 },
        ],
      },
      {
        id: 'receivableDue',
        weight: 80,
        numbers: {
          client: 'Gilles Lacasse',
          amount: cents(75_000),
          dueDay: 62,
        },
      },
    ],
    [
      'spoilage of exactly 50 $',
      {
        spoiledCost: cents(5_000),
        spoiled: { cafe: 0, chocolat: 0, croissant: 40 },
      },
      null,
    ],
    [
      'spoilage of 50,01 $',
      {
        spoiledCost: cents(5_001),
        spoiled: { cafe: 1, chocolat: 0, croissant: 40 },
      },
      {
        id: 'spoilage',
        weight: 70,
        numbers: { cost: cents(5_001), units: 41 },
      },
    ],
    ['no earlier week', { sales: cents(500_000), previousBest: null }, null],
    ['ventes equal to the best', { sales: cents(400_000) }, null],
    [
      'ventes 1 ¢ above the best',
      { sales: cents(400_001) },
      {
        id: 'bestWeek',
        weight: 60,
        numbers: { sales: cents(400_001), previousBest: cents(400_000) },
      },
    ],
    ['20 visits lost to the line', { lostToLine: 20 }, null],
    [
      '21 visits lost to the line',
      { lostToLine: 21 },
      { id: 'lostToLine', weight: 50, numbers: { visits: 21 } },
    ],
    ['9 days open in a row', { daysOpenInARow: 9 }, null],
    [
      '10 days open in a row',
      { daysOpenInARow: 10 },
      { id: 'daysOpenInARow', weight: 40, numbers: { days: 10 } },
    ],
  ])('for %s', (_, change, fact) => {
    expect(facts(change)).toEqual(fact === null ? [] : [fact])
  })

  it('tells the bénéfice up, encaisse down first, even at the lowest weight', () => {
    const rules: ReportContent = {
      ...RULES,
      facts: {
        ...RULES.facts,
        profitUpCashDown: { ...RULES.facts.profitUpCashDown, weight: 0 },
      },
    }
    expect(weekFacts(LOUD, rules).map(({ id }) => id)).toEqual([
      'profitUpCashDown',
      'unpaidRent',
      'receivableDue',
      'spoilage',
    ])
  })

  it('tells the others by weight, a tie in the order of the ids', () => {
    const rules: ReportContent = {
      ...RULES,
      maxFacts: 7,
      facts: {
        ...RULES.facts,
        daysOpenInARow: { ...RULES.facts.daysOpenInARow, weight: 95 },
        lostToLine: { ...RULES.facts.lostToLine, weight: 80 },
      },
    }
    expect(weekFacts(LOUD, rules).map(({ id }) => id)).toEqual([
      'profitUpCashDown',
      'daysOpenInARow',
      'unpaidRent',
      'receivableDue',
      'lostToLine',
      'spoilage',
      'bestWeek',
    ])
    const ties: ReportContent = {
      ...RULES,
      maxFacts: 7,
      facts: Object.fromEntries(
        Object.entries(RULES.facts).map(([id, rule]) => [
          id,
          { ...rule, weight: 1 },
        ]),
      ) as ReportContent['facts'],
    }
    expect(weekFacts(LOUD, ties).map(({ id }) => id)).toEqual(
      weekFactIdSchema.options,
    )
  })
})
