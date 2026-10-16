import { describe, expect, it } from 'vitest'
import { loadEventContent, type EventContent } from '../content/schema.ts'
import { createInitialState } from '../engine/clock.ts'
import { EVENTS } from '../engine/day.ts'
import { cents } from '../engine/money.ts'
import { resolveEvent } from '../engine/events.ts'
import type { GameState } from '../engine/types.ts'
import {
  choiceChanges,
  formatChangeLine,
  type ChangeLine,
} from './eventChanges.ts'

// Every space in an amount is a no-break space (U+00A0); a loss takes the
// minus sign (U+2212). Day 0 is Monday, May 1st.
const S = ' '
const M = '−'

/** A card whose « Oui » does `effects`, and whose « Non » does nothing. */
function content(effects: unknown[]): EventContent {
  return loadEventContent({
    pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
    events: [
      {
        id: 'test',
        weight: 1,
        character: { id: 'gilles', name: 'Gilles Lacasse', role: 'Traiteur' },
        title: 'La grosse commande',
        situation: 'Il lui faut des croissants.',
        choices: [
          {
            id: 'oui',
            label: 'Oui',
            tags: ['Risqué'],
            outcomes: [{ chance: 1, result: 'Fait.', effects }],
          },
          {
            id: 'non',
            label: 'Non',
            tags: ['Rien ne change'],
            outcomes: [{ chance: 1, result: 'Rien.', effects: [] }],
          },
        ],
      },
    ],
  })
}

function waiting(state: GameState, event: string): GameState {
  return {
    ...state,
    events: { ...state.events, pending: { event, followUp: false } },
  }
}

/** The lines of `choice` on the event waiting in `before`. */
function linesOf(
  before: GameState,
  choice: string,
  events: EventContent,
): string[] {
  const after = resolveEvent(before, choice, events)
  return choiceChanges(before, after).map((line) =>
    formatChangeLine(line, before.day),
  )
}

/** The lines of « Oui » doing `effects` on the morning of day 0. */
function lines(effects: unknown[], state = createInitialState(1)): string[] {
  return linesOf(waiting(state, 'test'), 'oui', content(effects))
}

const GILLES = 'Gilles Lacasse'

/** The shipped cards with no difficulty scaling them. */
const AS_WRITTEN: EventContent = { ...EVENTS, scaling: undefined }

