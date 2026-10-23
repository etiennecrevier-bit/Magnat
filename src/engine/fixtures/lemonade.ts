// What a save from before the lemonade (#261) looks like: every record by
// product, the decisions' and the days', without its `limonade`.

/**
 * `value`, a parsed save or a part of one, with no `limonade` in any record
 * by product (an object that has a `croissant`), as a save from before the
 * lemonade (#261) has none. Never mutates `value`.
 */
export function withoutLemonade<T>(value: T): T {
  return strip(value) as T
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip)
  if (value === null || typeof value !== 'object') return value
  const byProduct = 'croissant' in value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !(byProduct && key === 'limonade'))
      .map(([key, field]) => [key, strip(field)]),
  )
}
