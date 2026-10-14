declare const brand: unique symbol

/**
 * An amount of money as a whole number of cents. Only `cents()` and the
 * helpers below make one, so every `Cents` is a safe integer.
 */
export type Cents = number & { readonly [brand]: true }

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * Checks that `n` is a whole number of cents. Throws a RangeError unless `n`
 * is a safe integer. Negative zero becomes zero.
 */
export function cents(n: number): Cents {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Not a whole number of cents: ${n}`)
  }
  return (n + 0) as Cents
}

/** Throws a RangeError if the result leaves the safe integer range. */
export function add(a: Cents, b: Cents): Cents {
  return cents(a + b)
}

/** Throws a RangeError if the result leaves the safe integer range. */
export function sub(a: Cents, b: Cents): Cents {
  return cents(a - b)
}

/**
 * Multiplies by a whole number. Throws a RangeError unless `n` is a safe
 * integer, or if the result leaves the safe integer range.
 */
export function mulInt(c: Cents, n: number): Cents {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Not a whole multiplier: ${n}`)
  }
  return cents(c * n)
}

/**
 * Multiplies by a ratio such as a tax rate or a markup, rounding half away
 * from zero. The ratio counts as the decimal it is written as (0.35, not the
 * nearest float), so the cents come out as they would on paper: float
 * arithmetic gives 90 × 0.35 = 31.499… and would round it down. Throws a
 * RangeError unless `ratio` is finite, or if the result leaves the safe
 * integer range.
 */
export function mulRatio(c: Cents, ratio: number): Cents {
  if (!Number.isFinite(ratio)) {
    throw new RangeError(`Not a finite ratio: ${ratio}`)
  }

  const { digits, exponent } = toDecimal(ratio)
  const product = BigInt(c) * digits
  let result: bigint
  if (exponent >= 0) {
    result = product * 10n ** BigInt(exponent)
  } else {
    const divisor = 10n ** BigInt(-exponent)
    // BigInt division truncates toward zero and the remainder takes the sign
    // of the product, so a remainder of half the divisor or more rounds away.
    result = product / divisor
    const remainder = product % divisor
    if (2n * remainder >= divisor) result += 1n
    else if (2n * remainder <= -divisor) result -= 1n
  }

  if (result > MAX_CENTS || result < -MAX_CENTS) {
    throw new RangeError(`${c} × ${ratio} is out of range`)
  }
  return cents(Number(result))
}

/** Throws a RangeError if the total leaves the safe integer range. */
export function sum(list: readonly Cents[]): Cents {
  return list.reduce(add, cents(0))
}

/**
 * Reads a finite number as `digits × 10^exponent` from its shortest
 * round-trip form, which is how JSON and source code write it.
 */
function toDecimal(n: number): { digits: bigint; exponent: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(n))
  if (match === null) throw new RangeError(`Not a decimal number: ${n}`)
  const [, sign = '', whole = '', fraction = '', power = '0'] = match
  return {
    digits: BigInt(sign + whole + fraction),
    exponent: Number(power) - fraction.length,
  }
}
