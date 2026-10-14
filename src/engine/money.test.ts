import { describe, expect, it } from 'vitest'
import { add, cents, mulInt, mulRatio, sub, sum, type Cents } from './money.ts'

const MAX = Number.MAX_SAFE_INTEGER

describe('cents', () => {
  it.each([0, 1, -1, 1999, MAX, -MAX])('accepts %s', (n) => {
    expect(cents(n)).toBe(n)
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -(2 ** 53)])(
    'rejects %s',
    (n) => {
      expect(() => cents(n)).toThrow(RangeError)
    },
  )

  it('turns negative zero into zero', () => {
    expect(Object.is(cents(-0), 0)).toBe(true)
  })

  it('keeps plain numbers out of Cents at compile time', () => {
    // @ts-expect-error: a plain number is only Cents once cents() checks it
    const plain: Cents = 5
    // @ts-expect-error: the helpers only take Cents
    const total = add(cents(1), 2)
    expect([plain, total]).toEqual([5, 3])
  })
})

describe('add, sub and mulInt', () => {
  it('compute exact whole cents', () => {
    expect(add(cents(1999), cents(-500))).toBe(1499)
    expect(sub(cents(500), cents(1999))).toBe(-1499)
    expect(mulInt(cents(1999), 3)).toBe(5997)
    expect(mulInt(cents(-1999), -3)).toBe(5997)
  })

  it('never return negative zero', () => {
    expect(Object.is(mulInt(cents(-5), 0), 0)).toBe(true)
    expect(Object.is(sub(cents(0), cents(0)), 0)).toBe(true)
  })

  it('throw instead of leaving the safe integer range', () => {
    expect(() => add(cents(MAX), cents(1))).toThrow(RangeError)
    expect(() => sub(cents(-MAX), cents(1))).toThrow(RangeError)
    expect(() => mulInt(cents(MAX), 2)).toThrow(RangeError)
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'mulInt rejects multiplier %s',
    (n) => {
      expect(() => mulInt(cents(100), n)).toThrow(RangeError)
    },
  )
})

describe('sum', () => {
  it('adds a list of amounts', () => {
    expect(sum([cents(1), cents(2), cents(-4)])).toBe(-1)
  })

  it('is zero for an empty list', () => {
    expect(sum([])).toBe(0)
  })

  it('throws instead of leaving the safe integer range', () => {
    expect(() => sum([cents(MAX), cents(1)])).toThrow(RangeError)
  })
})

describe('mulRatio', () => {
  const cases: { amount: number; ratio: number; result: number }[] = [
    { amount: 5, ratio: 0.5, result: 3 },
    { amount: -5, ratio: 0.5, result: -3 },
    { amount: 3, ratio: -0.5, result: -2 },
    { amount: 1, ratio: 0.4, result: 0 },
    { amount: -1, ratio: 0.4, result: 0 },
    // Float arithmetic gets these wrong: 90 * 0.35 is 31.499999999999996.
    { amount: 90, ratio: 0.35, result: 32 },
    { amount: 100, ratio: 1.005, result: 101 },
    { amount: 1000, ratio: 0.14975, result: 150 },
    { amount: 1999, ratio: 0.5, result: 1000 },
    // Ratios written with an exponent, as String() prints them.
    { amount: 2, ratio: 1e-7, result: 0 },
    { amount: 5_000_000, ratio: 1e-7, result: 1 },
    { amount: -5_000_000, ratio: 1e-7, result: -1 },
    { amount: 0, ratio: 1e21, result: 0 },
    { amount: 7, ratio: 0, result: 0 },
    { amount: MAX, ratio: 1, result: MAX },
    { amount: -MAX, ratio: 1, result: -MAX },
  ]

  it.each(cases)('$amount × $ratio = $result', ({ amount, ratio, result }) => {
    const product = mulRatio(cents(amount), ratio)
    expect(product).toBe(result)
    expect(Object.is(product, -0)).toBe(false)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects ratio %s',
    (ratio) => {
      expect(() => mulRatio(cents(100), ratio)).toThrow(RangeError)
    },
  )

  it('throws instead of leaving the safe integer range', () => {
    expect(() => mulRatio(cents(3), 1.5e21)).toThrow(RangeError)
    expect(() => mulRatio(cents(MAX), 1.5)).toThrow(RangeError)
  })
})
