import { describe, expect, it } from 'vitest'
import bankruptcyJson from './bankruptcy.fr.json'
import {
  loadBankruptcyText,
  MAX_PRUDHOMME_LENGTH,
  MIN_PRUDHOMME_LINES,
} from './bankruptcyText.ts'

/** A deep copy of the shipped text to break, one field at a time. */
function shipped(): { prudhomme: string[] } & Record<string, unknown> {
  return structuredClone(bankruptcyJson)
}

const NO_BREAK_SPACE = ' '

describe('bankruptcy.fr.json', () => {
  const { prudhomme } = loadBankruptcyText()

  it(`holds at least ${MIN_PRUDHOMME_LINES} lines of Mme Prudhomme's, none twice`, () => {
    expect(prudhomme.length).toBeGreaterThanOrEqual(MIN_PRUDHOMME_LINES)
    expect(new Set(prudhomme).size).toBe(prudhomme.length)
  })

  it(`keeps each line within ${MAX_PRUDHOMME_LENGTH} characters`, () => {
    for (const line of prudhomme) {
      expect(line.length, line).toBeLessThanOrEqual(MAX_PRUDHOMME_LENGTH)
    }
  })

  it('names no amount and follows Quebec typography', () => {
    for (const line of prudhomme) {
      expect(line, line).not.toMatch(/[\d$]/)
      // No space before ? and !, a no-break space before :.
      expect(line, line).not.toMatch(/\s[?!]/)
      expect(line, line).not.toMatch(new RegExp(`[^${NO_BREAK_SPACE}]:`))
      // The screen adds the quotation marks.
      expect(line, line).not.toMatch(/["«»]/)
    }
  })
})

describe('loadBankruptcyText rejects', () => {
  it(`fewer than ${MIN_PRUDHOMME_LINES} lines`, () => {
    const raw = shipped()
    raw.prudhomme = raw.prudhomme.slice(0, MIN_PRUDHOMME_LINES - 1)
    expect(() => loadBankruptcyText(raw)).toThrow()
  })

  it(`a line over ${MAX_PRUDHOMME_LENGTH} characters, and takes one at that length`, () => {
    const at = shipped()
    at.prudhomme[0] = 'a'.repeat(MAX_PRUDHOMME_LENGTH)
    expect(() => loadBankruptcyText(at)).not.toThrow()

    const over = shipped()
    over.prudhomme[0] = 'a'.repeat(MAX_PRUDHOMME_LENGTH + 1)
    expect(() => loadBankruptcyText(over)).toThrow()
  })

  it('an empty line, or one padded with spaces', () => {
    for (const line of ['', ' Bonjour.', 'Bonjour. ']) {
      const raw = shipped()
      raw.prudhomme[1] = line
      expect(() => loadBankruptcyText(raw), JSON.stringify(line)).toThrow()
    }
  })

  it('a line repeated', () => {
    const raw = shipped()
    raw.prudhomme[2] = raw.prudhomme[0] ?? ''
    expect(() => loadBankruptcyText(raw)).toThrow(/twice/)
  })

  it('a key the screen does not know', () => {
    expect(() =>
      loadBankruptcyText({ ...shipped(), titre: 'Faillite' }),
    ).toThrow()
  })
})
