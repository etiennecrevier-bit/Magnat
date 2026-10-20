import { describe, expect, it } from 'vitest'
import type { EventContent } from '../content/schema.ts'
import { EVENTS } from '../engine/day.ts'
import type { EventRecord } from '../engine/types.ts'
import { recentEvents } from './eventLog.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = '\u00a0'

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
    expect(recentEvents(history, 400, 'moyen', EVENTS)).toEqual([
      {
        key: '400-essai',
        day: 400,
        title: "La carte d'essai",
        choice: 'Relancer le client',
        result: 'Le client demande un mois de plus, puis disparaît.',
      },
      {
        key: '61-essai',
        day: 61,
        title: "La carte d'essai",
        choice: 'Ne rien faire',
        result: 'Rien ne se passe. Thérèse est rassurée.',
      },
    ])
  })

  it('keys each event by its day and event, the same once a newer comes', () => {
    const history = [
      record(3, 'rienFaire'),
      record(4, 'payer', 0, 'influenceuse'),
    ]
    const before = recentEvents(history.slice(0, 1), 10, 'moyen', EVENTS)
    const after = recentEvents(history, 10, 'moyen', EVENTS)
    expect(before.map(({ key }) => key)).toEqual(['3-essai'])
    expect(after.map(({ key }) => key)).toEqual(['4-influenceuse', '3-essai'])
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
        'moyen',
        EVENTS,
      ).map(({ day }) => day),
    ).toEqual([4])
  })

  it('lists nothing before any event', () => {
    expect(recentEvents([], 100, 'moyen', EVENTS)).toEqual([])
  })

  it('writes the amounts as the game played them, as the card showed them', () => {
    const scaling: Pick<EventContent, 'scaling'> = {
      scaling: {
        lowestFactor: 0.1,
        difficulties: {
          facile: { gains: 1, losses: 0.7 },
          moyen: { gains: 1.3, losses: 1.3 },
          difficile: { gains: 0.7, losses: 1.2 },
        },
      },
    }
    const history = [
      record(5, 'payer', 0, 'influenceuse'),
      record(6, 'aiderNormand', 0, 'premierJuillet'),
    ]
    expect(
      recentEvents(history, 10, 'moyen', scaling).map(({ choice, result }) => [
        choice,
        result.split('. ').at(-1),
      ]),
    ).toEqual([
      ['Aider Normand', `Normand vous glisse 78${S}$ et une bière tiède.`],
      [`Payer 520${S}$`, expect.any(String)],
    ])
    expect(recentEvents(history, 10, 'difficile', {})[1]?.choice).toBe(
      `Payer 400${S}$`,
    )
  })
})
