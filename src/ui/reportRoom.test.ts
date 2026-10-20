import { describe, expect, it } from 'vitest'

// The week's card stands above the dock (#202, Do 8). Vitest runs without a
// browser, so this test works out the custom properties the way a browser
// does: each element inherits its parent's computed values, and a var() in
// a custom property is replaced where that property is declared. Ticker.tsx
// sets --ticker-height on the body (tickerRoom.ts); the CSS is read from disk.
// The app's types leave Node's out, hence the cast.
const NODE_FS: string = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: URL, encoding: 'utf8') => string
}

const SHEETS = ['Ticker.css', 'Dock.css', 'Yesterday.css', 'WeekSlideIn.css']

/** The dock's height on a phone: a 48 px tile, 6 px above and under it and
    its 3 px top border (63 px in the review's screenshots, #230). */
const PHONE_DOCK_HEIGHT = 63

const REM = 16

interface Rule {
  selector: string
  /** The window's widths the rule holds at. */
  media: { min: number; max: number }
  declarations: [string, string][]
}

function parseDeclarations(body: string): [string, string][] {
  return body
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes(':'))
    .map((part) => {
      const at = part.indexOf(':')
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()]
    })
}

/** The rules of `css`, those inside a width @media with its widths. */
function parseRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  const all = { min: 0, max: Infinity }
  let at = 0
  const block = (from: number): number => {
    let depth = 0
    for (let i = from; i < text.length; i++) {
      if (text[i] === '{') depth++
      if (text[i] === '}' && --depth === 0) return i
    }
    throw new Error('unbalanced CSS')
  }
  const read = (inner: string, media: Rule['media']) => {
    for (const [, selector, body] of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      rules.push({
        selector: selector!.trim(),
        media,
        declarations: parseDeclarations(body!),
      })
    }
  }
  while (at < text.length) {
    const open = text.indexOf('{', at)
    if (open === -1) break
    const head = text.slice(at, open).trim()
    const end = block(open)
    if (head.startsWith('@')) {
      const max = /max-width:\s*(\d+)px/.exec(head)
      const min = /min-width:\s*(\d+)px/.exec(head)
      if (head.startsWith('@media') && (max ?? min) !== null) {
        read(text.slice(open + 1, end), {
          min: min === null ? 0 : Number(min[1]),
          max: max === null ? Infinity : Number(max[1]),
        })
      }
    } else {
      read(text.slice(at, end + 1), all)
    }
    at = end + 1
  }
  return rules
}

const RULES = SHEETS.flatMap((sheet) =>
  parseRules(readFileSync(new URL(sheet, import.meta.url), 'utf8')),
)

/** Replaces each var() in `value` with `props`' value or its fallback. */
function substitute(value: string, props: Map<string, string>): string {
  for (;;) {
    const at = value.lastIndexOf('var(')
    if (at === -1) return value
    let depth = 0
    let end = at + 3
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++
      if (value[end] === ')' && --depth === 0) break
    }
    const inner = value.slice(at + 4, end)
    const comma = inner.indexOf(',')
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim()
    const found = props.get(name) ?? fallback
    if (found === undefined) throw new Error(`${name} has no value`)
    value = value.slice(0, at) + found + value.slice(end + 1)
  }
}

/** The length `value` (px, rem, calc(), + − × ÷) in pixels. */
function pixels(value: string): number {
  const tokens = value
    .replace(/calc\(/g, '(')
    .match(/\d*\.?\d+(?:px|rem)?|[-+*/()]/g)!
  let i = 0
  const atom = (): number => {
    const token = tokens[i++]!
    if (token === '(') {
      const inside = sum()
      i++
      return inside
    }
    if (token.endsWith('rem')) return parseFloat(token) * REM
    return parseFloat(token)
  }
  const product = (): number => {
    let result = atom()
    while (tokens[i] === '*' || tokens[i] === '/') {
      result = tokens[i++] === '*' ? result * atom() : result / atom()
    }
    return result
  }
  const sum = (): number => {
    let result = product()
    while (tokens[i] === '+' || tokens[i] === '-') {
      result = tokens[i++] === '+' ? result + product() : result - product()
    }
    return result
  }
  return sum()
}

/**
 * The computed custom properties and `property` of the element matched by
 * `selectors`, down the page html › body › it, in a `width` px window, the
 * body's style holding `bodyStyle` (as tickerRoom.ts sets it).
 */
function computed(
  width: number,
  bodyStyle: Record<string, string>,
  selectors: string[],
  property: string,
): number {
  const holds = (rule: Rule, names: string[]) =>
    names.includes(rule.selector) &&
    width >= rule.media.min &&
    width <= rule.media.max
  const cascade = (
    names: string[],
    parent: Map<string, string>,
    style: Record<string, string> = {},
  ) => {
    const declared = new Map<string, string>()
    for (const rule of RULES) {
      if (!holds(rule, names)) continue
      for (const [name, value] of rule.declarations) declared.set(name, value)
    }
    for (const [name, value] of Object.entries(style)) declared.set(name, value)
    const props = new Map(parent)
    for (const [name, value] of declared) {
      if (name.startsWith('--')) props.set(name, value)
    }
    // A custom property's var()s resolve on the element declaring it.
    for (const [name, value] of declared) {
      if (name.startsWith('--')) props.set(name, substitute(value, props))
    }
    return { props, declared }
  }
  const root = cascade([':root', 'html'], new Map())
  const body = cascade(['body', 'body:has(.ticker)'], root.props, bodyStyle)
  const element = cascade(selectors, body.props)
  const value = element.declared.get(property)
  if (value === undefined) throw new Error(`${property} is not declared`)
  return pixels(substitute(value, element.props))
}

describe("the week's card on a phone", () => {
  // One line of headline, then the two and three lines a phone wraps it
  // onto under the paper's name (Ticker.css), as on #230's screenshots.
  for (const ticker of [44, 88, 112]) {
    for (const width of [320, 390, 699]) {
      it(`stands above the dock at ${width} px wide, under a ${ticker} px ticker`, () => {
        const style = { '--ticker-height': `${ticker}px` }
        const dockBottom = computed(width, style, ['.dock'], 'bottom')
        const cardBottom = computed(width, style, ['.week-slide-in'], 'bottom')
        expect(dockBottom).toBe(ticker)
        expect(cardBottom).toBeGreaterThanOrEqual(
          dockBottom + PHONE_DOCK_HEIGHT,
        )
      })
    }
  }
})
