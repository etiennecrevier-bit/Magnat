import { describe, expect, it } from 'vitest'
import reportTextJson from './report.fr.json'
import {
  loadReportText,
  MAX_FACT_LENGTH,
  MAX_HEADLINE_LENGTH,
  MIN_VARIANTS,
  PLACEHOLDER,
  REPORT_PLACEHOLDERS,
} from './reportText.ts'
import {
  loadFoodTruckContent,
  loadReportContent,
  weekFactIdSchema,
} from './schema.ts'

/** A deep copy of the shipped text to break, one field at a time. */
function shipped() {
  return structuredClone(reportTextJson) as {
    facts: Record<string, string[]>
    headlines: Record<string, string[]>
    quietHeadlines: string[]
    creditSaleNote: string
  }
}

/** Every shipped line. */
function allLines(): string[] {
  const text = loadReportText()
  return [
    ...weekFactIdSchema.options.flatMap((id) => [
      ...text.facts[id],
      ...text.headlines[id],
    ]),
    ...text.quietHeadlines,
    text.creditSaleNote,
  ]
}

const NO_BREAK_SPACE = ' '

describe('report.fr.json', () => {
  it(`loads, with at least ${MIN_VARIANTS} facts and headlines for each fact of a week`, () => {
    const text = loadReportText()
    for (const id of weekFactIdSchema.options) {
      expect(text.facts[id].length, id).toBeGreaterThanOrEqual(MIN_VARIANTS)
      expect(text.headlines[id].length, id).toBeGreaterThanOrEqual(MIN_VARIANTS)
    }
    expect(text.quietHeadlines.length).toBeGreaterThanOrEqual(MIN_VARIANTS)
  })

  it('names every number of its fact in each fact, and only those', () => {
    const text = loadReportText()
    for (const id of weekFactIdSchema.options) {
      for (const fact of text.facts[id]) {
        const names = [...fact.matchAll(PLACEHOLDER)].map(([, name]) => name)
        expect(new Set(names), fact).toEqual(new Set(REPORT_PLACEHOLDERS[id]))
      }
    }
  })

  it(`keeps facts within ${MAX_FACT_LENGTH} characters and headlines within ${MAX_HEADLINE_LENGTH}`, () => {
    const text = loadReportText()
    for (const id of weekFactIdSchema.options) {
      for (const fact of text.facts[id]) {
        expect(fact.length, fact).toBeLessThanOrEqual(MAX_FACT_LENGTH)
      }
      for (const title of text.headlines[id]) {
        expect(title.length, title).toBeLessThanOrEqual(MAX_HEADLINE_LENGTH)
      }
    }
  })

  it('never repeats a line and follows Quebec typography', () => {
    const lines = allLines()
    expect(new Set(lines).size).toBe(lines.length)
    for (const line of lines) {
      // No space before ? and !, a no-break space before : and inside « ».
      expect(line, line).not.toMatch(/\s[?!]/)
      expect(line, line).not.toMatch(new RegExp(`[^${NO_BREAK_SPACE}]:`))
      expect(line, line).not.toMatch(new RegExp(`«[^${NO_BREAK_SPACE}]`))
      expect(line, line).not.toMatch(new RegExp(`[^${NO_BREAK_SPACE}]»`))
      expect(line, line).not.toMatch(/"/)
    }
  })

  // The facts write their counts in the plural, which the thresholds of
  // report.json keep at 2 or more: a fact told for one unit would read
  // « 1 unités ».
  it('keeps every count its facts name at 2 or more', () => {
    const { facts } = loadReportContent()
    const { products } = loadFoodTruckContent()
    expect(facts.daysOpenInARow.atLeast).toBeGreaterThanOrEqual(2)
    // More than aboveVisits visits.
    expect(facts.lostToLine.aboveVisits).toBeGreaterThanOrEqual(1)
    // Stock that cost more than the dearest unit is more than one unit.
    const dearest = Math.max(
      ...Object.values(products).map(({ unitCostCents }) => unitCostCents),
    )
    expect(facts.spoilage.aboveCents).toBeGreaterThanOrEqual(dearest)
  })
})

describe('loadReportText', () => {
  it('rejects a number the fact does not have', () => {
    const raw = shipped()
    raw.facts.unpaidRent![0] = 'Le loyer du {day} manque : {amount}.'
    expect(() => loadReportText(raw)).toThrow(/\{amount\}/)
  })

  it('rejects a fact that leaves out one of its numbers', () => {
    const raw = shipped()
    raw.facts.bestWeek![0] = 'Record battu : {sales} de ventes.'
    expect(() => loadReportText(raw)).toThrow(/\{previousBest\}/)
  })

  it.each(['Le loyer du {day n’est pas payé.', 'Le loyer du {day}} manque.'])(
    'rejects a stray brace: %s',
    (fact) => {
      const raw = shipped()
      raw.facts.unpaidRent![0] = fact
      expect(() => loadReportText(raw)).toThrow(/brace/)
    },
  )

  it('rejects a headline naming a number of another fact', () => {
    const raw = shipped()
    raw.headlines.lostToLine![0] = 'La file fait fuir {units} clients.'
    expect(() => loadReportText(raw)).toThrow(/\{units\}/)
  })

  it('rejects a number in a quiet headline', () => {
    const raw = shipped()
    raw.quietHeadlines[0] = 'Une semaine à {sales}.'
    expect(() => loadReportText(raw)).toThrow(/\{sales\}/)
  })

  it(`rejects a fact with fewer than ${MIN_VARIANTS} variants`, () => {
    const raw = shipped()
    raw.facts.spoilage = raw.facts.spoilage!.slice(0, MIN_VARIANTS - 1)
    expect(() => loadReportText(raw)).toThrow()
  })

  it('rejects a missing fact, and an unknown one', () => {
    const missing = shipped()
    delete missing.headlines.daysOpenInARow
    expect(() => loadReportText(missing)).toThrow(/daysOpenInARow/)

    const unknown = shipped()
    unknown.facts.rainyWeek = ['Il a plu.', 'Il a encore plu.']
    expect(() => loadReportText(unknown)).toThrow()
  })

  it('rejects a line that appears twice', () => {
    const raw = shipped()
    raw.headlines.bestWeek![1] = raw.headlines.spoilage![0]!
    expect(() => loadReportText(raw)).toThrow(/twice/)
  })

  it('rejects a credit note without its due day, and a line too long', () => {
    const note = shipped()
    note.creditSaleNote = '{amount} de {client}'
    expect(() => loadReportText(note)).toThrow(/\{dueDay\}/)

    const long = shipped()
    long.headlines.unpaidRent![0] = `Loyer${' impayé'.repeat(30)}.`
    expect(() => loadReportText(long)).toThrow()
  })
})
