import { describe, expect, it } from 'vitest'
import { createInitialState, tick, toCalendar } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { conditionsHold, drawEvent, resolveEvent } from '../engine/events.ts'
import { FULL_ENERGY } from '../engine/energy.ts'
import { onHand } from '../engine/inventory.ts'
import { next } from '../engine/rng.ts'
import { streetOn, type Street } from '../engine/street.ts'
import type { Day, GameState } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, entriesOf, type JournalEntry } from '../finance/journal.ts'
import { balanceSheet } from '../finance/statements.ts'
import type { EventCard, EventChoice, EventContent } from './schema.ts'

// The event cards of issues #93, #137 and #155, each choice played out in a
// game of seed 42: every outcome of every choice, from the first morning the
// card may come up, until nothing it started is left. chequeDansLaMalle,
// which only comes as a follow-up, plays from the late payment of
// grosseCommande. The cards play as written, with no difficulty scaling
// them: the game is at Moyen, so the effects of Difficile only never apply.

const SEED = 42
const CASH: AccountCode = '1000'
const RECEIVABLES: AccountCode = '1100'
const SALES: AccountCode = '4000'
const INVENTORY: AccountCode = '1200'
const INVENTORY_LOSSES: AccountCode = '5100'
const RENT_AND_PERMIT: AccountCode = '6100'
const MARKETING: AccountCode = '6300'
const BAD_DEBTS: AccountCode = '6950'
const GILLES = 'Gilles Lacasse'
const CROISSANT_COST = FOOD_TRUCK.products.croissant.unitCostCents
/** A year of mornings to find the one a card may first come up. */
const DAYS_PER_YEAR = 365
/** Days to play a choice out before giving up on it settling. */
const MAX_DAYS = 200

/** The shipped cards as written, with no difficulty scaling them. */
const AS_WRITTEN: EventContent = { ...EVENTS, scaling: undefined }

/** The cards as written with no draw: only follow-ups come up. */
const FOLLOW_UPS_ONLY: EventContent = {
  ...AS_WRITTEN,
  pacing: { ...EVENTS.pacing, dailyChance: 0 },
}

/** Plays `state`'s day, then the next morning brings only follow-ups. */
function step(state: GameState): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    FOLLOW_UPS_ONLY,
  )
}

const CARDS = EVENTS.events.filter(({ id }) => id !== 'essai')

function cardOf(id: string): EventCard {
  const card = EVENTS.events.find((event) => event.id === id)
  if (card === undefined) throw new Error(`No card ${id}`)
  return card
}

function choiceOf(event: string, id: string): EventChoice {
  const choice = cardOf(event).choices.find((c) => c.id === id)
  if (choice === undefined) throw new Error(`No choice ${event}/${id}`)
  return choice
}

/** Every weekday, Monday to Sunday. */
const WHOLE_WEEK = [1, 2, 3, 4, 5, 6, 7]

/**
 * A new seed-42 game for `event`, with the starting decisions, and in its
 * history the first choice a card that remembers one asks for, made on day
 * 0.
 */
function startOf(event: string): GameState {
  const state = createInitialState(SEED)
  const [made] = cardOf(event).conditions?.chosen ?? []
  if (made === undefined) return state
  return {
    ...state,
    events: {
      ...state.events,
      history: [{ day: 0, followUp: false, outcome: 0, ...made }],
    },
  }
}

const firstMornings = new Map<string, GameState>()

/**
 * The first morning of a seed-42 game, played with no event, on which
 * `event` may be drawn: from the pacing's first day, its conditions hold.
 */
function firstMorning(event: string): GameState {
  const known = firstMornings.get(event)
  if (known !== undefined) return known
  const card = cardOf(event)
  let state = startOf(event)
  for (let day = 0; day < DAYS_PER_YEAR; day += 1) {
    if (
      state.day >= EVENTS.pacing.firstDay &&
      conditionsHold(card, state, new Map())
    ) {
      firstMornings.set(event, state)
      return state
    }
    state = tick(state)
  }
  throw new Error(`${event} never comes up in the first year`)
}

/** A generator state whose next draw `test` holds for. */
function seedWhere(test: (value: number) => boolean): number {
  for (let state = 0; ; state += 1) {
    if (test(next(state)[0])) return state
  }
}

/** A generator state whose next draw picks outcome `index` of `choice`. */
function drawing(choice: EventChoice, index: number): number {
  const chances = choice.outcomes.map(({ chance }) => chance)
  const from = chances.slice(0, index).reduce((sum, c) => sum + c, 0)
  const to = from + (chances[index] ?? 0)
  // Off the edges, where the float sums could tip either way.
  const margin = 0.01
  for (let state = 0; ; state += 1) {
    const [value] = next(state)
    if (value > from + margin && value < to - margin) return state
  }
}

