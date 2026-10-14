import { describe, expect, it } from 'vitest'
import {
  formatGameDate,
  formatGamePeriod,
  formatShortGameDate,
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
