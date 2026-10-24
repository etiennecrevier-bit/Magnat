import { describe, expect, it } from 'vitest'
import { toCalendar } from '../engine/calendar.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { DIFFICULTIES, EVENTS, FOOD_TRUCK } from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { cents, sum, type Cents } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import type {
  Day,
  EventRecord,
  GameState,
  Receivable,
  WeekDay,
} from '../engine/types.ts'
import { balance, postEntry } from '../finance/journal.ts'
import { balanceSheet, incomeStatement } from '../finance/statements.ts'
import { nextFixedCosts } from './cashLevel.ts'
import { DISTRICTS } from '../engine/districts.ts'
import { monthlyFixedCosts } from '../engine/fixedCosts.ts'
import { credit, debit } from '../engine/posting.ts'
import { BAKERY } from '../engine/bakery.ts'
import {
  dateDay,
  hiring,
  SECOND,
  withSecondTruck,
} from './fixtures/twoTrucks.ts'
import {
  CHART_DAYS,
  companyBoard,
  daysPlayedThisMonth,
  financeTiles,
  permitsDue,
  truckRows,
  lateReceivables,
  monthDays,
  recentChartDays,
  watchLines,
  type FinanceTile,
} from './financesBoard.ts'
import type { FinancingSummary } from './financingSummary.ts'
import { formatDayAndMonth, formatDayOfMonth } from './formatGameDate.ts'
import { formatWholeMoney, formatWholeStatementAmount } from './formatMoney.ts'
import {
  computeStatements,
  periodFor,
  type Statements,
} from './statementPeriods.ts'
import { createGameStore, type GameStore } from './store.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '
const LACASSE = 'Gilles Lacasse'

/** A seeded game played `days` days with no event card, and its store. */
function played(days: number, seed = 42) {
  const store = createGameStore(createInitialState(seed), NO_EVENTS)
  store.getState().advance(days)
  return store
}

function thisMonth(game: Pick<GameState, 'journal' | 'day'>): Statements {
  const period = periodFor('thisMonth', game.day)
  if (period === null) throw new Error('no month')
  return computeStatements(game.journal, period)
}

function tile(game: GameState, id: FinanceTile['id']): FinanceTile {
  const found = financeTiles(game, thisMonth(game)).find(
    (each) => each.id === id,
  )
  if (found === undefined) throw new Error(`no tile ${id}`)
  return found
}

function fixedCosts(game: GameState): Cents {
  return nextFixedCosts({
    day: game.day,
    difficulty: game.profile.difficulty,
    firstDay: game.challenge?.startDay ?? 0,
    bakery: game.bakery,
    dream: game.dream,
  })
}

function watch(game: GameState, financing: FinancingSummary | null = null) {
  return watchLines(game, thisMonth(game), fixedCosts(game), financing)
}

/** `game` with `amount` of stock lost to 5100 Pertes sur stocks today. */
function withStockLost(game: GameState, amount: number): GameState {
  const size = cents(amount)
  const zero = cents(0)
  return {
    ...game,
    journal: postEntry(game.journal, {
      day: game.day,
      memo: 'Marchandises perdues',
      lines: [
        { account: '5100', debit: size, credit: zero },
        { account: '1200', debit: zero, credit: size },
      ],
    }),
  }
}

