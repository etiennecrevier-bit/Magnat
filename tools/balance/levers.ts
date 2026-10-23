import {
  candidateIdSchema,
  type DifficultyId,
  type EventContent,
  type PlaceId,
  type ProductId,
  type RungId,
  type StaffRoleId,
} from '../../src/content/schema.ts'
import { endOfMonth, toCalendar } from '../../src/engine/calendar.ts'
import { startContract } from '../../src/engine/contracts.ts'
import { FOOD_TRUCK } from '../../src/engine/day.ts'
import {
  applyDecision,
  type DecisionChange,
} from '../../src/engine/decisions.ts'
import { DISTRICTS } from '../../src/engine/districts.ts'
import {
  DREAM,
  cashNeeded,
  isBought,
  isPersonal,
  rungOf,
} from '../../src/engine/dream.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { netWorth } from '../../src/engine/netWorth.ts'
import { PLACES } from '../../src/engine/places.ts'
import { STAFF, askingWage } from '../../src/engine/staff.ts'
import type { Day, GameState } from '../../src/engine/types.ts'
import { openingChanges } from './bakery.ts'
import {
  GROWTH_EVENTS,
  grocersBySize,
  signingDay,
  withLetters,
} from './growth.ts'
import {
  NO_SCRIPT,
  changesOn,
  lastDayOf,
  playUntil,
  sensiblePolicy,
  startPlayer,
  type Player,
  type Policy,
  type Script,
  warnedBefore,
} from './sensible.ts'
import { WEEKDAYS } from './strategies.ts'

// The lever check of #298, definition 4: each decision the player can make
// is swept from a few situations reached by play, every setting played on
// from the same morning to the end of month 24, so the settings of a
// lever differ by that lever alone. The settings below are the test grid
// of #298, not tunables of the game. No I/O.

/**
 * Where a lever's settings branch from: `calm`, Oct 1 of year 1, played
 * with every grocer refused; `summer`, June 1 of year 2, with the careful
 * contracts the sensible player signed; `crunch`, the morning after the
 * naive player's first close below zero, every grocer signed at once on
 * the first day one may (#166's trap), or after its lowest close of the
 * first six months when it never goes below zero; `affordable`, the first
 * morning the best strategy, buying nothing, has the cash for a rung of
 * « Le rêve » and those before it, at least three months before the end.
 */
export type SituationId = 'calm' | 'summer' | 'crunch' | 'affordable'

export const SITUATIONS: readonly SituationId[] = [
  'calm',
  'summer',
  'crunch',
  'affordable',
]

/** The first day of `month` (1 = January) in game year `year`, from 1. */
export function firstOf(year: number, month: number): Day {
  for (let day = 0; ; day += 1) {
    const date = toCalendar(day)
    if (date.year === year && date.month === month && date.dayOfMonth === 1) {
      return day
    }
    if (date.year > year) throw new RangeError(`No ${year}-${month}-01`)
  }
}

export const CALM_DAY: Day = firstOf(1, 10)
export const SUMMER_DAY: Day = firstOf(2, 6)
/** The months the naive player's first close below zero is looked for in. */
export const CRUNCH_MONTHS = 6
/** The months a rung's situation leaves before the end, at least. */
export const AFFORDABLE_MONTHS_LEFT = 3

/** The policy a situation's games play on with, a setting's aside. */
export function situationPolicy(situation: SituationId): Policy {
  return situation === 'affordable' ? bestPolicy() : sensiblePolicy()
}

/**
 * The best strategy of #166 for the lever check: every grocer signed at
 * once on the first day one may, nothing bought, the financing refused,
 * only the renewals, the financing and the letters coming up.
 */
export function bestPolicy(): Policy {
  return {
    answers: 'first',
    offers: 'none',
    renewals: true,
    financing: 'refuse',
    restockMargin: null,
    dream: false,
    signAllOn: signingDay(),
  }
}

