import { describe, expect, it } from 'vitest'
import type {
  EventContent,
  ProductId,
  StreetChange,
} from '../content/schema.ts'
import { createInitialState, tick, toCalendar } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
  playDay,
} from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { resolveEvent } from '../engine/events.ts'
import { PRODUCTS, onHand } from '../engine/inventory.ts'
import { cents } from '../engine/money.ts'
import { MODIFIER_KINDS } from '../engine/street.ts'
import type {
  DelayedEffect,
  EventRecord,
  GameState,
  StreetModifier,
} from '../engine/types.ts'
import { ASSETS } from './manifest.ts'
import {
  type ChosenModifier,
  chosenModifiers,
  modifiersToday,
  openingStock,
  opensToday,
  rackFill,
  showsOn,
  truckView,
} from './truckView.ts'

const SEED = 42

/** Day 0, a Monday: the truck starts the game closed on Mondays. */
const monday = createInitialState(SEED)
/** Day 1, the first Tuesday, before it is played. */
const tuesday = tick(monday)

/** `state` with only `quantity` units of `product` on hand. */
function holding(
  state: GameState,
  product: ProductId,
  quantity: number,
): GameState {
  return {
    ...state,
    inventory: [
      { product, quantity, unitCost: cents(40), boughtOnDay: state.day },
    ],
  }
}

function decide(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((next, change) => applyDecision(next, change), state)
}

/** A change to the street from `event`, from `fromDay` to `lastDay`. */
function modifier(
  event: string,
  change: StreetChange,
  fromDay: number,
  lastDay: number,
): StreetModifier {
  return { event, change, fromDay, lastDay }
}

/** `state` with the changes to the street and the delayed effects given. */
function withEvents(
  state: GameState,
  modifiers: readonly StreetModifier[],
  delayed: readonly DelayedEffect[] = [],
): GameState {
  return { ...state, events: { ...state.events, modifiers, delayed } }
}

const CLOSED: StreetChange = { kind: 'closed' }
const NO_CAFE: StreetChange = { kind: 'unavailable', product: 'cafe' }
const FEWER: StreetChange = { kind: 'walkIns', factor: 0.65 }

describe('rackFill (the croissant stock shown on the rack)', () => {
  it.each([
    [0, 0],
    [1, 0.25],
    [25, 0.25],
    [26, 0.5],
    [50, 0.5],
    [51, 0.75],
    [70, 0.75],
    [75, 0.75],
    [76, 1],
    [100, 1],
    [250, 1],
  ])('shows %i croissants out of 100 as %f of the rack', (units, fill) => {
    expect(rackFill(units, 100, 4)).toBe(fill)
  })

  it('shows a one-shelf rack as empty or full', () => {
    expect(rackFill(0, 100, 1)).toBe(0)
    expect(rackFill(1, 100, 1)).toBe(1)
    expect(rackFill(100, 100, 1)).toBe(1)
  })

  it('never goes below empty', () => {
    expect(rackFill(-5, 100, 4)).toBe(0)
  })
})

describe('truckView', () => {
  it('shows the truck closed with an empty rack on the first Monday', () => {
    expect(truckView(monday)).toEqual({
      open: false,
      croissants: 0,
      businessName: "Le P'tit Camion",
      modifiers: [],
    })
  })

  it("writes the player's business name on the sign", () => {
    const game = createInitialState(SEED, FOOD_TRUCK, {
      businessName: 'Chez Mimi',
      avatar: 'homme',
      difficulty: 'facile',
    })
    expect(truckView(game).businessName).toBe('Chez Mimi')
    expect(truckView(tick(game)).businessName).toBe('Chez Mimi')
  })

  it('opens on Tuesday with the starting order of croissants', () => {
    expect(truckView(tuesday)).toEqual({
      open: true,
      croissants: 70,
      businessName: "Le P'tit Camion",
      modifiers: [],
    })
    expect(rackFill(truckView(tuesday).croissants, 100, 4)).toBe(0.75)
  })
})

