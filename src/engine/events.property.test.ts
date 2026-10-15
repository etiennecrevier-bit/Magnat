import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  difficultyIdSchema,
  loadEventContent,
  type EventCard,
  type EventContent,
  type ProductId,
} from '../content/schema.ts'
import { balance } from '../finance/journal.ts'
import { toCalendar } from './calendar.ts'
import { createInitialState } from './clock.ts'
import { FOOD_TRUCK } from './day.ts'
import { applyDecision, latestDecisions } from './decisions.ts'
import { startOfDay } from './effects.ts'
import { drawEvent, resolveEvent } from './events.ts'
import { PRODUCTS } from './inventory.ts'
import { int, seedRng } from './rng.ts'
import { defaultProfile } from './profile.ts'
import type { Day, GameState } from './types.ts'

// Conditions, cooldowns and the gap hold over ten years of mornings: random
// event lists with random conditions and pacing, drawn every morning with
// the owner's energy moving from one day to the next, each choice made at
// random. Every event that comes up is checked against the rules, written
// out here apart from the engine; with a daily chance of 1, so is every
// morning that brings none. The days are not played, only their mornings,
// so ten years stay cheap.

const DAYS = 3650
const NUM_RUNS = 50
/** Games of the fixed sample that checks every rule is put to the test. */
const SAMPLED = 100
const IDS = ['e0', 'e1', 'e2', 'e3'] as const

// Every condition a card may set; each card keeps up to two of them, so
// most cards still come up now and then.
const conditionValues = fc.record({
  fromDay: fc.constantFrom(0, 45, 120, 400),
  difficulties: fc.constantFrom(
    ['facile'],
    ['moyen'],
    ['difficile'],
    ['facile', 'difficile'],
  ),
  months: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), {
    minLength: 1,
    maxLength: 8,
  }),
  date: fc.constantFrom(
    { month: 6, dayOfMonth: 30 },
    { month: 12, dayOfMonth: 25 },
    { month: 5, dayOfMonth: 15 },
  ),
  weekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), {
    minLength: 1,
    maxLength: 6,
  }),
  energyBelow: fc.integer({ min: 10, max: 100 }),
  // Around what the three difficulties start with in Encaisse.
  cashAboveCents: fc.constantFrom(-1_000_000, 500_000, 1_500_000, 3_000_000),
  cashBelowCents: fc.constantFrom(0, 1_000_000, 2_000_000, 4_000_000),
  oncePerGame: fc.boolean(),
  cooldownDays: fc.integer({ min: 1, max: 120 }),
  productOnMenu: fc.constantFrom('cafe', 'chocolat', 'croissant'),
  followUpOnly: fc.boolean(),
})

type ConditionKey = keyof (typeof conditionValues extends fc.Arbitrary<infer T>
  ? T
  : never)

const CONDITION_KEYS: readonly ConditionKey[] = [
  'fromDay',
  'difficulties',
  'months',
  'date',
  'weekdays',
  'energyBelow',
  'cashAboveCents',
  'cashBelowCents',
  'oncePerGame',
  'cooldownDays',
  'productOnMenu',
  'followUpOnly',
]

const condition = fc
  .tuple(
    conditionValues,
    fc.uniqueArray(fc.constantFrom(...CONDITION_KEYS), {
      minLength: 1,
      maxLength: 2,
    }),
  )
  .map(([values, keys]) =>
    Object.fromEntries(keys.map((key) => [key, values[key]])),
  )

const effect = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('followUp'),
      event: fc.constantFrom(...IDS),
      days: fc.integer({ min: 1, max: 40 }),
      chance: fc.constantFrom(0.5, 1),
    }),
  },
  fc.record({
    kind: fc.constant('energy'),
    amount: fc.integer({ min: -30, max: 30 }).filter((n) => n !== 0),
  }),
  fc.record({
    kind: fc.constant('charge'),
    amountCents: fc.integer({ min: 1, max: 100_000 }),
    description: fc.constant('Charge'),
  }),
  fc.record({
    kind: fc.constant('cashSale'),
    amountCents: fc.integer({ min: 1, max: 100_000 }),
    description: fc.constant('Vente'),
  }),
  fc.record({
    kind: fc.constant('walkIns'),
    factor: fc.constantFrom(0.65, 1.8),
    days: fc.integer({ min: 1, max: 20 }),
  }),
  fc.record({
    kind: fc.constant('unavailable'),
    product: fc.constantFrom(...PRODUCTS),
    days: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({ kind: fc.constant('closed'), days: fc.constant(1) }),
)

const timedEffect = fc
  .tuple(effect, fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }))
  .map(([made, inDays]) => (inDays === undefined ? made : { ...made, inDays }))