/** The content the best strategy plays: the renewals, financing, letters. */
export const BEST_EVENTS: EventContent = withLetters(GROWTH_EVENTS)

/** The bakery the best strategy opens on the 1st of month 4, at Facile. */
export function bestScript(difficulty: DifficultyId): Script {
  return difficulty === 'facile'
    ? changesOn(endOfMonth(0, 2) + 1, openingChanges(70, 'louer'))
    : NO_SCRIPT
}

/** A situation's morning, and the content and script it plays on with. */
export interface Situation {
  readonly id: SituationId
  readonly player: Player
  readonly content: EventContent | undefined
  readonly script: Script
}

/** Plays `player` one day, the morning of `player.state.day`. */
function step(
  player: Player,
  policy: Policy,
  content?: EventContent,
  script?: Script,
): Player {
  return playUntil(player, policy, player.state.day, content, script)
}

/**
 * The morning of `situation` (not `affordable`) for seed `seed` at
 * `difficulty`; null when the game ended before it.
 */
export function reachSituation(
  situation: Exclude<SituationId, 'affordable'>,
  seed: number,
  difficulty: DifficultyId,
): Situation | null {
  const start = startPlayer(seed, difficulty)
  const reached = (player: Player): Situation | null =>
    player.state.ended === null
      ? { id: situation, player, content: undefined, script: NO_SCRIPT }
      : null
  switch (situation) {
    case 'calm':
      return reached(
        playUntil(start, { ...sensiblePolicy(), offers: 'none' }, CALM_DAY - 1),
      )
    case 'summer':
      return reached(playUntil(start, sensiblePolicy(), SUMMER_DAY - 1))
    case 'crunch': {
      const naive: Policy = {
        ...sensiblePolicy(),
        offers: 'none',
        signAllOn: signingDay(),
      }
      const last = endOfMonth(0, CRUNCH_MONTHS - 1)
      let player = start
      let lowest: { day: Day; cash: Cents } | null = null
      while (player.state.day <= last && player.state.ended === null) {
        const day = player.state.day
        player = step(player, naive)
        const { cash } = player.memory
        if (cash < 0) return reached(player)
        if (lowest === null || cash < lowest.cash) lowest = { day, cash }
      }
      if (lowest === null) return null
      return reached(playUntil(start, naive, lowest.day))
    }
  }
}

/**
 * For each rung, the first morning seed `seed` at `difficulty`, played by
 * the best strategy buying nothing, has the cash for it and every rung
 * before it on its ladder: the owner's for a personal rung, Encaisse for a
 * company one. Rungs coming soon, and those never affordable at least
 * `AFFORDABLE_MONTHS_LEFT` months before the end of month `months`, are
 * left out.
 */
export function affordableMornings(
  seed: number,
  difficulty: DifficultyId,
  months: number,
): Map<RungId, Situation> {
  const found = new Map<RungId, Situation>()
  if (months <= AFFORDABLE_MONTHS_LEFT) return found
  const policy = bestPolicy()
  const script = bestScript(difficulty)
  const last = lastDayOf(months - AFFORDABLE_MONTHS_LEFT)
  const rungs = [...DREAM.personal, ...DREAM.company].filter(
    (rung) => rung.comingSoon !== true,
  )
  let player = startPlayer(seed, difficulty)
  while (player.state.day <= last && player.state.ended === null) {
    for (const rung of rungs) {
      if (found.has(rung.id)) continue
      const { ladder, index } = rungOf(rung.id)
      const needed = DREAM[ladder]
        .slice(0, index + 1)
        .reduce((total, each) => total + cashNeeded(each), 0)
      const held = isPersonal(rung)
        ? player.state.personal.cash
        : player.memory.cash
      if (held >= needed) {
        found.set(rung.id, {
          id: 'affordable',
          player,
          content: BEST_EVENTS,
          script,
        })
      }
    }
    player = step(player, policy, BEST_EVENTS, script)
  }
  return found
}

