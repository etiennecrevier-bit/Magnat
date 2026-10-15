import { z } from 'zod'
import linesJson from './lines.fr.json'
import { segmentIdSchema } from './schema.ts'

// Rules the lines are held to, not tunables: each way a visit ends needs
// enough lines per segment that clicking around rarely repeats one, and a
// line has to fit the small card beside a customer.
export const MIN_LINES_PER_OUTCOME = 8
export const MAX_LINE_LENGTH = 120

/**
 * How a visit ended, as far as a customer's line goes: the engine's visit
 * outcomes, and `leftLine` for the customer who gave up waiting in line.
 */
export const lineOutcomeSchema = z.enum([
  'bought',
  'tooExpensive',
  'soldOut',
  'leftLine',
  'browsed',
])

export type LineOutcome = z.infer<typeof lineOutcomeSchema>

const lineSchema = z
  .string()
  .min(1)
  .max(MAX_LINE_LENGTH)
  .refine((line) => line === line.trim(), {
    message: 'a line starts and ends with text, not spaces',
  })

// A record keyed by an enum needs every key and rejects any other.
const segmentLinesSchema = z
  .strictObject({
    /** The segment's name for one customer, as the card shows it. */
    name: z.string().min(1),
    lines: z.record(
      lineOutcomeSchema,
      z.array(lineSchema).min(MIN_LINES_PER_OUTCOME),
    ),
  })
  .superRefine(({ lines }, ctx) => {
    const seen = new Set<string>()
    for (const outcome of lineOutcomeSchema.options) {
      lines[outcome].forEach((line, i) => {
        if (seen.has(line)) {
          ctx.addIssue({
            code: 'custom',
            message: 'the same line appears twice in this segment',
            path: ['lines', outcome, i],
          })
        }
        seen.add(line)
      })
    }
  })

export const customerLinesSchema = z.strictObject({
  _note: z.string().optional(),
  segments: z.record(segmentIdSchema, segmentLinesSchema),
})

/** What each segment's customers say, by how their visit ended. */
export type CustomerLines = z.output<typeof customerLinesSchema>

/** Validates the customers' lines; throws a ZodError naming any problem. */
export function loadCustomerLines(raw: unknown = linesJson): CustomerLines {
  return customerLinesSchema.parse(raw)
}
