import { describe, expect, it } from 'vitest'
import { EVENTS } from '../engine/day.ts'
import { HEADLINES, HEADLINES_FILE, readHeadlines } from './headlines.ts'

describe('readHeadlines', () => {
  it('reads the headlines of the events by id, and the general ones in order', () => {
    expect(
      readHeadlines({
        _note: 'Pour les tests.',
        events: { critique: 'La critique a aimé.' },
        general: ['B', 'A'],
      }),
    ).toEqual({
      events: new Map([['critique', 'La critique a aimé.']]),
      general: ['B', 'A'],
    })
  })

  it.each([
    ['no general headline', { events: {}, general: [] }],
    ['a blank headline', { events: {}, general: [''] }],
    ['a space at an end', { events: { a: 'Titre ' }, general: ['A'] }],
    ['an unknown field', { events: {}, general: ['A'], generale: [] }],
    ['no events', { general: ['A'] }],
  ])('rejects a file with %s', (_, raw) => {
    expect(() => readHeadlines(raw)).toThrow(/headlines\.fr\.json is invalid/)
  })
})

// The shipped file, or the hidden ticker without one.
describe.skipIf(HEADLINES_FILE === undefined)('the shipped headlines', () => {
  it('give a text to every headline an event queues', () => {
    const ids = EVENTS.events.flatMap(({ choices }) =>
      choices.flatMap(({ outcomes }) =>
        outcomes.flatMap(({ effects }) =>
          effects.flatMap((effect) =>
            effect.kind === 'headline' ? [effect.id] : [],
          ),
        ),
      ),
    )
    for (const id of ids) expect(HEADLINES?.events.get(id)).toBeTypeOf('string')
  })
})

describe.skipIf(HEADLINES_FILE !== undefined)('without a headline file', () => {
  it('has no headlines', () => {
    expect(HEADLINES).toBeNull()
  })
})
