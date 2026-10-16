import { describe, expect, it } from 'vitest'
import {
  formatDayAndMonth,
  formatDayOfMonth,
  formatGameDate,
  formatGameMonth,
  formatGamePeriod,
  formatShortGameDate,
  formatShortWeekdayName,
  formatWeekdayName,
} from './formatGameDate.ts'

describe('formatGameDate', () => {
  it.each([
    {
      when: 'the first of the month uses 1er',
      day: 0,
      text: 'Lundi 1er mai, an 1',
    },
    { when: 'an ordinary day', day: 1, text: 'Mardi 2 mai, an 1' },
    { when: 'December 31st', day: 244, text: 'Dimanche 31 décembre, an 1' },
    { when: 'the next year', day: 245, text: 'Lundi 1er janvier, an 2' },
    { when: 'accented months', day: 92, text: 'Mardi 1er août, an 1' },
  ])('formats $when', ({ day, text }) => {
    expect(formatGameDate(day)).toBe(text)
  })

  it('rejects days the calendar rejects', () => {
    expect(() => formatGameDate(-1)).toThrow(RangeError)
  })
})

describe('formatShortGameDate', () => {
  it.each([
    { day: 0, text: '1er mai, an 1' },
    { day: 30, text: '31 mai, an 1' },
    { day: 92, text: '1er août, an 1' },
    { day: 245, text: '1er janvier, an 2' },
  ])('formats day $day as $text', ({ day, text }) => {
    expect(formatShortGameDate(day)).toBe(text)
  })

  it('rejects days the calendar rejects', () => {
    expect(() => formatShortGameDate(-1)).toThrow(RangeError)
  })
})

describe('formatDayOfMonth', () => {
  it.each([
    { day: 0, text: '1er' },
    { day: 4, text: '5' },
    { day: 31, text: '1er' },
    { day: 60, text: '30' },
    { day: 244, text: '31' },
  ])('formats day $day as $text', ({ day, text }) => {
    expect(formatDayOfMonth(day)).toBe(text)
  })
})

describe('formatDayAndMonth', () => {
  it.each([
    { day: 0, text: '1er mai' },
    { day: 4, text: '5 mai' },
    { day: 31, text: '1er juin' },
    { day: 92, text: '1er août' },
    { day: 244, text: '31 décembre' },
  ])('formats day $day as $text', ({ day, text }) => {
    expect(formatDayAndMonth(day)).toBe(text)
  })
})

describe('formatWeekdayName', () => {
  it.each([
    { day: 0, text: 'lundi' },
    { day: 3, text: 'jeudi' },
    { day: 6, text: 'dimanche' },
    { day: 7, text: 'lundi' },
  ])('names day $day $text', ({ day, text }) => {
    expect(formatWeekdayName(day)).toBe(text)
  })
})

describe('formatShortWeekdayName', () => {
  it.each([
    { day: 0, text: 'lun.' },
    { day: 3, text: 'jeu.' },
    { day: 6, text: 'dim.' },
    { day: 7, text: 'lun.' },
  ])('names day $day $text', ({ day, text }) => {
    expect(formatShortWeekdayName(day)).toBe(text)
  })
})

describe('formatGameMonth', () => {
  it.each([
    { day: 0, text: 'Mai, an 1' },
    { day: 30, text: 'Mai, an 1' },
    { day: 31, text: 'Juin, an 1' },
    { day: 92, text: 'Août, an 1' },
    { day: 245, text: 'Janvier, an 2' },
  ])('formats day $day as $text', ({ day, text }) => {
    expect(formatGameMonth(day)).toBe(text)
  })

  it('rejects days the calendar rejects', () => {
    expect(() => formatGameMonth(-1)).toThrow(RangeError)
  })
})

describe('formatGamePeriod', () => {
  it.each([
    { from: 0, to: 30, text: 'Du 1er mai au 31 mai, an 1' },
    { from: 31, to: 45, text: 'Du 1er juin au 15 juin, an 1' },
    { from: 31, to: 31, text: 'Le 1er juin, an 1' },
    { from: 214, to: 245, text: 'Du 1er décembre, an 1 au 1er janvier, an 2' },
  ])('formats days $from to $to as $text', ({ from, to, text }) => {
    expect(formatGamePeriod(from, to)).toBe(text)
  })
})
