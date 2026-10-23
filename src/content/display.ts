import { z } from 'zod'
import displayJson from './display.json'

// How often and how finely the world draws (#281): only what the browser
// spends drawing, never the game.

export const displaySchema = z
  .strictObject({
    _note: z.string().optional(),
    /** The frames per second « Fluidité » offers, slowest first. */
    frameRates: z.array(z.int().positive().max(240)).min(1),
    /** The frame rate a player starts with: one of `frameRates`. */
    defaultFrameRate: z.int().positive(),
    /** The most pixels per logical pixel the canvas takes. */
    maxResolution: z.number().min(1),
    /** The same with « Effets visuels : Simples ». */
    simpleResolution: z.number().min(1),
  })
  .refine(
    ({ frameRates }) =>
      frameRates.every((rate, i) => i === 0 || rate > (frameRates[i - 1] ?? 0)),
    { message: 'frameRates must go up', path: ['frameRates'] },
  )
  .refine(
    ({ frameRates, defaultFrameRate }) => frameRates.includes(defaultFrameRate),
    {
      message: 'defaultFrameRate must be one of frameRates',
      path: ['defaultFrameRate'],
    },
  )
  .refine(
    ({ maxResolution, simpleResolution }) => simpleResolution <= maxResolution,
    {
      message: 'simpleResolution must not be above maxResolution',
      path: ['simpleResolution'],
    },
  )

export type Display = z.output<typeof displaySchema>

/**
 * Validates how the world draws and returns it typed. Throws an Error naming
 * every invalid field. Pass `raw` only to check other data; by default it
 * reads `display.json`.
 */
export function loadDisplay(raw: unknown = displayJson): Display {
  const result = displaySchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `display.json is invalid:\n${z.prettifyError(result.error)}`,
    )
  }
  return result.data
}

/** How the world draws, as shipped, validated once. */
export const DISPLAY: Display = loadDisplay()