/**
 * `morning` with `event` waiting, the player choosing `choiceId`, which
 * turns out as its outcome `index`.
 */
function choose(
  morning: GameState,
  event: string,
  choiceId: string,
  index = 0,
  followUp = false,
): GameState {
  const choice = choiceOf(event, choiceId)
  const waiting: GameState = {
    ...morning,
    rngState:
      choice.outcomes.length > 1 ? drawing(choice, index) : morning.rngState,
    events: { ...morning.events, pending: { event, followUp } },
  }
  return resolveEvent(waiting, choiceId, AS_WRITTEN)
}

/** Whether nothing an event started is left in `state`. */
function settled({ events, receivables }: GameState): boolean {
  return (
    events.pending === null &&
    events.delayed.length === 0 &&
    events.followUps.length === 0 &&
    events.modifiers.length === 0 &&
    receivables.length === 0
  )
}

/**
 * Plays `state` on with no event drawn, until it has `settled` and at least
 * `minDays` days are played, a month by default, answering each follow-up
 * with `answer`, or with its first choice when it has none so named.
 * Returns the morning after each day played, in order: its `lastDay` sums
 * up that day.
 */
function playOut(
  state: GameState,
  { answer = 'patienter', minDays = 30 } = {},
): GameState[] {
  const mornings: GameState[] = []
  let current = state
  for (let played = 0; played < MAX_DAYS; played += 1) {
    const { pending } = current.events
    if (pending !== null) {
      const { choices } = cardOf(pending.event)
      const known = choices.some(({ id }) => id === answer)
      current = resolveEvent(
        current,
        known ? answer : (choices[0]?.id ?? answer),
        AS_WRITTEN,
      )
    }
    if (played >= minDays && settled(current)) return mornings
    current = step(current)
    mornings.push(current)
  }
  throw new Error(`Still not settled after ${MAX_DAYS} days`)
}

/** `state` played on with no event drawn until an event waits. */
function untilPending(state: GameState): GameState {
  let current = state
  for (let played = 0; played < MAX_DAYS; played += 1) {
    if (current.events.pending !== null) return current
    current = step(current)
  }
  throw new Error(`No event after ${MAX_DAYS} days`)
}

/** The street as it was on `day`, one of the days `mornings` played. */
function streetOnDay(mornings: readonly GameState[], day: Day): Street {
  const summary = mornings.find(({ lastDay }) => lastDay?.day === day)?.lastDay
  if (summary === undefined || summary === null) {
    throw new Error(`Day ${day} was not played`)
  }
  return streetOn(summary.modifiers, day)
}

function last(mornings: readonly GameState[]): GameState {
  const state = mornings.at(-1)
  if (state === undefined) throw new Error('No day played')
  return state
}

function entries(state: GameState, memo: string): JournalEntry[] {
  return entriesOf(state.journal).filter((entry) => entry.memo === memo)
}

/** What the entry moves: its debits, which equal its credits. */
function amountOf({ lines }: JournalEntry): number {
  return lines.reduce((sum, { debit }) => sum + debit, 0)
}

/** The entry's debited and credited accounts with the amount it moves. */
function shape(entry: JournalEntry) {
  const debited = entry.lines.find(({ debit }) => debit > 0)?.account
  const credited = entry.lines.find(({ credit }) => credit > 0)?.account
  return { day: entry.day, debited, credited, amount: amountOf(entry) }
}

/** The days, in `from` to `to`, on which `test` holds for the street. */
function daysWhen(
  mornings: readonly GameState[],
  from: Day,
  to: Day,
  test: (street: Street) => boolean,
): Day[] {
  const days: Day[] = []
  for (let day = from; day <= to; day += 1) {
    if (test(streetOnDay(mornings, day))) days.push(day)
  }
  return days
}

/** The first day after `day` that falls on the ISO weekday `weekday`. */
function nextWeekday(day: Day, weekday: number): Day {
  let at = day + 1
  while (toCalendar(at).weekday !== weekday) at += 1
  return at
}

const CASES = CARDS.filter(
  ({ conditions }) => conditions?.followUpOnly !== true,
).flatMap(({ id, choices }) =>
  choices.flatMap((choice) =>
    choice.outcomes.map((_, outcome) => [id, choice.id, outcome] as const),
  ),
)

describe('every outcome of every choice', () => {
  it.each(CASES)(
    '%s, %s, outcome %i, plays out with the books balanced every day',
    (event, choiceId, outcome) => {
      const morning = firstMorning(event)
      const chosen = choose(morning, event, choiceId, outcome)
      expect(chosen.events.history.at(-1)).toEqual({
        day: morning.day,
        event,
        followUp: false,
        choice: choiceId,
        outcome,
      })
      for (const { journal, lastDay } of playOut(chosen)) {
        const day = lastDay?.day ?? 0
        const sheet = balanceSheet(journal, day)
        expect(sheet.assets.total.amount, `day ${day}`).toBe(
          sheet.totalLiabilitiesAndEquity.amount,
        )
      }
    },
  )
})

