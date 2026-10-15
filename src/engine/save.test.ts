import { describe, expect, it } from 'vitest'
import { loadFoodTruckContent } from '../content/schema.ts'
import {
  balance,
  entriesOf,
  postEntry,
  type Journal,
} from '../finance/journal.ts'
import { createInitialState, tick } from './clock.ts'
import { FOOD_TRUCK, playDay } from './day.ts'
import { applyDecision } from './decisions.ts'
import { inventoryValue } from './inventory.ts'
import { cents } from './money.ts'
import { PROFILE_CONTENT } from './profile.ts'
import { SAVE_VERSION, deserialize, serialize } from './save.ts'
import type { GameState, Profile } from './types.ts'

const SEED = 42
const LIMITS = FOOD_TRUCK.decisionLimits

type Json = Record<string, unknown>

function played(days: number, from = createInitialState(SEED)): GameState {
  let state = from
  for (let i = 0; i < days; i += 1) state = tick(state)
  return state
}

function reloaded(state: GameState): GameState {
  return deserialize(serialize(state))
}

const DAY_400 = played(400)

/** A cheaper price for café, waiting for the next morning. */
function withPendingPrice(state: GameState): GameState {
  return applyDecision(state, {
    kind: 'price',
    product: 'cafe',
    price: cents(LIMITS.priceCents.min),
  })
}

// The save the rejection tests break: day 14, the morning after a Sunday
// the truck opened, with two lots on hand, chocolat from day 8 then café
// from day 9.
const FORTNIGHT = played(14)
const SAVED = serialize(FORTNIGHT)
const ENTRIES = entriesOf(FORTNIGHT.journal).length

/**
 * The valid save, parsed, with `change` applied to the object holding the
 * last key of the dotted `path`, as text again.
 */
function edited(
  path: string,
  change: (parent: Json, key: string) => void,
): string {
  const save = JSON.parse(SAVED) as Json
  const keys = path.split('.')
  const key = keys.pop() as string
  const parent = keys.reduce((node, k) => node[k] as Json, save)
  change(parent, key)
  return JSON.stringify(save)
}

function withValue(path: string, value: unknown): string {
  return edited(path, (parent, key) => {
    parent[key] = value
  })
}

/** On an array index, this leaves a hole, which JSON writes as null. */
function without(path: string): string {
  return edited(path, (parent, key) => {
    delete parent[key]
  })
}

/** Expects the load to fail, its message naming each of `reasons`. */
function expectInvalid(
  text: string,
  reasons: readonly string[],
  content = FOOD_TRUCK,
): void {
  let message: string | undefined
  try {
    deserialize(text, content)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    message = error.message
  }
  expect(message, 'the save loaded').toBeDefined()
  expect(message).toMatch(/^Invalid save:/)
  for (const reason of reasons) expect(message).toContain(reason)
}