describe('financeTiles', () => {
  // Day 40 is June 10th, year 1: nine days of June were played.
  const store = played(40)
  const { game } = store.getState()

  it('show the books of a seeded game: the encaisse, the month, the net worth and the comptes clients', () => {
    const tiles = financeTiles(game, thisMonth(game))
    expect(tiles.map(({ label }) => label)).toEqual([
      'Encaisse',
      'Ce mois-ci',
      'Valeur nette',
      'À recevoir',
    ])
    const [cash, month, worth, owed] = tiles
    const sheet = balanceSheet(game.journal, game.day)
    const encaisse = sheet.assets.current.lines.find(
      ({ account }) => account === '1000',
    )
    expect(cash?.amount).toBe(
      balance(game.journal, '1000', { toDay: game.day }),
    )
    expect(cash?.amount).toBe(encaisse?.amount)
    expect(cash?.value).toBe(formatWholeMoney(cash?.amount ?? cents(0)))
    const june = incomeStatement(game.journal, 31, game.day)
    expect(month?.amount).toBe(june.netIncome.amount)
    expect(month?.value).toBe(formatWholeStatementAmount(june.netIncome.amount))
    expect(worth?.amount).toBe(netWorth(game))
    expect(owed?.amount).toBe(
      balance(game.journal, '1100', { toDay: game.day }),
    )
    expect(owed?.amount).toBe(sum(game.receivables.map(({ amount }) => amount)))
  })

  it('open the statement each comes from, or « Personnel » for the net worth', () => {
    expect(
      financeTiles(game, thisMonth(game)).map(({ opens, tip }) => [
        opens,
        tip.link,
      ]),
    ).toEqual([
      ['cashFlow', "Ouvrir l'état des flux de trésorerie"],
      ['incomeStatement', "Ouvrir l'état des résultats"],
      ['personal', 'Voir « Personnel »'],
      ['balanceSheet', 'Ouvrir le bilan'],
    ])
  })

  it('say how the encaisse moved since the last Sunday, with an arrow', () => {
    const cash = balance(game.journal, '1000', { toDay: game.day })
    const last = game.weekHistory.at(-1)
    if (last === undefined) throw new Error('no week')
    const sundayAt = (cashAtEnd: number): GameState => ({
      ...game,
      weekHistory: [
        ...game.weekHistory.slice(0, -1),
        { ...last, cashAtEnd: cents(cashAtEnd) },
      ],
    })
    expect(tile(sundayAt(cash - 31_800), 'cash')).toMatchObject({
      status: `▲ 318${S}$ cette semaine`,
      tone: 'good',
    })
    expect(tile(sundayAt(cash + 31_800), 'cash')).toMatchObject({
      status: `▼ 318${S}$ cette semaine`,
      tone: 'bad',
    })
    expect(tile(sundayAt(cash), 'cash')).toMatchObject({
      status: null,
      tone: 'neutral',
    })
    expect(tile({ ...game, weekHistory: [] }, 'cash').status).toBeNull()
  })

  it('give the parts of the encaisse in the tooltip: the month opening, the three activities and today', () => {
    const { tip } = tile(game, 'cash')
    const { cashFlow } = thisMonth(game)
    expect(tip.title).toBe('Encaisse, du 1er au 10 juin')
    expect(tip.rows?.map(({ label }) => label)).toEqual([
      'Au début du mois',
      cashFlow.operating.label,
      cashFlow.investing.label,
      cashFlow.financing.label,
      "Aujourd'hui",
    ])
  })

  it('say whether the month is a bénéfice or a perte, and over how many days', () => {
    const month = tile(game, 'month')
    const loss = month.amount < 0
    expect(month.status).toBe(`${loss ? 'Perte' : 'Bénéfice'} · 9 jours`)
    expect(month.tone).toBe(loss ? 'bad' : 'good')
    const statement = thisMonth(game).incomeStatement
    expect(month.tip.rows?.slice(0, 2)).toEqual([
      { label: 'Ventes', value: expect.any(String) },
      { label: 'Charges', value: expect.any(String) },
    ])
    const charges = [statement.costOfGoodsSold, ...statement.expenses.lines]
    const biggest = charges.toSorted((a, b) => b.amount - a.amount)[0]
    expect(month.tip.rows?.[2]).toEqual({
      label: 'Plus grosse charge',
      value: biggest?.label,
    })
  })

  it('count no day on the morning of the 1st', () => {
    const first = played(31).getState().game
    expect(toCalendar(first.day).dayOfMonth).toBe(1)
    expect(tile(first, 'month').status).toBe('Aucune journée encore')
  })

  it('say how the net worth moved since Sunday, in three parts', () => {
    const worth = tile(game, 'netWorth')
    const sunday = game.weekHistory.at(-1)?.netWorth
    if (sunday === null || sunday === undefined) throw new Error('no worth')
    const change = worth.amount - sunday
    expect(worth.status).toBe(
      change === 0
        ? null
        : `${change > 0 ? '▲' : '▼'} ${formatWholeMoney(cents(Math.abs(change)))} depuis dimanche`,
    )
    expect(worth.tip.rows?.map(({ label }) => label)).toEqual([
      "Part de l'entreprise",
      'Argent et biens personnels',
      'Dettes personnelles',
    ])
  })

  it('say who pays next, and list at most three clients and the total', () => {
    const owing = (clients: string[]): GameState => ({
      ...game,
      receivables: clients.map((client, index) => ({
        client,
        amount: cents(10_000 * (index + 1)),
        soldOnDay: 0,
        dueDay: 60 + index,
      })),
    })
    expect(tile(owing([]), 'receivables')).toMatchObject({
      status: 'Rien à recevoir',
      tip: { text: "Aucun client ne vous doit d'argent." },
    })
    const four = tile(owing(['A', 'B', 'C', 'D']), 'receivables')
    expect(four.status).toBe(`A · ${formatDayAndMonth(60)}`)
    expect(four.tip.rows?.map(({ label }) => label)).toEqual([
      `A · ${formatDayAndMonth(60)}`,
      `B · ${formatDayAndMonth(61)}`,
      `C · ${formatDayAndMonth(62)}`,
      '1 autre',
      'Total',
    ])
  })
})