describe('grosseCommande', () => {
  const morning = firstMorning('grosseCommande')
  const thursday = nextWeekday(morning.day, 4)
  const due = thursday + 60

  it('comes up on a Monday or a Tuesday, a few days before Thursday', () => {
    expect([1, 2]).toContain(toCalendar(morning.day).weekday)
    expect(thursday - morning.day).toBeLessThan(7)
  })

  it.each([0, 1])(
    '« Accepter » bakes and sells 400 croissants on credit on Thursday, outcome %i',
    (outcome) => {
      const chosen = choose(morning, 'grosseCommande', 'accepter', outcome)
      expect(chosen.journal).toBe(morning.journal)
      const days = playOut(chosen, { minDays: due - morning.day + 1 })
      const end = last(days)
      expect(entries(end, `Vente à crédit · ${GILLES}`).map(shape)).toEqual([
        { day: thursday, debited: '1100', credited: '4000', amount: 75_000 },
      ])
      const order = entries(end, 'Coût des marchandises vendues').filter(
        (entry) =>
          entry.day === thursday && amountOf(entry) === 400 * CROISSANT_COST,
      )
      expect(order).toHaveLength(1)
      expect(balance(end.journal, RECEIVABLES, { toDay: thursday - 1 })).toBe(0)
      expect(balance(end.journal, RECEIVABLES, { toDay: due - 1 })).toBe(75_000)
    },
  )

  it('« Accepter » is paid on the due day, 60 days after Thursday, at 85 %', () => {
    const chosen = choose(morning, 'grosseCommande', 'accepter', 0)
    expect(chosen.events.delayed.map(({ day }) => day)).toEqual(
      Array<Day>(5).fill(thursday),
    )
    const end = last(playOut(chosen, { minDays: due - morning.day + 1 }))
    expect(entries(end, `Encaissement · ${GILLES}`).map(shape)).toEqual([
      { day: due, debited: CASH, credited: RECEIVABLES, amount: 75_000 },
    ])
    expect(balance(end.journal, RECEIVABLES, { toDay: due })).toBe(0)
    expect(end.events.history).toHaveLength(1)
  })

  it('« Accepter, mais payé à la livraison » brings 625 $ in cash on Thursday', () => {
    const chosen = choose(morning, 'grosseCommande', 'payeLivraison')
    const end = last(playOut(chosen))
    expect(
      entries(end, 'Commande du Congrès québécois des optimistes').map(shape),
    ).toEqual([
      { day: thursday, debited: CASH, credited: SALES, amount: 62_500 },
    ])
    expect(entries(end, `Vente à crédit · ${GILLES}`)).toEqual([])
  })

  it('« Refuser poliment » changes nothing', () => {
    const chosen = choose(morning, 'grosseCommande', 'refuser')
    expect({ ...chosen, events: morning.events }).toEqual(morning)
    expect(chosen.events.delayed).toEqual([])
  })

  it.each([
    ['accepter', [thursday]],
    ['payeLivraison', [thursday]],
    ['refuser', []],
  ] as const)(
    '« %s » closes the truck on Thursday only when the order is taken',
    (choiceId, closed) => {
      const days = playOut(choose(morning, 'grosseCommande', choiceId))
      expect(
        daysWhen(days, morning.day, thursday + 3, ({ closed }) => closed),
      ).toEqual(closed)
    },
  )
})

