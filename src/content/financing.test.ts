import { describe, expect, it } from 'vitest'
import eventsJson from './events.json'
import financingJson from './financing.json'
import {
  isNoticeCard,
  loadEventContent,
  loadFinancingContent,
  type EventCard,
  type EventContent,
  type TimedEventEffect,
} from './schema.ts'

// The emergency loan and the share sale (#159), and the bankruptcy (#160):
// the rules of financing.json, checked against the event cards, the cards'
// terms as their text and tags write them, and Mme Prudhomme's letters.

type Json = Record<string, unknown>

const EVENTS = loadEventContent()
const content = loadFinancingContent()

function card(id: string): EventCard {
  const found = EVENTS.events.find((event) => event.id === id)
  if (found === undefined) throw new Error(`No card ${id}`)
  return found
}

/** The effects of `kind` on `card`'s choices, with the choice of each. */
function effectsOf<Kind extends TimedEventEffect['kind']>(
  { choices }: EventCard,
  kind: Kind,
): { choice: string; effect: Extract<TimedEventEffect, { kind: Kind }> }[] {
  return choices.flatMap(({ id, outcomes }) =>
    outcomes.flatMap(({ effects }) =>
      effects.flatMap((effect) =>
        effect.kind === kind
          ? [
              {
                choice: id,
                effect: effect as Extract<TimedEventEffect, { kind: Kind }>,
              },
            ]
          : [],
      ),
    ),
  )
}

/** The text of each tag of `card`'s choice `choice`. */
function tagsOf({ choices }: EventCard, choice: string): string[] {
  return (choices.find(({ id }) => id === choice)?.tags ?? []).map((tag) =>
    typeof tag === 'string' ? tag : tag.text,
  )
}

/** A number as French writes it: 18, or 1,5. */
function french(n: number): string {
  return String(n).replace('.', ',')
}

/** The shipped cards, with `change` made to the card `id`. */
function eventsWith(id: string, change: (card: Json) => void): EventContent {
  const raw = JSON.parse(JSON.stringify(eventsJson)) as {
    events: Json[]
  }
  const target = raw.events.find((event) => event.id === id)
  if (target === undefined) throw new Error(`No card ${id}`)
  change(target)
  return loadEventContent(raw)
}

/** The shipped rules with `notices` as the bankruptcy's letters. */
function withNotices(...notices: { afterMonths: number; event: string }[]) {
  return {
    ...financingJson,
    bankruptcy: { ...financingJson.bankruptcy, notices },
  }
}

function rejects(
  raw: unknown,
  reason: string,
  events: EventContent = EVENTS,
): void {
  expect(() => loadFinancingContent(raw, events)).toThrow(
    /^financing\.json is invalid:/,
  )
  expect(() => loadFinancingContent(raw, events)).toThrow(reason)
}