/** One way to set a lever, played on from a situation's morning. */
export interface Setting {
  readonly id: string
  /** What the setting decides on the branch's first morning. */
  readonly decide?: (player: Player) => GameState
  /** How the branch plays on, over the situation's policy. */
  readonly policy?: Partial<Policy>
  /** What it decides on later mornings, on top of the situation's script. */
  readonly script?: (startDay: Day) => Script
}

/** One decision of the player and the settings it is swept over. */
export interface Lever {
  readonly id: string
  /** What the lever is, for the report. */
  readonly label: string
  readonly situations: readonly SituationId[]
  /** For `affordable`, the rung whose morning the lever starts from. */
  readonly rung?: RungId
  /**
   * What every setting decides first, so they share it: a bakery for the
   * baker, a contract for the delivery person, the rungs before a rung.
   */
  readonly setup?: (player: Player) => GameState
  /** The setting the situation's policy plays, the one others beat or not. */
  readonly baseline: string
  readonly settings: readonly Setting[]
  /** The product whose « trop cher » the branches count, for a price. */
  readonly product?: ProductId
  /**
   * Whether the baseline is doing nothing (no hire, no bakery, no rung),
   * so a lever whose other settings never beat it never pays (#255).
   */
  readonly action?: boolean
}

const EVERYDAY: readonly SituationId[] = ['calm', 'summer', 'crunch']

function decided(...changes: DecisionChange[]): (player: Player) => GameState {
  return ({ state }) =>
    changes.reduce((each, change) => applyDecision(each, change), state)
}

/** The prices a price lever tries: $2.50 to $5.50 by 50¢, and the start. */
export const PRICE_GRID: readonly Cents[] = [
  250, 300, 350, 400, 450, 500, 550,
].map(cents)

function priceLever(product: ProductId): Lever {
  const start = FOOD_TRUCK.startingDecisions.pricesCents[product]
  const prices = [...new Set([...PRICE_GRID, start])].toSorted((a, b) => a - b)
  const lemonade = product === 'limonade'
  return {
    id: `price-${product}`,
    label: `Price of ${product}`,
    situations: lemonade ? ['summer'] : EVERYDAY,
    product,
    // Lemonade sells only when some is bought.
    setup: lemonade
      ? decided({
          kind: 'restock',
          product,
          rule: { kind: 'buyDaily', quantity: 40 },
        })
      : undefined,
    baseline: 'start',
    settings: prices.map((price) => ({
      id: price === start ? 'start' : `${price}`,
      decide: decided({ kind: 'price', product, price }),
    })),
  }
}

function topUpLever(product: 'cafe' | 'chocolat'): Lever {
  const rule = FOOD_TRUCK.startingDecisions.restock[product]
  if (rule.kind !== 'topUp') throw new Error(`${product} is not topped up`)
  // Within the most units a rule may name.
  const { max } = FOOD_TRUCK.decisionLimits.units
  return {
    id: `restock-${product}`,
    label: `Restock of ${product} (top-up rule scaled, within the limit)`,
    situations: EVERYDAY,
    baseline: '1x',
    settings: [0.5, 1, 2].map((scale) => ({
      id: `${scale}x`,
      decide: decided({
        kind: 'restock',
        product,
        rule: {
          kind: 'topUp',
          whenBelow: Math.min(max, Math.round(rule.whenBelow * scale)),
          upTo: Math.min(max, Math.round(rule.upTo * scale)),
        },
      }),
    })),
  }
}