const event = (id: string) =>
  fc
    .record({
      weight: fc.oneof(
        { weight: 1, arbitrary: fc.constant(0) },
        { weight: 4, arbitrary: fc.integer({ min: 1, max: 5 }) },
      ),
      conditions: fc.option(condition, { nil: undefined }),
      effects: fc.array(timedEffect, { maxLength: 3 }),
    })
    .map(({ weight, conditions, effects }) => ({
      id,
      weight,
      character: { id: 'personne', name: 'Personne', role: 'Rôle' },
      title: 'Titre',
      situation: 'Situation.',
      ...(conditions === undefined ? {} : { conditions }),
      choices: [
        {
          id: 'agir',
          label: 'Agir',
          tags: ['Risqué'],
          outcomes: [
            { chance: 0.5, result: 'Un.', effects },
            { chance: 0.5, result: 'Deux.', effects: [] },
          ],
        },
        {
          id: 'attendre',
          label: 'Attendre',
          tags: ['Rien ne change'],
          outcomes: [{ chance: 1, result: 'Rien.', effects: [] }],
        },
      ],
    }))

const game = fc.record({
  pacing: fc.record({
    firstDay: fc.integer({ min: 0, max: 30 }),
    minDaysBetween: fc.integer({ min: 0, max: 15 }),
    dailyChance: fc.constantFrom(0.15, 0.5, 1, 1),
  }),
  count: fc.integer({ min: 1, max: IDS.length }),
  events: fc.tuple(...IDS.map(event)),
  seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
  difficulty: fc.constantFrom(...difficultyIdSchema.options),
  /** The product the truck stops buying. */
  offMenu: fc.constantFrom(...PRODUCTS),
})

type Game = typeof game extends fc.Arbitrary<infer T> ? T : never

/**
 * The rules that keep `card` from coming up on the morning of `state.day`,
 * by name, written apart from the engine: none when it may come up. `seen`
 * holds the last day each event came up, follow-ups included.
 */
function heldBackBy(
  card: EventCard,
  state: GameState,
  seen: ReadonlyMap<string, Day>,
): string[] {
  const c = card.conditions ?? {}
  const { month, dayOfMonth, weekday } = toCalendar(state.day)
  const last = seen.get(card.id)
  const cash = balance(state.journal, '1000', { toDay: state.day })
  const onMenu = (product: ProductId) => {
    const rule = state.decisions.restock[product]
    return rule.kind === 'buyDaily' ? rule.quantity > 0 : rule.upTo > 0
  }
  const rules: Record<string, boolean> = {
    weight: card.weight > 0,
    followUpOnly: c.followUpOnly !== true,
    fromDay: c.fromDay === undefined || state.day >= c.fromDay,
    difficulties: c.difficulties?.includes(state.profile.difficulty) ?? true,
    months: c.months?.includes(month) ?? true,
    date:
      c.date === undefined ||
      (c.date.month === month && c.date.dayOfMonth === dayOfMonth),
    weekdays: c.weekdays?.includes(weekday) ?? true,
    energyBelow: c.energyBelow === undefined || state.energy < c.energyBelow,
    cashAboveCents: c.cashAboveCents === undefined || cash > c.cashAboveCents,
    cashBelowCents: c.cashBelowCents === undefined || cash < c.cashBelowCents,
    oncePerGame: c.oncePerGame !== true || last === undefined,
    cooldownDays:
      c.cooldownDays === undefined ||
      last === undefined ||
      state.day - last >= c.cooldownDays,
    productOnMenu: c.productOnMenu === undefined || onMenu(c.productOnMenu),
  }
  return Object.keys(rules).filter((rule) => !rules[rule])
}

/** Every rule `heldBackBy` checks. */
const RULES = [
  'weight',
  'followUpOnly',
  ...CONDITION_KEYS.filter((key) => key !== 'followUpOnly'),
]

/** What the mornings of some games brought, across them. */
interface Tally {
  drawn: number
  followUps: number
  /**
   * For each rule, the cards it alone held back on a morning with a sure
   * draw, which may have brought them otherwise.
   */
  heldBack: Map<string, number>
}

/**
 * Walks `DAYS` mornings of `played`: each morning the owner's energy moves,
 * the event, if any, is drawn and checked against the rules, the player
 * makes a choice at random, and the start of the day runs what the choices
 * queued for it. Counts what it saw in `tally`.
 */
