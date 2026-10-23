import { describe, expect, it } from 'vitest'
import type {
  CandidateId,
  RestockRule,
  StaffContent,
  StaffRoleId,
  TraitId,
  TraitLevel,
} from '../content/schema.ts'
import { entriesOf } from '../finance/journal.ts'
import { BAKERY, BAKERY_MEMO } from './bakery.ts'
import { createInitialState, tick } from './clock.ts'
import { GROCERS, startContract } from './contracts.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
  playDay,
} from './day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from './decisions.ts'
import { NO_EVENTS } from './events.ts'
import { PERCENTILES } from './percentiles.ts'
import {
  STAFF,
  STAFF_MEMO,
  absentOn,
  askingWage,
  hasWarned,
  staffNotices,
} from './staff.ts'
import type { DaySummary, Employee, GameState } from './types.ts'

// Each trait of #255 in each role, strong and weak, played on a shipped
// day: where the trait acts, it moves its number; elsewhere, the day is the
// same as with someone normal in it.

const TRAITS: readonly TraitId[] = [
  'rapidite',
  'minutie',
  'fiabilite',
  'accueil',
]

/** Who plays every role: their traits are set by the content. */
const WHO: CandidateId = 'kevin'

/**
 * The shipped staff, but every trait other than `trait` the same for
 * everyone, and nobody ever absent but someone weak in fiabilité, always:
 * so only `trait` sets the employee apart.
 */
function isolated(trait: TraitId): StaffContent {
  const traits = Object.fromEntries(
    TRAITS.map((id) => {
      const values = STAFF.traits[id]
      if (id === 'fiabilite') {
        const weak = id === trait ? 1 : 0
        return [id, { ...values, strong: 0, normal: 0, weak }]
      }
      if (id === trait) return [id, values]
      const { normal } = values
      return [id, { ...values, strong: normal, weak: normal }]
    }),
  ) as StaffContent['traits']
  return { ...STAFF, traits }
}

/** `content` with `WHO` at `level` in `trait`. */
function at(
  content: StaffContent,
  trait: TraitId,
  level: TraitLevel,
): StaffContent {
  const [first, second] = TRAITS.filter((id) => id !== trait) as [
    TraitId,
    TraitId,
  ]
  const traits =
    level === 'strong'
      ? { strength: trait, weakness: first }
      : level === 'weak'
        ? { strength: first, weakness: trait }
        : { strength: first, weakness: second }
  return {
    ...content,
    candidates: {
      ...content.candidates,
      [WHO]: { ...content.candidates[WHO], ...traits },
    },
  }
}

/** A shipped game of seed 42 with `changes` in effect from day 0. */
function game(staff: StaffContent, ...changes: DecisionChange[]): GameState {
  const state = changes.reduce(
    (next, change) =>
      applyDecision(next, change, undefined, undefined, undefined, staff),
    createInitialState(42),
  )
  return { ...state, decisions: latestDecisions(state), pendingDecisions: null }
}

/** The next morning of `state`, with `staff` as the employees' content. */
function next(state: GameState, staff: StaffContent): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    NO_EVENTS,
    DEFIS,
    PERCENTILES,
    BAKERY,
    GROCERS,
    staff,
  )
}

/** Plays the morning `state` with `staff`. */
function play(state: GameState, staff: StaffContent): GameState {
  return playDay(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    DEFIS,
    BAKERY,
    GROCERS,
    staff,
  )
}

function summary(state: GameState): DaySummary {
  if (state.lastDay === null) throw new Error('No day played')
  return state.lastDay
}

const hire = (role: StaffRoleId): DecisionChange => ({
  kind: 'hire',
  role,
  candidate: WHO,
})

/**
 * Each role's day: Tuesday, day 1, with the employee alone at the truck,
 * the owner away; Monday, day 7, the delivery day of a contract signed on
 * day 0; and Tuesday, day 1, with a bakery making the truck's croissants.
 */
const DAYS: Record<StaffRoleId, (staff: StaffContent) => GameState> = {
  camion: (staff) => {
    const morning = next(game(staff, hire('camion')), staff)
    return play({ ...morning, ownerAway: true }, staff)
  },
  livreur: (staff) => {
    let state = game(staff, hire('livreur'))
    state = {
      ...state,
      contracts: startContract(state.contracts, 0, 'chezNormand'),
    }
    for (let day = 0; day < 7; day += 1) state = next(state, staff)
    return play(state, staff)
  },
  boulanger: (staff) => {
    const state = game(
      staff,
      { kind: 'openBakery', oven: 'louer' },
      { kind: 'croissantSource', source: 'fabriquer' },
      hire('boulanger'),
    )
    return play(next(state, staff), staff)
  },
}