describe('daysPlayedThisMonth', () => {
  it.each([
    { day: 0, startDay: null, days: 0 },
    { day: 1, startDay: null, days: 1 },
    { day: 30, startDay: null, days: 30 },
    { day: 31, startDay: null, days: 0 },
    { day: 40, startDay: null, days: 9 },
    { day: 45, startDay: 45, days: 0 },
    { day: 50, startDay: 45, days: 5 },
    { day: 61, startDay: 45, days: 0 },
  ])(
    'counts $days on the morning of day $day, a Défi starting on $startDay',
    ({ day, startDay, days }) => {
      const challenge =
        startDay === null
          ? null
          : ({ startDay } as unknown as GameState['challenge'])
      expect(daysPlayedThisMonth({ day, challenge })).toBe(days)
    },
  )
})

describe('monthDays', () => {
  it('writes a day or the days of one month', () => {
    expect(monthDays(31, 31)).toBe('le 1er juin')
    expect(monthDays(31, 40)).toBe('du 1er au 10 juin')
  })
})

describe('watchLines', () => {
  it('give the fixed costs of the next 1st, today on a 1st', () => {
    const start = createInitialState(42)
    expect(watch(start)).toEqual([
      {
        id: 'charges',
        text: `${formatWholeMoney(fixedCosts(start))} de frais fixes le 1er mai`,
      },
    ])
    const later = { ...start, day: 40 }
    expect(watch(later)[0]?.text).toBe(
      `${formatWholeMoney(fixedCosts(later))} de frais fixes le 1er juillet`,
    )
  })

  it('add the loan payments due that 1st, and only those', () => {
    const game = { ...createInitialState(42), day: 40 }
    const loan = (amount: number, day: Day) => ({
      lender: 'Caisse',
      owed: cents(500_000),
      next: { amount: cents(amount), day },
    })
    const financing: FinancingSummary = {
      hadLoans: true,
      loans: [loan(100_000, 61), loan(50_000, 92)],
      shares: [],
      dividend: null,
    }
    expect(watch(game, financing)[0]?.text).toBe(
      `${formatWholeMoney(cents(fixedCosts(game) + 100_000))} de frais fixes et de prêts le 1er juillet`,
    )
  })

  it('give the stock lost this month, when there is some', () => {
    const start = createInitialState(42)
    expect(watch(start).map(({ id }) => id)).toEqual(['charges'])
    expect(watch(withStockLost(start, 14_300))[1]).toEqual({
      id: 'spoilage',
      text: `143${S}$ de stock jeté ce mois-ci`,
    })
  })

  it('show nothing when nothing is due, lost nor late', () => {
    const start = createInitialState(42)
    expect(watchLines(start, thisMonth(start), cents(0), null)).toEqual([])
  })
})

/** A store on the morning `game` brings the card `event`, with the cards. */
function storeOn(game: GameState, event: string): GameStore {
  return createGameStore(
    {
      ...game,
      events: { ...game.events, pending: { event, followUp: false } },
    },
    EVENTS,
  )
}

/**
 * Plays on in `store`, choosing the first choice of any other card, until
 * `until` holds of its game; throws past `most` days.
 */
function playUntil(
  store: GameStore,
  until: (game: GameState) => boolean,
  most = 200,
): void {
  for (let i = 0; i < most; i += 1) {
    const { game, panel } = store.getState()
    if (until(game)) return
    const pending = game.events.pending
    if (panel === 'event' && pending !== null) {
      const event = EVENTS.events.find(({ id }) => id === pending.event)
      store.getState().chooseEvent(event?.choices[0]?.id ?? '')
      store.getState().closePanel()
    } else {
      store.getState().advance(1)
    }
  }
  throw new Error('never came')
}

