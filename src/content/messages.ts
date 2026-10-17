import { z } from 'zod'
import messagesJson from './messages.fr.json'

// Rules the messages are held to, not tunables: each kind needs enough lines
// that a player rarely reads the same one twice in a row, and a line has to
// fit the small card a message shows in.
export const MIN_LINES_PER_KIND = 5
export const MAX_MESSAGE_LENGTH = 140

/**
 * Who writes: `landlord` when the owner's rent goes unpaid, `exhausted` when
 * the owner wakes up exhausted; then those the game names: a grocer when a
 * delivery is missed (`missedDelivery`), when their contract runs out
 * (`contractEnded`) or when the last missed delivery they allow ends it
 * (`contractBroken`), and an employee when they start (`hired`) or are let
 * go (`fired`).
 */
export const messageKindSchema = z.enum([
  'landlord',
  'exhausted',
  'missedDelivery',
  'contractEnded',
  'contractBroken',
  'hired',
  'fired',
])

export type MessageKind = z.infer<typeof messageKindSchema>

const lineSchema = z
  .string()
  .min(1)
  .max(MAX_MESSAGE_LENGTH)
  .refine((line) => line === line.trim(), {
    message: 'a line starts and ends with text, not spaces',
  })

const linesSchema = z.array(lineSchema).min(MIN_LINES_PER_KIND)

/** A kind with one sender, whom the content names. */
const senderSchema = z.strictObject({
  /** Who the message is from, as the card shows it. */
  from: z.string().min(1),
  lines: linesSchema,
})

/** A kind whose sender the game names: a grocer or an employee. */
const namedByGameSchema = z.strictObject({ lines: linesSchema })

export const messagesSchema = z
  .strictObject({
    _note: z.string().optional(),
    landlord: senderSchema,
    exhausted: senderSchema,
    missedDelivery: namedByGameSchema,
    contractEnded: namedByGameSchema,
    contractBroken: namedByGameSchema,
    hired: namedByGameSchema,
    fired: namedByGameSchema,
  })
  .superRefine((messages, ctx) => {
    const seen = new Set<string>()
    for (const kind of messageKindSchema.options) {
      messages[kind].lines.forEach((line, i) => {
        if (seen.has(line)) {
          ctx.addIssue({
            code: 'custom',
            message: 'the same line appears twice',
            path: [kind, 'lines', i],
          })
        }
        seen.add(line)
      })
    }
  })

/** What each kind of message says, and who it is from. */
export type Messages = z.output<typeof messagesSchema>

/** Validates the messages; throws a ZodError naming any problem. */
export function loadMessages(raw: unknown = messagesJson): Messages {
  return messagesSchema.parse(raw)
}
