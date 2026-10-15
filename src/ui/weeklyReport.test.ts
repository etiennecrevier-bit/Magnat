import { describe, expect, it } from 'vitest'
import { REPORT_PLACEHOLDERS } from '../content/reportText.ts'
import { weekFactIdSchema, type WeekFactId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { cents } from '../engine/money.ts'
import type { GameState, WeekRecord, WeekReport } from '../engine/types.ts'
import { weekFacts, type WeekFact } from '../engine/week.ts'
import {
  chartScale,
  creditNotes,
  factLines,
  factValues,
  fillTemplate,
  newWeekOf,
  opensFullReport,
  recentWeeks,
  REPORT_TEXT,
  reportHeadline,
  weekChart,
  WEEKS_LISTED,
  type ChartDay,
} from './weeklyReport.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '

/** `game` played until the morning its first week is reported. */
function toFirstReport(game: GameState): GameState {
  let next = game
  while (next.lastWeek === null) {
    next = tick(
      next,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
    )
  }
  return next
}

/** The first week of a seed-1 game, reported on the morning of day 7. */
const FIRST_WEEK = toFirstReport(createInitialState(1)).lastWeek!

/** `FIRST_WEEK` moved to the week starting `firstDay`, with `changes`. */
function weekOf(firstDay: number, changes: Partial<WeekReport> = {}) {
  return {
    ...FIRST_WEEK,
    firstDay,
    days: FIRST_WEEK.days.map((day, index) => ({
      ...day,
      day: firstDay + index,
    })),
    ...changes,
  }
}

describe('opensFullReport', () => {
  it.each([0, 7, 14, 21])(
    'opens in full the week of day %i, one of the first 4 of a game',
    (firstDay) => {
      expect(opensFullReport(weekOf(firstDay), false)).toBe(true)
    },
  )

  it.each([28, 35, 364])('slides in the week of day %i', (firstDay) => {
    expect(opensFullReport(weekOf(firstDay), false)).toBe(false)
  })

  it('opens in full every week when the player asks', () => {
    expect(opensFullReport(weekOf(28), true)).toBe(true)
    expect(opensFullReport(weekOf(700), true)).toBe(true)
  })

  it('counts the weeks pacing.json gives', () => {
    expect(opensFullReport(weekOf(7), false, 1)).toBe(false)
    expect(opensFullReport(weekOf(28), false, 5)).toBe(true)
  })
})

describe('newWeekOf', () => {
  it('finds the week the morning brings, and none on the other days', () => {
    const before = createInitialState(1)
    const after = toFirstReport(before)
    expect(newWeekOf(before, after)).toBe(after.lastWeek)
    expect(newWeekOf(after, after)).toBeNull()
    expect(newWeekOf(before, before)).toBeNull()
    const nextWeek = { ...after, lastWeek: weekOf(7) }
    expect(newWeekOf(after, nextWeek)).toBe(nextWeek.lastWeek)
  })
})

describe('weekChart', () => {
  it('has the 7 days of a week, Monday to Sunday, with their numbers', () => {
    const days = weekChart(FIRST_WEEK)
    expect(days).toHaveLength(7)
    expect(days.map(({ label }) => label)).toEqual([
      'lun.',
      'mar.',
      'mer.',
      'jeu.',
      'ven.',
      'sam.',
      'dim.',
    ])
    expect(days.map(({ day }) => day)).toEqual([0, 1, 2, 3, 4, 5, 6])
    days.forEach((day, index) => {
      const played = FIRST_WEEK.days[index]!
      expect(day).toEqual({
        day: played.day,
        label: day.label,
        played: true,
        open: played.open,
        sales: played.sales,
        cashReceived: played.cashReceived,
      })
    })
    // A game starts with the truck closed on Mondays.
    expect(days[0]).toMatchObject({ open: false, sales: 0 })
    expect(days[1]!.sales).toBeGreaterThan(0)
  })

  it('keeps 7 days for a partial week, those before its first day empty', () => {
    const partial = weekOf(14, {
      partial: true,
      days: FIRST_WEEK.days
        .slice(3)
        .map((day) => ({ ...day, day: day.day + 14 })),
    })
    const days = weekChart(partial)
    expect(days).toHaveLength(7)
    expect(days.map(({ played }) => played)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ])
    expect(days[0]).toEqual({
      day: 14,
      label: 'lun.',
      played: false,
      open: false,
      sales: 0,
      cashReceived: 0,
    })
    expect(days[3]!.sales).toBe(FIRST_WEEK.days[3]!.sales)
  })
})