describe('opensToday', () => {
  it('follows the weekdays the decisions of the day open', () => {
    expect(opensToday(monday)).toBe(false)
    expect(opensToday(tuesday)).toBe(true)
  })

  it('ignores a change of days waiting for the next morning', () => {
    const everyDay = decide(monday, {
      kind: 'daysOpen',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    })
    expect(opensToday(everyDay)).toBe(false)

    let nextMonday = everyDay
    for (let day = 0; day < 7; day += 1) nextMonday = tick(nextMonday)
    expect(opensToday(nextMonday)).toBe(true)
  })
})

describe('openingStock', () => {
  // The starting rules: café tops up to 300 below 100, croissants buy 70.
  it.each([
    [0, 300],
    [99, 300],
    [100, 100],
    [101, 101],
  ])('tops café up from %i on hand to %i', (units, opening) => {
    expect(openingStock(holding(tuesday, 'cafe', units), 'cafe')).toBe(opening)
  })

  it('adds a daily order to what is on hand', () => {
    expect(openingStock(holding(tuesday, 'croissant', 5), 'croissant')).toBe(75)
  })

  it('counts only what is on hand on a closed day', () => {
    expect(openingStock(holding(monday, 'cafe', 99), 'cafe')).toBe(99)
    expect(openingStock(monday, 'croissant')).toBe(0)
  })

  it('restocks with the rules of the day, not those waiting for the next morning', () => {
    const changed = decide(tuesday, {
      kind: 'restock',
      product: 'croissant',
      rule: { kind: 'buyDaily', quantity: 20 },
    })
    expect(openingStock(changed, 'croissant')).toBe(70)
    expect(openingStock(tick(changed), 'croissant')).toBe(20)
  })

  // The world repeats the engine's morning restock, which it may not call;
  // this holds the two together. Whatever the truck opens with is sold,
  // botched by a worn-out owner, spoiled at the close or still on hand after
  // it. The day sums up the units botched over every product.
  describe('agrees with the engine', () => {
    const changes: Record<number, DecisionChange[]> = {
      10: [
        {
          kind: 'restock',
          product: 'croissant',
          rule: { kind: 'buyDaily', quantity: 120 },
        },
      ],
      30: [
        {
          kind: 'restock',
          product: 'cafe',
          rule: { kind: 'topUp', whenBelow: 280, upTo: 290 },
        },
        {
          kind: 'restock',
          product: 'chocolat',
          rule: { kind: 'topUp', whenBelow: 0, upTo: 0 },
        },
      ],
      50: [{ kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] }],
      70: [
        {
          kind: 'restock',
          product: 'croissant',
          rule: { kind: 'buyDaily', quantity: 0 },
        },
      ],
    }

    it('on every product of every day for 120 days, as the player changes the rules', () => {
      let state = monday
      for (let day = 0; day < 120; day += 1) {
        state = decide(state, ...(changes[day] ?? []))
        const next = tick(state)
        const played = next.lastDay!
        let botched = 0
        for (const product of PRODUCTS) {
          const atClose =
            played.sold[product] +
            played.spoiled[product] +
            onHand(next.inventory, product)
          const opening = openingStock(state, product)
          expect(opening, `day ${day}, ${product}`).toBeGreaterThanOrEqual(
            atClose,
          )
          botched += opening - atClose
        }
        expect(botched, `day ${day} botched`).toBe(played.botched)
        expect(played.visits.length > 0, `day ${day} open`).toBe(
          opensToday(state),
        )
        state = next
      }
    })
  })
})

