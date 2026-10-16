import { describe, expect, it } from 'vitest'
import eventsJson from './events.json'
import {
  eventEffectSchema,
  loadEventContent,
  type DifficultyId,
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

/** The characters of issue #137, who have no portrait yet. */
const WITHOUT_PORTRAITS = [
  'mmeOuellette',
  'rosaireGagnon',
  'stevieDuvent',
  'ginettePelletier',
]

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
 * truck closed or a product it cannot sell, stock given away, or a client
 * who pays late or never.
 */
function costs(effect: TimedEventEffect): boolean {
  switch (effect.kind) {
    case 'charge':
    case 'closed':
    case 'unavailable':
    case 'delayReceivable':
    case 'writeOff':
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
      return effect.to === 'giveaway'
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

  it('paces events as the issue says: from day 7, 5 days apart, 15 % a morning', () => {
    expect(content.pacing).toEqual({
      firstDay: 7,
      minDaysBetween: 5,
      dailyChance: 0.15,
    })
  })

  it('holds the essai card, which never comes up in a real game', () => {
    const essai = content.events.find(({ id }) => id === 'essai')
    expect(essai?.weight).toBe(0)
  })

  it('holds the essai card, the twelve cards of issue #93, then the four of #137, in order', () => {
    expect(content.events.map(({ id }) => id)).toEqual([
      'essai',
      ...CARDS,
      ...STANDING_CARDS,
    ])
  })

  it('may draw every card but essai, unless it only comes as a follow-up', () => {
    for (const { id, weight, conditions } of content.events.slice(1)) {
      if (conditions?.followUpOnly !== true)
        expect(weight, id).toBeGreaterThan(0)
    }
  })

  it('brings each follow-up-only card as the follow-up of another, and only those', () => {
    const followUps = new Set(
      content.events.flatMap(({ choices }) =>
        choices.flatMap(({ outcomes }) =>
          outcomes.flatMap(({ effects }) =>
            effects.flatMap((effect) =>
              effect.kind === 'followUp' && effect.event !== 'essai'
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
    expect([...followUps]).toEqual(followUpOnly)
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

  it('scales the cards by difficulty from the starting values of #137', () => {
    expect(content.scaling).toEqual({
      _note: expect.any(String),
      lowestFactor: 0.1,
      difficulties: {
        facile: { gains: 1, losses: 0.7 },
        moyen: { gains: 1.3, losses: 1.3 },
        difficile: { gains: 0.7, losses: 1.2 },
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

  it('writes no amount into a tag by hand: the effect it names gives it', () => {
    const typed = content.events.flatMap(({ id, choices }) =>
      choices.flatMap(({ id: choice, tags }) =>
        tags
          .map((tag) => (typeof tag === 'string' ? tag : tag.text))
          .filter((text) => /\d\s*[$%]|Énergie [+−]\d/.test(text))
          .map((text) => `${id}, ${choice}: ${text}`),
      ),
    )
    expect(typed).toEqual([])
  })

  it('names the characters by the ids of their portraits in issue #95, or of #137', () => {
    const characters = new Set(
      content.events.slice(1).map(({ character }) => character.id),
    )
    expect([...characters].sort()).toEqual(
      [...PORTRAITS, ...WITHOUT_PORTRAITS].sort(),
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
      cooldownDays: 60,
      productOnMenu: 'chocolat',
      followUpOnly: false,
    }
    const loaded = loadEventContent(file([card({ conditions })]))
    expect(loaded.events[0]?.conditions).toEqual(conditions)
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
