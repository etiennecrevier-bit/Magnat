import { describe, expect, it } from 'vitest'
import type { StreetChange } from '../content/schema.ts'
import { NO_CHANGES } from './customers.ts'
import { MODIFIER_KINDS, inEffect, streetOn } from './street.ts'
import type { StreetModifier } from './types.ts'

// The changes to the street in effect on a day, folded together.

function modifier(
  change: StreetChange,
  fromDay = 10,
  lastDay = 14,
  event = 'chantier',
): StreetModifier {
  return { event, change, fromDay, lastDay }
}

const CLOSED = streetOn([modifier({ kind: 'closed' })], 10)

describe('MODIFIER_KINDS', () => {
  it('lists every kind of change, in the order the content lists them', () => {
    expect(MODIFIER_KINDS).toEqual([
      'walkIns',
      'appeal',
      'willingness',
      'unavailable',
      'closed',
    ])
  })
})

describe('inEffect', () => {
  const list = [
    modifier({ kind: 'closed' }, 10, 10),
    modifier({ kind: 'walkIns', factor: 0.65 }, 10, 24),
    modifier({ kind: 'unavailable', product: 'cafe' }, 12, 13),
  ]

  it('holds those in effect from their first day to their last, both included', () => {
    expect(inEffect(list, 9)).toEqual([])
    expect(inEffect(list, 10)).toEqual([list[0], list[1]])
    expect(inEffect(list, 11)).toEqual([list[1]])
    expect(inEffect(list, 12)).toEqual([list[1], list[2]])
    expect(inEffect(list, 13)).toEqual([list[1], list[2]])
    expect(inEffect(list, 24)).toEqual([list[1]])
    expect(inEffect(list, 25)).toEqual([])
  })
})

describe('streetOn', () => {
  it('changes nothing with no modifier', () => {
    expect(streetOn([], 10)).toEqual({
      ...NO_CHANGES,
      unavailable: { cafe: false, chocolat: false, croissant: false },
      closed: false,
      working: false,
    })
  })

  it('multiplies the walk-ins of every segment, or of one', () => {
    const everyone = streetOn([modifier({ kind: 'walkIns', factor: 0.65 })], 10)
    expect(everyone.walkIns).toEqual({
      aubaine: 0.65,
      habitue: 0.65,
      chic: 0.65,
    })
    const chic = streetOn(
      [modifier({ kind: 'walkIns', factor: 1.8, segment: 'chic' })],
      10,
    )
    expect(chic.walkIns).toEqual({ aubaine: 1, habitue: 1, chic: 1.8 })
    expect(chic.willingness).toEqual(NO_CHANGES.willingness)
  })

  it('multiplies several modifiers together', () => {
    const street = streetOn(
      [
        modifier({ kind: 'walkIns', factor: 0.5 }),
        modifier({ kind: 'walkIns', factor: 2, segment: 'habitue' }),
        modifier({ kind: 'walkIns', factor: 0.8, segment: 'habitue' }),
        modifier({ kind: 'appeal', product: 'chocolat', factor: 0.3 }),
        modifier({ kind: 'appeal', product: 'chocolat', factor: 0.5 }),
        modifier({ kind: 'willingness', factor: 1.1 }),
        modifier({ kind: 'willingness', factor: 1.5, segment: 'aubaine' }),
      ],
      10,
    )
    expect(street.walkIns).toEqual({ aubaine: 0.5, habitue: 0.8, chic: 0.5 })
    expect(street.appeal).toEqual({ cafe: 1, chocolat: 0.15, croissant: 1 })
    expect(street.willingness.aubaine).toBeCloseTo(1.65, 12)
    expect(street.willingness.habitue).toBe(1.1)
    expect(street.willingness.chic).toBe(1.1)
  })

  it('folds only the modifiers in effect that day', () => {
    const list = [
      modifier({ kind: 'walkIns', factor: 0.65 }, 10, 24),
      modifier({ kind: 'walkIns', factor: 1.8 }, 15, 15),
    ]
    expect(streetOn(list, 14).walkIns.chic).toBe(0.65)
    expect(streetOn(list, 15).walkIns.chic).toBeCloseTo(1.17, 12)
    expect(streetOn(list, 16).walkIns.chic).toBe(0.65)
    expect(streetOn(list, 25)).toEqual(streetOn([], 25))
  })

  it('makes a product unavailable, the others still on sale', () => {
    const street = streetOn(
      [modifier({ kind: 'unavailable', product: 'cafe' })],
      10,
    )
    expect(street.unavailable).toEqual({
      cafe: true,
      chocolat: false,
      croissant: false,
    })
    expect(street.closed).toBe(false)
  })

  it('closes the truck', () => {
    expect(CLOSED.closed).toBe(true)
    expect(CLOSED.walkIns).toEqual(NO_CHANGES.walkIns)
    expect(streetOn([modifier({ kind: 'closed' })], 15).closed).toBe(false)
  })

  it('has the owner work while a closure for work is in effect', () => {
    expect(CLOSED.working).toBe(false)
    const work = modifier({ kind: 'closed', work: true }, 10, 10)
    expect(streetOn([work], 10)).toMatchObject({ closed: true, working: true })
    expect(streetOn([work], 11)).toMatchObject({
      closed: false,
      working: false,
    })
    // A day off and a day of work on the same day: the owner works.
    const both = [modifier({ kind: 'closed' }), work]
    expect(streetOn(both, 10).working).toBe(true)
    expect(streetOn(both, 11)).toMatchObject({ closed: true, working: false })
  })

  it('never mutates the modifiers', () => {
    const list = Object.freeze([
      Object.freeze(modifier({ kind: 'walkIns', factor: 0.5 })),
    ])
    expect(() => streetOn(list, 10)).not.toThrow()
    expect(list[0]?.change).toEqual({ kind: 'walkIns', factor: 0.5 })
  })
})
