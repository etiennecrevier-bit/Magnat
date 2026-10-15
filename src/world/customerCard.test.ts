import { describe, expect, it } from 'vitest'
import { loadCustomerLines } from '../content/lines.ts'
import type { SegmentId } from '../content/schema.ts'
import type { Visit, VisitOutcome } from '../engine/types.ts'
import { CROWD } from './crowdSettings.ts'
import {
  cardOf,
  customerAt,
  MOOD_COLORS,
  MOOD_WORDS,
  nextOnScreen,
  placeCard,
  quoted,
  saying,
  type Box,
  type Target,
} from './customerCard.ts'
import { ASSETS } from './manifest.ts'

const LINES = loadCustomerLines()
const CARD = CROWD.card

function visit(segment: SegmentId, outcome: VisitOutcome): Visit {
  return {
    arrivalMinute: 450,
    segment,
    outcome,
    bought: { cafe: outcome === 'bought' ? 1 : 0, chocolat: 0, croissant: 0 },
    servedMinute: outcome === 'bought' || outcome === 'soldOut' ? 450 : null,
    leftMinute: outcome === 'leftLine' ? 450 : null,
    botched: 0,
  }
}

describe('cardOf', () => {
  it.each([
    ['aubaine', 'bought', "Chasseur d'aubaines", 'happy'],
    ['habitue', 'tooExpensive', 'Habitué', 'annoyed'],
    ['chic', 'soldOut', 'Clientèle chic', 'sad'],
    ['chic', 'leftLine', 'Clientèle chic', 'annoyed'],
    ['habitue', 'browsed', 'Habitué', 'neutral'],
  ] as const)(
    'gives a %s customer who ended %s their name, mood and a line',
    (segment, outcome, name, mood) => {
      const choices = LINES.segments[segment].lines[outcome]
      expect(cardOf(visit(segment, outcome), LINES, () => 0)).toEqual({
        segment,
        name,
        mood,
        line: choices[0],
      })
      expect(cardOf(visit(segment, outcome), LINES, () => 0.999).line).toBe(
        choices.at(-1),
      )
    },
  )
})

