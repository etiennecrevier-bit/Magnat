import { z } from 'zod'
import avatarFatigueJson from './avatarFatigue.json'

// How the owner's fatigue shows on the street: only what the world draws,
// never the game. Every object is strict, so a mistyped key fails loudly.

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'expected a colour such as #2B2622')

const ms = z.number().positive()

export const avatarFatigueSchema = z.strictObject({
  _note: z.string().optional(),
  /** How many times longer the arm's reach takes; 1 is the rested reach. */
  reachMultiplier: z.strictObject({
    tired: z.number().min(1),
    exhausted: z.number().min(1),
  }),
  /** A yawn: how long it lasts, and the wait after one before the next. */
  yawn: z
    .strictObject({
      everyMs: ms,
      jitterMs: z.number().nonnegative(),
      lengthMs: ms,
    })
    .refine(({ everyMs, jitterMs }) => jitterMs < everyMs, {
      message: 'jitterMs must stay below everyMs, so a wait is never 0',
      path: ['jitterMs'],
    }),
  /** How far the exhausted avatar slumps, in logical pixels and radians. */
  slump: z.strictObject({
    bodyDrop: z.number().nonnegative(),
    headDrop: z.number().nonnegative(),
    tiltRadians: z
      .number()
      .min(0)
      .max(Math.PI / 4),
  }),
  /** The dark circles under an exhausted avatar's eyes. */
  circlesColor: hexColor,
  /** The spill a botched unit leaves on the counter. */
  spill: z.strictObject({
    /** The puddle's centre, in logical pixels of the design. */
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    color: hexColor,
    /** How long it shows in full, before it fades. */
    showMs: z.number().nonnegative(),
    /** How long it takes to fade out. */
    fadeMs: ms,
  }),
})

export type AvatarFatigue = z.output<typeof avatarFatigueSchema>

/**
 * Validates how fatigue shows on the street and returns it typed. Throws an
 * Error naming every invalid field. Pass `raw` only to check other data; by
 * default it reads `avatarFatigue.json`.
 */
export function loadAvatarFatigue(
  raw: unknown = avatarFatigueJson,
): AvatarFatigue {
  const result = avatarFatigueSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `avatarFatigue.json is invalid:\n${z.prettifyError(result.error)}`,
    )
  }
  return result.data
}