function hireLever(role: StaffRoleId): Lever {
  const setup =
    role === 'boulanger'
      ? decided(
          { kind: 'openBakery', oven: 'louer' },
          {
            kind: 'croissantSource',
            source: 'fabriquer',
          },
        )
      : role === 'livreur'
        ? withContract
        : undefined
  return {
    id: `hire-${role}`,
    label: `Hire ${STAFF.roles[role].name}`,
    situations: EVERYDAY,
    setup,
    baseline: 'none',
    action: true,
    settings: [
      { id: 'none' },
      ...candidateIdSchema.options.map((candidate) => ({
        id: candidate,
        decide: decided({
          kind: 'hire',
          role,
          candidate,
          hourlyWage: askingWage(candidate, role),
        }),
      })),
    ],
  }
}

/** The smallest grocer signed, unless a contract runs already. */
function withContract({ state }: Player): GameState {
  if (state.contracts.running.length > 0) return state
  const [smallest] = grocersBySize()
  if (smallest === undefined) return state
  return {
    ...state,
    contracts: startContract(state.contracts, state.day, smallest),
  }
}

/** Every grocer signed now, those already running aside. */
function signAll({ state }: Player): GameState {
  return {
    ...state,
    contracts: grocersBySize().reduce(
      (contracts, grocer) => startContract(contracts, state.day, grocer),
      state.contracts,
    ),
  }
}

const TRIP_WEEKDAY = 3

/** Sends the owner to `place` on the mornings `when` picks, if it can. */
function tripScript(
  place: PlaceId,
  when: (day: Day, startDay: Day) => boolean,
): (startDay: Day) => Script {
  return (startDay) =>
    ({ state }) => {
      if (!when(state.day, startDay)) return state
      try {
        return applyDecision(state, { kind: 'goTo', place })
      } catch (error) {
        if (error instanceof RangeError) return state
        throw error
      }
    }
}

function tripLever(place: PlaceId): Lever {
  const wednesday = (day: Day) => toCalendar(day).weekday === TRIP_WEEKDAY
  return {
    id: `trip-${place}`,
    label: `Trips to ${place}`,
    situations: EVERYDAY,
    baseline: 'never',
    action: true,
    settings: [
      { id: 'never' },
      {
        id: 'once',
        script: tripScript(
          place,
          (day, startDay) => wednesday(day) && day < startDay + 7,
        ),
      },
      { id: 'weekly', script: tripScript(place, (day) => wednesday(day)) },
    ],
  }
}

function rungLever(rung: RungId): Lever {
  const { ladder, index } = rungOf(rung)
  const before = DREAM[ladder].slice(0, index).map(({ id }) => id)
  const buy = (player: Player): GameState => {
    let { state } = player
    state = applyDecision(state, { kind: 'buy', rung })
    const added = DREAM.company.find((each) => each.id === rung)?.addsTruck
    if (added === undefined) return state
    // A truck opens the morning someone works there: hire and send one.
    const candidate = 'kevin'
    state = applyDecision(state, {
      kind: 'hire',
      role: 'camion',
      candidate,
      hourlyWage: askingWage(candidate, 'camion'),
    })
    return applyDecision(state, {
      kind: 'assign',
      candidate,
      truck: added.id,
    })
  }
  return {
    id: `rung-${rung}`,
    label: `Buy « ${rungOf(rung).rung.name} »`,
    situations: ['affordable'],
    rung,
    setup: ({ state }) =>
      before.reduce(
        (each, id) =>
          isBought(each.dream, id)
            ? each
            : applyDecision(each, { kind: 'buy', rung: id }),
        state,
      ),
    baseline: 'skip',
    action: true,
    settings: [{ id: 'skip' }, { id: 'buy', decide: buy }],
  }
}