describe('chequeDansLaMalle', () => {
  // Gilles's cheque is late in the 15 % outcome of « Accepter »: the
  // follow-up comes up the morning the 750 $ is due, before it is collected.
  const morning = firstMorning('grosseCommande')
  const thursday = nextWeekday(morning.day, 4)
  const due = thursday + 60
  const dueMorning = untilPending(
    choose(morning, 'grosseCommande', 'accepter', 1),
  )

  it('comes up the morning the 750 $ is due, with it still owed', () => {
    expect(dueMorning.day).toBe(due)
    expect(dueMorning.events.pending).toEqual({
      event: 'chequeDansLaMalle',
      followUp: true,
    })
    expect(dueMorning.receivables).toEqual([
      { client: GILLES, amount: 75_000, soldOnDay: thursday, dueDay: due },
    ])
    expect(balance(dueMorning.journal, RECEIVABLES, { toDay: due })).toBe(
      75_000,
    )
  })

  it('« Patienter » collects the 750 $ 30 days later, once, at 60 %', () => {
    const chosen = choose(dueMorning, 'chequeDansLaMalle', 'patienter', 0, true)
    expect(chosen.receivables).toEqual([
      { client: GILLES, amount: 75_000, soldOnDay: thursday, dueDay: due + 30 },
    ])
    const end = last(playOut(chosen, { minDays: 40 }))
    expect(balance(end.journal, RECEIVABLES, { toDay: due + 29 })).toBe(75_000)
    expect(entries(end, `Encaissement · ${GILLES}`).map(shape)).toEqual([
      { day: due + 30, debited: CASH, credited: RECEIVABLES, amount: 75_000 },
    ])
    expect(entries(end, `Mauvaise créance · ${GILLES}`)).toEqual([])
    expect(balance(end.journal, RECEIVABLES, { toDay: due + 30 })).toBe(0)
  })

  it('« Patienter » writes the 750 $ off 30 days later at 40 %, never collected', () => {
    const chosen = choose(dueMorning, 'chequeDansLaMalle', 'patienter', 1, true)
    expect(chosen.receivables).toEqual([
      { client: GILLES, amount: 75_000, soldOnDay: thursday, dueDay: due + 30 },
    ])
    const end = last(playOut(chosen, { minDays: 40 }))
    expect(balance(end.journal, RECEIVABLES, { toDay: due + 29 })).toBe(75_000)
    expect(entries(end, `Mauvaise créance · ${GILLES}`).map(shape)).toEqual([
      {
        day: due + 30,
        debited: BAD_DEBTS,
        credited: RECEIVABLES,
        amount: 75_000,
      },
    ])
    expect(entries(end, `Encaissement · ${GILLES}`)).toEqual([])
    expect(balance(end.journal, RECEIVABLES, { toDay: end.day })).toBe(0)
  })

  it('« Aller le voir au bureau » pays the taxi and collects the 750 $ at once at 80 %, once', () => {
    const chosen = choose(
      dueMorning,
      'chequeDansLaMalle',
      'allerLeVoir',
      0,
      true,
    )
    expect(chosen.energy).toBe(dueMorning.energy - 5)
    expect(chosen.receivables).toEqual([])
    expect(
      entries(chosen, 'Taxi aller-retour au bureau de Gilles').map(shape),
    ).toEqual([{ day: due, debited: '6900', credited: CASH, amount: 4000 }])
    const end = last(playOut(chosen, { minDays: 40 }))
    expect(entries(end, `Encaissement · ${GILLES}`).map(shape)).toEqual([
      { day: due, debited: CASH, credited: RECEIVABLES, amount: 75_000 },
    ])
    expect(entries(end, `Mauvaise créance · ${GILLES}`)).toEqual([])
  })

  it('« Aller le voir au bureau » writes the 750 $ off at 20 %, never collected', () => {
    const chosen = choose(
      dueMorning,
      'chequeDansLaMalle',
      'allerLeVoir',
      1,
      true,
    )
    expect(chosen.energy).toBe(dueMorning.energy - 5)
    expect(chosen.receivables).toEqual([])
    const end = last(playOut(chosen, { minDays: 40 }))
    expect(entries(end, `Mauvaise créance · ${GILLES}`).map(shape)).toEqual([
      { day: due, debited: BAD_DEBTS, credited: RECEIVABLES, amount: 75_000 },
    ])
    expect(entries(end, `Encaissement · ${GILLES}`)).toEqual([])
    expect(balance(end.journal, RECEIVABLES, { toDay: end.day })).toBe(0)
  })
})

describe('the croissants given away', () => {
  // Croissants keep one day: the morning a card comes up, none are left
  // from the day before, so the card bakes those it gives away.
  it.each([
    ['critique', 'offrirBoite', 0, 6],
    ['critique', 'offrirBoite', 1, 6],
    ['influenceuse', 'offrirCroissants', 0, 10],
    ['influenceuse', 'offrirCroissants', 1, 10],
  ] as const)(
    '%s, %s, outcome %i, gives away %i croissants to Marketing',
    (event, choiceId, outcome, units) => {
      const morning = firstMorning(event)
      expect(onHand(morning.inventory, 'croissant')).toBe(0)
      const chosen = choose(morning, event, choiceId, outcome)
      const cost = units * CROISSANT_COST
      expect(entries(chosen, 'Marchandises offertes').map(shape)).toEqual([
        {
          day: morning.day,
          debited: MARKETING,
          credited: '1200',
          amount: cost,
        },
      ])
      const toDay = morning.day
      expect(balance(chosen.journal, MARKETING, { toDay })).toBe(
        balance(morning.journal, MARKETING, { toDay }) + cost,
      )
      expect(balance(chosen.journal, CASH, { toDay })).toBe(
        balance(morning.journal, CASH, { toDay }) - cost,
      )
      expect(onHand(chosen.inventory, 'croissant')).toBe(0)
    },
  )
})

