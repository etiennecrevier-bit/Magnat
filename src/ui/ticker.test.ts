import { describe, expect, it } from 'vitest'
import type { Headline } from '../engine/types.ts'
import type { Headlines } from './headlines.ts'
import { startTicker, turnTicker, type TickerState } from './ticker.ts'

const HEADLINES: Headlines = {
  events: new Map([
    ['critique', 'La critique a aimé.'],
    ['festival', 'Le festival commence.'],
  ]),
  general: ['A', 'B', 'C'],
}

const first = () => 0

/** The texts of `count` turns after `state`. */
function turns(
  state: TickerState,
  count: number,
  queued: readonly Headline[] = [],
): (string | null)[] {
  const texts: (string | null)[] = []
  let current = state
  for (let i = 0; i < count; i += 1) {
    current = turnTicker(current, queued, HEADLINES)
    texts.push(current.text)
  }
  return texts
}

describe('startTicker', () => {
  it('starts on the general headline picked, then cycles through them all', () => {
    const start = startTicker([], 10, HEADLINES, () => 0.5)
    expect(start.text).toBe('B')
    expect(turns(start, 4)).toEqual(['C', 'A', 'B', 'C'])
  })

  it('picks the last general headline for a value just below 1', () => {
    expect(startTicker([], 10, HEADLINES, () => 0.9999).text).toBe('C')
  })

  it('counts what was queued before today as shown, and shows today’s first', () => {
    const queued = [
      { day: 3, id: 'critique' },
      { day: 10, id: 'festival' },
    ]
    const start = startTicker(queued, 10, HEADLINES, first)
    expect(start.text).toBe('Le festival commence.')
    expect(turns(start, 2, queued)).toEqual(['A', 'B'])
    expect(startTicker(queued, 11, HEADLINES, first).text).toBe('A')
  })
})

describe('turnTicker', () => {
  it('shows the headlines events queue first, oldest first', () => {
    const start = startTicker([], 5, HEADLINES, first)
    const queued = [
      { day: 6, id: 'critique' },
      { day: 6, id: 'festival' },
    ]
    expect(turns(start, 3, queued)).toEqual([
      'La critique a aimé.',
      'Le festival commence.',
      'B',
    ])
  })

  it('skips a queued headline with no text', () => {
    const start = startTicker([], 5, HEADLINES, first)
    expect(
      turns(start, 2, [
        { day: 6, id: 'inconnu' },
        { day: 6, id: 'critique' },
      ]),
    ).toEqual(['La critique a aimé.', 'B'])
    expect(turns(start, 1, [{ day: 6, id: 'inconnu' }])).toEqual(['B'])
  })

  it("starts over with another game's shorter list", () => {
    const state: TickerState = { seen: 5, nextGeneral: 0, text: 'C' }
    const queued = [{ day: 1, id: 'critique' }]
    expect(turns(state, 2, queued)).toEqual(['A', 'B'])
    expect(turns(state, 1, [...queued, { day: 2, id: 'festival' }]).at(0)).toBe(
      'A',
    )
  })
})
