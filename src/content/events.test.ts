import { describe, expect, it } from 'vitest'
import eventsJson from './events.json'
import { eventEffectSchema, loadEventContent } from './schema.ts'

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

  it('holds the essai card, then the twelve cards of issue #93 in order', () => {
    expect(content.events.map(({ id }) => id)).toEqual(['essai', ...CARDS])
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

  it('names the characters by the ids of their portraits in issue #95', () => {
    const characters = new Set(
      content.events.slice(1).map(({ character }) => character.id),
    )
    expect([...characters].sort()).toEqual([...PORTRAITS].sort())
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