describe('the changes to the street', () => {
  it.each(['patienter', 'vacances'])(
    'conesOrange: « %s » takes 55 %% of the walk-ins for a week, then 20 %% for two',
    (choiceId) => {
      const morning = firstMorning('conesOrange')
      const { day } = morning
      const days = playOut(choose(morning, 'conesOrange', choiceId))
      const factor = (factor: number) =>
        daysWhen(days, day, day + 22, (s) => s.walkIns.chic === factor)
      expect(factor(0.45)).toEqual(Array.from({ length: 7 }, (_, d) => day + d))
      expect(factor(0.8)).toEqual(
        Array.from({ length: 14 }, (_, d) => day + 7 + d),
      )
    },
  )

  it('conesOrange: « Prendre une semaine de vacances » closes 7 days and fills the energy', () => {
    const morning = firstMorning('conesOrange')
    const { day } = morning
    const days = playOut(choose(morning, 'conesOrange', 'vacances'))
    const closed = daysWhen(days, day, day + 21, ({ closed }) => closed)
    expect(closed).toEqual([0, 1, 2, 3, 4, 5, 6].map((d) => day + d))
    const lastClosed = days.find(({ lastDay }) => lastDay?.day === day + 6)
    expect(lastClosed?.lastDay?.energy).toBe(100)
  })

  it('conesOrange: « Changer de coin de rue » pays the permit and closes tomorrow only', () => {
    const morning = firstMorning('conesOrange')
    const { day } = morning
    const chosen = choose(morning, 'conesOrange', 'changerDeCoin')
    expect(
      entries(chosen, 'Formulaire 22-C, changement de coin de rue').map(shape),
    ).toEqual([
      { day, debited: RENT_AND_PERMIT, credited: CASH, amount: 115_000 },
    ])
    const days = playOut(chosen)
    expect(daysWhen(days, day, day + 21, ({ closed }) => closed)).toEqual([
      day + 1,
    ])
  })

  it('machineTousse: the tape that gives way stops the café for 4 days, 3 days later', () => {
    const morning = firstMorning('machineTousse')
    const { day } = morning
    const days = playOut(choose(morning, 'machineTousse', 'ruban', 1))
    const noCafe = daysWhen(days, day, day + 8, (s) => s.unavailable.cafe)
    expect(noCafe).toEqual([3, 4, 5, 6].map((d) => day + d))
    expect(
      entries(last(days), "Réparation d'urgence de la machine à espresso").map(
        shape,
      ),
    ).toEqual([
      { day: day + 3, debited: '6200', credited: CASH, amount: 90_000 },
    ])
  })

  it('chalet: « Y aller » closes the truck from Friday to Sunday', () => {
    const morning = firstMorning('chalet')
    const { day } = morning
    const friday = nextWeekday(day, 5)
    const days = playOut(choose(morning, 'chalet', 'yAller'))
    expect(daysWhen(days, day, day + 7, ({ closed }) => closed)).toEqual([
      friday,
      friday + 1,
      friday + 2,
    ])
  })

  it.each([
    ['payer', 1.8],
    ['dehors', 1.2],
  ] as const)(
    'festival: « %s » brings %d times the walk-ins from Friday to Sunday',
    (choiceId, factor) => {
      const morning = firstMorning('festival')
      const { day } = morning
      const friday = nextWeekday(day, 5)
      const days = playOut(choose(morning, 'festival', choiceId))
      const crowd = daysWhen(days, day, day + 8, (s) => s.walkIns.chic > 1)
      expect(crowd).toEqual([friday, friday + 1, friday + 2])
      expect(streetOnDay(days, friday).walkIns.habitue).toBe(factor)
    },
  )

  it('formulaire14B: losing the contest closes tomorrow and doubles the fine tomorrow', () => {
    const morning = firstMorning('formulaire14B')
    const { day } = morning
    const chosen = choose(morning, 'formulaire14B', 'contester', 1)
    expect(chosen.energy).toBe(morning.energy - 10)
    const days = playOut(chosen)
    expect(daysWhen(days, day, day + 3, ({ closed }) => closed)).toEqual([
      day + 1,
    ])
    expect(
      entries(last(days), 'Amende doublée, formulaire 14-B bis').map(shape),
    ).toEqual([
      { day: day + 1, debited: '6900', credited: CASH, amount: 30_000 },
    ])
  })

  it("premierJuillet comes up on June 30, and « Aider Normand » puts 60 $ in the owner's pocket on July 1", () => {
    const morning = firstMorning('premierJuillet')
    const { day } = morning
    expect(toCalendar(day)).toMatchObject({ month: 6, dayOfMonth: 30 })
    const days = playOut(choose(morning, 'premierJuillet', 'aiderNormand'))
    expect(daysWhen(days, day, day + 2, ({ closed }) => closed)).toEqual([
      day + 1,
    ])
    expect(
      last(days).personal.movements.filter(
        ({ label }) => label === 'Normand vous remercie',
      ),
    ).toEqual([{ day: day + 1, label: 'Normand vous remercie', amount: 6000 }])
  })
})