describe('choiceChanges', () => {
  it("reads the shipped essai card's « Tout essayer », as written", () => {
    // Now: −100 $ + 200 $ − 20 croissants at 1,10 $ in Encaisse; 750 $ and
    // 100 $ on credit, the 100 $ written off; 20 croissants in, 18 out.
    // Later: 50 $ in 3 days, and Client d'essai collected next Thursday,
    // which keeps their due day off the line.
    expect(
      linesOf(
        waiting(createInitialState(1), 'essai'),
        'toutEssayer',
        AS_WRITTEN,
      ),
    ).toEqual([
      `Encaisse +78${S}$`,
      `Comptes clients +750${S}$`,
      `Stocks +2,20${S}$`,
      `Énergie ${M}10`,
      `Vos finances +60${S}$`,
      `Encaisse ${M}50${S}$ jeudi`,
      "Encaissement de Client d'essai, jeudi",
    ])
  })

  it('shows what a choice that does nothing did: nothing', () => {
    expect(
      linesOf(waiting(createInitialState(1), 'essai'), 'rienFaire', EVENTS),
    ).toEqual([])
  })

  it('never nets a purchase with the stock used the same later day', () => {
    // 200 croissants bought and used next Thursday, from no stock: Stocks
    // ends where it was, but only the purchase's cash is known now.
    expect(
      lines([
        {
          kind: 'buyStock',
          product: 'croissant',
          units: 200,
          onNextWeekday: 4,
        },
        {
          kind: 'useStock',
          product: 'croissant',
          units: 200,
          to: 'order',
          onNextWeekday: 4,
        },
        {
          kind: 'creditSale',
          amountCents: 75_000,
          client: GILLES,
          dueInDays: 60,
          onNextWeekday: 4,
        },
        { kind: 'energy', amount: -15, onNextWeekday: 4 },
      ]),
    ).toEqual([
      `Encaisse ${M}220${S}$ jeudi`,
      `Comptes clients +750${S}$ jeudi (3 juillet)`,
      `Énergie ${M}15 jeudi`,
    ])
  })

  it('shows what moved at once from the books, dropping what nets to zero', () => {
    expect(
      lines([
        { kind: 'buyStock', product: 'croissant', units: 200 },
        { kind: 'useStock', product: 'croissant', units: 200, to: 'order' },
        {
          kind: 'creditSale',
          amountCents: 75_000,
          client: GILLES,
          dueInDays: 60,
        },
        { kind: 'collectReceivable', client: GILLES },
      ]),
    ).toEqual([`Encaisse +530${S}$`])
  })

  it('gives the day a sale on credit is collected, as the books have it', () => {
    expect(
      lines([
        {
          kind: 'creditSale',
          amountCents: 75_000,
          client: GILLES,
          dueInDays: 60,
        },
      ]),
    ).toEqual([`Comptes clients +750${S}$ (30 juin)`])
    expect(
      lines([
        {
          kind: 'creditSale',
          amountCents: 75_000,
          client: GILLES,
          dueInDays: 60,
        },
        { kind: 'delayReceivable', client: GILLES, days: 30 },
      ]),
    ).toEqual([`Comptes clients +750${S}$ (30 juillet)`])
  })

  it('gives each due day once, in order', () => {
    expect(
      lines([
        { kind: 'creditSale', amountCents: 10_000, client: 'B', dueInDays: 90 },
        { kind: 'creditSale', amountCents: 5_000, client: 'A', dueInDays: 60 },
        { kind: 'creditSale', amountCents: 5_000, client: 'C', dueInDays: 60 },
      ]),
    ).toEqual([`Comptes clients +200${S}$ (30 juin, 30 juillet)`])
  })

  it('gives no due day when a later effect delays or settles the debt', () => {
    const sale = {
      kind: 'creditSale',
      amountCents: 75_000,
      client: GILLES,
      dueInDays: 60,
    }
    expect(
      lines([
        sale,
        { kind: 'delayReceivable', client: GILLES, days: 30, inDays: 1 },
      ]),
    ).toEqual([
      `Comptes clients +750${S}$`,
      'Paiement de Gilles Lacasse reporté de 30 jours, demain',
    ])
    expect(
      lines([
        { ...sale, inDays: 2 },
        { kind: 'collectReceivable', client: GILLES, inDays: 5 },
      ]),
    ).toEqual([
      `Comptes clients +750${S}$ mercredi`,
      'Encaissement de Gilles Lacasse, samedi',
    ])
    expect(
      lines([
        { ...sale, client: 'Client douteux' },
        { kind: 'writeOff', client: 'Client douteux', inDays: 8 },
        { kind: 'delayReceivable', client: GILLES, days: 1, inDays: 1 },
      ]),
    ).toEqual([
      `Comptes clients +750${S}$`,
      'Paiement de Gilles Lacasse reporté de 1 jour, demain',
      'Mauvaise créance de Client douteux, le 9 mai',
    ])
  })

  it('keeps the due day of a client nothing later touches', () => {
    expect(
      lines([
        {
          kind: 'creditSale',
          amountCents: 75_000,
          client: GILLES,
          dueInDays: 60,
        },
        { kind: 'writeOff', client: 'Quelqu’un d’autre', inDays: 1 },
      ]),
    ).toEqual([
      `Comptes clients +750${S}$ (30 juin)`,
      'Mauvaise créance de Quelqu’un d’autre, demain',
    ])
  })

  it('says when, and never adds two later effects together', () => {
    expect(
      lines([
        { kind: 'charge', amountCents: 1_000, description: 'A', inDays: 1 },
        { kind: 'cashSale', amountCents: 1_000, description: 'B', inDays: 1 },
        { kind: 'charge', amountCents: 1_050, description: 'C', inDays: 6 },
        { kind: 'personal', amountCents: 6_000, label: 'D', inDays: 7 },
      ]),
    ).toEqual([
      `Encaisse ${M}10${S}$ demain`,
      `Encaisse +10${S}$ demain`,
      `Encaisse ${M}10,50${S}$ dimanche`,
      `Vos finances +60${S}$ le 8 mai`,
    ])
  })

  it('shows no follow-up, headline, change to the street or later stock use', () => {
    expect(
      lines([
        { kind: 'followUp', event: 'test', days: 10 },
        { kind: 'headline', id: 'essai' },
        { kind: 'walkIns', factor: 0.5, days: 3 },
        { kind: 'closed', days: 1, inDays: 1 },
        {
          kind: 'useStock',
          product: 'cafe',
          units: 5,
          to: 'giveaway',
          inDays: 2,
        },
        { kind: 'followUp', event: 'test', days: 10, inDays: 1 },
        { kind: 'headline', id: 'essai', inDays: 1 },
      ]),
    ).toEqual([])
  })

  it('shows the energy that actually changed, rounded', () => {
    const tired = { ...createInitialState(1), energy: 50 }
    expect(lines([{ kind: 'energy', amount: 10 }])).toEqual([])
    expect(lines([{ kind: 'energy', amount: -7.4 }], tired)).toEqual([
      `Énergie ${M}7`,
    ])
    expect(lines([{ kind: 'energy', amount: 0.4, inDays: 1 }], tired)).toEqual(
      [],
    )
    expect(lines([{ kind: 'energy', amount: 20, inDays: 6 }], tired)).toEqual([
      'Énergie +20 dimanche',
    ])
  })

  it('leaves out what earlier choices queued', () => {
    const events = content([
      { kind: 'charge', amountCents: 1_000, description: 'A', inDays: 3 },
    ])
    const earlier = resolveEvent(
      waiting(createInitialState(1), 'test'),
      'oui',
      events,
    )
    expect(earlier.events.delayed).toHaveLength(1)
    expect(linesOf(waiting(earlier, 'test'), 'non', events)).toEqual([])
  })

  describe('with what earlier choices queued for a client', () => {
    const sale = {
      kind: 'creditSale',
      amountCents: 75_000,
      client: GILLES,
      dueInDays: 60,
    }
    /** The lines of a sale, once an earlier choice queued `effect`. */
    const afterEarlier = (effect: unknown, later: unknown = sale) => {
      const earlier = resolveEvent(
        waiting(createInitialState(1), 'test'),
        'oui',
        content([effect]),
      )
      expect(earlier.events.delayed).toHaveLength(1)
      return linesOf(waiting(earlier, 'test'), 'oui', content([later]))
    }

    it('gives no due day when they collect or delay the debt before it', () => {
      // Gilles pays on Thursday, not on June 30th.
      expect(
        afterEarlier({ kind: 'collectReceivable', client: GILLES, inDays: 3 }),
      ).toEqual([`Comptes clients +750${S}$`])
      expect(
        afterEarlier(
          { kind: 'delayReceivable', client: GILLES, days: 30, inDays: 10 },
          { ...sale, inDays: 2 },
        ),
      ).toEqual([`Comptes clients +750${S}$ mercredi`])
      expect(
        afterEarlier(
          { kind: 'writeOff', client: GILLES, inDays: 62 },
          { ...sale, inDays: 2 },
        ),
      ).toEqual([`Comptes clients +750${S}$ mercredi`])
    })

    it('keeps the due day when they come before the sale or after it is due', () => {
      expect(
        afterEarlier(
          { kind: 'collectReceivable', client: GILLES, inDays: 3 },
          { ...sale, inDays: 5 },
        ),
      ).toEqual([`Comptes clients +750${S}$ samedi (5 juillet)`])
      expect(
        afterEarlier(
          { kind: 'writeOff', client: GILLES, inDays: 30 },
          { ...sale, dueInDays: 20 },
        ),
      ).toEqual([`Comptes clients +750${S}$ (21 mai)`])
    })
  })
})

describe('formatChangeLine', () => {
  const line = (change: Partial<ChangeLine>): ChangeLine => ({
    label: 'Encaisse',
    amount: null,
    day: 10,
    collectedOn: [],
    ...change,
  })

  it('writes what is done today without a day', () => {
    expect(formatChangeLine(line({ label: 'Encaissement de A' }), 10)).toBe(
      'Encaissement de A',
    )
    expect(
      formatChangeLine(line({ amount: { money: cents(-22_000) } }), 10),
    ).toBe(`Encaisse ${M}220${S}$`)
  })
})
