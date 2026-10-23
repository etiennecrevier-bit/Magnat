import { z } from 'zod'
import messagesJson from './messages.fr.json'
import { candidateIdSchema } from './schema.ts'

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

/**
 * The messages written for one employee, one line per candidate: their
 * own words, `underpaid`, the warning, and `quit` (#255), and the owner's
 * `discovered`, the morning their weakness shows (#256).
 */
export const OWN_WORDS = ['underpaid', 'quit', 'discovered'] as const

export type OwnWordsKind = (typeof OWN_WORDS)[number]

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

/**
 * What each employee says in their own voice (#255), one line each: they
 * are not kinds the game picks a line of at random.
 */
const ownWordsSchema = z.record(candidateIdSchema, lineSchema)

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
    /**
     * An employee paid below their asking wage, a week before they quit
     * unless the player raises it (#255).
     */
    underpaid: ownWordsSchema,
    /** An employee who quits, underpaid, the morning they leave (#255). */
    quit: ownWordsSchema,
    /**
     * What the owner finds out the morning an employee's weakness shows
     * (#256), in the owner's voice.
     */
    discovered: ownWordsSchema,
  })
  .superRefine((messages, ctx) => {
    const seen = new Set<string>()
    const once = (line: string, path: (string | number)[]) => {
      if (seen.has(line)) {
        ctx.addIssue({
          code: 'custom',
          message: 'the same line appears twice',
          path,
        })
      }
      seen.add(line)
    }
    for (const kind of messageKindSchema.options) {
      messages[kind].lines.forEach((line, i) => once(line, [kind, 'lines', i]))
    }
    for (const kind of OWN_WORDS) {
      for (const [candidate, line] of Object.entries(messages[kind])) {
        once(line, [kind, candidate])
      }
    }
  })

/** What each kind of message says, and who it is from. */
export type Messages = z.output<typeof messagesSchema>

/** Validates the messages; throws a ZodError naming any problem. */
export function loadMessages(raw: unknown = messagesJson): Messages {
  return messagesSchema.parse(raw)
}
