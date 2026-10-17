import { z } from 'zod'
import bankruptcyJson from './bankruptcy.fr.json'

// Rules the « Faillite » screen's text is held to, not tunables: enough of
// Mme Prudhomme's lines that two games rarely end on the same one, each
// short enough for the screen.
export const MIN_PRUDHOMME_LINES = 3
export const MAX_PRUDHOMME_LENGTH = 160

const lineSchema = z
  .string()
  .min(1)
  .max(MAX_PRUDHOMME_LENGTH)
  .refine((line) => line === line.trim(), {
    message: 'a line starts and ends with text, not spaces',
  })

export const bankruptcyTextSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** What Mme Prudhomme says once the game ends in bankruptcy. */
    prudhomme: z.array(lineSchema).min(MIN_PRUDHOMME_LINES),
  })
  .superRefine(({ prudhomme }, ctx) => {
    prudhomme.forEach((line, i) => {
      if (prudhomme.indexOf(line) === i) return
      ctx.addIssue({
        code: 'custom',
        message: 'the same line appears twice',
        path: ['prudhomme', i],
      })
    })
  })

/** The French of the « Faillite » screen. */
export type BankruptcyText = z.output<typeof bankruptcyTextSchema>

/**
 * Validates the « Faillite » screen's text; throws a ZodError naming any
 * problem. Pass `raw` only to check other data; by default it reads
 * `bankruptcy.fr.json`.
 */
export function loadBankruptcyText(
  raw: unknown = bankruptcyJson,
): BankruptcyText {
  return bankruptcyTextSchema.parse(raw)
}
