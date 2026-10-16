import { describe, expect, it } from 'vitest'
import eventsJson from './events.json'
import {
  eventEffectSchema,
  loadEventContent,
  loadGrocerContent,
  type DifficultyId,
  type EventCard,
  type TimedEventEffect,
} from './schema.ts'

// The event cards: the shipped file, and what the schema refuses.

type Json = Record<string, unknown>

const KINDS = eventEffectSchema.options.map((option) => option.shape.kind.value)

/** The cards of issue #93, in its order. */
const CARDS = [
  'grosseCommande',
  'chequeDansLaMalle',
  'conesOrange',
  'machineTousse',
  'critique',
  'influenceuse',
  'concurrence',
  'formulaire14B',
  'chalet',
  'canicule',
  'festival',
  'premierJuillet',
]

/** The cards of issue #137, which Facile draws by the player's standing. */
const STANDING_CARDS = [
  'gateauFete',
  'traiteurPresse',
  'placementMiracle',
  'peintureLuxe',
]

/** The cards of issue #155, in its order, the rain under the awning added. */
const R06_CARDS = [
  'panneCourant',
  'stagiaire',
  'feteQuartier',
  'fournisseurRetard',
  'carteFidelite',
  'inspection',
  'pluie',
  'pluieAuvent',
  'clientMystere',
  'camionVoisin',
  'commandite',
  'volCaisse',
  'reportage',
]

/** The grocers' offers of issue #156, then their renewals. */
const GROCER_CARDS = [
  'contratNormand',
  'contratBioLogique',
  'contratDepanneur',
  'renouvellementNormand',
  'renouvellementBioLogique',
  'renouvellementDepanneur',
]

/**
 * The cards of issue #159, which the engine brings when the encaisse
 * closes below zero: Mme Prudhomme's emergency loan, then Max Duvent's
 * offer.
 */
const FINANCING_CARDS = ['pretUrgence', 'offreDuvent']

/** The portraits of issue #95, one per character but the silhouette. */
const PORTRAITS = [
  'gillesLacasse',
  'rejeanLalonde',
  'bertrand',
  'solangeBeaulieuFortin',
  'coralieLumiere',
  'sylvain',
  'liseTremblayCote',
  'martine',
  'normand',
  'jeanPhilippe',
  'meteorologue',
]

/** The characters of issue #159, whose portraits came before their cards. */
const FINANCING_PORTRAITS = ['mmePrudhomme', 'maxDuvent']

/** The characters of issues #137 and #156, who have no portrait yet. */
const WITHOUT_PORTRAITS = [
  'mmeOuellette',
  'rosaireGagnon',
  'stevieDuvent',
  'ginettePelletier',
  'solangeTremblayLevesque',
  'monsieurKim',
]

/**
 * Whether `card` offers a grocer's contract: its prices are the grocer's in
 * grocers.json, which no difficulty scales (see grocerCards.test.ts).
 */
function offersContract({ choices }: EventCard): boolean {
  return choices.some(({ outcomes }) =>
    outcomes.some(({ effects }) =>
      effects.some(({ kind }) => kind === 'contract'),
    ),
  )
}

/** An emergency loan on the shipped terms, as a card writes it. */
const LOAN: Json = {
  kind: 'emergencyLoan',
  lender: 'Caisse populaire Saint-Prudent',
  monthsOfFixedCosts: 1,
  maxCents: 1_500_000,
  annualRateBasisPoints: 1800,
  termMonths: 12,
  feeShare: 0.02,
}

/** A round of shares on the shipped terms, as a card writes it. */
const SHARES: Json = {
  kind: 'shareSale',
  investor: 'Duvent Capital',
  amountCents: 2_000_000,
  share: 0.2,
}

/** A copy of the shipped file to break, as plain JSON. */
function shipped(): Json {
  return JSON.parse(JSON.stringify(eventsJson)) as Json
}

/** A valid file holding `events`, by default one card. */
function file(events: unknown[] = [card()]): Json {
  return {
    pacing: { firstDay: 7, minDaysBetween: 5, dailyChance: 0.15 },
    events,
  }
}

function card(extra: Json = {}): Json {
  return {
    id: 'grosseCommande',
    weight: 1,
    character: {
      id: 'gilles',
      name: 'Gilles Lacasse',
      role: 'Traiteur du Congrès québécois des optimistes',
    },
    title: 'La grosse commande',
    situation: 'Il me faut 200 croissants jeudi matin pour le congrès.',
    choices: [choice('accepter'), choice('refuser')],
    ...extra,
  }
}

function choice(id: string, extra: Json = {}): Json {
  return {
    id,
    label: 'Accepter',
    tags: ['Ventes +750 $'],
    outcomes: [outcome()],
    ...extra,
  }
}

function outcome(extra: Json = {}): Json {
  return { chance: 1, result: 'Gilles est content.', effects: [], ...extra }
}

/** A file whose one card's first choice has the one outcome `effects`. */
function withEffects(...effects: unknown[]): Json {
  return file([
    card({
      choices: [
        choice('accepter', { outcomes: [outcome({ effects })] }),
        choice('refuser'),
      ],
    }),
  ])
}

/**
 * Whether `effect` applies at `difficulty` (#137): it names no difficulty,
 * or that one among those it names.
 */
function appliesAt(
  { difficulties }: TimedEventEffect,
  difficulty: DifficultyId,
): boolean {
  return difficulties === undefined || difficulties.includes(difficulty)
}