describe('the mood on the card', () => {
  it('reads as a noun that fits any customer', () => {
    expect(MOOD_WORDS).toEqual({
      happy: 'Satisfaction',
      annoyed: 'Agacement',
      sad: 'Déception',
      neutral: 'Indifférence',
    })
  })

  it("takes the bubble face's colours from the palette", () => {
    for (const color of Object.values(MOOD_COLORS)) {
      expect(ASSETS.palette[color]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('saying', () => {
  it('puts the card in one sentence, the line in guillemets', () => {
    const card = cardOf(visit('habitue', 'bought'), LINES, () => 0)
    expect(quoted('Bonjour.')).toBe('«\u00a0Bonjour.\u00a0»')
    expect(saying(card)).toBe(
      `Habitué, satisfaction\u00a0: «\u00a0${card.line}\u00a0»`,
    )
  })
})

/** A customer's box, `width` × `height`, feet centred on `x`, `y`. */
function boxAt(x: number, y: number, width = 40, height = 120): Box {
  return {
    left: x - width / 2,
    top: y - height,
    right: x + width / 2,
    bottom: y,
  }
}

describe('customerAt', () => {
  const targets: Target[] = [
    { id: 0, box: boxAt(100, 500), depth: 500 },
    { id: 1, box: boxAt(120, 534), depth: 534 },
    { id: 2, box: boxAt(130, 500), depth: 500 },
  ]

  it('picks the customer drawn at the point', () => {
    expect(customerAt({ x: 90, y: 400 }, targets, 0)).toBe(0)
  })

  it('picks the one drawn on top where they overlap: nearest, then latest', () => {
    // 0, 1 and 2 all cover x = 115 at y = 450; 1 stands nearer the viewer.
    expect(customerAt({ x: 115, y: 450 }, targets, 0)).toBe(1)
    // Above 1's head, 0 and 2 overlap at the same depth; 2 came later.
    expect(customerAt({ x: 115, y: 400 }, targets, 0)).toBe(2)
  })

  it('takes the box edges and the margin around them', () => {
    expect(customerAt({ x: 80, y: 380 }, targets, 0)).toBe(0)
    expect(customerAt({ x: 75, y: 380 }, targets, 0)).toBeNull()
    expect(customerAt({ x: 75, y: 375 }, targets, 5)).toBe(0)
    expect(customerAt({ x: 74, y: 380 }, targets, 5)).toBeNull()
  })

  it('finds no one on an empty street or beside everyone', () => {
    expect(customerAt({ x: 100, y: 400 }, [], 10)).toBeNull()
    expect(customerAt({ x: 600, y: 400 }, targets, 10)).toBeNull()
  })
})

describe('nextOnScreen', () => {
  const span = { left: 0, right: 1000 }
  const customers = [
    { id: 3, x: -40 },
    { id: 4, x: 200 },
    { id: 6, x: 500 },
    { id: 9, x: 999 },
    { id: 10, x: 1060 },
  ]

  it('starts with the first customer on screen, in the order they came', () => {
    expect(nextOnScreen(customers, null, span)).toBe(4)
  })

  it('moves on to the next one, then back to the first after the last', () => {
    expect(nextOnScreen(customers, 4, span)).toBe(6)
    expect(nextOnScreen(customers, 6, span)).toBe(9)
    expect(nextOnScreen(customers, 9, span)).toBe(4)
  })

  it('skips those off the screen, and starts over from one who walked off', () => {
    expect(nextOnScreen(customers, 3, span)).toBe(4)
    expect(nextOnScreen(customers, 10, span)).toBe(4)
  })

  it('finds no one when no one is on screen', () => {
    expect(nextOnScreen([], null, span)).toBeNull()
    expect(nextOnScreen([{ id: 1, x: -60 }], 1, span)).toBeNull()
  })
})

describe('placeCard', () => {
  const desk = { width: 1440, height: 900 }

  it("sits to the customer's right, its foot level with theirs", () => {
    const box = boxAt(800, 780)
    expect(placeCard(box, desk, CARD)).toEqual({
      left: box.right + CARD.gap,
      bottom: desk.height - 780,
      width: CARD.width,
      side: 'right',
    })
  })

  it('flips to the left near the right edge', () => {
    const box = boxAt(1300, 780)
    expect(placeCard(box, desk, CARD)).toEqual({
      left: box.left - CARD.gap - CARD.width,
      bottom: desk.height - 780,
      width: CARD.width,
      side: 'left',
    })
  })

  it('on a phone, flips left at the right edge and goes above in the middle', () => {
    const phone = { width: 360, height: 640 }
    const sides = [20, 180, 345].map((x) => {
      const box = boxAt(x, 620, 14, 40)
      const place = placeCard(box, phone, CARD)
      expect(place.width).toBe(CARD.width)
      expect(place.left).toBeGreaterThanOrEqual(CARD.margin)
      expect(place.left + place.width).toBeLessThanOrEqual(
        phone.width - CARD.margin,
      )
      // Beside the customer, the card clears them; above, it clears their head.
      if (place.side === 'above') {
        expect(place.bottom).toBe(phone.height - box.top + CARD.gap)
      } else if (place.side === 'left') {
        expect(place.left + place.width).toBeLessThanOrEqual(box.left)
      } else {
        expect(place.left).toBeGreaterThanOrEqual(box.right)
      }
      return place.side
    })
    expect(sides).toEqual(['right', 'above', 'left'])
  })

  it('narrows to a page narrower than the card', () => {
    const tiny = { width: 200, height: 400 }
    const place = placeCard(boxAt(100, 380, 10, 30), tiny, CARD)
    expect(place.width).toBe(tiny.width - 2 * CARD.margin)
    expect(place.left).toBe(CARD.margin)
  })

  it('keeps its foot inside the page', () => {
    const below = placeCard(boxAt(300, 1000), desk, CARD)
    expect(below.bottom).toBe(CARD.margin)
  })
})
