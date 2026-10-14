import { describe, expect, it } from 'vitest'
import { formatGameDate } from './formatGameDate.ts'

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