describe('modifiersToday', () => {
  it('counts a change from its first day to its last, both included', () => {
    const fewer = modifier('conesOrange', FEWER, 3, 5)
    const game = (day: number) => withEvents({ ...tuesday, day }, [fewer])
    expect(modifiersToday(game(2))).toEqual([])
    expect(modifiersToday(game(3))).toEqual([fewer])
    expect(modifiersToday(game(5))).toEqual([fewer])
    expect(modifiersToday(game(6))).toEqual([])
  })

  it('starts the street changes a choice queued for that morning or before, after the others', () => {
    const fewer = modifier('conesOrange', FEWER, 0, 9)
    const game = withEvents(
      tuesday,
      [fewer],
      [
        { day: 0, event: 'chalet', effect: { kind: 'closed', days: 2 } },
        { day: 1, event: 'machineTousse', effect: { ...NO_CAFE, days: 4 } },
        { day: 1, event: 'essai', effect: { kind: 'energy', amount: 5 } },
        { day: 2, event: 'chalet', effect: { kind: 'closed', days: 1 } },
      ],
    )
    expect(modifiersToday(game)).toEqual([
      fewer,
      modifier('chalet', CLOSED, 1, 2),
      modifier('machineTousse', NO_CAFE, 1, 4),
    ])
  })

  // The world repeats the engine's start of the day, which it may not
  // call; this holds the two together. Every morning may bring an event, so
  // that a summer sees every card that changes the street; the cards are
  // the shipped ones, and the choices are taken in turn.
  describe('agrees with the engine', () => {
    const OFTEN: EventContent = {
      ...EVENTS,
      pacing: { firstDay: 0, minDaysBetween: 1, dailyChance: 1 },
    }
    /** From the 1st of May to the end of September. */
    const DAYS = 153

    /** Whether the engine opened the truck on the day it just played. */
    function engineOpened(played: GameState): boolean {
      const { day } = played.lastDay!
      const days = [...(played.lastWeek?.days ?? []), ...played.weekSoFar.days]
      return days.find((recorded) => recorded.day === day)!.open
    }

    it('on every morning of a game with events, through a summer', () => {
      let state = createInitialState(SEED)
      let chosen = 0
      const events = new Set<string>()
      const seen = { unavailable: 0, closedByEvent: 0, startingDelayed: 0 }
      for (let day = 0; day < DAYS; day += 1) {
        const today = modifiersToday(state)
        const played = playDay(state)
        expect(today, `day ${day}`).toEqual(played.lastDay!.modifiers)
        expect(opensToday(state), `day ${day} open`).toBe(engineOpened(played))
        const shown = truckView(state).modifiers
        expect(shown).toMatchObject(today)

        for (const { event, change, choice } of shown) {
          events.add(event)
          if (change.kind === 'unavailable') seen.unavailable += 1
          // Made by a choice of its card that makes such a change.
          const made = OFTEN.events
            .find(({ id }) => id === event)
            ?.choices.find(({ id }) => id === choice)
          expect(
            made?.outcomes.flatMap(({ effects }) => effects.map((e) => e.kind)),
            `day ${day} ${event} ${choice}`,
          ).toContain(change.kind)
        }
        const { weekday } = toCalendar(state.day)
        if (state.decisions.daysOpen.includes(weekday) && !opensToday(state)) {
          seen.closedByEvent += 1
        }
        if (
          state.events.delayed.some(
            ({ day: due, effect }) =>
              due <= state.day &&
              (MODIFIER_KINDS as readonly string[]).includes(effect.kind),
          )
        ) {
          seen.startingDelayed += 1
        }

        state = tick(
          state,
          FOOD_TRUCK,
          CUSTOMERS,
          DIFFICULTIES,
          PERSONAL,
          ENERGY,
          OFTEN,
        )
        const { pending } = state.events
        if (pending !== null) {
          const card = OFTEN.events.find(({ id }) => id === pending.event)!
          const choice = card.choices[chosen % card.choices.length]!
          state = resolveEvent(state, choice.id, OFTEN)
          chosen += 1
        }
      }
      // The run covers what it is here for: every card that shows on the
      // street, a product that cannot be sold, a day the street closes the
      // truck, and a queued change that starts on its morning.
      expect([...events]).toEqual(
        expect.arrayContaining([
          'conesOrange',
          'concurrence',
          'festival',
          'canicule',
          'machineTousse',
        ]),
      )
      expect(seen.unavailable).toBeGreaterThan(0)
      expect(seen.closedByEvent).toBeGreaterThan(0)
      expect(seen.startingDelayed).toBeGreaterThan(0)
    })
  })
})

