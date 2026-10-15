import { describe, expect, it } from 'vitest'
import headlinesJson from './headlines.fr.json'
import { loadEventContent } from './schema.ts'

// The La Presse-Citron headlines: the ticker reads and validates the file
// (src/ui/headlines.ts); here, what the writers owe the event cards.

/** The general headlines the ticker cycles through, as issue #93 asks. */
const GENERAL_HEADLINES = 20
/** A headline is one line of a newspaper, not a paragraph. */
const MAX_LENGTH = 120

/** Every headline id a card of `events.json` queues, in the file's order. */
function queued(): string[] {
  return loadEventContent().events.flatMap(({ choices }) =>
    choices.flatMap(({ outcomes }) =>
      outcomes.flatMap(({ effects }) =>
        effects.flatMap((effect) =>
          effect.kind === 'headline' ? [effect.id] : [],
        ),
      ),
    ),
  )
}

describe('headlines.fr.json', () => {
  const { events, general } = headlinesJson

  it('holds 20 different general headlines', () => {
    expect(general).toHaveLength(GENERAL_HEADLINES)
    expect(new Set(general).size).toBe(general.length)
  })

  it('opens with the 14th form, as issue #93 writes it', () => {
    expect(general[0]).toBe(
      'La Ville exige un 14e formulaire pour vendre des croissants sur roues.',
    )
  })

  it('keeps every headline to one short line', () => {
    for (const text of [...general, ...Object.values(events)]) {
      expect(text.length, text).toBeLessThanOrEqual(MAX_LENGTH)
      expect(text, text).not.toMatch(/\n/)
    }
  })

  it('gives a text to every headline a card queues, and to no other', () => {
    expect(Object.keys(events).sort()).toEqual([...new Set(queued())].sort())
  })
})