describe('premierJuillet on a June 30 whose July 1 the truck is closed', () => {
  // « Ouvrir tôt pour les déménageurs » and « Ouvrir comme d'habitude »
  // promise customers on July 1. When the schedule closes the weekday July 1
  // falls on, either the card does not come up that June 30, or the choice
  // opens the truck on July 1 (#149). The starting schedule, closed on
  // Mondays, meets this in year 3; this game meets it on a Saturday.

  /** The first morning of premierJuillet, the schedule closing July 1. */
  function closedOnJuly1(): GameState {
    const morning = firstMorning('premierJuillet')
    const july1 = toCalendar(morning.day + 1).weekday
    return {
      ...morning,
      decisions: {
        ...morning.decisions,
        daysOpen: WHOLE_WEEK.filter((weekday) => weekday !== july1),
      },
    }
  }

  /**
   * What the player meets on July 1 after choosing `choiceId` on the
   * morning of June 30, `morning`.
   */
  function july1After(morning: GameState, choiceId: string): string {
    if (!conditionsHold(cardOf('premierJuillet'), morning, new Map())) {
      return 'no card on June 30'
    }
    const july1 = morning.day + 1
    const days = playOut(choose(morning, 'premierJuillet', choiceId), {
      minDays: 2,
    })
    const summary = days.find(({ lastDay }) => lastDay?.day === july1)?.lastDay
    if (summary === undefined || summary === null) {
      throw new Error(`Day ${july1} was not played`)
    }
    return summary.visits.length > 0 ? 'customers served' : 'truck closed'
  }

  it.each(['ouvrirTot', 'habitude'])(
    '« %s » never promises customers to the closed truck',
    (choiceId) => {
      expect(['no card on June 30', 'customers served']).toContain(
        july1After(closedOnJuly1(), choiceId),
      )
    },
  )
})

describe('the energy the cards cost and give', () => {
  // A card that closes the truck for a day of work costs energy: the owner
  // bakes all night, queues at the permit counter or carries a divan. From
  // the same morning, they end that day less rested than with the choice
  // that costs no energy. The closed day is no day off (#145). The chalet's
  // are, and its tag says what they give.

  /** The owner's energy at the close of `day`, one of the days played. */
  function energyAtCloseOf(mornings: readonly GameState[], day: Day): number {
    const summary = mornings.find(
      ({ lastDay }) => lastDay?.day === day,
    )?.lastDay
    if (summary === undefined || summary === null) {
      throw new Error(`Day ${day} was not played`)
    }
    return summary.energy
  }

  it.each([
    ['grosseCommande', 'accepter', 0, 'refuser'],
    ['grosseCommande', 'accepter', 1, 'refuser'],
    ['grosseCommande', 'payeLivraison', 0, 'refuser'],
    ['formulaire14B', 'contester', 0, 'payer'],
    ['formulaire14B', 'contester', 1, 'payer'],
    ['premierJuillet', 'aiderNormand', 0, 'habitude'],
    ['reportage', 'accepter', 0, 'decliner'],
    ['reportage', 'accepter', 1, 'decliner'],
  ] as const)(
    '%s: « %s », outcome %i, closes a day of work that tires more than « %s »',
    (event, choiceId, outcome, free) => {
      const morning = firstMorning(event)
      const working = playOut(choose(morning, event, choiceId, outcome))
      const [closedDay] = daysWhen(
        working,
        morning.day,
        morning.day + 7,
        ({ closed }) => closed,
      )
      if (closedDay === undefined) throw new Error('No day closed')
      const resting = playOut(choose(morning, event, free))
      expect(energyAtCloseOf(working, closedDay)).toBeLessThan(
        energyAtCloseOf(resting, closedDay),
      )
    },
  )

  it('chalet: « Y aller » leaves the owner at « Énergie au maximum » on Sunday', () => {
    // The three days off rest the owner to full by themselves (#145).
    expect(choiceOf('chalet', 'yAller').tags).toContain('Énergie au maximum')
    const morning = firstMorning('chalet')
    const sunday = nextWeekday(morning.day, 7)
    const away = playOut(choose(morning, 'chalet', 'yAller'))
    const open = playOut(choose(morning, 'chalet', 'resterOuvert'))
    expect(energyAtCloseOf(away, sunday)).toBe(FULL_ENERGY)
    expect(energyAtCloseOf(open, sunday)).toBeLessThan(FULL_ENERGY)
  })
})