/** The memo of the truck's morning purchases. */
const MEMO_PURCHASES = 'Achat de marchandises'

const memos = (state: GameState, day: number) =>
  entriesOf(state.journal)
    .filter((entry) => entry.day === day)
    .map(({ memo }) => memo)

const wasteOn = (state: GameState, day: number) =>
  entriesOf(state.journal)
    .filter((entry) => entry.day === day && entry.memo === BAKERY_MEMO.wasted)
    .map(({ lines }) => lines[0]?.debit ?? 0)
    .reduce((total: number, amount) => total + amount, 0)

/**
 * What a trait moves in a role, as the day shows it, compared with the same
 * day played by someone normal in it: `better` for a strong employee,
 * `worse` for a weak one.
 */
type Effect = (
  played: GameState,
  normal: GameState,
) => 'better' | 'worse' | 'same'

/** Compares `measure` of the two days, `lower` being better or not. */
function by(measure: (state: GameState) => number, lower: boolean): Effect {
  return (played, normal) => {
    const a = measure(played)
    const b = measure(normal)
    if (a === b) return 'same'
    return a < b === lower ? 'better' : 'worse'
  }
}

/** Where each trait acts, and what it moves there (#255). */
const EFFECTS: Partial<Record<`${TraitId}:${StaffRoleId}`, Effect>> = {
  'rapidite:camion': by((state) => summary(state).averageWaitSeconds, true),
  'minutie:camion': by((state) => summary(state).botched, true),
  'fiabilite:camion': by((state) => -summary(state).visits.length, true),
  'accueil:camion': by(
    (state) => -summary(state).segments.habitue.visits,
    true,
  ),
  'fiabilite:livreur': by((state) => summary(state).missed.length, true),
  'minutie:boulanger': by((state) => wasteOn(state, 1), true),
  'fiabilite:boulanger': by(
    (state) =>
      memos(state, 1).filter((memo) => memo === BAKERY_MEMO.ingredients).length,
    false,
  ),
}

describe('the traits at work', () => {
  const ROLES: readonly StaffRoleId[] = ['camion', 'livreur', 'boulanger']
  const cases = ROLES.flatMap((role) =>
    TRAITS.flatMap((trait) =>
      (['strong', 'weak'] as const).map(
        (level) => [trait, level, role] as const,
      ),
    ),
  )

  it.each(cases)('%s, %s, as %s', (trait, level, role) => {
    const content = isolated(trait)
    const played = DAYS[role](at(content, trait, level))
    const normal = DAYS[role](at(content, trait, 'normal'))
    const effect = EFFECTS[`${trait}:${role}`]
    expect(STAFF.traits[trait].roles.includes(role)).toBe(effect !== undefined)
    if (effect === undefined) {
      // No effect in this role: the very same day.
      expect(played.journal.entries).toEqual(normal.journal.entries)
      expect(played.lastDay).toEqual(normal.lastDay)
      expect(played.rngState).toBe(normal.rngState)
      return
    }
    // fiabilité's strong is never absent, as normal is here.
    const expected =
      trait === 'fiabilite'
        ? level === 'strong'
          ? 'same'
          : 'worse'
        : level === 'strong'
          ? 'better'
          : 'worse'
    expect(effect(played, normal)).toBe(expected)
  })

  it('throws away ⌊croissants baked × bakeryWasteShare × minutie⌋ at the bakery', () => {
    const content = isolated('minutie')
    expect(BAKERY.startingDecisions.bake).toEqual({
      kind: 'buyDaily',
      quantity: 70,
    })
    const cost = DIFFICULTIES.bakery.moyen.ingredientCostCents
    const wasted = (['strong', 'normal', 'weak'] as const).map((level) => {
      const share = STAFF.bakeryWasteShare * STAFF.traits.minutie[level]
      const state = DAYS.boulanger(at(content, 'minutie', level))
      expect(wasteOn(state, 1), level).toBe(Math.floor(70 * share) * cost)
      return wasteOn(state, 1) / cost
    })
    expect(wasted).toEqual([1, 2, 3])
  })

  it('wastes nothing when the owner bakes', () => {
    const state = game(
      STAFF,
      { kind: 'openBakery', oven: 'louer' },
      { kind: 'croissantSource', source: 'fabriquer' },
    )
    const day = play(next(state, STAFF), STAFF)
    expect(memos(day, 1)).toContain(BAKERY_MEMO.ingredients)
    expect(memos(day, 1)).not.toContain(BAKERY_MEMO.wasted)
  })
})