/**
 * A store where Gilles Lacasse's big order went through with the outcome
 * whose cheque is « dans la malle » 60 days on: the first seed giving it.
 */
function lacasseOrder(): GameStore {
  for (let seed = 1; seed < 500; seed += 1) {
    const store = storeOn(
      { ...createInitialState(seed), day: 14 },
      'grosseCommande',
    )
    store.getState().chooseEvent('accepter')
    if (store.getState().game.events.history.at(-1)?.outcome === 1) {
      store.getState().closePanel()
      return store
    }
  }
  throw new Error('no seed')
}

describe('the late money in « À surveiller »', () => {
  it('shows Gilles Lacasse late once « Patienter » put off his cheque, until it is settled', () => {
    const store = lacasseOrder()
    playUntil(store, (game) =>
      game.receivables.some(({ client }) => client === LACASSE),
    )
    // An order on credit not due yet is not late.
    const owed = store.getState().game
    expect(watch(owed).map(({ id }) => id)).not.toContain('late')
    expect(tile(owed, 'receivables').status).toMatch(/^Gilles Lacasse · /)

    playUntil(
      store,
      (game) => game.events.pending?.event === 'chequeDansLaMalle',
    )
    const [due] = store
      .getState()
      .game.receivables.filter(({ client }) => client === LACASSE)
    store.getState().chooseEvent('patienter')
    store.getState().closePanel()
    const late = store.getState().game
    const [after] = late.receivables.filter(({ client }) => client === LACASSE)
    expect(after?.dueDay).toBe((due?.dueDay ?? 0) + 30)
    expect(watch(late).find(({ id }) => id === 'late')).toEqual({
      id: 'late',
      text: `Gilles Lacasse paie en retard${S}: ${formatWholeMoney(after?.amount ?? cents(0))} le ${formatDayAndMonth(after?.dueDay ?? 0)}`,
    })

    playUntil(
      store,
      (game) => !game.receivables.some(({ client }) => client === LACASSE),
    )
    expect(watch(store.getState().game).map(({ id }) => id)).not.toContain(
      'late',
    )
  })

  const receivable: Receivable = {
    client: LACASSE,
    amount: cents(75_000),
    soldOnDay: 50,
    dueDay: 140,
  }
  const record = (day: Day, choice: string): EventRecord => ({
    day,
    event: 'chequeDansLaMalle',
    followUp: true,
    choice,
    outcome: 0,
  })
  const game = (history: EventRecord[]) => {
    const start = createInitialState(42)
    return {
      ...start,
      receivables: [receivable],
      events: { ...start.events, history },
    }
  }

  it('counts only a delay of that client since the sale', () => {
    expect(lateReceivables(game([record(110, 'patienter')]))).toEqual([
      receivable,
    ])
    expect(lateReceivables(game([record(40, 'patienter')]))).toEqual([])
    expect(lateReceivables(game([record(110, 'allerLeVoir')]))).toEqual([])
    expect(
      lateReceivables({
        ...game([record(110, 'patienter')]),
        receivables: [{ ...receivable, client: 'Épicerie Normand' }],
      }),
    ).toEqual([])
  })

  it('sums several late clients on one line, after the others', () => {
    const late = {
      ...game([
        record(110, 'patienter'),
        { ...record(112, 'patienter'), event: 'essai', choice: 'toutEssayer' },
      ]),
      day: 120,
      receivables: [receivable, { ...receivable, client: "Client d'essai" }],
    }
    const lines = watch(withStockLost(late, 10_000))
    expect(lines.map(({ id }) => id)).toEqual(['charges', 'spoilage', 'late'])
    expect(lines[2]?.text).toBe(`2 clients paient en retard${S}: 1${S}500${S}$`)
  })
})

