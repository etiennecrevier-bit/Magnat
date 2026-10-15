import { describe, expect, it } from 'vitest'
import type { EventRecord } from '../engine/types.ts'
import { recentEvents } from './eventLog.ts'

function record(
  day: number,
  choice: string,
  outcome = 0,
  event = 'essai',
): EventRecord {
  return { day, event, followUp: false, choice, outcome }
}

describe('recentEvents', () => {
  it('lists the events of this month and the 11 before, newest first', () => {
    // Day 400 is June 5 of year 2: the window opens on July 1 of year 1,
    // day 61; day 31 is June 1 of year 1.
    const history = [
      record(31, 'toutEssayer'),
      record(61, 'rienFaire'),
      record(400, 'relancer', 1),
    ]
    expect(recentEvents(history, 400)).toEqual([
      {
        day: 400,
        title: "La carte d'essai",
        choice: 'Relancer le client',
        result: 'Le client demande un mois de plus, puis disparaît.',
      },
      {
        day: 61,
        title: "La carte d'essai",
        choice: 'Ne rien faire',
        result: 'Rien ne se passe. Thérèse est rassurée.',
      },
    ])
  })

  it('leaves out what the content no longer holds', () => {
    expect(
      recentEvents(
        [
          record(1, 'toutEssayer', 0, 'disparu'),
          record(2, 'disparu'),
          record(3, 'toutEssayer', 1),
          record(4, 'relancer', 0),
        ],
        10,
      ).map(({ day }) => day),
    ).toEqual([4])
  })

  it('lists nothing before any event', () => {
    expect(recentEvents([], 100)).toEqual([])
  })
})