describe('a day the street closes the truck', () => {
  /** Tuesday, an open day, closed by a change made for it. */
  const closedTuesday = withEvents(tuesday, [modifier('chalet', CLOSED, 1, 1)])

  it('keeps the truck closed with only what is on hand, as the engine does', () => {
    expect(opensToday(closedTuesday)).toBe(false)
    expect(truckView(closedTuesday)).toMatchObject({
      open: false,
      croissants: 0,
    })
    const stocked = holding(closedTuesday, 'cafe', 40)
    expect(openingStock(stocked, 'cafe')).toBe(40)
    const played = playDay(stocked)
    expect(played.lastDay?.visits).toEqual([])
    expect(onHand(played.inventory, 'cafe')).toBe(40)
  })

  it('opens again the day after', () => {
    expect(opensToday({ ...closedTuesday, day: 2 })).toBe(true)
  })

  it('closes on the morning a queued closing starts', () => {
    const queued = withEvents(
      tuesday,
      [],
      [{ day: 1, event: 'formulaire14B', effect: { kind: 'closed', days: 1 } }],
    )
    expect(opensToday(queued)).toBe(false)
  })
})

describe('openingStock while a product cannot be sold', () => {
  it('restocks none of it, as the engine skips it, and the others as usual', () => {
    const game = holding(
      withEvents(tuesday, [modifier('machineTousse', NO_CAFE, 1, 3)]),
      'cafe',
      20,
    )
    expect(openingStock(game, 'cafe')).toBe(20)
    expect(openingStock(game, 'croissant')).toBe(70)
    expect(onHand(playDay(game).inventory, 'cafe')).toBe(20)
  })
})

describe('chosenModifiers', () => {
  /** `choice` of `event` chosen on the morning of `day`. */
  function chosen(day: number, event: string, choice: string): EventRecord {
    return { day, event, followUp: false, choice, outcome: 0 }
  }

  it('gives each change the choice that made it, those it queued included', () => {
    const waiting: GameState = {
      ...tuesday,
      events: {
        ...tuesday.events,
        pending: { event: 'conesOrange', followUp: false },
      },
    }
    const moved = resolveEvent(waiting, 'changerDeCoin')
    const kinds = (game: GameState) =>
      chosenModifiers(game).map(({ change, choice }) => [change.kind, choice])
    expect(kinds(moved)).toEqual([['walkIns', 'changerDeCoin']])
    expect(kinds(tick(moved))).toEqual([
      ['walkIns', 'changerDeCoin'],
      ['closed', 'changerDeCoin'],
    ])
  })

  it('takes the last choice of the card on its first day or before, and none for a Défi', () => {
    const before = modifier('conesOrange', FEWER, 0, 3)
    const after = modifier('conesOrange', FEWER, 1, 3)
    const street = withEvents(tuesday, [before, after])
    const game: GameState = {
      ...street,
      events: {
        ...street.events,
        history: [
          chosen(0, 'conesOrange', 'patienter'),
          chosen(1, 'canicule', 'glace'),
          chosen(1, 'conesOrange', 'changerDeCoin'),
        ],
      },
    }
    expect(chosenModifiers(game).map(({ choice }) => choice)).toEqual([
      'patienter',
      'changerDeCoin',
    ])
    expect(chosenModifiers(withEvents(tuesday, [after]))).toEqual([
      { ...after, choice: undefined },
    ])
  })
})

