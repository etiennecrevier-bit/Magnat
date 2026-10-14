// mulberry32, written as pure functions: the whole generator state is one
// uint32 that GameState holds and a save restores as is. Its constants are
// facts of the algorithm, not tunables, so they stay here rather than in
// src/content/.
const INCREMENT = 0x6d2b79f5
const UINT32_RANGE = 2 ** 32

/** A drawn value and the generator state to draw the next one from. */
export type Draw = [value: number, state: number]

/**
 * Returns the generator state a game with this seed starts from. Throws a
 * RangeError unless `seed` is an integer in [0, 2^32).
 */
export function seedRng(seed: number): number {
  assertUint32(seed, 'seed')
  return seed
}

/**
 * Draws a value in [0, 1). Returns it with the next state; never mutates
 * anything. Throws a RangeError unless `state` is an integer in [0, 2^32).
 */
export function next(state: number): Draw {
  assertUint32(state, 'generator state')
  // The reference version lets its counter grow as a float; keeping it as an
  // exact uint32 gives the same values and a state that saves cleanly.
  const nextState = (state + INCREMENT) >>> 0
  let t = nextState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE, nextState]
}

/**
 * Draws an integer from `min` to `max`, both included, using one draw. Each
 * result gets ⌊2^32/span⌋ or ⌈2^32/span⌉ of the generator's 2^32 outputs, so
 * it is uniform to within span/2^32: negligible for game-sized ranges, but
 * for spans near 2^32 some results come up twice as often as others. Throws a
 * RangeError unless `min` and `max` are safe integers, `min ≤ max` and the
 * span is at most 2^32.
 */
export function int(state: number, min: number, max: number): Draw {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
    throw new RangeError(`Invalid integer range: ${min} to ${max}`)
  }
  const span = max - min + 1
  if (span > UINT32_RANGE) {
    throw new RangeError(`Integer range too wide: ${min} to ${max}`)
  }
  const [value, nextState] = next(state)
  return [min + Math.floor(value * span), nextState]
}

/**
 * Draws from a normal distribution with the Box–Muller transform, using
 * exactly two draws. Throws a RangeError unless `mean` is finite and `sd` is
 * finite and non-negative.
 */
export function normal(state: number, mean: number, sd: number): Draw {
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd < 0) {
    throw new RangeError(`Invalid normal distribution: ${mean}, ${sd}`)
  }
  const [u1, afterFirst] = next(state)
  const [u2, nextState] = next(afterFirst)
  // 1 - u1 is in (0, 1], so the logarithm is finite. The transform makes a
  // second, independent value from the same draws; there is nowhere to keep
  // it, so it is dropped.
  const z = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2)
  return [mean + sd * z, nextState]
}

/**
 * Whether `n` is a seed or generator state the functions here accept: an
 * integer in [0, 2^32).
 */
export function isRngState(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < UINT32_RANGE
}

function assertUint32(n: number, name: string): void {
  if (!isRngState(n)) {
    throw new RangeError(`Invalid ${name}: ${n}`)
  }
}