describe('the cards of #155', () => {
  it('panneCourant: « Tout jeter et racheter » loses the café and the chocolate on hand to Pertes sur stocks', () => {
    const morning = firstMorning('panneCourant')
    const { day } = morning
    const chosen = choose(morning, 'panneCourant', 'jeter')
    const lost = entries(chosen, 'Marchandises perdues').map(shape)
    expect(lost.map(({ debited, credited }) => [debited, credited])).toEqual([
      [INVENTORY_LOSSES, INVENTORY],
      [INVENTORY_LOSSES, INVENTORY],
    ])
    const total = lost.reduce((sum, { amount }) => sum + amount, 0)
    expect(total).toBeGreaterThan(0)
    expect(balance(chosen.journal, INVENTORY_LOSSES, { toDay: day })).toBe(
      balance(morning.journal, INVENTORY_LOSSES, { toDay: day }) + total,
    )
    for (const [product, units] of [
      ['cafe', 300],
      ['chocolat', 150],
    ] as const) {
      expect(onHand(chosen.inventory, product)).toBe(
        Math.max(0, onHand(morning.inventory, product) - units),
      )
    }
  })

  it('stagiaire: the intern who finds the hot chocolate loses 40 portions', () => {
    const morning = firstMorning('stagiaire')
    const chosen = choose(morning, 'stagiaire', 'prendre', 1)
    expect(onHand(chosen.inventory, 'chocolat')).toBe(
      Math.max(0, onHand(morning.inventory, 'chocolat') - 40),
    )
    expect(entries(chosen, 'Marchandises perdues')).toHaveLength(1)
    expect(
      entries(
        choose(morning, 'stagiaire', 'prendre', 0),
        'Marchandises perdues',
      ),
    ).toEqual([])
  })

  it('fournisseurRetard: « Fermer demain » closes tomorrow only', () => {
    const morning = firstMorning('fournisseurRetard')
    const { day } = morning
    const days = playOut(choose(morning, 'fournisseurRetard', 'fermer'))
    expect(daysWhen(days, day, day + 3, ({ closed }) => closed)).toEqual([
      day + 1,
    ])
  })

  it('fournisseurRetard: « Acheter au dépanneur » pays the supplement tomorrow', () => {
    const morning = firstMorning('fournisseurRetard')
    const { day } = morning
    const end = last(playOut(choose(morning, 'fournisseurRetard', 'depanneur')))
    expect(
      entries(end, 'Supplément, croissants du dépanneur').map(shape),
    ).toEqual([{ day: day + 1, debited: '6900', credited: CASH, amount: 8000 }])
  })

  it('fournisseurRetard: « Ouvrir sans croissants » sells none tomorrow, and buys none', () => {
    const morning = firstMorning('fournisseurRetard')
    const { day } = morning
    const days = playOut(choose(morning, 'fournisseurRetard', 'sansCroissants'))
    expect(
      daysWhen(days, day, day + 3, (street) => street.unavailable.croissant),
    ).toEqual([day + 1])
    const tomorrow = days.find(({ lastDay }) => lastDay?.day === day + 1)
    expect(tomorrow?.lastDay?.sold.croissant).toBe(0)
    expect(tomorrow?.lastDay?.spoiled.croissant).toBe(0)
  })

  it('pluie: « Acheter un auvent » turns the rains to come into pluieAuvent', () => {
    const morning = firstMorning('pluie')
    // A morning of September, months of rain, past every cooldown.
    const later = (state: GameState): GameState => ({ ...state, day: 130 })
    expect(toCalendar(130).month).toBe(9)
    const holds = (event: string, state: GameState) =>
      conditionsHold(cardOf(event), later(state), new Map())
    const awning = choose(morning, 'pluie', 'auvent')
    expect(holds('pluie', awning)).toBe(false)
    expect(holds('pluieAuvent', awning)).toBe(true)
    const waited = choose(morning, 'pluie', 'attendre')
    expect(holds('pluie', waited)).toBe(true)
    expect(holds('pluieAuvent', waited)).toBe(false)
  })

  it('pluieAuvent: « Ouvrir sous l’auvent » takes half of what the rain took without it', () => {
    const factor = (event: string, choiceId: string) => {
      const morning = firstMorning(event)
      const days = playOut(choose(morning, event, choiceId))
      return streetOnDay(days, morning.day).walkIns.chic
    }
    expect(1 - factor('pluieAuvent', 'ouvrir')).toBeCloseTo(
      (1 - factor('pluie', 'attendre')) / 2,
    )
  })

  it('camionVoisin: « Racheter son café » buys 300 portions below their usual cost', () => {
    const morning = firstMorning('camionVoisin')
    const { day } = morning
    const chosen = choose(morning, 'camionVoisin', 'stock')
    expect(chosen.inventory.at(-1)).toEqual({
      product: 'cafe',
      quantity: 300,
      unitCost: 20,
      boughtOnDay: day,
    })
    expect(20).toBeLessThan(FOOD_TRUCK.products.cafe.unitCostCents)
    const bought = entries(chosen, 'Achat de marchandises').slice(
      entries(morning, 'Achat de marchandises').length,
    )
    expect(bought.map(shape)).toEqual([
      { day, debited: INVENTORY, credited: CASH, amount: 6000 },
    ])
  })

  it('camionVoisin: « Acheter sa machine » stops machineTousse for good', () => {
    const morning = firstMorning('camionVoisin')
    const coughs = (state: GameState) =>
      conditionsHold(cardOf('machineTousse'), state, new Map())
    expect(coughs(morning)).toBe(true)
    expect(coughs(choose(morning, 'camionVoisin', 'machine'))).toBe(false)
    expect(coughs(choose(morning, 'camionVoisin', 'stock'))).toBe(true)
  })

  it('volCaisse: « Prendre le risque » brings the theft back 30 days later at 10 %, though it comes once a game', () => {
    const morning = firstMorning('volCaisse')
    const { day } = morning
    const risk = (test: (value: number) => boolean) =>
      choose({ ...morning, rngState: seedWhere(test) }, 'volCaisse', 'risque')
    expect(cardOf('volCaisse').conditions?.oncePerGame).toBe(true)
    expect(risk((value) => value >= 0.1).events.followUps).toEqual([])
    const again = risk((value) => value < 0.1)
    expect(again.events.followUps).toEqual([
      { day: day + 30, event: 'volCaisse' },
    ])
    expect(entries(again, 'Vol de la caisse').map(shape)).toEqual([
      { day, debited: '6900', credited: CASH, amount: 30_000 },
    ])
    const back = untilPending(again)
    expect(back.day).toBe(day + 30)
    expect(back.events.pending).toEqual({ event: 'volCaisse', followUp: true })
  })

  it('volCaisse: « Acheter un coffre-fort » pays the theft and the safe, and the thief never comes back', () => {
    const morning = firstMorning('volCaisse')
    const chosen = choose(morning, 'volCaisse', 'coffre')
    expect(entries(chosen, 'Vol de la caisse').map(shape)).toEqual([
      { day: morning.day, debited: '6900', credited: CASH, amount: 30_000 },
    ])
    expect(entries(chosen, 'Coffre-fort').map(shape)).toEqual([
      { day: morning.day, debited: '6900', credited: CASH, amount: 25_000 },
    ])
    expect(chosen.events.followUps).toEqual([])
  })

  it.each([
    [0, 'reportageElogieux', 1.2],
    [1, 'reportageMoqueur', 1],
  ] as const)(
    'reportage: « Accepter l’entrevue », outcome %i, closes tomorrow, and the piece comes out the day after',
    (outcome, headline, chic) => {
      const morning = firstMorning('reportage')
      const { day } = morning
      const days = playOut(choose(morning, 'reportage', 'accepter', outcome))
      expect(daysWhen(days, day, day + 3, ({ closed }) => closed)).toEqual([
        day + 1,
      ])
      expect(last(days).events.headlines).toContainEqual({
        day: day + 2,
        id: headline,
      })
      expect(streetOnDay(days, day + 1).walkIns.chic).toBe(1)
      expect(streetOnDay(days, day + 2).walkIns.chic).toBe(chic)
      expect(streetOnDay(days, day + 22).walkIns.chic).toBe(chic)
      expect(streetOnDay(days, day + 23).walkIns.chic).toBe(1)
    },
  )
})