describe('serialize and deserialize', () => {
  it('write the current save version', () => {
    expect(SAVE_VERSION).toBe(3)
    expect(JSON.parse(serialize(DAY_400))).toMatchObject({ saveVersion: 3 })
  })

  it.each<Profile>([
    { businessName: 'Café Facile', avatar: 'femme', difficulty: 'facile' },
    { businessName: "Le P'tit Camion", avatar: 'homme', difficulty: 'moyen' },
    { businessName: 'Chez Mimi 🥐', avatar: 'femme', difficulty: 'difficile' },
  ])('give back the profile of a $difficulty game', (profile) => {
    const game = played(20, createInitialState(SEED, FOOD_TRUCK, profile))
    const back = reloaded(game)
    expect(back.profile).toStrictEqual(profile)
    expect(back).toStrictEqual(game)
  })

  it('give back the state after 400 days', () => {
    expect(reloaded(DAY_400)).toStrictEqual(DAY_400)
  })

  it('give back the state on day 0, before any day is played', () => {
    const start = createInitialState(SEED)
    expect(reloaded(start)).toStrictEqual(start)
  })

  it('give back decisions waiting for the next morning', () => {
    const pending = withPendingPrice(DAY_400)
    expect(pending.pendingDecisions).not.toBeNull()
    expect(reloaded(pending)).toStrictEqual(pending)
  })

  it('give back a state at the close of its day', () => {
    const closed = playDay(DAY_400)
    expect(closed.lastDay?.day).toBe(closed.day)
    expect(reloaded(closed)).toStrictEqual(closed)
  })

  it('load a save that continues as if the game had never stopped', () => {
    const resumed = played(30, reloaded(DAY_400))
    const uninterrupted = played(30, DAY_400)
    // The bytes tools/sim's journalHash hashes.
    expect(JSON.stringify(entriesOf(resumed.journal))).toBe(
      JSON.stringify(entriesOf(uninterrupted.journal)),
    )
    expect(resumed).toStrictEqual(uninterrupted)
  })

  it('load pending decisions that take effect the next morning', () => {
    const pending = withPendingPrice(DAY_400)
    const resumed = played(30, reloaded(pending))
    const uninterrupted = played(30, pending)
    expect(resumed.decisions.prices.cafe).toBe(LIMITS.priceCents.min)
    expect(JSON.stringify(entriesOf(resumed.journal))).toBe(
      JSON.stringify(entriesOf(uninterrupted.journal)),
    )
    expect(resumed).toStrictEqual(uninterrupted)
  })

  it('load books the finance functions accept, frozen', () => {
    const { journal, day } = reloaded(DAY_400)
    expect(Object.isFrozen(journal)).toBe(true)
    expect(Object.isFrozen(entriesOf(journal))).toBe(true)
    expect(Object.isFrozen(entriesOf(journal)[0])).toBe(true)
    expect(balance(journal, '1000', { toDay: day })).toBe(
      balance(DAY_400.journal, '1000', { toDay: day }),
    )
    const posted = postEntry(journal, {
      day,
      memo: 'Test',
      lines: [
        { account: '1000', debit: cents(100), credit: cents(0) },
        { account: '3000', debit: cents(0), credit: cents(100) },
      ],
    })
    expect(entriesOf(posted)).toHaveLength(entriesOf(journal).length + 1)
  })

  it('refuse to save a journal postEntry() did not make', () => {
    const forged = [
      { ...DAY_400.journal },
      { entries: [...DAY_400.journal.entries] },
    ] as unknown as Journal[]
    for (const journal of forged) {
      expect(() => serialize({ ...DAY_400, journal })).toThrow(TypeError)
    }
  })
})