/** Every lever of #298's definition 4, with its settings. */
export function levers(): Lever[] {
  const storage = DISTRICTS.winterStorage
  return [
    priceLever('cafe'),
    priceLever('chocolat'),
    priceLever('croissant'),
    priceLever('limonade'),
    {
      id: 'restock-croissant',
      label: 'Croissants bought each morning',
      situations: EVERYDAY,
      baseline: 'adaptive',
      settings: [
        { id: 'adaptive' },
        ...[40, 70, 110].map((quantity) => ({
          id: `${quantity}`,
          policy: { restockMargin: null },
          decide: decided({
            kind: 'restock',
            product: 'croissant',
            rule: { kind: 'buyDaily', quantity },
          }),
        })),
      ],
    },
    topUpLever('cafe'),
    topUpLever('chocolat'),
    {
      id: 'restock-limonade',
      label: 'Lemonade bought each morning',
      situations: ['summer'],
      baseline: '0',
      action: true,
      settings: [0, 20, 40, 80].map((quantity) => ({
        id: `${quantity}`,
        decide: decided({
          kind: 'restock',
          product: 'limonade',
          rule: { kind: 'buyDaily', quantity },
        }),
      })),
    },
    {
      id: 'days-open',
      label: 'Days open a week',
      situations: EVERYDAY,
      baseline: '6',
      settings: ([5, 6, 7] as const).map((days) => ({
        id: `${days}`,
        decide: decided({ kind: 'daysOpen', weekdays: WEEKDAYS[days] }),
      })),
    },
    {
      id: 'owner-pay',
      label: "Owner's weekly pay",
      situations: EVERYDAY,
      baseline: '700',
      settings: [400, 700, 1000].map((dollars) => ({
        id: `${dollars}`,
        decide: decided({ kind: 'ownerWeeklyPay', pay: cents(dollars * 100) }),
      })),
    },
    {
      id: 'marketing',
      label: 'Marketing a day',
      situations: EVERYDAY,
      baseline: '30',
      settings: [0, 30, 80].map((dollars) => ({
        id: `${dollars}`,
        decide: decided({
          kind: 'marketingDaily',
          budget: cents(dollars * 100),
        }),
      })),
    },
    {
      id: 'contracts',
      label: "Grocers' contracts",
      situations: EVERYDAY,
      baseline: 'careful',
      settings: [
        { id: 'careful' },
        { id: 'none', policy: { offers: 'none', renewals: false } },
        { id: 'all-offers', policy: { offers: 'all' } },
        { id: 'three-now', decide: signAll, policy: { offers: 'none' } },
      ],
    },
    {
      id: 'bakery',
      label: 'Open the bakery (the owner bakes)',
      situations: EVERYDAY,
      baseline: 'never',
      action: true,
      settings: [
        { id: 'never' },
        ...(['louer', 'acheter'] as const).map((oven) => ({
          id: oven,
          decide: decided(
            { kind: 'openBakery', oven },
            { kind: 'croissantSource', source: 'fabriquer' },
          ),
        })),
      ],
    },
    {
      id: 'croissant-source',
      label: 'Croissants made or bought, the bakery open',
      situations: EVERYDAY,
      setup: decided({ kind: 'openBakery', oven: 'louer' }),
      baseline: 'fabriquer',
      settings: (['fabriquer', 'acheter'] as const).map((source) => ({
        id: source,
        decide: decided({ kind: 'croissantSource', source }),
      })),
    },
    {
      id: 'production',
      label: 'Croissants baked each morning',
      situations: EVERYDAY,
      setup: decided(
        { kind: 'openBakery', oven: 'louer' },
        { kind: 'croissantSource', source: 'fabriquer' },
      ),
      baseline: 'adaptive',
      settings: [
        { id: 'adaptive' },
        ...[110, 150, 200].map((quantity) => ({
          id: `${quantity}`,
          policy: { restockMargin: null },
          decide: decided({
            kind: 'bake',
            rule: { kind: 'buyDaily', quantity },
          }),
        })),
      ],
    },
    hireLever('camion'),
    hireLever('livreur'),
    hireLever('boulanger'),
    {
      id: 'wage-camion',
      label: 'Wage of an employee at the truck',
      situations: EVERYDAY,
      setup: decided({ kind: 'hire', role: 'camion', candidate: 'amelie' }),
      baseline: 'asking',
      settings: [
        ['min', STAFF.roles.camion.hourlyWageCents.min],
        ['asking', askingWage('amelie', 'camion')],
        ['max', STAFF.roles.camion.hourlyWageCents.max],
      ].map(([id, hourlyWage]) => ({
        id: String(id),
        decide: decided({
          kind: 'setWage',
          candidate: 'amelie',
          hourlyWage: cents(Number(hourlyWage)),
        }),
      })),
    },
    {
      id: 'fire-camion',
      label: 'Let an employee at the truck go after 13 weeks',
      situations: EVERYDAY,
      setup: decided({
        kind: 'hire',
        role: 'camion',
        candidate: 'amelie',
        hourlyWage: askingWage('amelie', 'camion'),
      }),
      baseline: 'keep',
      settings: [
        { id: 'keep' },
        {
          id: 'fire',
          script: (startDay: Day) =>
            changesOn(startDay + 91, [{ kind: 'fire', candidate: 'amelie' }]),
        },
      ],
    },
    ...PLACES.places
      .filter(({ effect }) => effect.kind !== 'filing')
      .map(({ id }) => tripLever(id)),
    {
      id: 'financing',
      label: 'Emergency financing',
      situations: EVERYDAY,
      baseline: 'accept',
      settings: (['accept', 'loanOnly', 'refuse'] as const).map(
        (financing) => ({ id: financing, policy: { financing } }),
      ),
    },
    {
      id: 'storage',
      label: "« Remiser pour l'hiver »",
      situations: ['calm'],
      baseline: 'no',
      action: true,
      settings: [
        { id: 'no' },
        { id: 'store', decide: decided({ kind: 'storage', storage }) },
      ],
    },
    ...[...DREAM.personal, ...DREAM.company]
      .filter((rung) => rung.comingSoon !== true)
      .map(({ id }) => rungLever(id)),
  ]
}

