import { describe, expect, it } from 'vitest'
import { mulRatio, type Cents } from '../engine/money.ts'
import {
  grocerIdSchema,
  loadEventContent,
  loadGrocerContent,
  type EventCard,
  type GrocerId,
} from './schema.ts'

// The grocers' cards of #156: one offer and one renewal for each grocer of
// grocers.json, each to accept, negotiate or refuse, and text that says the
// grocer's own terms. No difficulty scales a contract's price, so the cards
// write it out, where other cards show their amounts as {montant:name}.

const EVENTS = loadEventContent()
const GROCERS = loadGrocerContent(undefined, EVENTS)

/** What negotiating asks for: the price, 10 % more. */
const NEGOTIATED = 1.1
/** How long a grocer who walks away stays away. */
const AWAY_DAYS = 180

/** The characters of the grocers, by their portrait ids. */
const CHARACTERS: Record<GrocerId, string> = {
  chezNormand: 'normand',
  marcheBioLogique: 'solangeTremblayLevesque',
  depanneur2424: 'monsieurKim',
}

function cardOf(id: string): EventCard {
  const card = EVENTS.events.find((event) => event.id === id)
  if (card === undefined) throw new Error(`No card ${id}`)
  return card
}

/** The offer of `grocer`: the card whose `grocer` condition names them. */
function offerOf(grocer: GrocerId): EventCard {
  const offers = EVENTS.events.filter(
    ({ conditions }) => conditions?.grocer === grocer,
  )
  expect(offers).toHaveLength(1)
  return offers[0] as EventCard
}

/** A count as French text writes it: 1 250. */
function count(units: number): string {
  return String(units).replace(/\B(?=(\d{3})+$)/g, ' ')
}

/** A price as French text writes it: 2,10 $. */
function price(amount: Cents): string {
  return `${(amount / 100).toFixed(2).replace('.', ',')} $`
}

/** Every text of `card` the player reads, the tags aside. */
function texts(card: EventCard): string {
  return [
    card.situation,
    card.quote ?? '',
    ...card.choices.flatMap(({ label, outcomes }) => [
      label,
      ...outcomes.map(({ result }) => result),
    ]),
  ].join('\n')
}

describe.each(grocerIdSchema.options)("%s's cards", (grocer) => {
  const terms = GROCERS.grocers[grocer]
  const offer = offerOf(grocer)
  const renewal = cardOf(terms.renewalEvent)

  it('offer from day 30, every 90 days at most, while the grocer may (see mayOffer)', () => {
    expect(offer.conditions).toEqual({
      fromDay: 30,
      cooldownDays: 90,
      grocer,
    })
    expect(offer.weight).toBeGreaterThan(0)
  })

  it('renew only as the follow-up the end of a contract brings', () => {
    expect(renewal.conditions).toEqual({ followUpOnly: true })
  })

  it.each([
    ['offer', offer],
    ['renewal', renewal],
  ])(
    '%s: accepts, negotiates 10 % more or walks away, or refuses',
    (_, card) => {
      expect(card.character.id).toBe(CHARACTERS[grocer])
      expect(card.choices.map(({ id }) => id)).toEqual([
        'accepter',
        'negocier',
        'refuser',
      ])
      const [accept, negotiate, refuse] = card.choices
      expect(accept?.outcomes).toEqual([
        {
          chance: 1,
          result: expect.any(String),
          effects: [{ kind: 'contract', grocer }],
        },
      ])
      expect(negotiate?.outcomes).toEqual([
        {
          chance: 0.5,
          result: expect.any(String),
          effects: [{ kind: 'contract', grocer, priceFactor: NEGOTIATED }],
        },
        {
          chance: 0.5,
          result: expect.any(String),
          effects: [{ kind: 'grocerAway', grocer, days: AWAY_DAYS }],
        },
      ])
      // Refusing costs only what every Difficile choice costs.
      expect(refuse?.outcomes).toEqual([
        {
          chance: 1,
          result: expect.any(String),
          effects: [
            {
              kind: 'energy',
              amount: -5,
              difficulties: ['difficile'],
              name: 'energie',
            },
          ],
        },
      ])
    },
  )

  it.each([
    ['offer', offer],
    ['renewal', renewal],
  ])(
    "%s: says the grocer's weekly croissants, price, terms and weeks, and the negotiated price",
    (_, card) => {
      const text = texts(card)
      expect(card.quote).toContain(`${count(terms.unitsPerWeek)} `)
      expect(card.quote).toContain(price(terms.unitPriceCents))
      expect(card.quote).toContain(`${terms.paymentDays} jours`)
      expect(card.quote).toContain(`${terms.weeks} semaines`)
      expect(card.choices[1]?.label).toBe(
        `Négocier à ${price(mulRatio(terms.unitPriceCents, NEGOTIATED))}`,
      )
      for (const choice of card.choices.slice(0, 2)) {
        expect(choice.tags).toContain(`Payé dans ${terms.paymentDays} jours`)
      }
      if (terms.artisanalPremiumCents > 0) {
        expect(card.quote).toContain(price(terms.artisanalPremiumCents))
      }
      // No other amount of money than the grocer's own.
      const amounts = [...text.matchAll(/\d+,\d\d \$/g)].map(([m]) => m)
      const known = [
        terms.unitPriceCents,
        mulRatio(terms.unitPriceCents, NEGOTIATED),
        terms.artisanalPremiumCents,
      ].map(price)
      expect(amounts.filter((amount) => !known.includes(amount))).toEqual([])
    },
  )
})

describe("the grocers' content", () => {
  it('holds one offer and one renewal per grocer, and no other card with a grocer', () => {
    const withGrocer = EVENTS.events.filter(
      ({ conditions }) => conditions?.grocer !== undefined,
    )
    expect(withGrocer.map(({ conditions }) => conditions?.grocer)).toEqual(
      grocerIdSchema.options,
    )
    const renewals = Object.values(GROCERS.grocers).map(
      ({ renewalEvent }) => renewalEvent,
    )
    expect(new Set(renewals).size).toBe(grocerIdSchema.options.length)
  })
})
