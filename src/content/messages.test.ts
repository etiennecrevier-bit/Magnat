import { describe, expect, it } from 'vitest'
import messagesJson from './messages.fr.json'
import {
  loadMessages,
  MAX_MESSAGE_LENGTH,
  messageKindSchema,
  MIN_LINES_PER_KIND,
} from './messages.ts'

/** A deep copy of the shipped messages to break, one field at a time. */
function shipped() {
  // Each kind as a plain record; the tests leave `_note` alone.
  return structuredClone(messagesJson) as unknown as Record<
    string,
    { from: string; lines: string[] } & Record<string, unknown>
  >
}

/** Every shipped line. */
function allLines(): string[] {
  const messages = loadMessages()
  return messageKindSchema.options.flatMap((kind) => messages[kind].lines)
}

const NO_BREAK_SPACE = ' '

describe('messages.fr.json', () => {
  it('loads, naming who each kind is from', () => {
    const messages = loadMessages()
    expect(messages.landlord.from).toBe('Votre propriétaire')
    expect(messages.exhausted.from).toBe('Vous')
  })

  it(`holds at least ${MIN_LINES_PER_KIND} lines of each kind`, () => {
    const messages = loadMessages()
    for (const kind of messageKindSchema.options) {
      expect(messages[kind].lines.length, kind).toBeGreaterThanOrEqual(
        MIN_LINES_PER_KIND,
      )
    }
  })

  it(`keeps every line within ${MAX_MESSAGE_LENGTH} characters, and never repeats one`, () => {
    const lines = allLines()
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH)
    }
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('names no amount and follows Quebec typography', () => {
    for (const line of allLines()) {
      expect(line, line).not.toMatch(/[\d$]/)
      // No space before ? and !, a no-break space before :.
      expect(line, line).not.toMatch(/\s[?!]/)
      expect(line, line).not.toMatch(new RegExp(`[^${NO_BREAK_SPACE}]:`))
      expect(line, line).not.toMatch(/["«»]/)
    }
  })
})

describe('loadMessages', () => {
  it('rejects a missing kind or an unknown one', () => {
    const missing = shipped()
    delete missing.exhausted
    expect(() => loadMessages(missing)).toThrow()

    const unknown = shipped()
    unknown.banker = unknown.landlord!
    expect(() => loadMessages(unknown)).toThrow()
  })

  it(`rejects a kind with fewer than ${MIN_LINES_PER_KIND} lines`, () => {
    const raw = shipped()
    raw.landlord!.lines = raw.landlord!.lines.slice(0, MIN_LINES_PER_KIND - 1)
    expect(() => loadMessages(raw)).toThrow()
  })

  it(`rejects a line over ${MAX_MESSAGE_LENGTH} characters, and takes one at that length`, () => {
    const at = shipped()
    at.exhausted!.lines[0] = 'a'.repeat(MAX_MESSAGE_LENGTH)
    expect(() => loadMessages(at)).not.toThrow()

    const over = shipped()
    over.exhausted!.lines[0] = 'a'.repeat(MAX_MESSAGE_LENGTH + 1)
    expect(() => loadMessages(over)).toThrow()
  })

  it('rejects an empty line, one padded with spaces, or an empty sender', () => {
    for (const line of ['', ' Bonjour.', 'Bonjour. ']) {
      const raw = shipped()
      raw.landlord!.lines[2] = line
      expect(() => loadMessages(raw), JSON.stringify(line)).toThrow()
    }
    const raw = shipped()
    raw.exhausted!.from = ''
    expect(() => loadMessages(raw)).toThrow()
  })

  it('rejects a line repeated, even across kinds', () => {
    const raw = shipped()
    raw.exhausted!.lines[3] = raw.landlord!.lines[0]!
    expect(() => loadMessages(raw)).toThrow(/twice/)
  })

  it('rejects an unknown key in a kind', () => {
    const raw = shipped()
    raw.landlord!.tone = 'sec'
    expect(() => loadMessages(raw)).toThrow()
  })
})