describe('deserialize rejects', () => {
  it.each(['', 'not json {', '{"day":', '{"day": 1,}'])(
    'malformed JSON: %j',
    (text) => {
      expectInvalid(text, ['Invalid save: not JSON'])
    },
  )

  it.each(['null', '[]', '42', '"save"', 'true'])('JSON that is %s', (text) => {
    expectInvalid(text, ['Invalid save: not a saved game'])
  })

  it('a save without its version', () => {
    expectInvalid(without('saveVersion'), ['unsupported saveVersion undefined'])
  })

  it.each([0, 1, 4, '3', null])('saveVersion %j', (version) => {
    expectInvalid(withValue('saveVersion', version), [
      `unsupported saveVersion ${JSON.stringify(version)}`,
    ])
  })

  describe('a key the game does not know', () => {
    it('in the save', () => {
      expectInvalid(withValue('cheat', 1), ['Unrecognized key: "cheat"'])
    })

    it.each([
      ['a lot', 'inventory.0.free', 'inventory[0]'],
      ['an entry', 'journal.1.approved', 'journal[1]'],
      ['a line', 'journal.1.lines.0.note', 'journal[1].lines[0]'],
      ['the last day', 'lastDay.profit', 'lastDay'],
      ['a visit', 'lastDay.visits.0.tip', 'lastDay.visits[0]'],
      ['the decisions', 'decisions.discount', 'decisions'],
      ['the prices', 'decisions.prices.poutine', 'decisions.prices'],
      ['the profile', 'profile.level', 'profile'],
    ])('in %s', (_, path, at) => {
      const key = path.split('.').at(-1)
      expectInvalid(withValue(path, 1), [
        `Unrecognized key: "${key}"\n  → at ${at}`,
      ])
    })

    it('__proto__', () => {
      const text = SAVED.replace(/^\{/, '{"__proto__":{"day":0},')
      expectInvalid(text, ['Unrecognized key: "__proto__"'])
    })
  })

  it.each([
    'day',
    'seed',
    'rngState',
    'journal',
    'inventory',
    'lastDay',
    'decisions',
    'pendingDecisions',
    'profile',
    'profile.businessName',
    'profile.avatar',
    'profile.difficulty',
    'journal.1.memo',
    'inventory.0.unitCost',
    'lastDay.segments.chic',
    'decisions.prices.croissant',
  ])('a save missing %s', (path) => {
    const at = path.replace(/\.(\d+)/g, '[$1]')
    expectInvalid(without(path), [`→ at ${at}`])
  })

  describe('a journal', () => {
    it('with a sparse lines array', () => {
      expectInvalid(without('journal.1.lines.0'), [
        'expected object, received null',
        '→ at journal[1].lines[0]',
      ])
    })

    it.each([42, { text: 'Ventes' }, null])('with the memo %j', (memo) => {
      expectInvalid(withValue('journal.1.memo', memo), [
        'expected string',
        '→ at journal[1].memo',
      ])
    })

    it('with an unbalanced entry', () => {
      const debit = FORTNIGHT.journal.entries[0]?.lines[0]?.debit ?? 0
      expectInvalid(withValue('journal.0.lines.0.debit', debit + 1), [
        'journal entry 1: Cannot post "Mise de fonds" on day 0',
        'do not equal credits',
      ])
    })

    it('with a line on both sides', () => {
      expectInvalid(withValue('journal.0.lines.0.credit', 5), [
        'journal entry 1:',
        'line 1: both a debit and a credit',
      ])
    })

    it('with a line of no amount', () => {
      expectInvalid(withValue('journal.0.lines.0.debit', 0), [
        'journal entry 1:',
        'line 1: no amount',
      ])
    })

    it.each(['9999', 1000, null])('with the account %j', (account) => {
      expectInvalid(withValue('journal.0.lines.0.account', account), [
        'unknown account',
        '→ at journal[0].lines[0].account',
      ])
    })

    it('whose days go down', () => {
      expectInvalid(withValue(`journal.${ENTRIES - 1}.day`, 0), [
        `journal entry ${ENTRIES}:`,
        'the last entry is on day 13',
      ])
    })

    it('with an entry dated after the save', () => {
      expectInvalid(withValue(`journal.${ENTRIES - 1}.day`, 15), [
        `journal entry ${ENTRIES} is on day 15, after day 14`,
      ])
    })

    it('with an entry of no lines', () => {
      expectInvalid(withValue('journal.0.lines', []), [
        'Too small',
        '→ at journal[0].lines',
      ])
    })

    it.each([12.5, -100, '100', Number.MAX_SAFE_INTEGER + 1])(
      'with the amount %j',
      (amount) => {
        expectInvalid(withValue('journal.0.lines.0.debit', amount), [
          '→ at journal[0].lines[0].debit',
        ])
      },
    )

    // Each entry is in range; their sums are not.
    const huge = {
      day: 14,
      memo: 'Test',
      lines: [
        { account: '1500', debit: Number.MAX_SAFE_INTEGER, credit: 0 },
        { account: '2500', debit: 0, credit: Number.MAX_SAFE_INTEGER },
      ],
    }

    it('whose balances leave the safe integer range', () => {
      const text = edited('journal', (save, key) => {
        save[key] = [...(save[key] as unknown[]), huge, huge]
      })
      expectInvalid(text, ['the books: Not a whole number of cents'])
    })

    it('whose debit column leaves the safe integer range', () => {
      const text = edited('journal', (save, key) => {
        save[key] = [...(save[key] as unknown[]), huge]
      })
      expectInvalid(text, ['the books: Not a whole number of cents'])
    })
  })

  describe('an inventory', () => {
    it('with an unknown product', () => {
      expectInvalid(withValue('inventory.0.product', 'poutine'), [
        '→ at inventory[0].product',
      ])
    })

    it.each([0, -1, 1.5, '24', null])('with the quantity %j', (quantity) => {
      expectInvalid(withValue('inventory.0.quantity', quantity), [
        '→ at inventory[0].quantity',
      ])
    })

    it('with a lot bought after the save', () => {
      expectInvalid(withValue('inventory.1.boughtOnDay', 15), [
        'lot 2 was bought on day 15, after day 14',
      ])
    })

    it('whose lots are not oldest first', () => {
      expectInvalid(withValue('inventory.0.boughtOnDay', 10), [
        'lot 2 is older than the lot before it: day 9 < day 10',
      ])
    })

    it('that costs more than the Stocks account carries', () => {
      const stocks = inventoryValue(FORTNIGHT.inventory)
      const unitCost = FORTNIGHT.inventory[0]?.unitCost ?? 0
      const quantity = FORTNIGHT.inventory[0]?.quantity ?? 0
      expectInvalid(withValue('inventory.0.quantity', quantity + 1), [
        `the Stocks balance of ${stocks} does not equal the lots' cost of ${stocks + unitCost}`,
      ])
    })

    it('that is gone while the Stocks account still carries it', () => {
      expect(FORTNIGHT.inventory.length).toBeGreaterThan(0)
      expectInvalid(withValue('inventory', []), [
        "does not equal the lots' cost of 0",
      ])
    })

    it('whose cost leaves the safe integer range', () => {
      expectInvalid(withValue('inventory.0.quantity', 2 ** 52), [
        'the lots: Not a whole number of cents',
      ])
    })
  })

  describe('a generator or a day', () => {
    it.each([-1, 2 ** 32, 1.5, '7', null])('rngState %j', (state) => {
      expectInvalid(withValue('rngState', state), ['→ at rngState'])
    })

    it.each([-1, 2 ** 32, 1.5, '7', null])('seed %j', (seed) => {
      expectInvalid(withValue('seed', seed), ['→ at seed'])
    })

    it('a generator state out of range, named as such', () => {
      expectInvalid(withValue('rngState', 2 ** 32), [
        'expected an integer in [0, 2^32)',
      ])
    })

    it.each([-1, 1.5, '14'])('day %j', (day) => {
      expectInvalid(withValue('day', day), ['→ at day'])
    })
  })

  describe('a last day', () => {
    it('that is neither the save day nor the day before', () => {
      expectInvalid(withValue('lastDay.day', 5), ['lastDay is day 5 on day 14'])
      expectInvalid(withValue('day', 20), ['lastDay is day 13 on day 20'])
    })

    it('that is missing after day 0', () => {
      expectInvalid(withValue('lastDay', null), ['lastDay is null on day 14'])
    })

    it('with a visit that ends in an unknown way', () => {
      expectInvalid(withValue('lastDay.visits.0.outcome', 'stole'), [
        '→ at lastDay.visits[0].outcome',
      ])
    })

    it('with a visit after midnight', () => {
      expectInvalid(withValue('lastDay.visits.0.arrivalMinute', 1441), [
        '→ at lastDay.visits[0].arrivalMinute',
      ])
    })
  })

  describe('decisions', () => {
    const { step, max } = LIMITS.priceCents

    it('with a price off the step', () => {
      const price = FORTNIGHT.decisions.prices.cafe + 1
      expectInvalid(withValue('decisions.prices.cafe', price), [
        `decisions: Invalid decision: prices.cafe must be a multiple of ${step}`,
      ])
    })

    it('with a price out of range', () => {
      expectInvalid(withValue('decisions.prices.cafe', max + step), [
        'decisions: Invalid decision: prices.cafe must be a whole number',
      ])
    })

    it.each([[[3, 2]], [[2, 2, 3]], [[0, 1]], [[7, 8]], [[]]])(
      'open on the weekdays %j',
      (daysOpen) => {
        expectInvalid(withValue('decisions.daysOpen', daysOpen), [
          'decisions: Invalid decision: daysOpen',
        ])
      },
    )

    it('that change a product to another kind of restock rule', () => {
      expectInvalid(
        withValue('decisions.restock.croissant', {
          kind: 'topUp',
          whenBelow: 10,
          upTo: 70,
        }),
        ['decisions.restock.croissant must be a buyDaily rule: topUp'],
      )
    })

    it('with a restock rule that tops up below more than it buys up to', () => {
      expectInvalid(withValue('decisions.restock.cafe.whenBelow', 400), [
        'decisions: Invalid decision: restock.cafe.whenBelow must not exceed upTo',
      ])
    })

    it('with an unknown kind of restock rule', () => {
      expectInvalid(withValue('decisions.restock.cafe.kind', 'steal'), [
        '→ at decisions.restock.cafe.kind',
      ])
    })

    it('pending for the next morning, held to the same limits', () => {
      const pending = { ...FORTNIGHT.decisions, marketingDaily: -1 }
      expectInvalid(withValue('pendingDecisions', pending), [
        '→ at pendingDecisions.marketingDaily',
      ])
      const offStep = {
        ...FORTNIGHT.decisions,
        prices: { ...FORTNIGHT.decisions.prices, chocolat: 351 },
      }
      expectInvalid(withValue('pendingDecisions', offStep), [
        'pendingDecisions: Invalid decision: prices.chocolat',
      ])
      const otherKind = {
        ...FORTNIGHT.decisions,
        restock: {
          ...FORTNIGHT.decisions.restock,
          cafe: { kind: 'buyDaily', quantity: 100 },
        },
      }
      expectInvalid(withValue('pendingDecisions', otherKind), [
        'pendingDecisions.restock.cafe must be a topUp rule: buyDaily',
      ])
    })

    it('outside the limits of the content it loads with', () => {
      const narrowed = loadFoodTruckContent({
        ...FOOD_TRUCK,
        decisionLimits: {
          ...LIMITS,
          priceCents: { ...LIMITS.priceCents, max: LIMITS.priceCents.min },
        },
      })
      expectInvalid(
        SAVED,
        ['decisions: Invalid decision: prices.cafe must be a whole number'],
        narrowed,
      )
    })
  })

  it('a game saved before the real costs, as version 2', () => {
    // Its books hold no truck and no loan, so it cannot play on under the
    // rules of version 3.
    expectInvalid(withValue('saveVersion', 2), ['unsupported saveVersion 2'])
  })

  describe('a profile', () => {
    it('saved before the profile, as version 1', () => {
      const text = edited('profile', (save, key) => {
        delete save[key]
        save.saveVersion = 1
      })
      expectInvalid(text, ['unsupported saveVersion 1'])
    })

    it.each([
      ['avatar', 'robot'],
      ['avatar', null],
      ['difficulty', 'extreme'],
      ['difficulty', 2],
    ])('with the %s %j', (field, value) => {
      expectInvalid(withValue(`profile.${field}`, value), [
        `→ at profile.${field}`,
      ])
    })

    it.each([42, null])('with the business name %j', (name) => {
      expectInvalid(withValue('profile.businessName', name), [
        'expected string',
        '→ at profile.businessName',
      ])
    })

    const max = PROFILE_CONTENT.businessNameMaxLength

    it.each([
      ['', `must hold 1 to ${max} characters: 0`],
      ['x'.repeat(max + 1), `must hold 1 to ${max} characters: ${max + 1}`],
      [' Chez Mimi', 'must not start or end with a space'],
      ['Chez\nMimi', 'must not hold a control character'],
    ])('with the business name %j', (name, reason) => {
      expectInvalid(withValue('profile.businessName', name), [
        `profile: Invalid profile: businessName ${reason}`,
      ])
    })
  })
})