/** One branch played, as the analysis reads it. */
export interface BranchGame {
  readonly netWorth: Cents
  readonly bankrupt: boolean
  /**
   * Whether a bankruptcy had a close below zero and Mme Prudhomme's three
   * letters first; true for a game that did not end.
   */
  readonly warned: boolean
  /** The lever's product's « trop cher » a day the truck opened. */
  readonly pricedOut: number
}

/**
 * Plays `setting` of `lever` from `situation`'s morning to the close of
 * month `months`: the lever's setup, then the setting's decision, through
 * `applyDecision`, then the situation's policy with the setting's over it.
 * Null when the setup or the setting cannot be decided there, as the game
 * would refuse it.
 */
export function playBranch(
  situation: Situation,
  lever: Lever,
  setting: Setting,
  months: number,
): BranchGame | null {
  let player = situation.player
  const startDay = player.state.day
  try {
    if (lever.setup !== undefined) {
      player = { ...player, state: lever.setup(player) }
    }
    if (setting.decide !== undefined) {
      player = { ...player, state: setting.decide(player) }
    }
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
  const policy = { ...situationPolicy(situation.id), ...setting.policy }
  const own = setting.script?.(startDay) ?? NO_SCRIPT
  const script: Script = (morning) =>
    own({ ...morning, state: situation.script(morning) })
  const last = lastDayOf(months)
  let pricedOut = 0
  let opened = 0
  while (player.state.day <= last && player.state.ended === null) {
    player = step(player, policy, situation.content, script)
    const day = player.state.lastDay
    if (day !== null && day.visits.length > 0) {
      opened += 1
      if (lever.product !== undefined) pricedOut += day.pricedOut[lever.product]
    }
  }
  const { state, memory } = player
  return {
    netWorth: netWorth(state),
    bankrupt: state.ended !== null,
    warned: warnedBefore(state, memory.firstDayBelowZero),
    pricedOut: opened === 0 ? 0 : pricedOut / opened,
  }
}