describe('an absent employee', () => {
  /** Kevin is always absent: weak in fiabilité, at a chance of 1. */
  const ABSENT = at(isolated('fiabilite'), 'fiabilite', 'weak')

  it('at the truck leaves the owner alone, or the truck closed when the owner is away', () => {
    const morning = next(game(ABSENT, hire('camion')), ABSENT)
    const alone = summary(play(morning, ABSENT))
    expect(alone.visits.length).toBeGreaterThan(0)
    expect(alone.absent).toEqual([WHO])
    const away = summary(play({ ...morning, ownerAway: true }, ABSENT))
    expect(away.visits).toEqual([])
    expect(away.revenue).toBe(0)
    expect(away.absent).toEqual([WHO])
  })

  it('misses the delivery, with its strike', () => {
    const day = DAYS.livreur(ABSENT)
    expect(summary(day).missed).toEqual([{ day: 7, grocer: 'chezNormand' }])
    expect(summary(day).deliveries).toEqual([])
    expect(day.contracts.running[0]?.strikes).toBe(1)
    expect(summary(day).absent).toEqual([WHO])
  })

  it('leaves the croissants to be bought, by the bake rule, when the baker is away', () => {
    const day = DAYS.boulanger(ABSENT)
    const present = DAYS.boulanger(
      at(isolated('fiabilite'), 'fiabilite', 'strong'),
    )
    expect(summary(day).absent).toEqual([WHO])
    expect(memos(day, 1)).not.toContain(BAKERY_MEMO.ingredients)
    expect(memos(present, 1)).toContain(BAKERY_MEMO.ingredients)
    const bought = day.inventory.filter(
      ({ product, boughtOnDay }) =>
        product === 'croissant' && boughtOnDay === 1,
    )
    const sold = summary(day)
    expect(
      bought.reduce((total, { quantity }) => total + quantity, 0) +
        sold.sold.croissant +
        sold.spoiled.croissant,
    ).toBe(70)
    expect(
      bought.every(
        ({ unitCost }) =>
          unitCost === FOOD_TRUCK.products.croissant.unitCostCents,
      ),
    ).toBe(true)
    expect(sold.sold.croissant).toBe(summary(present).sold.croissant)
  })

  it('takes the absent out of the line: the day is the owner’s alone', () => {
    const morning = next(game(ABSENT, hire('camion')), ABSENT)
    const nobody = next(game(ABSENT), ABSENT)
    const absent = summary(play(morning, ABSENT))
    const alone = summary(play(nobody, ABSENT))
    expect(absent.visits).toEqual(alone.visits)
    expect(absent.averageWaitSeconds).toBe(alone.averageWaitSeconds)
    expect(absent.leftLine).toBe(alone.leftLine)
    expect(absent.sold).toEqual(alone.sold)
  })

  it('misses nothing on a day their role has no work, and is drawn from day 0 in a game set up that morning', () => {
    // Day 0, a Monday, the truck closed: the morning's staff is drawn, but
    // nobody missed any work.
    const state = game(ABSENT, hire('camion'))
    expect(state.day).toBe(0)
    expect(state.decisions.daysOpen).not.toContain(1)
    expect(absentOn(state, ABSENT)).toEqual([WHO])
    expect(summary(play(state, ABSENT)).absent).toBeUndefined()
  })

  describe('the croissants bought for an absent baker', () => {
    const bakingWith = (bake: RestockRule) =>
      game(
        ABSENT,
        { kind: 'openBakery', oven: 'louer' },
        { kind: 'croissantSource', source: 'fabriquer' },
        {
          kind: 'restock',
          product: 'croissant',
          rule: { kind: 'buyDaily', quantity: 40 },
        },
        { kind: 'bake', rule: bake },
        hire('boulanger'),
      )
    /** Day 1 played from `state`'s next morning, with `change` to it. */
    const dayOne = (
      state: GameState,
      change: (morning: GameState) => GameState = (morning) => morning,
    ) => play(change(next(state, ABSENT)), ABSENT)
    const bought = (day: GameState) =>
      summary(day).sold.croissant + summary(day).spoiled.croissant
    const purchases = (day: GameState) =>
      entriesOf(day.journal)
        .filter(({ day: on, memo }) => on === 1 && memo === MEMO_PURCHASES)
        .reduce((total: number, { lines }) => total + (lines[0]?.debit ?? 0), 0)
    const offSale = (morning: GameState): GameState => ({
      ...morning,
      events: {
        ...morning.events,
        modifiers: [
          {
            event: 'test',
            change: { kind: 'unavailable', product: 'croissant' },
            fromDay: 1,
            lastDay: 1,
          },
        ],
      },
    })

    it('buys what the bake rule orders, not the restock rule, at the truck’s cost', () => {
      const state = bakingWith({ kind: 'buyDaily', quantity: 90 })
      const day = dayOne(state)
      expect(summary(day).absent).toEqual([WHO])
      expect(bought(day)).toBe(90)
      // Off sale, none is bought, and the purchases cost 90 croissants less.
      const none = dayOne(state, offSale)
      expect(bought(none)).toBe(0)
      expect(purchases(day) - purchases(none)).toBe(
        90 * FOOD_TRUCK.products.croissant.unitCostCents,
      )
    })

    it('counts the croissants on hand, by the bake rule’s top-up', () => {
      const state = bakingWith({ kind: 'topUp', whenBelow: 50, upTo: 90 })
      const withStock = dayOne(state, (morning) => ({
        ...morning,
        inventory: [
          {
            product: 'croissant',
            quantity: 30,
            unitCost: FOOD_TRUCK.products.croissant.unitCostCents,
            boughtOnDay: 1,
          },
        ],
      }))
      // 30 on hand, so 60 more, to 90.
      expect(bought(withStock)).toBe(90)
      expect(bought(dayOne(state))).toBe(90)
      expect(purchases(dayOne(state)) - purchases(withStock)).toBe(
        30 * FOOD_TRUCK.products.croissant.unitCostCents,
      )
    })
  })

  it('is drawn on a hire’s first morning too, and for those the morning hires', () => {
    // Hired on day 0, Kevin starts on day 1.
    const pending = applyDecision(
      createInitialState(42),
      hire('camion'),
      undefined,
      undefined,
      undefined,
      ABSENT,
    )
    const morning = next(pending, ABSENT)
    expect(morning.staff).toEqual([])
    expect(absentOn(morning, ABSENT)).toEqual([WHO])
    const played = play(morning, ABSENT)
    expect(played.staff.map(({ candidate }) => candidate)).toEqual([WHO])
    expect(summary(played).absent).toEqual([WHO])
    // Let go that morning, nobody is absent.
    const fired = next(
      applyDecision(
        played,
        { kind: 'fire', candidate: WHO },
        undefined,
        undefined,
        undefined,
        ABSENT,
      ),
      ABSENT,
    )
    expect(absentOn(fired, ABSENT)).toEqual([])
  })
})

