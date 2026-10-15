import { z } from 'zod'

// The La Presse-Citron headlines, from src/content/headlines.fr.json, which
// P3-05 (#93) adds with the event cards. Until it does, the glob finds no
// file and the ticker stays hidden. The file holds:
// - `events`: the text of each headline an event's `headline` effect
//   queues, by the headline's id;
// - `general`: the headlines the ticker cycles through, at least one;
// - `_note`, optional, for the writers.
const FILES = import.meta.glob<unknown>('../content/headlines.fr.json', {
  eager: true,
  import: 'default',
})

/** French text the player reads: not blank, with no space at either end. */
const text = z
  .string()
  .min(1)
  .refine((line) => line === line.trim(), {
    message: 'text starts and ends with a character, not a space',
  })

const headlinesSchema = z.strictObject({
  _note: z.string().optional(),
  events: z.record(z.string(), text),
  general: z.array(text).min(1),
})

/** The headlines the ticker shows. */
export interface Headlines {
  /** The text of each headline an event queues, by its id. */
  readonly events: ReadonlyMap<string, string>
  /** The headlines it cycles through when no event's is waiting. */
  readonly general: readonly string[]
}

/** The headline file as found, before it is read; undefined without one. */
export const HEADLINES_FILE: unknown = Object.values(FILES)[0]

/**
 * Reads a headline file (see above). Throws an Error naming every invalid
 * field.
 */
export function readHeadlines(raw: unknown): Headlines {
  const parsed = headlinesSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `headlines.fr.json is invalid:\n${z.prettifyError(parsed.error)}`,
    )
  }
  const { events, general } = parsed.data
  return { events: new Map(Object.entries(events)), general }
}

/** The shipped headlines; null until there is a file. */
export const HEADLINES: Headlines | null =
  HEADLINES_FILE === undefined ? null : readHeadlines(HEADLINES_FILE)