describe('the morning of June 30 with a follow-up due (#155)', () => {
  // « Le 1er juillet » comes on its day, inside the gap and with no draw.
  // A card coming back, such as the theft, waits for July 1; the rest of a
  // story, such as Gilles's cheque on the morning his payment is due, keeps
  // its day, before the payment would be collected by itself.
  const june30 = firstMorning('premierJuillet')
  const due = (event: string): GameState => ({
    ...june30,
    events: {
      ...june30.events,
      lastDrawnDay: june30.day - 1,
      followUps: [{ day: june30.day, event }],
    },
  })

  it('brings premierJuillet, the theft coming back the next morning', () => {
    const drawn = drawEvent(due('volCaisse'), AS_WRITTEN)
    expect(drawn.events.pending).toEqual({
      event: 'premierJuillet',
      followUp: false,
    })
    expect(drawn.events.followUps).toEqual([
      { day: june30.day, event: 'volCaisse' },
    ])
    const july1 = tick(
      resolveEvent(drawn, 'habitude', AS_WRITTEN),
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      AS_WRITTEN,
    )
    expect(july1.day).toBe(june30.day + 1)
    expect(july1.events.pending).toEqual({ event: 'volCaisse', followUp: true })
  })

  it('brings Gilles’s cheque the morning it is due, before premierJuillet', () => {
    expect(conditionsHold(cardOf('premierJuillet'), june30, new Map())).toBe(
      true,
    )
    const drawn = drawEvent(due('chequeDansLaMalle'), AS_WRITTEN)
    expect(drawn.events.pending).toEqual({
      event: 'chequeDansLaMalle',
      followUp: true,
    })
  })
})