function walk(
  { pacing, count, events, seed, difficulty, offMenu }: Game,
  tally: Tally,
): void {
  const content: EventContent = loadEventContent({
    pacing,
    events: events.slice(0, count).map((made) => ({
      ...made,
      choices: made.choices.map((choice) => ({
        ...choice,
        outcomes: choice.outcomes.map((outcome) => ({
          ...outcome,
          // Follow-ups only to events of the list.
          effects: outcome.effects.filter(
            (e) =>
              e.kind !== 'followUp' ||
              IDS.indexOf(e.event as (typeof IDS)[number]) < count,
          ),
        })),
      })),
    })),
  })
  const cards = new Map(content.events.map((card) => [card.id, card]))

  let state = createInitialState(seed, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
  const { kind } = state.decisions.restock[offMenu]
  state = applyDecision(state, {
    kind: 'restock',
    product: offMenu,
    rule:
      kind === 'buyDaily'
        ? { kind, quantity: 0 }
        : { kind, whenBelow: 0, upTo: 0 },
  })
  state = { ...state, decisions: latestDecisions(state) }
  // The owner's energy and the choices come from a stream of their own, so
  // they never touch the game's generator.
  let stream = seedRng(seed)
  const draw = (min: number, max: number) => {
    const [value, after] = int(stream, min, max)
    stream = after
    return value
  }
  const seen = new Map<string, Day>()
  const cameUp: [string, Day][] = []
  let lastDrawn: Day | null = null

  for (let day = 1; day < DAYS; day += 1) {
    const morning: GameState = { ...state, day, energy: draw(0, 100) }
    const drawn = drawEvent(morning, content)
    const { pending } = drawn.events
    const due = morning.events.followUps.find(
      (followUp) => followUp.day <= day && cards.has(followUp.event),
    )
    const open =
      day >= pacing.firstDay &&
      (lastDrawn === null || day - lastDrawn >= pacing.minDaysBetween)

    if (due !== undefined) {
      // The first follow-up due comes up, whatever the rest, and leaves the
      // gap where it was.
      expect(pending).toEqual({ event: due.event, followUp: true })
      expect(drawn.events.lastDrawnDay).toBe(lastDrawn)
      tally.followUps += 1
    } else if (pending !== null) {
      const card = cards.get(pending.event)
      expect(pending.followUp).toBe(false)
      expect(open, `a draw on day ${day}`).toBe(true)
      if (card !== undefined) {
        expect(
          heldBackBy(card, morning, seen),
          `${card.id}, day ${day}`,
        ).toEqual([])
      }
      expect(drawn.events.lastDrawnDay).toBe(day)
      lastDrawn = day
      tally.drawn += 1
    } else if (pacing.dailyChance === 1 && open) {
      // A sure chance: nothing came up only when nothing could.
      for (const card of content.events) {
        expect(
          heldBackBy(card, morning, seen),
          `${card.id}, day ${day}`,
        ).not.toEqual([])
      }
    }
    if (due === undefined && pacing.dailyChance === 1 && open) {
      // A card one rule alone holds back on a morning with a sure draw:
      // the draw would bring it now and then if the engine missed the rule.
      for (const card of content.events) {
        const [only, ...others] = heldBackBy(card, morning, seen)
        if (only !== undefined && others.length === 0) {
          tally.heldBack.set(only, (tally.heldBack.get(only) ?? 0) + 1)
        }
      }
    }

    state = drawn
    if (pending !== null) {
      seen.set(pending.event, day)
      cameUp.push([pending.event, day])
      const choice = draw(0, 3) === 0 ? 'attendre' : 'agir'
      state = resolveEvent(state, choice, content, FOOD_TRUCK)
      expect(state.events.pending).toBeNull()
    }
    state = startOfDay(state, FOOD_TRUCK)
  }
  expect(state.events.history.map(({ event, day }) => [event, day])).toEqual(
    cameUp,
  )
  // No day is played, so no change to the street ever ends: each one made
  // is there, in the order made, from an event that came up by its day.
  const firstSeen = new Map<string, Day>()
  for (const [event, day] of cameUp) {
    if (!firstSeen.has(event)) firstSeen.set(event, day)
  }
  let before = 0
  for (const { event, fromDay, lastDay } of state.events.modifiers) {
    expect(fromDay).toBeGreaterThanOrEqual(before)
    expect(lastDay).toBeGreaterThanOrEqual(fromDay)
    expect(firstSeen.get(event) ?? DAYS).toBeLessThanOrEqual(fromDay)
    before = fromDay
  }
}

function emptyTally(): Tally {
  return { drawn: 0, followUps: 0, heldBack: new Map() }
}

describe('event cards over ten years', () => {
  it('come up only as their conditions, cooldowns, follow-ups and the gap allow', () => {
    const tally = emptyTally()
    fc.assert(
      fc.property(game, (played) => walk(played, tally)),
      { numRuns: NUM_RUNS },
    )
  }, 120_000)

  it('are put to every rule, on a fixed sample of games', () => {
    // So the property above cannot pass by drawing nothing, nor without each
    // rule alone holding a card back on mornings a sure draw would bring it.
    const tally = emptyTally()
    for (const played of fc.sample(game, { numRuns: SAMPLED, seed: 42 })) {
      walk(played, tally)
    }
    expect(tally.drawn).toBeGreaterThan(SAMPLED * 20)
    expect(tally.followUps).toBeGreaterThan(SAMPLED * 5)
    expect(
      Object.fromEntries(RULES.map((rule) => [rule, tally.heldBack.has(rule)])),
    ).toEqual(Object.fromEntries(RULES.map((rule) => [rule, true])))
  }, 120_000)
})