describe('financing.json', () => {
  it('brings Mme Prudhomme once a game year, and Max Duvent 14 days after her loan, for two rounds, as Étienne decided on October 16, 2026', () => {
    expect(content).toEqual({
      _note: expect.any(String),
      loanEvent: 'pretUrgence',
      investorEvent: 'offreDuvent',
      investorDaysAfterLoan: 14,
      maxShareRounds: 2,
      noSecondLoanAt: ['difficile'],
      bankruptcy: {
        months: 6,
        notices: [
          { afterMonths: 1, event: 'premierAvis' },
          { afterMonths: 3, event: 'deuxiemeAvis' },
          { afterMonths: 5, event: 'dernierAvis' },
        ],
      },
    })
  })

  it('names cards no draw brings, each with the effect of its kind on « Accepter » alone', () => {
    const loan = card(content.loanEvent)
    const investor = card(content.investorEvent)
    expect(loan.weight).toBe(0)
    expect(investor.weight).toBe(0)
    expect(
      effectsOf(loan, 'emergencyLoan').map(({ choice }) => choice),
    ).toEqual(['accepter'])
    expect(
      effectsOf(investor, 'shareSale').map(({ choice }) => choice),
    ).toEqual(['accepter'])
    for (const { choices } of [loan, investor]) {
      expect(choices.map(({ id, label }) => [id, label])).toEqual([
        ['accepter', 'Accepter'],
        ['refuser', 'Refuser'],
      ])
    }
  })

  it("writes the loan's rate, term and fee in its tags as its effect has them", () => {
    const loan = card(content.loanEvent)
    const [{ effect } = { effect: undefined }] = effectsOf(
      loan,
      'emergencyLoan',
    )
    if (effect === undefined) throw new Error('No loan')
    const tags = tagsOf(loan, 'accepter')
    expect(tags).toContain(
      `Intérêts ${french(effect.annualRateBasisPoints / 100)} % · ${effect.termMonths} mois`,
    )
    expect(tags).toContain(
      `Frais de dossier ${french(effect.feeShare * 100)} %`,
    )
    expect(effect.monthsOfFixedCosts).toBe(1)
    expect(tags).toContain('Encaisse visée : un mois de frais fixes')
    expect(tags).toContain("Prêt d'au plus {montant}")
    expect(loan.quote).toContain("jusqu'à {montant:pret}")
    expect(loan.quote).toContain('Les frais de dossier se prennent dessus')
  })

  it('writes the share sold in its tags and its quote as its effect has it', () => {
    const investor = card(content.investorEvent)
    const [{ effect } = { effect: undefined }] = effectsOf(
      investor,
      'shareSale',
    )
    if (effect === undefined) throw new Error('No share sale')
    const percent = `${french(effect.share * 100)} %`
    expect(tagsOf(investor, 'accepter')).toEqual([
      'Encaisse +{montant}',
      `${percent} des actions · pour toujours`,
      `${percent} des profits chaque trimestre`,
    ])
    expect(investor.quote).toContain(
      `${percent} des actions, et ${percent} des profits chaque trimestre`,
    )
  })

  it('says refusing leaves the encaisse below zero, which P4-05 counts', () => {
    for (const id of [content.loanEvent, content.investorEvent]) {
      expect(tagsOf(card(id), 'refuser')[0]).toBe("L'encaisse reste sous zéro")
    }
  })
})

describe("the bankruptcy's letters (#160)", () => {
  const { notices } = content.bankruptcy

  it('are « Premier avis », « Deuxième avis » and « Dernier avis », from Mme Prudhomme, as the loan is', () => {
    const lender = card(content.loanEvent).character
    expect(notices.map(({ event }) => card(event).title)).toEqual([
      'Premier avis',
      'Deuxième avis',
      'Dernier avis',
    ])
    for (const { event } of notices) {
      expect(card(event).character, event).toEqual(lender)
    }
  })

  it('are notices no draw brings: one choice, « Compris », with no tag and no effect', () => {
    for (const { event } of notices) {
      const notice = card(event)
      expect(isNoticeCard(notice), event).toBe(true)
      expect(notice.weight, event).toBe(0)
      expect(notice.weightByStanding, event).toBeUndefined()
      expect(
        notice.choices.map(({ id, label, tags, outcomes }) => ({
          id,
          label,
          tags,
          outcomes: outcomes.map(({ chance, effects }) => ({
            chance,
            effects,
          })),
        })),
        event,
      ).toEqual([
        {
          id: 'compris',
          label: 'Compris',
          tags: [],
          outcomes: [{ chance: 1, effects: [] }],
        },
      ])
    }
  })

  it('count the months they come after, in words', () => {
    const words: Record<number, string> = { 1: 'un', 3: 'trois', 5: 'cinq' }
    for (const { afterMonths, event } of notices) {
      const { situation, quote = '' } = card(event)
      expect(`${situation} ${quote}`.toLowerCase(), event).toContain(
        `${words[afterMonths]} mois`,
      )
    }
  })

  it('are the only notices', () => {
    const letters = notices.map(({ event }) => event)
    expect(EVENTS.events.filter(isNoticeCard).map(({ id }) => id)).toEqual(
      letters,
    )
  })
})