describe('chartScale', () => {
  function daysUpTo(sales: number, cashReceived = 0): ChartDay[] {
    return weekChart(FIRST_WEEK).map((day, index) =>
      index === 2
        ? { ...day, sales: cents(sales), cashReceived: cents(cashReceived) }
        : { ...day, sales: cents(0), cashReceived: cents(0) },
    )
  }

  it.each([
    { highest: 0, top: 100, ticks: [0, 100] },
    { highest: 350, top: 400, ticks: [0, 100, 200, 300, 400] },
    {
      highest: 75_000,
      top: 80_000,
      ticks: [0, 20_000, 40_000, 60_000, 80_000],
    },
    {
      highest: 80_000,
      top: 80_000,
      ticks: [0, 20_000, 40_000, 60_000, 80_000],
    },
    { highest: 80_001, top: 100_000, ticks: [0, 50_000, 100_000] },
    {
      highest: 1_234_567,
      top: 1_500_000,
      ticks: [0, 500_000, 1_000_000, 1_500_000],
    },
  ])('reaches $highest cents with round steps', ({ highest, top, ticks }) => {
    expect(chartScale(daysUpTo(highest))).toEqual({ top, ticks })
    expect(chartScale(daysUpTo(0, highest))).toEqual({ top, ticks })
  })
})

describe('creditNotes', () => {
  it('notes each sale on credit of the week on its day, in the order of the days', () => {
    const report = weekOf(7, {
      receivables: [
        // Sold the week before: not this week's.
        {
          client: 'Ancien client',
          amount: cents(10_000),
          soldOnDay: 3,
          dueDay: 40,
        },
        {
          client: 'Gilles Lacasse',
          amount: cents(75_000),
          soldOnDay: 11,
          dueDay: 94,
        },
        {
          client: 'Le traiteur',
          amount: cents(12_550),
          soldOnDay: 9,
          dueDay: 100,
        },
      ],
    })
    expect(creditNotes(report)).toEqual([
      { day: 9, text: `125,50${S}$ de Le traiteur${S}: à recevoir le 9 août` },
      { day: 11, text: `750${S}$ de Gilles Lacasse${S}: à recevoir le 3 août` },
    ])
  })

  it('has none in a week without a sale on credit', () => {
    expect(creditNotes(FIRST_WEEK)).toEqual([])
  })
})

/** One fact of each kind, with numbers worth formatting. */
const SAMPLES: readonly WeekFact[] = [
  {
    id: 'profitUpCashDown',
    weight: 100,
    numbers: { netIncome: cents(123_400), cashChange: cents(-45_050) },
  },
  { id: 'unpaidRent', weight: 90, numbers: { day: 31 } },
  {
    id: 'receivableDue',
    weight: 80,
    numbers: { client: 'Gilles Lacasse', amount: cents(75_000), dueDay: 94 },
  },
  { id: 'spoilage', weight: 70, numbers: { cost: cents(6_050), units: 55 } },
  {
    id: 'bestWeek',
    weight: 60,
    numbers: { sales: cents(812_500), previousBest: cents(790_000) },
  },
  { id: 'lostToLine', weight: 50, numbers: { visits: 23 } },
  { id: 'daysOpenInARow', weight: 40, numbers: { days: 12 } },
]

/** How each sample's numbers read, by placeholder. */
const WRITTEN: Record<WeekFactId, Record<string, string>> = {
  profitUpCashDown: { netIncome: `1${S}234${S}$`, cashChange: `−450,50${S}$` },
  unpaidRent: { day: '1er juin' },
  receivableDue: {
    client: 'Gilles Lacasse',
    amount: `750${S}$`,
    dueDay: '3 août',
  },
  spoilage: { cost: `60,50${S}$`, units: '55' },
  bestWeek: { sales: `8${S}125${S}$`, previousBest: `7${S}900${S}$` },
  lostToLine: { visits: '23' },
  daysOpenInARow: { days: '12' },
}

