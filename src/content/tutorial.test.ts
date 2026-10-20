import { describe, expect, it } from 'vitest'
import { loadEventContent, loadTutorialContent } from './schema.ts'
import tutorialJson from './tutorial.json'

type Json = Record<string, unknown>

/** A copy of the shipped file to break, as plain JSON. */
function shipped(): Json {
  return JSON.parse(JSON.stringify(tutorialJson)) as Json
}

function rejects(raw: unknown, ...reasons: string[]): void {
  let message = ''
  try {
    loadTutorialContent(raw)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message, 'the file loaded').toMatch(/^tutorial\.json is invalid:/)
  for (const reason of reasons) expect(message).toContain(reason)
}

describe('tutorial.json', () => {
  const content = loadTutorialContent()

  it('plays seven days on a seed of its own', () => {
    expect(content.days).toBe(7)
    expect(Number.isInteger(content.seed)).toBe(true)
  })

  it('starts with a low croissant rule, a café above the habitués’ price, and every day open', () => {
    expect(content.decisions).toEqual({
      pricesCents: { cafe: 375 },
      restock: { croissant: { kind: 'buyDaily', quantity: 40 } },
      daysOpen: [1, 2, 3, 4, 5, 6, 7],
    })
  })

  it('brings Coralie’s story on day 4', () => {
    expect(content.scriptedEvents).toEqual([{ day: 4, event: 'tutoStory' }])
  })

  it('holds the fourteen steps of issue #236, in order, each with its gesture', () => {
    expect(
      content.steps.map(({ id, day, gesture }) => [day, id, gesture]),
    ).toEqual([
      [1, 'bienvenue', 'next'],
      [1, 'ouvrirCamion', 'openTruck'],
      [1, 'changerPrix', 'priceChange'],
      [1, 'lancerJour', 'speed1'],
      [2, 'lireHier', 'readYesterday'],
      [2, 'commander', 'restockRaise'],
      [3, 'tropCher', 'tooltip'],
      [3, 'ajuster', 'priceOrOk'],
      [4, 'evenement', 'choice'],
      [5, 'accelerer', 'speed3'],
      [5, 'pause', 'pause'],
      [6, 'encaisse', 'next'],
      [6, 'finances', 'finances'],
      [7, 'aurevoir', 'next'],
    ])
  })
})

describe('tutorial.json, what Réal says', () => {
  const content = loadTutorialContent()

  it('has a text for every step, a button only where the step waits for one', () => {
    for (const { gesture, text, button } of content.steps) {
      expect(text.length).toBeGreaterThan(0)
      expect(button !== undefined).toBe(
        gesture === 'next' || gesture === 'priceOrOk',
      )
    }
  })

  it('keeps Réal to sentences of 15 words at most', () => {
    const lines = content.steps.flatMap(({ text, fallback }) =>
      fallback === undefined ? [text] : [text, fallback.text],
    )
    for (const line of lines) {
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(15)
      }
    }
  })

  it('falls back on day 2 without a shortage and on day 3 without a complaint', () => {
    expect(
      content.steps.flatMap(({ id, day, fallback }) =>
        fallback === undefined ? [] : [[day, id, fallback.fact]],
      ),
    ).toEqual([
      [2, 'lireHier', 'croissantShortage'],
      [3, 'tropCher', 'cafeTooExpensive'],
    ])
  })

  it('centres the first and the last bubble, and points every other at something', () => {
    for (const { id, anchors } of content.steps) {
      expect(anchors.length === 0, id).toBe(
        id === 'bienvenue' || id === 'aurevoir',
      )
    }
  })
})

describe('loadTutorialContent rejects', () => {
  it('a button where the step waits for none, none where it waits for one, and tipAnchors likewise', () => {
    const raw = shipped()
    const steps = raw.steps as Json[]
    delete steps[0]!.button
    steps[1]!.button = 'Allez'
    delete steps[4]!.tipAnchors
    steps[5]!.tipAnchors = ['menu.cafe']
    rejects(
      raw,
      'a next step has a button',
      'a openTruck step has no button',
      'a readYesterday step has tipAnchors',
      'a restockRaise step has no tipAnchors',
    )
  })

  it('an anchor that is no data-tuto, a fallback on a fact the engine does not tell, or no coach', () => {
    const raw = shipped()
    const steps = raw.steps as Json[]
    steps[1]!.anchors = ['Dock camion']
    steps[4]!.fallback = { fact: 'rain', text: 'Il pleut.', button: 'Ok' }
    delete raw.coach
    rejects(raw, 'a data-tuto anchor', 'steps[4].fallback.fact', 'coach')
  })

  it('a step id used twice, steps out of the order of their days, and one after the last day', () => {
    const raw = shipped()
    const step = { text: 'Salut.', button: 'Ok', anchors: [] }
    raw.steps = [
      { id: 'a', day: 2, gesture: 'next', ...step },
      { id: 'a', day: 1, gesture: 'next', ...step },
      { id: 'b', day: 8, gesture: 'next', ...step },
    ]
    rejects(
      raw,
      'the step id a appears twice',
      'the steps go in the order of their days',
      "the step falls after the tutorial's 7 days",
      'day 3 has no step',
    )
  })

  it('a gesture the UI does not know, or a key the file does not have', () => {
    const raw = shipped()
    raw.steps = [{ id: 'a', day: 1, gesture: 'dance' }]
    raw.extra = true
    rejects(raw, '→ at steps[0].gesture', 'extra')
  })

  it('no step', () => {
    rejects({ ...shipped(), steps: [] }, '→ at steps')
  })

  it('a card of no event, one a draw may bring, on day 1, after the last day, or two on a day', () => {
    const raw = shipped()
    raw.scriptedEvents = [
      { day: 1, event: 'inconnu' },
      { day: 2, event: 'influenceuse' },
      { day: 2, event: 'tutoStory' },
      { day: 9, event: 'tutoStory' },
    ]
    rejects(
      raw,
      'no event has the id inconnu',
      'the event influenceuse is not tutorialOnly',
      'a card comes on day 2 at the earliest',
      'one event a day at most',
      "the event falls after the tutorial's 7 days",
    )
  })

  it('a card the event file it is checked against does not hold', () => {
    const events = loadEventContent()
    expect(() =>
      loadTutorialContent(shipped(), {
        ...events,
        events: events.events.filter(({ id }) => id !== 'tutoStory'),
      }),
    ).toThrow('no event has the id tutoStory')
  })

  it('a restock rule or a price the decisions cannot hold', () => {
    const raw = shipped()
    raw.decisions = {
      pricesCents: { the: 100 },
      restock: { cafe: { kind: 'sometimes' } },
      daysOpen: [],
    }
    rejects(raw, 'decisions.pricesCents', 'decisions.restock', 'daysOpen')
  })
})