describe('loadFinancingContent rejects', () => {
  it('a card the event cards do not hold', () => {
    rejects(
      { ...financingJson, loanEvent: 'pretMiracle' },
      'no event has the id pretMiracle',
    )
  })

  it('a card a draw may bring', () => {
    const drawn = eventsWith('offreDuvent', (event) => {
      event.weight = 1
    })
    rejects(
      financingJson,
      'the event offreDuvent has a weight above 0, so a draw may bring it',
      drawn,
    )
  })

  it('a card without the effect of its kind', () => {
    rejects(
      { ...financingJson, investorEvent: 'essai', loanEvent: 'offreDuvent' },
      'no choice of the event offreDuvent has a emergencyLoan effect',
    )
  })

  it('the same card for both', () => {
    rejects(
      { ...financingJson, investorEvent: 'pretUrgence' },
      'the loan and the investor come on cards of their own',
    )
  })

  it('a notice the event cards do not hold, or one with a choice to make', () => {
    rejects(
      withNotices({ afterMonths: 1, event: 'avisFantome' }),
      'no event has the id avisFantome',
    )
    rejects(
      withNotices({ afterMonths: 1, event: 'essai' }),
      'the event essai is no notice: it has more than one choice',
    )
  })

  it("a notice on one of the financing's own cards, or twice the same", () => {
    rejects(
      withNotices({ afterMonths: 1, event: 'pretUrgence' }),
      "the event pretUrgence is already one of the financing's cards",
    )
    rejects(
      withNotices(
        { afterMonths: 1, event: 'premierAvis' },
        { afterMonths: 2, event: 'premierAvis' },
      ),
      "the event premierAvis is already one of the financing's cards",
    )
  })

  it('notices out of order, or two after the same months', () => {
    const reason = 'the notices come in order, each after more months'
    rejects(
      withNotices(
        { afterMonths: 3, event: 'premierAvis' },
        { afterMonths: 1, event: 'deuxiemeAvis' },
      ),
      reason,
    )
    rejects(
      withNotices(
        { afterMonths: 2, event: 'premierAvis' },
        { afterMonths: 2, event: 'deuxiemeAvis' },
      ),
      reason,
    )
  })

  it('a notice once the months that end the game are reached', () => {
    rejects(
      withNotices({ afterMonths: 6, event: 'premierAvis' }),
      'a notice comes before the 6 months that end the game',
    )
  })

  it('takes no notice at all, which loads', () => {
    expect(
      loadFinancingContent(withNotices(), EVENTS).bankruptcy.notices,
    ).toEqual([])
  })

  it.each<[string, Json]>([
    ['no days after the loan', { investorDaysAfterLoan: 0 }],
    ['days after the loan that are not whole', { investorDaysAfterLoan: 1.5 }],
    ['rounds below zero', { maxShareRounds: -1 }],
    ['a difficulty the game does not know', { noSecondLoanAt: ['extreme'] }],
    ['a key the game does not know', { maxLoans: 3 }],
    ['no bankruptcy', { bankruptcy: undefined }],
    ['a bankruptcy after no month', { bankruptcy: { months: 0, notices: [] } }],
    [
      'a bankruptcy after months that are not whole',
      { bankruptcy: { months: 5.5, notices: [] } },
    ],
    [
      'a notice after no month',
      {
        bankruptcy: {
          months: 6,
          notices: [{ afterMonths: 0, event: 'premierAvis' }],
        },
      },
    ],
    [
      'a key the bankruptcy does not know',
      { bankruptcy: { months: 6, notices: [], grace: 1 } },
    ],
  ])('%s', (_, change) => {
    expect(() =>
      loadFinancingContent({ ...financingJson, ...change }, EVENTS),
    ).toThrow(/^financing\.json is invalid:/)
  })
})
