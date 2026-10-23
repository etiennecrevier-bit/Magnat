import { describe, expect, it } from 'vitest'
import linesJson from './lines.fr.json'
import {
  lineOutcomeSchema,
  loadCustomerLines,
  MAX_LINE_LENGTH,
  MIN_LINES_PER_OUTCOME,
} from './lines.ts'
import { segmentIdSchema } from './schema.ts'

/** A deep copy of the shipped lines to break, one field at a time. */
function shipped() {
  return structuredClone(linesJson) as {
    segments: Record<
      string,
      { name: string; lines: Record<string, string[]> } & Record<
        string,
        unknown
      >
    >
    [key: string]: unknown
  }
}

/** Every shipped line. */
function allLines(): string[] {
  const { segments } = loadCustomerLines()
  return segmentIdSchema.options.flatMap((segment) =>
    lineOutcomeSchema.options.flatMap(
      (outcome) => segments[segment].lines[outcome],
    ),
  )
}

const NO_BREAK_SPACE = '\u00a0'

describe('lines.fr.json', () => {
  it('loads, naming one customer of each segment', () => {
    const { segments } = loadCustomerLines()
    expect(segments.aubaine.name).toBe("Chasseur d'aubaines")
    expect(segments.habitue.name).toBe('Habitué')
    expect(segments.chic.name).toBe('Clientèle chic')
    expect(segments.touriste.name).toBe('Touriste')
  })

  it(`holds at least ${MIN_LINES_PER_OUTCOME} lines for every segment and outcome, 120 in all`, () => {
    const { segments } = loadCustomerLines()
    for (const segment of segmentIdSchema.options) {
      for (const outcome of lineOutcomeSchema.options) {
        expect(
          segments[segment].lines[outcome].length,
          `${segment} ${outcome}`,
        ).toBeGreaterThanOrEqual(MIN_LINES_PER_OUTCOME)
      }
    }
    expect(allLines().length).toBeGreaterThanOrEqual(120)
  })

  it(`keeps every line within ${MAX_LINE_LENGTH} characters, and never repeats one`, () => {
    const lines = allLines()
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(MAX_LINE_LENGTH)
    }
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('follows Quebec typography', () => {
    for (const line of allLines()) {
      // No space before ? and !, a no-break space before : and $.
      expect(line, line).not.toMatch(/\s[?!]/)
      expect(line, line).not.toMatch(new RegExp(`[^${NO_BREAK_SPACE}][:$]`))
      // Guillemets around the line come from the card; none inside it.
      expect(line, line).not.toMatch(/["«»]/)
    }
  })
})

describe('loadCustomerLines', () => {
  it('rejects a segment missing an outcome', () => {
    const raw = shipped()
    delete raw.segments.habitue!.lines.leftLine
    expect(() => loadCustomerLines(raw)).toThrow()
  })

  it('rejects a missing segment or an unknown one', () => {
    const missing = shipped()
    delete missing.segments.chic
    expect(() => loadCustomerLines(missing)).toThrow()

    const unknown = shipped()
    unknown.segments.enfant = unknown.segments.chic!
    expect(() => loadCustomerLines(unknown)).toThrow()
  })

  it(`rejects an outcome with fewer than ${MIN_LINES_PER_OUTCOME} lines`, () => {
    const raw = shipped()
    raw.segments.aubaine!.lines.bought!.pop()
    expect(raw.segments.aubaine!.lines.bought).toHaveLength(
      MIN_LINES_PER_OUTCOME - 1,
    )
    expect(() => loadCustomerLines(raw)).toThrow()
  })

  it(`rejects a line over ${MAX_LINE_LENGTH} characters, and takes one at that length`, () => {
    const at = shipped()
    at.segments.chic!.lines.browsed![0] = 'a'.repeat(MAX_LINE_LENGTH)
    expect(() => loadCustomerLines(at)).not.toThrow()

    const over = shipped()
    over.segments.chic!.lines.browsed![0] = 'a'.repeat(MAX_LINE_LENGTH + 1)
    expect(() => loadCustomerLines(over)).toThrow()
  })

  it('rejects an empty line or one padded with spaces', () => {
    for (const line of ['', ' Bonjour.', 'Bonjour. ']) {
      const raw = shipped()
      raw.segments.habitue!.lines.soldOut![2] = line
      expect(() => loadCustomerLines(raw), JSON.stringify(line)).toThrow()
    }
  })

  it('rejects a line repeated within a segment, even across outcomes', () => {
    const raw = shipped()
    const { lines } = raw.segments.aubaine!
    lines.browsed![3] = lines.bought![0]!
    expect(() => loadCustomerLines(raw)).toThrow(/twice/)
  })

  it('rejects an unknown key', () => {
    const top = shipped()
    top.extra = true
    expect(() => loadCustomerLines(top)).toThrow()

    const segment = shipped()
    segment.segments.chic!.mood = 'happy'
    expect(() => loadCustomerLines(segment)).toThrow()

    const outcome = shipped()
    outcome.segments.chic!.lines.boughtTwice = outcome.segments.chic!.lines
      .bought as string[]
    expect(() => loadCustomerLines(outcome)).toThrow()
  })
})