describe('an underpaid employee', () => {
  // Kevin, hired on day 0 at the truck's start, asks more: he warns on the
  // morning of day 56 and quits on that of day 63.
  const WARNS = 56
  const QUITS = 63
  const raise = (state: GameState): GameState =>
    applyDecision(state, {
      kind: 'setWage',
      candidate: WHO,
      hourlyWage: askingWage(WHO, 'camion'),
    })

  /**
   * The mornings from day 0 to `days`, with `change` made on the morning
   * of `on`, if any.
   */
  function mornings(
    days: number,
    change?: { on: number; make: (state: GameState) => GameState },
  ): GameState[] {
    const all = [game(STAFF, hire('camion'))]
    for (let day = 0; day < days; day += 1) {
      // The change comes after the morning's notices, as the player makes
      // it once the morning shows.
      const state = all[day] as GameState
      all.push(tick(change?.on === day ? change.make(state) : state))
    }
    return all
  }

  /** What each step from one morning to the next brought. */
  const dayByDay = (all: readonly GameState[]) =>
    all.slice(1).flatMap((state, index) => {
      const before = all[index] as GameState
      return staffNotices(before, state)
    })

  const kevinOn = (state: GameState) =>
    state.staff.find(({ candidate }) => candidate === WHO)

  it('warns once, a week before quitting, then leaves with no notice', () => {
    expect(STAFF.roles.camion.hourlyWageCents.start).toBeLessThan(
      askingWage(WHO, 'camion'),
    )
    const all = mornings(70)
    expect(kevinOn(all[1] as GameState)?.underpaidSince).toBe(0)
    expect(dayByDay(all)).toEqual([
      { kind: 'underpaid', candidate: WHO, day: WARNS },
      { kind: 'quit', candidate: WHO, day: QUITS },
    ])
    expect(QUITS - WARNS).toBe(7)
    expect(hasWarned(kevinOn(all[WARNS] as GameState) as Employee, WARNS)).toBe(
      true,
    )
    const gone = all[QUITS + 1] as GameState
    expect(summary(gone).quits).toEqual([WHO])
    expect(gone.staff).toEqual([])
    expect(gone.decisions.staff).toEqual([])
    expect(kevinOn(all[QUITS] as GameState)).toBeDefined()
    const name = STAFF.candidates[WHO].name
    expect(
      entriesOf(gone.journal)
        .filter(({ memo }) => memo.endsWith(name))
        .map(({ memo }) => memo.split(' · ')[0]),
    ).not.toContain(STAFF_MEMO.notice)
    // Gone, he is paid no more.
    const after = all[70] as GameState
    expect(
      entriesOf(after.journal).filter(
        ({ day, memo }) => day > QUITS && memo.endsWith(name),
      ),
    ).toEqual([])
  })

  it('stays when raised in the warning week, even the day before quitting', () => {
    for (const on of [WARNS, QUITS - 1]) {
      const all = mornings(70, { on, make: raise })
      expect(dayByDay(all), `raised on day ${on}`).toEqual([
        { kind: 'underpaid', candidate: WHO, day: WARNS },
      ])
      const last = all[70] as GameState
      expect(kevinOn(last)?.underpaidSince).toBeUndefined()
      expect(last.lastDay?.quits).toBeUndefined()
    }
  })

  it('never warns when raised before the warning', () => {
    const all = mornings(70, { on: WARNS - 2, make: raise })
    expect(dayByDay(all)).toEqual([])
    // Raised on the eve of the warning, the warning morning knows of it.
    const eve = mornings(WARNS, { on: WARNS - 1, make: raise })
    expect(dayByDay(eve)).toEqual([])
  })

  it('quits all the same when raised on the morning they quit, too late', () => {
    const all = mornings(70, { on: QUITS, make: raise })
    expect(dayByDay(all)).toEqual([
      { kind: 'underpaid', candidate: WHO, day: WARNS },
      { kind: 'quit', candidate: WHO, day: QUITS },
    ])
    expect((all[70] as GameState).staff).toEqual([])
  })

  it('says nothing more once let go with notice in the warning week', () => {
    const all = mornings(70, {
      on: WARNS + 2,
      make: (state) => applyDecision(state, { kind: 'fire', candidate: WHO }),
    })
    expect(dayByDay(all)).toEqual([
      { kind: 'underpaid', candidate: WHO, day: WARNS },
    ])
    // Over the whole advance too.
    expect(
      staffNotices(all[WARNS + 2] as GameState, all[70] as GameState),
    ).toEqual([])
  })

  it('brings the warning and the quit when several days are played at once', () => {
    const all = mornings(70)
    const at = (day: number) => all[day] as GameState
    expect(staffNotices(at(50), at(70))).toEqual([
      { kind: 'underpaid', candidate: WHO, day: WARNS },
      { kind: 'quit', candidate: WHO, day: QUITS },
    ])
    expect(staffNotices(at(50), at(60))).toEqual([
      { kind: 'underpaid', candidate: WHO, day: WARNS },
    ])
    expect(staffNotices(at(WARNS), at(70))).toEqual([
      { kind: 'quit', candidate: WHO, day: QUITS },
    ])
    expect(staffNotices(at(10), at(WARNS - 1))).toEqual([])
    expect(staffNotices(at(60), at(60))).toEqual([])
  })

  it('never warns nor quits when paid what they ask', () => {
    const state = game(STAFF, {
      ...hire('camion'),
      hourlyWage: askingWage(WHO, 'camion'),
    } as DecisionChange)
    const all = [state]
    for (let day = 0; day < 70; day += 1) all.push(tick(all[day] as GameState))
    expect(dayByDay(all)).toEqual([])
    expect(kevinOn(all[70] as GameState)?.underpaidSince).toBeUndefined()
  })
})
