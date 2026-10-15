import { z } from 'zod'
import reportTextJson from './report.fr.json'
import { weekFactIdSchema, type WeekFactId } from './schema.ts'

// Rules the report's text is held to, not tunables: each fact needs enough
// variants that the weeks do not keep repeating one, and a line has to fit
// where it shows: a fact on the slide-in card, a headline in the ticker's
// band.
export const MIN_VARIANTS = 2
export const MAX_FACT_LENGTH = 160
export const MAX_HEADLINE_LENGTH = 120

/**
 * The numbers each fact's text may name, as `{name}`: those the engine
 * gives the fact (`WeekFactNumbers` in src/engine/week.ts).
 */
export const REPORT_PLACEHOLDERS = {
  profitUpCashDown: ['netIncome', 'cashChange'],
  unpaidRent: ['day'],
  receivableDue: ['client', 'amount', 'dueDay'],
  spoilage: ['cost', 'units'],
  bestWeek: ['sales', 'previousBest'],
  lostToLine: ['visits'],
  daysOpenInARow: ['days'],
} as const satisfies Record<WeekFactId, readonly string[]>

/** What the chart's note on a sale on credit names. */
export const CREDIT_NOTE_PLACEHOLDERS = ['amount', 'client', 'dueDay'] as const

/** A `{name}` in a line, and the name. */
export const PLACEHOLDER = /\{([^{}]*)\}/g

const line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => text === text.trim(), {
      message: 'a line starts and ends with text, not spaces',
    })

const factLine = line(MAX_FACT_LENGTH)
const headline = line(MAX_HEADLINE_LENGTH)

// A record keyed by an enum needs every key and rejects any other.
export const reportTextSchema = z
  .strictObject({
    _note: z.string().optional(),
    facts: z.record(weekFactIdSchema, z.array(factLine).min(MIN_VARIANTS)),
    headlines: z.record(weekFactIdSchema, z.array(headline).min(MIN_VARIANTS)),
    quietHeadlines: z.array(headline).min(MIN_VARIANTS),
    creditSaleNote: factLine,
  })
  .superRefine((text, ctx) => {
    const seen = new Set<string>()
    /**
     * Checks that `text` names only `names`, every one of them when
     * `every`, has no stray brace and was not seen before.
     */
    const check = (
      text: string,
      path: (string | number)[],
      names: readonly string[],
      every: boolean,
    ) => {
      const issue = (message: string) =>
        ctx.addIssue({ code: 'custom', message, path })
      const used = new Set<string>()
      for (const [, name = ''] of text.matchAll(PLACEHOLDER)) {
        if (!names.includes(name)) {
          issue(`{${name}} is not one of this line's numbers`)
        }
        used.add(name)
      }
      if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) {
        issue('a brace that is not part of a {name}')
      }
      if (every) {
        for (const name of names) {
          if (!used.has(name)) issue(`the line never names {${name}}`)
        }
      }
      if (seen.has(text)) issue('the same line appears twice')
      seen.add(text)
    }
    for (const id of weekFactIdSchema.options) {
      const names = REPORT_PLACEHOLDERS[id]
      text.facts[id].forEach((fact, i) =>
        check(fact, ['facts', id, i], names, true),
      )
      text.headlines[id].forEach((title, i) =>
        check(title, ['headlines', id, i], names, false),
      )
    }
    text.quietHeadlines.forEach((title, i) =>
      check(title, ['quietHeadlines', i], [], false),
    )
    check(
      text.creditSaleNote,
      ['creditSaleNote'],
      CREDIT_NOTE_PLACEHOLDERS,
      true,
    )
  })

/**
 * What the « Bilan de la semaine » says: each fact's variants, the
 * La Presse-Citron headlines and the chart's note on a sale on credit.
 */
export type ReportText = z.output<typeof reportTextSchema>

/** Validates the report's text; throws a ZodError naming any problem. */
export function loadReportText(raw: unknown = reportTextJson): ReportText {
  return reportTextSchema.parse(raw)
}
