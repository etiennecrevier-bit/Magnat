import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import {
  formatAmount,
  formatBriefMoney,
  formatCount,
  formatMoney,
  formatSignedMoney,
  formatStatementAmount,
} from './formatMoney.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

describe('formatMoney', () => {
  it.each([
    { amount: 0, text: `0,00${S}$` },
    { amount: 5, text: `0,05${S}$` },
    { amount: 99, text: `0,99${S}$` },
    { amount: 100, text: `1,00${S}$` },
    { amount: 99_999, text: `999,99${S}$` },
    { amount: 100_000, text: `1${S}000,00${S}$` },
    { amount: 123_456, text: `1${S}234,56${S}$` },
    { amount: 123_456_789, text: `1${S}234${S}567,89${S}$` },
  ])('writes $amount cents as $text', ({ amount, text }) => {
    expect(formatMoney(cents(amount))).toBe(text)
  })

  it('puts a minus sign before a negative amount', () => {
    expect(formatMoney(cents(-123_456))).toBe(`-1${S}234,56${S}$`)
    expect(formatMoney(cents(-5))).toBe(`-0,05${S}$`)
  })

  it('never signs zero', () => {
    expect(formatMoney(cents(-0))).toBe(`0,00${S}$`)
  })

  it('stays exact at the ends of the safe integer range', () => {
    expect(formatMoney(cents(Number.MAX_SAFE_INTEGER))).toBe(
      `90${S}071${S}992${S}547${S}409,91${S}$`,
    )
    expect(formatMoney(cents(Number.MIN_SAFE_INTEGER))).toBe(
      `-90${S}071${S}992${S}547${S}409,91${S}$`,
    )
  })
})

describe('formatStatementAmount', () => {
  it('puts a negative amount in parentheses, without a minus sign', () => {
    expect(formatStatementAmount(cents(-123_456))).toBe(`(1${S}234,56${S}$)`)
    expect(formatStatementAmount(cents(-1))).toBe(`(0,01${S}$)`)
  })

  it('leaves zero and positive amounts as they are', () => {
    expect(formatStatementAmount(cents(0))).toBe(`0,00${S}$`)
    expect(formatStatementAmount(cents(-0))).toBe(`0,00${S}$`)
    expect(formatStatementAmount(cents(123_456_789))).toBe(
      `1${S}234${S}567,89${S}$`,
    )
  })
})

describe('formatAmount', () => {
  it.each([
    { amount: 0, text: '0,00' },
    { amount: 5, text: '0,05' },
    { amount: 325, text: '3,25' },
    { amount: 300_000, text: `3${S}000,00` },
    { amount: -123_456, text: `1${S}234,56` },
  ])('writes $amount cents as $text, without a sign', ({ amount, text }) => {
    expect(formatAmount(cents(amount))).toBe(text)
  })
})

describe('formatSignedMoney', () => {
  it.each([
    { amount: 75_000, text: `+750${S}$` },
    { amount: -22_000, text: `\u2212220${S}$` },
    { amount: -250, text: `\u22122,50${S}$` },
    { amount: 5, text: `+0,05${S}$` },
    { amount: 123_456_700, text: `+1${S}234${S}567${S}$` },
  ])('writes $amount cents as $text', ({ amount, text }) => {
    expect(formatSignedMoney(cents(amount))).toBe(text)
  })
})

describe('formatBriefMoney', () => {
  it.each([
    { amount: 75_000, text: `750${S}$` },
    { amount: 250, text: `2,50${S}$` },
    { amount: 0, text: `0${S}$` },
    { amount: -0, text: `0${S}$` },
    { amount: -120_000, text: `-1${S}200${S}$` },
    { amount: -5, text: `-0,05${S}$` },
    { amount: 123_456_700, text: `1${S}234${S}567${S}$` },
  ])('writes $amount cents as $text', ({ amount, text }) => {
    expect(formatBriefMoney(cents(amount))).toBe(text)
  })
})

describe('formatCount', () => {
  it.each([
    { count: 0, text: '0' },
    { count: 750, text: '750' },
    { count: 1250, text: `1${S}250` },
    { count: 1_234_567, text: `1${S}234${S}567` },
  ])('writes $count as $text', ({ count, text }) => {
    expect(formatCount(count)).toBe(text)
  })
})
