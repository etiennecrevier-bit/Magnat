import { describe, expect, it } from 'vitest'
import cashGauge from '../content/cashGauge.json'
import difficulty from '../content/difficulty.json'
import districts from '../content/districts.json'
import foodTruck from '../content/foodtruck.json'
import { monthsSinceStart, toCalendar } from '../engine/calendar.ts'
import { cents } from '../engine/money.ts'
import { loanSchedule } from '../finance/loan.ts'
import { LOW_BELOW_MONTHS, cashLevel, monthlyFixedCosts } from './cashLevel.ts'

describe('cashLevel', () => {
  const monthly = cents(175_000)
  const threshold = 2 * 175_000

  it.each([
    { cash: -1, level: 'negative' },
    { cash: -1_000_000, level: 'negative' },
    { cash: 0, level: 'low' },
    { cash: threshold - 1, level: 'low' },
    { cash: threshold, level: 'healthy' },
    { cash: 1_000_000, level: 'healthy' },
  ])('reads $cash cents as $level', ({ cash, level }) => {
    expect(cashLevel(cents(cash), monthly, 2)).toBe(level)
  })

  it('reads the shipped number of months by default', () => {
    expect(LOW_BELOW_MONTHS).toBe(cashGauge.lowBelowMonthsOfFixedCosts)
    const threshold = 355_000 * LOW_BELOW_MONTHS
    expect(cashLevel(cents(threshold - 1), cents(355_000))).toBe('low')
    expect(cashLevel(cents(threshold), cents(355_000))).toBe('healthy')
  })
})

describe('monthlyFixedCosts', () => {
  // The Plateau's permit (#260), then the insurance.
  const everyTruck =
    districts.districts.plateau.permit.monthlyCents +
    foodTruck.monthlyCostsCents.insurance

  it.each([0, 1, 30, 31, 400, 3649])(
    'charges an owned truck the permit and the insurance on day %i',
    (day) => {
      expect(monthlyFixedCosts(day, 'facile')).toBe(everyTruck)
    },
  )

  it.each([0, 1, 30, 31, 400, 3649])(
    'adds the lease to a leased truck on day %i',
    (day) => {
      const { monthlyLeaseCents } = difficulty.difficulties.difficile.truck
      expect(monthlyFixedCosts(day, 'difficile')).toBe(
        everyTruck + monthlyLeaseCents,
      )
    },
  )

  describe('with a loan', () => {
    const { loanCents, annualRateBasisPoints, termMonths } =
      difficulty.difficulties.moyen.truck
    const { payments } = loanSchedule(
      cents(loanCents),
      annualRateBasisPoints,
      termMonths,
    )
    // May 1st of year 6, the 1st of the last payment.
    const lastPaymentDay = 1825

    it('is taken on May 1st and paid off on May 1st of year 6', () => {
      expect(toCalendar(0)).toMatchObject({ month: 5, dayOfMonth: 1 })
      expect(toCalendar(lastPaymentDay)).toMatchObject({
        year: 6,
        month: 5,
        dayOfMonth: 1,
      })
      expect(monthsSinceStart(lastPaymentDay)).toBe(termMonths)
    })

    it.each([
      { day: 1, when: 'the next day', payment: 1 },
      { day: 30, when: 'the eve of the first payment', payment: 1 },
      { day: 31, when: 'the 1st of the first payment', payment: 1 },
      { day: 32, when: 'the next day', payment: 2 },
      {
        day: lastPaymentDay,
        when: 'the 1st of the last payment',
        payment: termMonths,
      },
    ])('adds payment $payment on day $day, $when', ({ day, payment }) => {
      expect(monthlyFixedCosts(day, 'moyen')).toBe(
        everyTruck + (payments[payment - 1]?.payment ?? NaN),
      )
    })

    it.each([
      { day: 0, when: 'the 1st it is taken' },
      { day: lastPaymentDay + 1, when: 'the day after the last payment' },
      { day: 3649, when: 'the last day of year 10' },
    ])('adds no payment on day $day, $when', ({ day }) => {
      expect(monthlyFixedCosts(day, 'moyen')).toBe(everyTruck)
    })

    // A Défi's truck comes on its first day, from which the engine counts
    // the loan's months.
    describe('in a Défi', () => {
      // July 10 and August 1st of year 1.
      const july10 = 70
      const august1 = 92
      // June 1st of year 1.
      const june1 = 31

      it('counts the payments from the first day of the Défi', () => {
        expect(toCalendar(july10)).toMatchObject({ month: 7, dayOfMonth: 10 })
        expect(toCalendar(august1)).toMatchObject({ month: 8, dayOfMonth: 1 })
        expect(monthlyFixedCosts(july10, 'moyen', july10)).toBe(
          everyTruck + (payments[0]?.payment ?? NaN),
        )
        expect(monthlyFixedCosts(august1 + 1, 'moyen', july10)).toBe(
          everyTruck + (payments[1]?.payment ?? NaN),
        )
      })

      it('adds no payment on the 1st the Défi starts, as the loan is taken', () => {
        expect(toCalendar(june1)).toMatchObject({ month: 6, dayOfMonth: 1 })
        expect(monthlyFixedCosts(june1, 'moyen', june1)).toBe(everyTruck)
        expect(monthlyFixedCosts(june1, 'moyen')).toBe(
          everyTruck + (payments[0]?.payment ?? NaN),
        )
      })
    })
  })
})