describe('showsOn', () => {
  const view = (open: boolean, ...modifiers: ChosenModifier[]) => ({
    open,
    modifiers,
  })
  const cones = modifier('conesOrange', FEWER, 1, 3)
  const broken = modifier('machineTousse', NO_CAFE, 1, 3)

  it('shows an open or closed piece on those days', () => {
    expect(showsOn('open', view(true))).toBe(true)
    expect(showsOn('open', view(false))).toBe(false)
    expect(showsOn('closed', view(false))).toBe(true)
    expect(showsOn('closed', view(true))).toBe(false)
  })

  it("shows an event's piece while any change from its card is in effect", () => {
    const shows = { event: 'conesOrange' }
    expect(showsOn(shows, view(true))).toBe(false)
    expect(showsOn(shows, view(true, broken))).toBe(false)
    expect(showsOn(shows, view(true, broken, cones))).toBe(true)
    expect(showsOn(shows, view(false, cones))).toBe(true)
  })

  it('leaves out the changes the choices in its `except` made', () => {
    const shows = { event: 'conesOrange', except: ['changerDeCoin'] }
    const moved = { ...cones, choice: 'changerDeCoin' }
    const waited = { ...cones, choice: 'patienter' }
    expect(showsOn(shows, view(true, moved))).toBe(false)
    expect(showsOn(shows, view(false, broken, moved))).toBe(false)
    expect(showsOn(shows, view(true, waited))).toBe(true)
    expect(showsOn(shows, view(true, moved, waited))).toBe(true)
    // A Défi's change, which no choice made.
    expect(showsOn(shows, view(true, cones))).toBe(true)
  })

  it("shows a product's piece while it cannot be sold, whatever made it so", () => {
    expect(showsOn({ unavailable: 'cafe' }, view(true))).toBe(false)
    expect(showsOn({ unavailable: 'cafe' }, view(true, cones))).toBe(false)
    expect(showsOn({ unavailable: 'cafe' }, view(true, broken))).toBe(true)
    expect(showsOn({ unavailable: 'croissant' }, view(true, broken))).toBe(
      false,
    )
    const essai = modifier('essai', NO_CAFE, 1, 1)
    expect(showsOn({ unavailable: 'cafe' }, view(false, essai))).toBe(true)
  })

  it("shows a product's piece on open days while it can be sold", () => {
    expect(showsOn({ sells: 'cafe' }, view(true))).toBe(true)
    expect(showsOn({ sells: 'cafe' }, view(true, cones))).toBe(true)
    expect(showsOn({ sells: 'cafe' }, view(false))).toBe(false)
    expect(showsOn({ sells: 'cafe' }, view(true, broken))).toBe(false)
    expect(showsOn({ sells: 'croissant' }, view(true, broken))).toBe(true)
  })
})

describe('the construction of « Les cônes orange »', () => {
  /** The shipped pieces the card draws round the truck. */
  const CONSTRUCTION = ASSETS.pieces.filter(
    ({ shows }) =>
      typeof shows === 'object' &&
      'event' in shows &&
      shows.event === 'conesOrange',
  )
  const ALL = ['cones-left', 'cones-right', 'road-sign']

  /**
   * Each morning from the one `choiceId` is chosen on, a Tuesday, while a
   * change to the street from the card is in effect.
   */
  function mornings(choiceId: string): GameState[] {
    const waiting: GameState = {
      ...tuesday,
      events: {
        ...tuesday.events,
        pending: { event: 'conesOrange', followUp: false },
      },
    }
    const seen: GameState[] = []
    let state = resolveEvent(waiting, choiceId)
    while (fromTheCard(state).length > 0) {
      seen.push(state)
      state = tick(state)
    }
    return seen
  }

  /** The changes to the street from the card on the morning of `game`. */
  function fromTheCard(game: GameState): StreetModifier[] {
    return modifiersToday(game).filter(({ event }) => event === 'conesOrange')
  }

  /** The construction pieces the street shows on the morning of `game`. */
  function construction(game: GameState): string[] {
    const view = truckView(game)
    return CONSTRUCTION.filter(({ shows }) => showsOn(shows!, view)).map(
      ({ id }) => id,
    )
  }

  it('draws the cones, the barrier and « Rue barrée »', () => {
    expect(CONSTRUCTION.map(({ id }) => id)).toEqual(ALL)
  })

  it.each(['patienter', 'vacances'])(
    'keeps them round the truck for the 21 days « %s » changes the street',
    (choiceId) => {
      const days = mornings(choiceId)
      expect(days).toHaveLength(21)
      for (const game of days) {
        expect(construction(game), `day ${game.day}`).toEqual(ALL)
      }
    },
  )

  it('leaves them at the old corner after « Changer de coin de rue », the fewer walk-ins kept', () => {
    const days = mornings('changerDeCoin')
    expect(days).toHaveLength(21)
    for (const game of days) {
      expect(
        fromTheCard(game).map(({ change }) => change.kind),
        `day ${game.day}`,
      ).toContain('walkIns')
      expect(construction(game), `day ${game.day}`).toEqual([])
    }
  })
})