describe('the facts in words', () => {
  it('has a sample of every fact', () => {
    expect(SAMPLES.map(({ id }) => id)).toEqual(weekFactIdSchema.options)
  })

  it.each(SAMPLES)('writes the numbers of $id for its placeholders', (fact) => {
    const values = factValues(fact)
    expect(values).toEqual(WRITTEN[fact.id])
    expect(new Set(Object.keys(values))).toEqual(
      new Set(REPORT_PLACEHOLDERS[fact.id]),
    )
  })

  it.each(SAMPLES)(
    'renders every variant of $id with its numbers, and every headline',
    (fact) => {
      const values = factValues(fact)
      for (const template of REPORT_TEXT.facts[fact.id]) {
        const text = fillTemplate(template, values)
        expect(text, template).not.toMatch(/[{}]/)
        for (const value of Object.values(WRITTEN[fact.id])) {
          expect(text, template).toContain(value)
        }
      }
      for (const template of REPORT_TEXT.headlines[fact.id]) {
        expect(fillTemplate(template, values), template).not.toMatch(/[{}]/)
      }
    },
  )

  it('throws for a placeholder without its number', () => {
    expect(() => fillTemplate('Le {day}.', {})).toThrow('{day}')
    expect(() => fillTemplate('{constructor}', {})).toThrow('{constructor}')
    expect(fillTemplate('Le {day}.', { day: '1er mai' })).toBe('Le 1er mai.')
  })
})

describe('factLines and reportHeadline', () => {
  /** The week of day `firstDay`, the owner's rent unpaid on its Tuesday. */
  function rentWeek(firstDay: number): WeekReport {
    return weekOf(firstDay, { unpaidRents: [firstDay + 1] })
  }

  it('tell the facts of the week, the first first, in the week’s variant', () => {
    const report = rentWeek(28)
    const facts = weekFacts(report)
    expect(facts[0]!.id).toBe('unpaidRent')
    const lines = factLines(report)
    expect(lines).toHaveLength(facts.length)
    // The week of day 28 is week 4 of the game, counting from 0.
    const variants = REPORT_TEXT.facts.unpaidRent
    expect(lines[0]).toBe(
      fillTemplate(variants[4 % variants.length]!, { day: '30 mai' }),
    )
    const headlines = REPORT_TEXT.headlines.unpaidRent
    expect(reportHeadline(report)).toBe(headlines[4 % headlines.length])
  })

  it('read the same each time, and change from one week to the next', () => {
    expect(factLines(rentWeek(7))).toEqual(factLines(rentWeek(7)))
    expect(factLines(rentWeek(7))[0]).not.toBe(factLines(rentWeek(14))[0])
    expect(reportHeadline(rentWeek(7))).not.toBe(reportHeadline(rentWeek(14)))
  })

  it('give a quiet headline to a week with no fact', () => {
    const quiet = weekOf(0, { spoiledCost: cents(0) })
    expect(weekFacts(quiet)).toEqual([])
    expect(factLines(quiet)).toEqual([])
    expect(REPORT_TEXT.quietHeadlines).toContain(reportHeadline(quiet))
    const nextQuiet = weekOf(7, { spoiledCost: cents(0) })
    expect(REPORT_TEXT.quietHeadlines).toContain(reportHeadline(nextQuiet))
    expect(reportHeadline(nextQuiet)).not.toBe(reportHeadline(quiet))
  })
})

describe('recentWeeks', () => {
  function record(firstDay: number): WeekRecord {
    return {
      firstDay,
      sales: cents(firstDay * 100),
      netIncome: cents(-firstDay),
      cashAtEnd: cents(firstDay * 1000),
    }
  }

  it(`lists the last ${WEEKS_LISTED} weeks, newest first`, () => {
    const history = Array.from({ length: 15 }, (_, index) => record(index * 7))
    const weeks = recentWeeks(history)
    expect(weeks).toHaveLength(WEEKS_LISTED)
    expect(weeks.map(({ firstDay }) => firstDay)).toEqual(
      Array.from({ length: 12 }, (_, index) => (14 - index) * 7),
    )
    expect(history[0]!.firstDay).toBe(0)
  })

  it('lists fewer when the game has fewer, and none before the first', () => {
    expect(recentWeeks([record(0), record(7)])).toEqual([record(7), record(0)])
    expect(recentWeeks([])).toEqual([])
  })
})