describe('recentChartDays', () => {
  const store = played(40)
  const { game, weekReports } = store.getState()
  const weekSoFar = game.weekSoFar.days

  it('has no day before the first is played', () => {
    expect(recentChartDays([], [], 0, null)).toEqual([])
  })

  it('shows the first day alone once it is played, a Monday labelled with its date', () => {
    const first = played(1).getState()
    expect(
      recentChartDays(
        first.weekReports,
        first.game.weekSoFar.days,
        0,
        first.game.lastDay?.day ?? null,
      ),
    ).toEqual([expect.objectContaining({ day: 0, label: '1er', played: true })])
  })

  it('shows every day played while there are fewer than 30', () => {
    const early = played(10).getState()
    const days = recentChartDays(
      early.weekReports,
      early.game.weekSoFar.days,
      0,
      9,
    )
    expect(days.map(({ day }) => day)).toEqual([...Array(10).keys()])
    expect(days.every(({ played: has }) => has)).toBe(true)
  })

  it('shows the last 30 days, with what the reports kept, a label on each Monday', () => {
    const days = recentChartDays(weekReports, weekSoFar, 0, 39)
    expect(days).toHaveLength(CHART_DAYS)
    expect(days[0]?.day).toBe(10)
    expect(days.at(-1)?.day).toBe(39)
    const known = new Map<Day, WeekDay>(
      [...weekReports.flatMap(({ days: kept }) => kept), ...weekSoFar].map(
        (day) => [day.day, day],
      ),
    )
    for (const day of days) {
      const kept = known.get(day.day)
      expect(day.played).toBe(kept !== undefined)
      if (kept !== undefined) {
        expect(day).toMatchObject({
          sales: kept.sales,
          cashReceived: kept.cashReceived,
        })
      }
      expect(day.label).toBe(
        toCalendar(day.day).weekday === 1 ? formatDayOfMonth(day.day) : '',
      )
    }
  })

  it('has no data for the days of a loaded game the UI did not keep', () => {
    const days = recentChartDays([], weekSoFar, 0, 39)
    expect(days).toHaveLength(CHART_DAYS)
    const kept = new Set(weekSoFar.map(({ day }) => day))
    expect(days.filter(({ played: has }) => has).map(({ day }) => day)).toEqual(
      [...kept].filter((day) => day >= 10),
    )
  })

  it('starts on the first day of a Défi that started mid-month', () => {
    const days = recentChartDays([], [], 45, 50)
    expect(days.map(({ day }) => day)).toEqual([45, 46, 47, 48, 49, 50])
    expect(days.every(({ played: has }) => !has)).toBe(true)
  })
})

describe('« Par camion » (#265)', () => {
  /** Days 1 to 3 played, both trucks open every day, Kevin at the Plateau. */
  function bothPlayed(): GameState {
    let game = withSecondTruck(
      createInitialState(42),
      { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] },
      { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7], truck: SECOND },
      hiring('kevin'),
      { kind: 'ownerAt', truck: SECOND },
    )
    for (let day = 0; day < 4; day += 1) game = tick(game)
    return game
  }

  /** `game` with an entry of `lines` on its morning, no truck named. */
  function posted(game: GameState, ...lines: Parameters<typeof debit>[]) {
    const [first, second] = lines
    if (first === undefined || second === undefined) throw new Error('lines')
    return {
      ...game,
      journal: postEntry(game.journal, {
        day: game.day,
        memo: 'Livraison',
        lines: [debit(...first), credit(...second)],
      }),
    }
  }

  it('is not there with one truck', () => {
    const game = played(3).getState().game
    expect(truckRows(game, thisMonth(game))).toBeNull()
    expect(companyBoard(game, []).trucks).toBeNull()
  })

  it('adds up, with what no truck sold, to the month’s sales and margin', () => {
    // A grocer's delivery: sold on credit, its croissants out of stock.
    const game = posted(
      posted(bothPlayed(), ['1100', cents(12_000)], ['4000', cents(12_000)]),
      ['5000', cents(4_000)],
      ['1200', cents(4_000)],
    )
    const statements = thisMonth(game)
    const rows = truckRows(game, statements)
    expect(rows?.map(({ label }) => label)).toEqual([
      'Plateau',
      'Vieux-Montréal',
      'Autres ventes',
      'Total',
    ])
    const [plateau, vieux, others, total] = rows ?? []
    expect(plateau!.sales).toBeGreaterThan(0)
    expect(vieux!.sales).toBeGreaterThan(0)
    expect(others).toMatchObject({ sales: 12_000, margin: 8_000 })
    const { sales, grossMargin } = statements.incomeStatement
    expect(total).toMatchObject({
      sales: sales.amount,
      margin: grossMargin.amount,
    })
    expect(sum([plateau!, vieux!, others!].map(({ sales }) => sales))).toBe(
      sales.amount,
    )
    expect(sum([plateau!, vieux!, others!].map(({ margin }) => margin))).toBe(
      grossMargin.amount,
    )
    expect(companyBoard(game, []).trucks).toEqual(rows)
  })

  it('keeps « Autres ventes » for a cost no truck made, and leaves it out at 0', () => {
    const game = bothPlayed()
    expect(truckRows(game, thisMonth(game))?.map(({ id }) => id)).toEqual([
      'plateau',
      SECOND,
      'total',
    ])
    const cost = posted(game, ['5000', cents(500)], ['1200', cents(500)])
    expect(truckRows(cost, thisMonth(cost))?.[2]).toEqual({
      id: 'others',
      label: 'Autres ventes',
      sales: 0,
      margin: -500,
    })
  })
})

