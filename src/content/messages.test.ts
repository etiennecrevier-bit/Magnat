import { describe, expect, it } from 'vitest'
import messagesJson from './messages.fr.json'
import {
  loadMessages,
  MAX_MESSAGE_LENGTH,
  messageKindSchema,
  MIN_LINES_PER_KIND,
  OWN_WORDS,
} from './messages.ts'
import { candidateIdSchema } from './schema.ts'

/** A deep copy of the shipped messages to break, one field at a time. */
function shipped() {
  // Each kind as a plain record; the tests leave `_note` alone.
  return structuredClone(messagesJson) as unknown as Record<
    string,
    { from?: string; lines: string[] } & Record<string, unknown>
  >
}

/** The kinds whose sender the game names: a grocer or an employee. */
const NAMED_BY_GAME = [
  'missedDelivery',
  'contractEnded',
  'contractBroken',
  'hired',
  'fired',
] as const

/** Every shipped line, the employees' own words included. */
function allLines(): string[] {
  const messages = loadMessages()
  return [
    ...messageKindSchema.options.flatMap((kind) => messages[kind].lines),
    ...OWN_WORDS.flatMap((kind) => Object.values(messages[kind])),
  ]
}

/** The shipped employees' own words, as plain records to break. */
function ownWords() {
  return structuredClone(messagesJson) as unknown as Record<
    string,
    Record<string, string>
  >
}

const NO_BREAK_SPACE = ' '

describe('messages.fr.json', () => {
  it('loads, naming who each kind is from, but those the game names', () => {
    const messages = loadMessages()
    expect(messages.landlord.from).toBe('Votre propriétaire')
    expect(messages.exhausted.from).toBe('Vous')
    for (const kind of NAMED_BY_GAME) {
      expect(Object.keys(messages[kind]), kind).toEqual(['lines'])
    }
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

  it('rejects a sender on a kind the game names, and none on the others', () => {
    const named = shipped()
    named.hired!.from = 'Amélie'
    expect(() => loadMessages(named)).toThrow()

    const unnamed = shipped()
    delete unnamed.landlord!.from
    expect(() => loadMessages(unnamed)).toThrow()
  })

  it('rejects an unknown key in a kind', () => {
    const raw = shipped()
    raw.landlord!.tone = 'sec'
    expect(() => loadMessages(raw)).toThrow()
  })
})

describe("the employees' own words (#255)", () => {
  it('give each candidate one warning and one goodbye of their own', () => {
    const messages = loadMessages()
    for (const kind of OWN_WORDS) {
      expect(Object.keys(messages[kind]), kind).toEqual(
        candidateIdSchema.options,
      )
    }
    expect(messages.underpaid.kevin).not.toBe(messages.quit.kevin)
  })

  it('reject a candidate missing, one the game does not know, or a line repeated', () => {
    const missing = ownWords()
    delete missing.underpaid!.kevin
    expect(() => loadMessages(missing)).toThrow()

    const unknown = ownWords()
    unknown.quit!.gilles = 'Je pars.'
    expect(() => loadMessages(unknown)).toThrow()

    const repeated = ownWords()
    repeated.quit!.kevin = repeated.underpaid!.nadia!
    expect(() => loadMessages(repeated)).toThrow(/twice/)

    const long = ownWords()
    long.underpaid!.kevin = 'a'.repeat(MAX_MESSAGE_LENGTH + 1)
    expect(() => loadMessages(long)).toThrow()
  })
})