/**
 * Whether `effect` costs the player something (#137): a charge, energy or
 * the owner's own cash going down, a change to the street below 1, the
 * truck closed or a product it cannot sell, stock given away or lost, a
 * client who pays late or never, or a grocer's contract, whose deliveries
 * take cash and energy each week, or a grocer walking away (#156), or an
 * emergency loan, whose fee and interest are paid, or shares sold, whose
 * buyer takes a share of the profit for good (#159).
 */
function costs(effect: TimedEventEffect): boolean {
  switch (effect.kind) {
    case 'charge':
    case 'emergencyLoan':
    case 'shareSale':
    case 'closed':
    case 'unavailable':
    case 'delayReceivable':
    case 'writeOff':
    case 'contract':
    case 'grocerAway':
      return true
    case 'energy':
      return effect.amount < 0
    case 'personal':
      return effect.amountCents < 0
    case 'walkIns':
    case 'appeal':
    case 'willingness':
      return effect.factor < 1
    case 'useStock':
      return effect.to !== 'order'
    default:
      return false
  }
}

function rejects(raw: unknown, ...reasons: string[]): void {
  let message = ''
  try {
    loadEventContent(raw)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(message, 'the file loaded').toMatch(/^events\.json is invalid:/)
  for (const reason of reasons) expect(message).toContain(reason)
}

describe('events.json', () => {
  const content = loadEventContent()

  it('paces events as #155 and its decision say: from day 10, 14 days apart, 8 % a morning', () => {
    expect(content.pacing).toEqual({
      firstDay: 10,
      minDaysBetween: 14,
      dailyChance: 0.08,
    })
  })

  it('caps the cards that came too often (#155)', () => {
    const caps = Object.fromEntries(
      content.events.flatMap(({ id, conditions }) =>
        conditions?.maxPerGame === undefined
          ? []
          : [[id, conditions.maxPerGame]],
      ),
    )
    expect(caps).toEqual({ machineTousse: 3, influenceuse: 2, concurrence: 2 })
  })

  it('brings the chalet on any tired summer morning, five times as often as a card of weight 1, with the grocers’ offers (#156)', () => {
    const chalet = content.events.find(({ id }) => id === 'chalet')
    expect(chalet?.weight).toBe(5)
    expect(chalet?.conditions).toEqual({
      energyBelow: 100,
      months: [6, 7, 8, 9],
      cooldownDays: 60,
    })
  })

  it('remembers the choices that change later cards: the awning, the neighbour’s machine', () => {
    const remembers = Object.fromEntries(
      content.events.flatMap(({ id, conditions }) =>
        conditions?.chosen === undefined && conditions?.notChosen === undefined
          ? []
          : [
              [
                id,
                { chosen: conditions.chosen, notChosen: conditions.notChosen },
              ],
            ],
      ),
    )
    expect(remembers).toEqual({
      machineTousse: {
        chosen: undefined,
        notChosen: [{ event: 'camionVoisin', choice: 'machine' }],
      },
      pluie: {
        chosen: undefined,
        notChosen: [{ event: 'pluie', choice: 'auvent' }],
      },
      pluieAuvent: {
        chosen: [{ event: 'pluie', choice: 'auvent' }],
        notChosen: undefined,
      },
    })
  })

  it('holds the essai card, which never comes up in a real game', () => {
    const essai = content.events.find(({ id }) => id === 'essai')
    expect(essai?.weight).toBe(0)
  })

  it('holds the essai card, the twelve cards of issue #93, the four of #137, the thirteen of #155, the six of #156, then the two of #159, in order', () => {
    expect(content.events.map(({ id }) => id)).toEqual([
      'essai',
      ...CARDS,
      ...STANDING_CARDS,
      ...R06_CARDS,
      ...GROCER_CARDS,
      ...FINANCING_CARDS,
    ])
  })

  it('dates only « Le 1er juillet », on June 30', () => {
    const dated = content.events.flatMap(({ id, conditions }) =>
      conditions?.date === undefined ? [] : [[id, conditions.date]],
    )
    expect(dated).toEqual([['premierJuillet', { month: 6, dayOfMonth: 30 }]])
  })

  it('may draw every card but essai and those of #159, which the engine brings, unless it only comes as a follow-up', () => {
    for (const { id, weight, conditions } of content.events.slice(1)) {
      if (FINANCING_CARDS.includes(id)) expect(weight, id).toBe(0)
      else if (conditions?.followUpOnly !== true)
        expect(weight, id).toBeGreaterThan(0)
    }
  })

  it("brings each follow-up-only card as the follow-up of another or a grocer's renewal, and only those", () => {
    // A card that may come back by itself, as the theft does, aside.
    const renewals = Object.values(loadGrocerContent().grocers).map(
      ({ renewalEvent }) => renewalEvent,
    )
    const followUps = new Set(
      content.events.flatMap(({ id, choices }) =>
        choices.flatMap(({ outcomes }) =>
          outcomes.flatMap(({ effects }) =>
            effects.flatMap((effect) =>
              effect.kind === 'followUp' && effect.event !== id
                ? [effect.event]
                : [],
            ),
          ),
        ),
      ),
    )
    const followUpOnly = content.events
      .filter(({ conditions }) => conditions?.followUpOnly === true)
      .map(({ id }) => id)
    expect([...followUps, ...renewals].sort()).toEqual(followUpOnly.sort())
  })

  it('tags a choice « Risqué » exactly when it leaves something to chance', () => {
    for (const { id, choices } of content.events) {
      for (const { id: choice, tags, outcomes } of choices) {
        const effects = outcomes.flatMap(({ effects: list }) => list)
        const leftToChance =
          outcomes.length > 1 ||
          effects.some(
            (effect) => effect.kind === 'followUp' && effect.chance < 1,
          )
        expect(tags.includes('Risqué'), `${id}, ${choice}`).toBe(leftToChance)
      }
    }
  })

  it('charges for every outcome of every choice at Difficile, refusing included', () => {
    const free = content.events
      .slice(1)
      .flatMap(({ id, choices }) =>
        choices.flatMap(({ id: choice, outcomes }) =>
          outcomes.flatMap(({ effects }, outcome) =>
            effects.some(
              (effect) => appliesAt(effect, 'difficile') && costs(effect),
            )
              ? []
              : [`${id}, ${choice}, outcome ${outcome}`],
          ),
        ),
      )
    expect(free).toEqual([])
  })

  it('scales the cards by difficulty as #137 tuned them', () => {
    expect(content.scaling).toEqual({
      _note: expect.any(String),
      lowestFactor: 0.1,
      difficulties: {
        facile: { gains: 1, losses: 0.9 },
        moyen: { gains: 1.1, losses: 1.1 },
        difficile: { gains: 0.85, losses: 1.15 },
      },
    })
  })

  it('draws by the standing at Facile only, from the 30th and 70th percentiles and a month of fixed costs', () => {
    expect(content.adaptiveDraw).toEqual({
      _note: expect.any(String),
      difficulties: ['facile'],
      behindBelowPercentile: 30,
      aheadAbovePercentile: 70,
      behindBelowMonthsOfFixedCosts: 1,
    })
  })

  it('weighs the cards of #137 toward their standing, and only those', () => {
    const weights = Object.fromEntries(
      content.events.flatMap(({ id, weight, weightByStanding }) =>
        weightByStanding === undefined
          ? []
          : [
              [
                id,
                [
                  weightByStanding.behind ?? weight,
                  weightByStanding.average ?? weight,
                  weightByStanding.ahead ?? weight,
                ],
              ],
            ],
      ),
    )
    expect(Object.keys(weights)).toEqual(STANDING_CARDS)
    for (const id of ['gateauFete', 'traiteurPresse']) {
      const [behind = 0, average = 0, ahead = 0] = weights[id] ?? []
      expect(behind, id).toBeGreaterThan(average)
      expect(average, id).toBeGreaterThan(ahead)
    }
    for (const id of ['placementMiracle', 'peintureLuxe']) {
      const [behind = 0, average = 0, ahead = 0] = weights[id] ?? []
      expect(ahead, id).toBeGreaterThan(average)
      expect(average, id).toBeGreaterThan(behind)
    }
  })

  it('writes no amount into a tag by hand, the terms of #159 aside: the effect it names gives it', () => {
    // A loan's rate, term and fee, and the share sold, are no amount a tag
    // can show: financing.test.ts holds the text to the effect.
    const typed = content.events
      .filter(({ id }) => !FINANCING_CARDS.includes(id))
      .flatMap(({ id, choices }) =>
        choices.flatMap(({ id: choice, tags }) =>
          tags
            .map((tag) => (typeof tag === 'string' ? tag : tag.text))
            .filter((text) => /\d\s*[$%]|Énergie [+−]\d/.test(text))
            .map((text) => `${id}, ${choice}: ${text}`),
        ),
      )
    expect(typed).toEqual([])
  })

  it('writes no amount of money into a card’s text by hand, a grocer’s prices aside: the effects it names give it', () => {
    const typed = content.events
      .filter((event) => !offersContract(event))
      .flatMap((event) =>
        [
          event.situation,
          event.quote ?? '',
          ...event.choices.flatMap(({ label, outcomes }) => [
            label,
            ...outcomes.map(({ result }) => result),
          ]),
        ]
          .filter((text) => /\d\s*\$/.test(text))
          .map((text) => `${event.id}: ${text}`),
      )
    expect(typed).toEqual([])
  })

  it('names the characters by the ids of their portraits in issue #95 and #159, or of #137 and #156', () => {
    const characters = new Set(
      content.events.slice(1).map(({ character }) => character.id),
    )
    expect([...characters].sort()).toEqual(
      [...PORTRAITS, ...FINANCING_PORTRAITS, ...WITHOUT_PORTRAITS].sort(),
    )
  })

  it('tries every kind of effect, both timings and an outcome left to chance on the essai card', () => {
    const essai = content.events.find(({ id }) => id === 'essai')
    const outcomes = essai?.choices.flatMap(({ outcomes }) => outcomes) ?? []
    const effects = outcomes.flatMap(({ effects }) => effects)
    expect([...new Set(effects.map(({ kind }) => kind))].sort()).toEqual(
      [...KINDS].sort(),
    )
    expect(effects.some(({ inDays }) => inDays !== undefined)).toBe(true)
    expect(
      effects.some(({ onNextWeekday }) => onNextWeekday !== undefined),
    ).toBe(true)
    expect(essai?.choices.some(({ outcomes: list }) => list.length > 1)).toBe(
      true,
    )
    expect(
      effects.some(
        (effect) => effect.kind === 'useStock' && effect.to === 'giveaway',
      ),
    ).toBe(true)
    expect(
      effects.some((effect) => effect.kind === 'charge' && effect.account),
    ).toBe(true)
  })

  it("loads a grocer's contract, at their price or another, and a grocer walking away, with the grocer condition", () => {
    const effects = [
      { kind: 'contract', grocer: 'chezNormand' },
      { kind: 'contract', grocer: 'marcheBioLogique', priceFactor: 1.1 },
      { kind: 'grocerAway', grocer: 'depanneur2424', days: 180 },
    ]
    const raw = withEffects(...effects)
    const loaded = loadEventContent({
      ...raw,
      events: (raw.events as Json[]).map((event) => ({
        ...event,
        conditions: { grocer: 'chezNormand' },
      })),
    })
    expect(loaded.events[0]?.choices[0]?.outcomes[0]?.effects).toEqual(effects)
    expect(loaded.events[0]?.conditions).toEqual({ grocer: 'chezNormand' })
  })

  it('loads every change to the street, now or later, for everyone or one segment', () => {
    const effects = [
      { kind: 'walkIns', factor: 0.65, days: 15 },
      { kind: 'walkIns', factor: 1.8, segment: 'chic', days: 2, inDays: 3 },
      { kind: 'appeal', product: 'chocolat', factor: 0.3, days: 5 },
      { kind: 'willingness', factor: 1.1, days: 1, onNextWeekday: 6 },
      { kind: 'willingness', factor: 1.1, segment: 'aubaine', days: 1 },
      { kind: 'unavailable', product: 'cafe', days: 4 },
      { kind: 'closed', days: 1 },
    ]
    const loaded = loadEventContent(withEffects(...effects))
    expect(loaded.events[0]?.choices[0]?.outcomes[0]?.effects).toEqual(effects)
  })

  it('refuses a key a change to the street does not have', () => {
    rejects(
      withEffects({ kind: 'closed', days: 1, product: 'cafe' }),
      'Unrecognized key: "product"',
    )
  })

  it('gives a follow-up a chance of 1 unless it says otherwise', () => {
    const loaded = loadEventContent(
      withEffects({ kind: 'followUp', event: 'grosseCommande', days: 60 }),
    )
    const effect = loaded.events[0]?.choices[0]?.outcomes[0]?.effects[0]
    expect(effect).toEqual({
      kind: 'followUp',
      event: 'grosseCommande',
      days: 60,
      chance: 1,
    })
  })

  it('loads a card with every condition', () => {
    const conditions = {
      fromDay: 14,
      difficulties: ['facile', 'moyen'],
      months: [6, 7, 8, 9],
      date: { month: 2, dayOfMonth: 28 },
      weekdays: [1, 2],
      energyBelow: 60,
      cashAboveCents: -50_000,
      cashBelowCents: 100_000,
      oncePerGame: true,
      maxPerGame: 2,
      cooldownDays: 60,
      chosen: [{ event: 'grosseCommande', choice: 'accepter' }],
      notChosen: [
        { event: 'grosseCommande', choice: 'refuser' },
        { event: 'grosseCommande', choice: 'accepter' },
      ],
      productOnMenu: 'chocolat',
      openTomorrow: true,
      followUpOnly: false,
    }
    const loaded = loadEventContent(
      file([
        card({ conditions, choices: [choice('accepter'), choice('refuser')] }),
      ]),
    )
    expect(loaded.events[0]?.conditions).toEqual(conditions)
  })

  it('loads stock lost, and stock bought now at its own unit cost', () => {
    const effects = [
      { kind: 'useStock', product: 'cafe', units: 300, to: 'loss' },
      { kind: 'buyStock', product: 'cafe', units: 300, unitCostCents: 20 },
    ]
    const loaded = loadEventContent(withEffects(...effects))
    expect(loaded.events[0]?.choices[0]?.outcomes[0]?.effects).toEqual(effects)
  })
})

describe('loadEventContent loads', () => {
  it('an effect for some difficulties, named for its tags, and a tag for some difficulties', () => {
    const effect = {
      kind: 'energy',
      amount: -5,
      difficulties: ['difficile'],
      name: 'energie',
    }
    const tags = [
      { text: 'Rien ne change', difficulties: ['facile', 'moyen'] },
      { text: 'Énergie −{montant}', effect: 'energie' },
    ]
    const loaded = loadEventContent(
      file([
        card({
          weightByStanding: { behind: 3, ahead: 0 },
          choices: [
            choice('a', { tags, outcomes: [outcome({ effects: [effect] })] }),
            choice('b'),
          ],
        }),
      ]),
    )
    const [event] = loaded.events
    expect(event?.weightByStanding).toEqual({ behind: 3, ahead: 0 })
    expect(event?.choices[0]?.tags).toEqual(tags)
    expect(event?.choices[0]?.outcomes[0]?.effects).toEqual([effect])
  })

  it('a file with no scaling and no adaptive draw', () => {
    const loaded = loadEventContent(file())
    expect(loaded.scaling).toBeUndefined()
    expect(loaded.adaptiveDraw).toBeUndefined()
  })
})

describe('loadEventContent rejects', () => {
  it('an event id used twice', () => {
    rejects(file([card(), card()]), 'the event id grosseCommande appears twice')
  })

  it('a choice id used twice in an event', () => {
    rejects(
      file([card({ choices: [choice('accepter'), choice('accepter')] })]),
      'the choice id accepter appears twice in this event',
    )
  })

  it('the same choice id in two events, which loads', () => {
    const other = card({ id: 'autre' })
    expect(loadEventContent(file([card(), other])).events).toHaveLength(2)
  })

  it.each([[[0.5, 0.4]], [[0.5, 0.6]], [[0.7]]])(
    'outcomes whose chances are %j',
    (chances) => {
      const outcomes = chances.map((chance) => outcome({ chance }))
      rejects(
        file([card({ choices: [choice('a', { outcomes }), choice('b')] })]),
        'the chances of the outcomes must sum to 1',
      )
    },
  )

  it('outcomes whose chances sum to 1 to within a rounding error, which loads', () => {
    const outcomes = [0.1, 0.2, 0.7].map((chance) => outcome({ chance }))
    const loaded = loadEventContent(
      file([card({ choices: [choice('a', { outcomes }), choice('b')] })]),
    )
    expect(loaded.events[0]?.choices[0]?.outcomes).toHaveLength(3)
  })

  it.each([1, 4])('%i choices', (count) => {
    const choices = Array.from({ length: count }, (_, i) => choice(`c${i}`))
    rejects(file([card({ choices })]), '→ at events[0].choices')
  })

  it.each([0, -0.1, 1.5])('an outcome of chance %j', (chance) => {
    rejects(
      file([
        card({
          choices: [
            choice('a', { outcomes: [outcome({ chance })] }),
            choice('b'),
          ],
        }),
      ]),
      '→ at events[0].choices[0].outcomes[0].chance',
    )
  })

  it('a choice with no outcome or no tag', () => {
    rejects(
      file([card({ choices: [choice('a', { outcomes: [] }), choice('b')] })]),
      '→ at events[0].choices[0].outcomes',
    )
    rejects(
      file([card({ choices: [choice('a', { tags: [] }), choice('b')] })]),
      '→ at events[0].choices[0].tags',
    )
  })

  it('a choice remembered of an event the file does not hold, or that it does not have', () => {
    rejects(
      file([
        card({
          conditions: { chosen: [{ event: 'pluie', choice: 'auvent' }] },
        }),
      ]),
      'no event has the id pluie',
      '→ at events[0].conditions.chosen[0]',
    )
    rejects(
      file([
        card({
          conditions: {
            notChosen: [{ event: 'grosseCommande', choice: 'refuser' }],
          },
          choices: [choice('accepter'), choice('payer')],
        }),
      ]),
      'the event grosseCommande has no choice refuser',
      '→ at events[0].conditions.notChosen[0]',
    )
  })

  it('stock bought later at its own unit cost, which the card could not show', () => {
    for (const timing of [{ inDays: 1 }, { onNextWeekday: 4 }]) {
      rejects(
        withEffects({
          kind: 'buyStock',
          product: 'cafe',
          units: 300,
          unitCostCents: 20,
          ...timing,
        }),
        'a purchase at its own unit cost happens now',
      )
    }
  })

  it('a contract signed, or a grocer walking away, on a later day', () => {
    for (const effect of [
      { kind: 'contract', grocer: 'chezNormand' },
      { kind: 'grocerAway', grocer: 'chezNormand', days: 180 },
    ]) {
      for (const timing of [{ inDays: 1 }, { onNextWeekday: 1 }]) {
        rejects(
          withEffects({ ...effect, ...timing }),
          'a contract, or a grocer walking away, happens now',
        )
      }
    }
  })

  it('a contract with a grocer the game does not know, or at no price', () => {
    rejects(
      withEffects({ kind: 'contract', grocer: 'costco' }),
      '→ at events[0].choices[0].outcomes[0].effects[0].grocer',
    )
    rejects(
      withEffects({ kind: 'contract', grocer: 'chezNormand', priceFactor: 0 }),
      '→ at events[0].choices[0].outcomes[0].effects[0].priceFactor',
    )
    rejects(
      withEffects({ kind: 'grocerAway', grocer: 'chezNormand', days: 0 }),
      '→ at events[0].choices[0].outcomes[0].effects[0].days',
    )
    rejects(
      file([card({ conditions: { grocer: 'costco' } })]),
      '→ at events[0].conditions.grocer',
    )
  })

  it('an emergency loan, or a share sale, on a later day', () => {
    for (const effect of [LOAN, SHARES]) {
      for (const timing of [{ inDays: 1 }, { onNextWeekday: 1 }]) {
        rejects(
          withEffects({ ...effect, ...timing }),
          'an emergency loan, or a share sale, happens now',
        )
      }
    }
  })

  it.each<[string, Json, string]>([
    [
      'a loan of no months',
      { ...LOAN, monthsOfFixedCosts: 0 },
      'monthsOfFixedCosts',
    ],
    ['a loan with no cap', { ...LOAN, maxCents: 0 }, 'maxCents'],
    [
      'a loan at a rate below zero',
      { ...LOAN, annualRateBasisPoints: -1 },
      'annualRateBasisPoints',
    ],
    [
      'a loan at a rate that is not whole',
      { ...LOAN, annualRateBasisPoints: 18.5 },
      'annualRateBasisPoints',
    ],
    ['a loan of no term', { ...LOAN, termMonths: 0 }, 'termMonths'],
    [
      'a loan whose fee is more than it lends',
      { ...LOAN, feeShare: 1.5 },
      'feeShare',
    ],
    ['a loan from nobody', { ...LOAN, lender: '' }, 'lender'],
    ['shares sold for nothing', { ...SHARES, amountCents: 0 }, 'amountCents'],
    ['no share of the business', { ...SHARES, share: 0 }, 'share'],
    ['the whole business', { ...SHARES, share: 1 }, 'share'],
    ['shares sold to nobody', { ...SHARES, investor: ' Duvent' }, 'investor'],
  ])('%s', (_, effect, key) => {
    rejects(
      withEffects(effect),
      `→ at events[0].choices[0].outcomes[0].effects[0].${key}`,
    )
  })

  it('a follow-up to an event the file does not hold', () => {
    rejects(
      withEffects({ kind: 'followUp', event: 'chequeDansLaMalle', days: 60 }),
      'no event has the id chequeDansLaMalle',
    )
  })

  it('an effect timed both ways', () => {
    rejects(
      withEffects({ kind: 'energy', amount: -15, inDays: 2, onNextWeekday: 4 }),
      'an effect starts after inDays or onNextWeekday, not both',
    )
  })

  it.each([
    [{ inDays: 0 }, 'inDays'],
    [{ inDays: 1.5 }, 'inDays'],
    [{ onNextWeekday: 0 }, 'onNextWeekday'],
    [{ onNextWeekday: 8 }, 'onNextWeekday'],
  ])('the timing %j', (timing, field) => {
    rejects(
      withEffects({ kind: 'energy', amount: -15, ...timing }),
      `→ at events[0].choices[0].outcomes[0].effects[0].${field}`,
    )
  })

  it.each([
    [{ month: 2, dayOfMonth: 29 }, 'dayOfMonth'],
    [{ month: 2, dayOfMonth: 30 }, 'dayOfMonth'],
    [{ month: 4, dayOfMonth: 31 }, 'dayOfMonth'],
    [{ month: 13, dayOfMonth: 1 }, 'month'],
    [{ month: 6, dayOfMonth: 0 }, 'dayOfMonth'],
  ])('the date %j', (date, field) => {
    rejects(
      file([card({ conditions: { date } })]),
      `→ at events[0].conditions.date.${field}`,
    )
  })

  it.each<[Json, string]>([
    [{ fromDay: -1 }, 'fromDay'],
    [{ difficulties: [] }, 'difficulties'],
    [{ difficulties: ['extreme'] }, 'difficulties[0]'],
    [{ months: [0] }, 'months[0]'],
    [{ weekdays: [8] }, 'weekdays[0]'],
    [{ energyBelow: 101 }, 'energyBelow'],
    [{ cashAboveCents: 12.5 }, 'cashAboveCents'],
    [{ cooldownDays: 0 }, 'cooldownDays'],
    [{ productOnMenu: 'poutine' }, 'productOnMenu'],
    [{ oncePerGame: 'oui' }, 'oncePerGame'],
    [{ maxPerGame: 0 }, 'maxPerGame'],
    [{ chosen: [] }, 'chosen'],
    [{ notChosen: [{ event: 'grosseCommande' }] }, 'notChosen[0].choice'],
    [{ openTomorrow: 1 }, 'openTomorrow'],
  ])('the condition %j', (conditions, field) => {
    rejects(file([card({ conditions })]), `→ at events[0].conditions.${field}`)
  })

  it.each([
    [
      { kind: 'charge', amountCents: 100, description: 'x', account: '6000' },
      'account',
    ],
    [
      { kind: 'charge', amountCents: 100, description: 'x', account: '1000' },
      'account',
    ],
    [{ kind: 'charge', amountCents: 0, description: 'x' }, 'amountCents'],
    [{ kind: 'cashSale', amountCents: 12.5, description: 'x' }, 'amountCents'],
    [
      { kind: 'creditSale', amountCents: 100, client: 'A', dueInDays: 0 },
      'dueInDays',
    ],
    [
      { kind: 'creditSale', amountCents: 100, client: ' ', dueInDays: 5 },
      'client',
    ],
    [{ kind: 'delayReceivable', client: 'A', days: 0 }, 'days'],
    [{ kind: 'buyStock', product: 'poutine', units: 1 }, 'product'],
    [{ kind: 'buyStock', product: 'cafe', units: 0 }, 'units'],
    [
      { kind: 'buyStock', product: 'cafe', units: 1, unitCostCents: 0 },
      'unitCostCents',
    ],
    [{ kind: 'useStock', product: 'cafe', units: 1, to: 'poubelle' }, 'to'],
    [{ kind: 'energy', amount: 0 }, 'amount'],
    [{ kind: 'energy', amount: -101 }, 'amount'],
    [{ kind: 'personal', amountCents: 0, label: 'x' }, 'amountCents'],
    [{ kind: 'followUp', event: 'grosseCommande', days: 0 }, 'days'],
    [
      { kind: 'followUp', event: 'grosseCommande', days: 1, chance: 0 },
      'chance',
    ],
    [{ kind: 'headline', id: 'Mauvais titre' }, 'id'],
    [{ kind: 'lottery' }, 'kind'],
    [{ kind: 'walkIns', factor: 0, days: 15 }, 'factor'],
    [{ kind: 'walkIns', factor: -0.65, days: 15 }, 'factor'],
    [{ kind: 'walkIns', factor: 0.65, days: 0 }, 'days'],
    [{ kind: 'walkIns', factor: 0.65, days: 1.5 }, 'days'],
    [{ kind: 'walkIns', factor: 0.65 }, 'days'],
    [{ kind: 'walkIns', factor: 1.8, segment: 'touriste', days: 2 }, 'segment'],
    [{ kind: 'appeal', product: 'poutine', factor: 0.3, days: 5 }, 'product'],
    [{ kind: 'appeal', product: 'chocolat', factor: 0, days: 5 }, 'factor'],
    [{ kind: 'appeal', factor: 0.3, days: 5 }, 'product'],
    [{ kind: 'willingness', factor: '1.1', days: 1 }, 'factor'],
    [
      { kind: 'willingness', factor: 1.1, segment: 'riche', days: 1 },
      'segment',
    ],
    [{ kind: 'unavailable', product: 'the', days: 4 }, 'product'],
    [{ kind: 'unavailable', product: 'cafe', days: -1 }, 'days'],
    [{ kind: 'closed', days: 0 }, 'days'],
  ])('the effect %j', (effect, field) => {
    rejects(
      withEffects(effect),
      `→ at events[0].choices[0].outcomes[0].effects[0].${field}`,
    )
  })

  it.each([
    ['', 'id'],
    ['GrosseCommande', 'id'],
    ['grosse-commande', 'id'],
  ])('the event id %j', (id, field) => {
    rejects(file([card({ id })]), `→ at events[0].${field}`)
  })

  it('a negative weight', () => {
    rejects(file([card({ weight: -1 })]), '→ at events[0].weight')
  })

  it('a situation over 280 characters', () => {
    const at = (length: number) =>
      file([card({ situation: 'x'.repeat(length) })])
    expect(() => loadEventContent(at(280))).not.toThrow()
    rejects(at(281), '→ at events[0].situation')
  })

  it('a choice label over 45 characters', () => {
    const fits = file([
      card({ choices: [choice('a', { label: 'x'.repeat(45) }), choice('b')] }),
    ])
    expect(() => loadEventContent(fits)).not.toThrow()
    rejects(
      file([
        card({
          choices: [choice('a', { label: 'x'.repeat(46) }), choice('b')],
        }),
      ]),
      '→ at events[0].choices[0].label',
    )
  })

  it('a result over 200 characters', () => {
    const at = (length: number) =>
      file([
        card({
          choices: [
            choice('a', {
              outcomes: [outcome({ result: 'x'.repeat(length) })],
            }),
            choice('b'),
          ],
        }),
      ])
    expect(() => loadEventContent(at(200))).not.toThrow()
    rejects(at(201), '→ at events[0].choices[0].outcomes[0].result')
  })

  it.each([
    ['title', ''],
    ['title', ' La grosse commande'],
    ['situation', 'Il me faut des croissants. '],
    ['quote', ''],
  ])('the %s %j', (field, text) => {
    rejects(file([card({ [field]: text })]), `→ at events[0].${field}`)
  })

  it.each([
    ['in the file', (raw: Json) => ({ ...raw, extra: 1 })],
    [
      'in the pacing',
      (raw: Json) => ({
        ...raw,
        pacing: { ...(raw.pacing as Json), extra: 1 },
      }),
    ],
    ['in an event', (raw: Json) => ({ ...raw, events: [card({ extra: 1 })] })],
    [
      'in the conditions',
      (raw: Json) => ({ ...raw, events: [card({ conditions: { extra: 1 } })] }),
    ],
  ])('a key the game does not know %s', (_, change) => {
    rejects(change(file()), 'Unrecognized key: "extra"')
  })

  it('an effect of no difficulty, or of one the game does not know', () => {
    rejects(
      withEffects({ kind: 'energy', amount: -5, difficulties: [] }),
      '→ at events[0].choices[0].outcomes[0].effects[0].difficulties',
    )
    rejects(
      withEffects({ kind: 'energy', amount: -5, difficulties: ['extreme'] }),
      '→ at events[0].choices[0].outcomes[0].effects[0].difficulties[0]',
    )
  })

  it('a tag showing {montant} without naming its effect', () => {
    rejects(
      file([
        card({
          choices: [
            choice('a', { tags: [{ text: 'Ventes +{montant}' }] }),
            choice('b'),
          ],
        }),
      ]),
      'a tag showing {montant} names its effect',
    )
  })

  it('a tag naming no effect of its choice', () => {
    rejects(
      file([
        card({
          choices: [
            choice('a', {
              tags: [{ text: 'Ventes +{montant}', effect: 'vente' }],
            }),
            choice('b'),
          ],
        }),
      ]),
      'no effect of this choice is named vente',
      '→ at events[0].choices[0].tags[0].effect',
    )
  })

  it('a tag showing the amount of effects of different units, or of none', () => {
    const tagged = (...effects: Json[]) =>
      file([
        card({
          choices: [
            choice('a', {
              tags: [{ text: 'Coûts −{montant}', effect: 'cout' }],
              outcomes: [outcome({ effects })],
            }),
            choice('b'),
          ],
        }),
      ])
    rejects(
      tagged(
        { kind: 'energy', amount: -5, name: 'cout' },
        { kind: 'charge', amountCents: 100, description: 'Taxi', name: 'cout' },
      ),
      'the effects named cout have no amount of one unit to show',
    )
    rejects(
      tagged({ kind: 'closed', days: 1, name: 'cout' }),
      'the effects named cout have no amount of one unit to show',
    )
  })

  it('an amount in a card’s text naming no effect where it looks, or not at every difficulty', () => {
    /** A card with `texts`, its first choice's label `label`. */
    const named = (
      {
        label,
        ...texts
      }: { label?: string; quote?: string; situation?: string },
      effects: Json[] = [],
    ) =>
      file([
        card({
          ...texts,
          choices: [
            choice('a', {
              outcomes: [outcome({ effects })],
              ...(label === undefined ? {} : { label }),
            }),
            choice('b'),
          ],
        }),
      ])
    const sale = {
      kind: 'cashSale',
      amountCents: 67_500,
      description: 'Vente',
      name: 'vente',
    }
    expect(() =>
      loadEventContent(named({ quote: 'Payé {montant:vente}.' }, [sale])),
    ).not.toThrow()
    rejects(
      named({ quote: 'Payé {montant:prix}.' }, [sale]),
      'no effect named prix applies at facile',
      '→ at events[0].quote',
    )
    rejects(
      named({ situation: 'Payé {montant:vente}.' }, [
        { ...sale, difficulties: ['facile', 'moyen'] },
      ]),
      'no effect named vente applies at difficile',
      '→ at events[0].situation',
    )
    rejects(
      named({ label: 'Vendre {montant:vente}' }),
      'no effect named vente applies at facile',
      '→ at events[0].choices[0].label',
    )
  })

  it('an amount in an outcome’s result taken from another outcome', () => {
    const sale = {
      kind: 'cashSale',
      amountCents: 67_500,
      description: 'Vente',
      name: 'vente',
    }
    rejects(
      file([
        card({
          choices: [
            choice('a', {
              outcomes: [
                outcome({ chance: 0.5, effects: [sale] }),
                outcome({ chance: 0.5, result: 'Payé {montant:vente}.' }),
              ],
              tags: ['Risqué'],
            }),
            choice('b'),
          ],
        }),
      ]),
      'no effect named vente applies at facile',
      '→ at events[0].choices[0].outcomes[1].result',
    )
  })

  it('an amount in a card’s text of effects of different units, or written otherwise', () => {
    const effects = [
      { kind: 'energy', amount: -5, name: 'cout' },
      { kind: 'charge', amountCents: 100, description: 'Taxi', name: 'cout' },
    ]
    rejects(
      file([
        card({
          quote: 'Ça coûte {montant:cout}.',
          choices: [
            choice('a', { outcomes: [outcome({ effects })] }),
            choice('b'),
          ],
        }),
      ]),
      'the effects named cout have no amount of one unit to show',
    )
    for (const quote of ['Ça coûte {montant}.', 'Ça coûte {montant:Cout}.']) {
      rejects(
        file([card({ quote })]),
        "a card's text shows an amount as {montant:name}",
        '→ at events[0].quote',
      )
    }
  })

  it('a tag shown at no difficulty, or with a key the game does not know', () => {
    const tagged = (tag: Json) =>
      file([card({ choices: [choice('a', { tags: [tag] }), choice('b')] })])
    rejects(
      tagged({ text: 'Rien', difficulties: [] }),
      '→ at events[0].choices[0].tags[0]',
    )
    rejects(
      tagged({ text: 'Rien', extra: 1 }),
      '→ at events[0].choices[0].tags[0]',
    )
  })

  it('a weight by standing below 0, or of a standing the game does not know', () => {
    rejects(
      file([card({ weightByStanding: { behind: -1 } })]),
      '→ at events[0].weightByStanding.behind',
    )
    rejects(
      file([card({ weightByStanding: { perdu: 1 } })]),
      '→ at events[0].weightByStanding',
    )
  })

  it('a lowest factor above 1, or a difficulty the scaling leaves out', () => {
    const { scaling } = shipped() as { scaling: Json }
    rejects(
      { ...file(), scaling: { ...scaling, lowestFactor: 1.5 } },
      '→ at scaling.lowestFactor',
    )
    rejects(
      {
        ...file(),
        scaling: {
          ...scaling,
          difficulties: { facile: { gains: 1, losses: 1 } },
        },
      },
      '→ at scaling.difficulties',
    )
  })

  it('an adaptive draw whose « en avance » starts below « en difficulté »', () => {
    const { adaptiveDraw } = shipped() as { adaptiveDraw: Json }
    rejects(
      {
        ...file(),
        adaptiveDraw: { ...adaptiveDraw, aheadAbovePercentile: 20 },
      },
      'behindBelowPercentile is at most aheadAbovePercentile',
    )
  })

  it('an effect key the game does not know', () => {
    rejects(
      withEffects({ kind: 'energy', amount: -5, duration: 3 }),
      'Unrecognized key: "duration"',
    )
  })

  it.each([
    [{ firstDay: -1 }, 'firstDay'],
    [{ minDaysBetween: 1.5 }, 'minDaysBetween'],
    [{ dailyChance: 1.2 }, 'dailyChance'],
  ])('the pacing %j', (pacing, field) => {
    const raw = shipped()
    rejects(
      { ...raw, pacing: { ...(raw.pacing as Json), ...pacing } },
      `→ at pacing.${field}`,
    )
  })
})