describe('the second truck’s charges in « À surveiller » (#265)', () => {
  const START = createInitialState(42)
  const MARCH_1 = dateDay(2, 3, 1)
  const MARCH_15 = dateDay(2, 3, 15)
  const APRIL_1 = dateDay(2, 4, 1)
  const PERMIT = DIFFICULTIES.districtPermits.moyen.vieuxMontreal ?? cents(0)
  const INSURANCE = cents(FOOD_TRUCK.monthlyCostsCents.insurance)

  /** The second truck bought on day 0, the game on the morning of `day`. */
  const on = (day: number, game: GameState = withSecondTruck(START)) => ({
    ...game,
    day,
  })
  const watch = (game: GameState) =>
    companyBoard(game, []).watch.map(({ text }) => text)
  /** What the cash gauge reads against, one-truck or two. */
  const costs = (game: GameState) =>
    nextFixedCosts({
      day: game.day,
      difficulty: game.profile.difficulty,
      firstDay: 0,
      bakery: game.bakery,
      dream: game.dream,
      trucks: game.trucks ?? [],
    })

  it('shows the permit from the 1st of the month before to the morning it is paid', () => {
    const line = `Permis du Vieux-Montréal${S}: ${formatWholeMoney(PERMIT)} le 1er avril`
    expect(watch(on(MARCH_1 - 1))).not.toContain(line)
    expect(watch(on(MARCH_1))).toContain(line)
    expect(watch(on(MARCH_15))).toContain(line)
    expect(watch(on(APRIL_1))).toContain(line)
    expect(watch(on(APRIL_1 + 1)).join()).not.toContain('Permis')
    expect(permitsDue(on(MARCH_15))).toEqual([
      { district: 'Vieux-Montréal', day: APRIL_1, amount: PERMIT },
    ])
    // Second, after the charges, so three lines never cut it.
    expect(companyBoard(on(MARCH_15), []).watch[1]?.id).toBe('permit')
  })

  it('keeps the permit in the cash gauge’s amount, and once in « À surveiller »', () => {
    const one = on(MARCH_15, START)
    const two = on(MARCH_15)
    expect(costs(two)).toBe(
      monthlyFixedCosts(
        MARCH_15,
        'moyen',
        0,
        FOOD_TRUCK,
        DIFFICULTIES,
        two.bakery,
        BAKERY,
        null,
        DISTRICTS,
        two.trucks,
      ),
    )
    expect(costs(two)).toBe(costs(one) + INSURANCE + PERMIT)
    // The charges line leaves out the permit, which has its own.
    expect(watch(two)[0]).toBe(
      `${formatWholeMoney(cents(costs(one) + INSURANCE))} de frais fixes le 1er avril`,
    )
    expect(costs(on(APRIL_1))).toBe(
      costs(on(APRIL_1, START)) + INSURANCE + PERMIT,
    )
    // On March 1st, the 1st paid that morning has no permit in it.
    expect(costs(on(MARCH_1))).toBe(costs(on(MARCH_1, START)) + INSURANCE)
  })

  it('adds the insurance in an ordinary month, stored or not', () => {
    const june = dateDay(1, 6, 15)
    const two = on(june)
    expect(costs(two)).toBe(costs(on(june, START)) + INSURANCE)
    expect(watch(two)[0]).toBe(
      `${formatWholeMoney(costs(two))} de frais fixes le 1er juillet`,
    )
    const stored = on(
      june,
      withSecondTruck(START, {
        kind: 'storage',
        storage: { from: { month: 5, day: 1 }, to: { month: 9, day: 30 } },
        truck: SECOND,
      }),
    )
    expect(costs(stored)).toBe(costs(two))
  })
})
