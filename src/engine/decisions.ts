import {
  candidateIdSchema,
  croissantSourceSchema,
  decisionKindSchema,
  ovenTermsSchema,
  staffRoleIdSchema,
  winterStorageSchema,
  type BakeryContent,
  type CandidateId,
  type CroissantSource,
  type DecisionKind,
  type DecisionLimits,
  type DefiContent,
  type DifficultyContent,
  type DreamContent,
  type FoodTruckContent,
  type OvenTerms,
  type PlaceId,
  type PlacesContent,
  type ProductId,
  type RestockRule,
  type RungId,
  type StaffContent,
  type StaffRoleId,
  type WinterStorage,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, postEntry } from '../finance/journal.ts'
import { BAKERY, holdsPremises, morningBakery } from './bakery.ts'
import { isLocked } from './challenge.ts'
import { DEFIS, DIFFICULTIES, FOOD_TRUCK, truckOnBooks } from './day.ts'
import {
  DREAM,
  cashNeeded,
  dreamBonuses,
  dreamLimits,
  isBought,
  isPersonal,
  isRungId,
  prerequisitesMet,
  purchaseCost,
  purchaseEntries,
  purchaseMovements,
  rungOf,
} from './dream.ts'
import { PRODUCTS } from './inventory.ts'
import type { Cents } from './money.ts'
import { addMovement } from './personal.ts'
import { PLACES, goTo } from './places.ts'
import { completeStep } from './tutorial.ts'
import { STAFF } from './staff.ts'
import {
  FIRST_TRUCK,
  hasTruck,
  newTruck,
  truckDecisionsOf,
  withTruckDecisions,
} from './trucks.ts'
import type {
  BakeryPlan,
  BakeryState,
  Decisions,
  GameState,
  Hire,
  TruckDecisions,
  TruckId,
} from './types.ts'

// The player's decisions: how the truck runs, from its prices to the days it
// opens, the bakery that makes its croissants and the employees. A change
// waits in `pendingDecisions` until the next morning, so a day is always
// played with the decisions it began with.

// ISO 8601 weekdays run from 1 = Monday to 7 = Sunday; a calendar fact.
const MONDAY = 1
const SUNDAY = 7

const CASH: AccountCode = '1000'

/** The role whose employees work at a truck, the only one assigned to one. */
const AT_TRUCK = 'camion'

/** One change the player makes to how the truck runs. */
export type DecisionChange =
  | {
      readonly kind: 'price'
      readonly product: ProductId
      readonly price: Cents
      /** The truck whose price it is (#259); the first one when absent. */
      readonly truck?: TruckId
    }
  | {
      readonly kind: 'restock'
      readonly product: ProductId
      readonly rule: RestockRule
      /** The truck whose rule it is (#259); the first one when absent. */
      readonly truck?: TruckId
    }
  | {
      readonly kind: 'daysOpen'
      /** The ISO weekdays the truck opens, in any order. */
      readonly weekdays: readonly number[]
      /** The truck whose days they are (#259); the first one when absent. */
      readonly truck?: TruckId
    }
  | {
      /**
       * « Remiser pour l'hiver » (#260): the dates the truck is stored each
       * year from the next morning on, or null to store it no more.
       */
      readonly kind: 'storage'
      readonly storage: WinterStorage | null
      /** The truck stored (#260); the first one when absent. */
      readonly truck?: TruckId
    }
  | {
      /** The truck the owner works at from the next morning on (#259). */
      readonly kind: 'ownerAt'
      readonly truck: TruckId
    }
  | {
      /**
       * The truck an employee « Au camion », hired or wanted, works at from
       * the next morning on (#259).
       */
      readonly kind: 'assign'
      readonly candidate: CandidateId
      readonly truck: TruckId
    }
  | { readonly kind: 'ownerWeeklyPay'; readonly pay: Cents }
  | { readonly kind: 'marketingDaily'; readonly budget: Cents }
  | {
      readonly kind: 'openBakery'
      /** How its oven comes: leased by the month, or bought once. */
      readonly oven: OvenTerms
    }
  | { readonly kind: 'closeBakery' }
  | { readonly kind: 'croissantSource'; readonly source: CroissantSource }
  | {
      readonly kind: 'bake'
      /** How many croissants the bakery makes each morning. */
      readonly rule: RestockRule
    }
  | {
      readonly kind: 'hire'
      readonly role: StaffRoleId
      readonly candidate: CandidateId
      /** What they earn an hour; the role's starting wage when absent. */
      readonly hourlyWage?: Cents
    }
  | { readonly kind: 'fire'; readonly candidate: CandidateId }
  | {
      readonly kind: 'setWage'
      readonly candidate: CandidateId
      /** What they earn an hour. */
      readonly hourlyWage: Cents
    }
  | {
      /** Buys a rung of « Le rêve » that very morning. */
      readonly kind: 'buy'
      readonly rung: RungId
    }
  | {
      /**
       * Sends the owner to a place in town that very day, or keeps them at
       * the truck when it is null (#164).
       */
      readonly kind: 'goTo'
      readonly place: PlaceId | null
    }
  | {
      /** Marks the tutorial's step done, as the UI saw its gesture (#236). */
      readonly kind: 'tutorialStep'
      readonly step: string
    }

/**
 * The decisions a game starts with, from the content: the truck's, then no
 * bakery, the croissants as `bakery` has them, and nobody on staff. Throws a
 * RangeError if they break the content's own limits (see
 * `validateDecisions`).
 */
export function startingDecisions(
  content: FoodTruckContent = FOOD_TRUCK,
  bakery: BakeryContent = BAKERY,
): Decisions {
  const start = content.startingDecisions
  const decisions: Decisions = {
    prices: { ...start.pricesCents },
    restock: perProductRule((product) => start.restock[product]),
    daysOpen: ascending(start.daysOpen),
    ownerWeeklyPay: start.ownerWeeklyPayCents,
    marketingDaily: start.marketingDailyCents,
    bakery: null,
    croissantSource: bakery.startingDecisions.croissantSource,
    bake: copied(bakery.startingDecisions.bake),
    staff: [],
  }
  validateDecisions(decisions, content.decisionLimits, bakery)
  return decisions
}

/**
 * The decisions as the player last left them: those waiting for the next
 * morning, or else those of the day under way.
 */
export function latestDecisions(state: GameState): Decisions {
  return state.pendingDecisions ?? state.decisions
}

/**
 * Makes `change` on top of the latest decisions and leaves the result
 * waiting for the next morning, when `tick()` puts it in effect. The day
 * under way keeps its decisions. Returns a new state; never mutates `state`.
 *
 * `openBakery` plans a bakery and how its oven comes, and `closeBakery`
 * drops the plan, so the next morning opens the bakery or gives its notice
 * (see `bakeryMorning`). A bakery that still holds its premises that
 * morning, one the day under way opens included, keeps the oven it has
 * until it closes: planning it again takes a notice back.
 *
 * Throws a RangeError, naming the field, if the change names an unknown
 * kind or product, gives a product another kind of restock rule than it has,
 * or leaves the decisions outside the limits of `content` and `bakery` (see
 * `validateDecisions`); one if `openBakery` comes with a bakery already
 * planned, leases an oven when the business owns one or buys one that day,
 * or gives a bakery that holds its premises the next morning other oven
 * terms, or if `closeBakery` comes with none planned; and one naming the
 * kind if the game's Défi, one of `defis`, locks it. A Défi locks none of
 * the bakery's changes.
 *
 * `hire` adds the candidate to the staff the player wants, after the
 * others, at the hourly wage it names, or else their role's starting wage
 * in `staff`; `fire` takes them out,
 * which costs nothing for a hire who has not started yet; `setWage` gives
 * them another hourly wage. The next morning hires, lets go and pays as the
 * staff then wants (see `staffMorning`). Throws a RangeError if `hire` names
 * a candidate already wanted or who works the day under way, or a role or
 * candidate `staff` does not know, if `fire` or `setWage` names one not
 * wanted, or if the staff then breaks `staff`'s limits (see
 * `validateDecisions`). A Défi locks none of these either.
 *
 * A restock rule may name the more units the rungs of « Le rêve » owned
 * allow, with `dream` (see `dreamLimits`).
 *
 * `price`, `restock` and `daysOpen` change the truck they name, the first
 * one when they name none (#259); `ownerAt` puts the owner at a truck, and
 * `assign` an employee « Au camion » the player wants, at a truck. Throws a
 * RangeError for a truck the game does not have, and for `assign`, for a
 * candidate the player does not want, or in another role.
 *
 * `storage` stores the truck it names, the first one when it names none,
 * each year from its `from` to its `to`, both included (see `isStored`),
 * or no more when null (#260). Throws a RangeError for a date no year has.
 *
 * `buy` and `goTo` are the changes that do not wait: `buy` buys the rung
 * of `dream` on the morning of `state.day`, before the day is played (see
 * `bought`), and `goTo` sends the owner to a place of `places` that day,
 * or keeps them at the truck, in place of the trip chosen before (see
 * `goTo` in places.ts, which says when it throws a RangeError).
 * `tutorialStep` does not wait either: it marks the tutorial's step done
 * that morning (see `completeStep`, which says when it throws a
 * RangeError).
 */
export function applyDecision(
  state: GameState,
  change: DecisionChange,
  content: FoodTruckContent = FOOD_TRUCK,
  defis: DefiContent = DEFIS,
  bakery: BakeryContent = BAKERY,
  staff: StaffContent = STAFF,
  dream: DreamContent = DREAM,
  difficulties: DifficultyContent = DIFFICULTIES,
  places: PlacesContent = PLACES,
): GameState {
  if (change.kind === 'buy') {
    return bought(state, change.rung, content, dream, difficulties)
  }
  if (change.kind === 'goTo') {
    return goTo(state, change.place, places, undefined, undefined, content)
  }
  if (change.kind === 'tutorialStep') return completeStep(state, change.step)
  if (isLockable(change.kind) && isLocked(state, change.kind, defis)) {
    throw new RangeError(
      `Invalid decision: the Défi ${state.challenge?.id} locks ${change.kind}`,
    )
  }
  const decisions = changed(
    state,
    latestDecisions(state),
    change,
    bakery,
    staff,
  )
  validateDecisions(
    decisions,
    dreamLimits(content.decisionLimits, dreamBonuses(state.dream, dream)),
    bakery,
    staff,
  )
  validateTrucks(decisions, state)
  return { ...state, pendingDecisions: ordered(decisions) }
}

/**
 * `decisions` with the owner's truck, the other trucks' decisions and the
 * first truck's storage last, in that order, when they are there: the order a save holds them in, so a
 * game saved and loaded writes the same save.
 */
function ordered(decisions: Decisions): Decisions {
  const { ownerAt, trucks, storage, ...rest } = decisions
  return {
    ...rest,
    ...(ownerAt === undefined ? {} : { ownerAt }),
    ...(trucks === undefined ? {} : { trucks }),
    ...(storage === undefined ? {} : { storage }),
  }
}

/**
 * The morning of `state.day` with the rung `id` of `dream` bought. A
 * personal rung moves the owner's cash (see `purchaseMovements`), selling
 * back the rung it sells first; a company rung posts its entries, dated
 * that day, before the day's own (see `purchaseEntries`), with the truck on
 * the books that morning when it replaces it (see `truckOnBooks`). The rung
 * joins `dream.bought` with what it cost (see `purchaseCost`). A rung that
 * adds a truck (#259) adds it to `state.trucks`, with its own generator and
 * no stock (see `newTruck`), run as the first truck is in the decisions of
 * the day under way and in those waiting, if any, so it opens the first
 * morning someone works there.
 *
 * Throws a RangeError in a Défi, once the game has ended or the day is
 * played, for an id that is no rung, one bought already, one coming
 * soon, one whose ladder has a rung before it not bought yet, and when the
 * cash it needs is not on hand (see `cashNeeded`): the owner's own for a
 * personal rung, Encaisse for a company one.
 */
function bought(
  state: GameState,
  id: RungId,
  content: FoodTruckContent,
  dream: DreamContent,
  difficulties: DifficultyContent,
): GameState {
  const { day, journal, personal } = state
  const refuse = (reason: string): never => {
    throw new RangeError(
      `Invalid decision: cannot buy ${String(id)}, ${reason}`,
    )
  }
  if (state.challenge !== null) refuse('a Défi has no dream')
  if (state.ended !== null) refuse('the game has ended')
  if (state.lastDay?.day === day) refuse(`day ${day} is played already`)
  if (!isRungId(id)) refuse('it is no rung')
  const { rung } = rungOf(id, dream)
  if (isBought(state.dream, id)) refuse('it is bought already')
  if (rung.comingSoon === true) refuse('it is not for sale yet')
  if (!prerequisitesMet(state.dream, id, dream)) {
    refuse('a rung before it is not bought yet')
  }
  const needed = cashNeeded(rung, dream)
  if (isPersonal(rung)) {
    if (personal.cash < needed) {
      refuse(`the owner has ${personal.cash}, not ${needed}`)
    }
    return {
      ...state,
      personal: purchaseMovements(rung, day, dream).reduce(
        (account, { label, amount }) =>
          addMovement(account, day, label, amount),
        personal,
      ),
      dream: {
        ...state.dream,
        bought: [
          ...state.dream.bought,
          { rung: id, day, cost: rung.priceCents },
        ],
      },
    }
  }
  const cash = balance(journal, CASH, { toDay: day })
  if (cash < needed) refuse(`Encaisse holds ${cash}, not ${needed}`)
  const truck = truckOnBooks(
    journal,
    day,
    state.profile.difficulty,
    content,
    difficulties,
  )
  const purchased: GameState = {
    ...state,
    journal: purchaseEntries(rung, day, truck).reduce(postEntry, journal),
    dream: {
      ...state.dream,
      bought: [
        ...state.dream.bought,
        { rung: id, day, cost: purchaseCost(rung, truck) },
      ],
    },
  }
  const { addsTruck } = rung
  if (addsTruck === undefined) return purchased
  if (hasTruck(state, addsTruck.id))
    refuse(`${addsTruck.id} is a truck already`)
  const run = (decisions: Decisions): Decisions =>
    ordered({
      ...decisions,
      trucks: {
        ...decisions.trucks,
        [addsTruck.id]: copiedTruck(truckDecisionsOf(decisions, FIRST_TRUCK)),
      },
    })
  return {
    ...purchased,
    trucks: [...(state.trucks ?? []), newTruck(state.seed, addsTruck, day)],
    decisions: run(state.decisions),
    pendingDecisions:
      state.pendingDecisions === null ? null : run(state.pendingDecisions),
  }
}

/** A copy of `storage`, which `validateDecisions` checks. */
function storedFrom(storage: WinterStorage): WinterStorage {
  const { from, to } = storage
  return { from: { ...from }, to: { ...to } }
}

/** A copy of `truck`, so two trucks never share their rules' objects. */
function copiedTruck(truck: TruckDecisions): TruckDecisions {
  return {
    prices: { ...truck.prices },
    restock: perProductRule((product) => truck.restock[product]),
    daysOpen: [...truck.daysOpen],
  }
}

/** Whether a Défi may lock changes of `kind`. */
function isLockable(kind: DecisionChange['kind']): kind is DecisionKind {
  return (decisionKindSchema.options as readonly string[]).includes(kind)
}

/**
 * Throws a RangeError naming the first field outside `limits`. Prices must be
 * whole multiples of the step within their range. Restock rules must name
 * whole numbers of units within their range, with `whenBelow` no higher
 * than `upTo`. The owner's pay and the marketing budget must be whole cents
 * within their ranges. The days open must be ascending ISO weekdays with no
 * repeats, at least `minDaysOpen` of them. Every product needs a price and a
 * rule, and no other key may appear. The bakery planned, if any, needs oven
 * terms, the croissants a source, and the bake rule, of either kind, whole
 * numbers of units from 0 to `bakery.capacityPerDay`, with `whenBelow` no
 * higher than `upTo`. The staff holds at most `staff.maxEmployees`, each a
 * different candidate of `staff`, in one of its roles, at an hourly wage of
 * whole cents within the role's range. Each truck after the first, if any,
 * has its prices, restock rules and days open held to the same limits, and
 * the owner's truck, if named, is a word; `validateTrucks` checks the
 * trucks named exist.
 */
export function validateDecisions(
  decisions: Decisions,
  limits: DecisionLimits,
  bakery: BakeryContent = BAKERY,
  staff: StaffContent = STAFF,
): void {
  expectTruck('', decisions, limits)
  for (const [id, truck] of Object.entries(decisions.trucks ?? {})) {
    if (id === FIRST_TRUCK) {
      throw new RangeError(
        `Invalid decision: trucks.${id} is the first truck, whose decisions are not in trucks`,
      )
    }
    expectTruck(`trucks.${id}.`, truck, limits)
  }
  if (
    decisions.ownerAt !== undefined &&
    (typeof decisions.ownerAt !== 'string' || decisions.ownerAt === '')
  ) {
    throw new RangeError(
      `Invalid decision: ownerAt must name a truck: ${String(decisions.ownerAt)}`,
    )
  }
  expectWithin(
    'ownerWeeklyPay',
    decisions.ownerWeeklyPay,
    limits.ownerWeeklyPayCents,
  )
  expectWithin(
    'marketingDaily',
    decisions.marketingDaily,
    limits.marketingDailyCents,
  )
  expectPlan(decisions.bakery)
  if (!croissantSourceSchema.safeParse(decisions.croissantSource).success) {
    throw new RangeError(
      `Invalid decision: croissantSource must be one of ${croissantSourceSchema.options.join(', ')}: ${String(decisions.croissantSource)}`,
    )
  }
  expectRule('bake', decisions.bake, {
    min: 0,
    max: bakery.capacityPerDay,
  })
  validateStaff(decisions.staff, staff)
}

/**
 * Throws a RangeError naming the first field of a truck's decisions outside
 * `limits`, its name after `field`: its prices, restock rules and days
 * open (see `validateDecisions`), and its storage, if any, unless both its
 * dates are days of a year.
 */
function expectTruck(
  field: string,
  truck: TruckDecisions,
  limits: DecisionLimits,
): void {
  expectProducts(`${field}prices`, truck.prices)
  expectProducts(`${field}restock`, truck.restock)
  for (const product of PRODUCTS) {
    const price = truck.prices[product]
    expectWithin(`${field}prices.${product}`, price, limits.priceCents)
    if (price % limits.priceCents.step !== 0) {
      throw new RangeError(
        `Invalid decision: ${field}prices.${product} must be a multiple of ${limits.priceCents.step}: ${price}`,
      )
    }
    expectRule(
      `${field}restock.${product}`,
      truck.restock[product],
      limits.units,
    )
  }
  expectDaysOpen(`${field}daysOpen`, truck.daysOpen, limits.minDaysOpen)
  if (
    truck.storage !== undefined &&
    !winterStorageSchema.safeParse(truck.storage).success
  ) {
    throw new RangeError(
      `Invalid decision: ${field}storage must run between two days of a year: ${JSON.stringify(truck.storage)}`,
    )
  }
}

/**
 * Throws a RangeError unless every truck `decisions` name is one of
 * `state`'s (#259): those it runs after the first, the owner's and each
 * employee's « Au camion ». The first truck is never named.
 */
export function validateTrucks(
  decisions: Decisions,
  state: Pick<GameState, 'trucks'>,
): void {
  const ids = (state.trucks ?? []).map(({ id }) => id)
  const run = Object.keys(decisions.trucks ?? {})
  if (run.join() !== ids.join()) {
    throw new RangeError(
      `Invalid decision: trucks must run exactly ${ids.join(', ') || 'none'}, in order: ${run.join(', ') || 'none'}`,
    )
  }
  if (decisions.ownerAt !== undefined && !ids.includes(decisions.ownerAt)) {
    throw new RangeError(
      `Invalid decision: ownerAt names no truck after the first: ${decisions.ownerAt}`,
    )
  }
  decisions.staff.forEach(({ candidate, truck }, index) => {
    if (truck !== undefined && !ids.includes(truck)) {
      throw new RangeError(
        `Invalid decision: staff.${index}.truck, ${candidate}'s, names no truck after the first: ${truck}`,
      )
    }
  })
}

/** The truck `id` of `state`; throws a RangeError for one it does not have. */
function existing(state: GameState, id: TruckId): TruckId {
  if (!hasTruck(state, id)) {
    throw new RangeError(`Invalid decision: unknown truck ${String(id)}`)
  }
  return id
}

/**
 * `decisions` with the truck `id`, the first one when undefined, changed
 * by `change`.
 */
function changedTruck(
  state: GameState,
  decisions: Decisions,
  id: TruckId | undefined,
  change: (truck: TruckDecisions) => TruckDecisions,
): Decisions {
  const truck = existing(state, id ?? FIRST_TRUCK)
  return withTruckDecisions(
    decisions,
    truck,
    change(truckDecisionsOf(decisions, truck)),
  )
}

function changed(
  state: GameState,
  decisions: Decisions,
  change: DecisionChange,
  bakery: BakeryContent,
  staff: StaffContent,
): Decisions {
  switch (change.kind) {
    case 'price':
      return changedTruck(state, decisions, change.truck, (truck) => ({
        ...truck,
        prices: { ...truck.prices, [known(change.product)]: change.price },
      }))
    case 'restock':
      return changedTruck(state, decisions, change.truck, (truck) => {
        const product = known(change.product)
        const { kind } = truck.restock[product]
        if (change.rule.kind !== kind) {
          throw new RangeError(
            `Invalid decision: restock.${product} must stay a ${kind} rule: ${change.rule.kind}`,
          )
        }
        return {
          ...truck,
          restock: { ...truck.restock, [product]: copied(change.rule) },
        }
      })
    case 'daysOpen':
      return changedTruck(state, decisions, change.truck, (truck) => ({
        ...truck,
        daysOpen: ascending(change.weekdays),
      }))
    case 'storage':
      return changedTruck(state, decisions, change.truck, (truck) => {
        const rest = { ...truck }
        delete rest.storage
        return change.storage === null
          ? rest
          : { ...rest, storage: storedFrom(change.storage) }
      })
    case 'ownerAt': {
      const truck = existing(state, change.truck)
      const rest = { ...decisions }
      delete rest.ownerAt
      return truck === FIRST_TRUCK ? rest : { ...rest, ownerAt: truck }
    }
    case 'assign': {
      const truck = existing(state, change.truck)
      planned(decisions, change.candidate)
      return {
        ...decisions,
        staff: decisions.staff.map((hire) => {
          if (hire.candidate !== change.candidate) return hire
          if (hire.role !== AT_TRUCK) {
            throw new RangeError(
              `Invalid decision: ${hire.candidate} works as ${hire.role}, not at a truck`,
            )
          }
          const rest = { ...hire }
          delete rest.truck
          return truck === FIRST_TRUCK ? rest : { ...rest, truck }
        }),
      }
    }
    case 'ownerWeeklyPay':
      return { ...decisions, ownerWeeklyPay: change.pay }
    case 'marketingDaily':
      return { ...decisions, marketingDaily: change.budget }
    case 'openBakery':
      return {
        ...decisions,
        bakery: opening(state, decisions, change.oven, bakery),
      }
    case 'closeBakery':
      if (decisions.bakery === null) {
        throw new RangeError('Invalid decision: no bakery is planned to close')
      }
      return { ...decisions, bakery: null }
    case 'croissantSource':
      return { ...decisions, croissantSource: change.source }
    case 'bake':
      return { ...decisions, bake: copied(change.rule) }
    case 'hire':
      return {
        ...decisions,
        staff: [...decisions.staff, hired(state, decisions, change, staff)],
      }
    case 'fire':
      planned(decisions, change.candidate)
      return {
        ...decisions,
        staff: decisions.staff.filter(
          ({ candidate }) => candidate !== change.candidate,
        ),
      }
    case 'setWage':
      planned(decisions, change.candidate)
      return {
        ...decisions,
        staff: decisions.staff.map((hire) =>
          hire.candidate === change.candidate
            ? { ...hire, hourlyWage: change.hourlyWage }
            : hire,
        ),
      }
    default:
      throw new RangeError(
        `Unknown decision: ${String((change as { kind: unknown }).kind)}`,
      )
  }
}

/**
 * The hire `change` makes, on top of `decisions`, at the wage it names or
 * else the role's starting wage: the candidate may be neither wanted yet
 * nor at work the day under way, which would make them leave and start
 * again the same morning.
 */
function hired(
  state: GameState,
  decisions: Decisions,
  { role, candidate, hourlyWage }: Extract<DecisionChange, { kind: 'hire' }>,
  staff: StaffContent,
): Hire {
  if (!staffRoleIdSchema.safeParse(role).success) {
    throw new RangeError(`Invalid decision: unknown role ${String(role)}`)
  }
  if (!candidateIdSchema.safeParse(candidate).success) {
    throw new RangeError(`Invalid decision: unknown candidate ${candidate}`)
  }
  if (decisions.staff.some((hire) => hire.candidate === candidate)) {
    throw new RangeError(`Invalid decision: ${candidate} is already hired`)
  }
  if (state.decisions.staff.some((hire) => hire.candidate === candidate)) {
    throw new RangeError(
      `Invalid decision: ${candidate} works on day ${state.day}, so cannot be hired again before the next morning`,
    )
  }
  return {
    candidate,
    role,
    hourlyWage: hourlyWage ?? staff.roles[role].hourlyWageCents.start,
  }
}

/** Throws a RangeError unless `candidate` is in the staff `decisions` want. */
function planned(decisions: Decisions, candidate: CandidateId): void {
  if (!decisions.staff.some((hire) => hire.candidate === candidate)) {
    throw new RangeError(`Invalid decision: ${candidate} is not hired`)
  }
}

/**
 * The bakery `oven` plans, on top of `decisions`: none may be planned yet.
 * The plan takes effect the next morning, on the bakery the day under way
 * leaves (see `bakeryTomorrow`): the business leases no oven while it owns
 * one, bought that day included, and a bakery that still holds its premises
 * that morning keeps its oven terms until it closes.
 */
function opening(
  state: GameState,
  decisions: Decisions,
  oven: OvenTerms,
  content: BakeryContent,
): BakeryPlan {
  if (decisions.bakery !== null) {
    throw new RangeError('Invalid decision: a bakery is already planned')
  }
  const bakery = bakeryTomorrow(state, content)
  if (oven === 'louer' && bakery.ovenBoughtOnDay !== null) {
    throw new RangeError(
      `Invalid decision: bakery.oven cannot be louer, the business owns an oven since day ${bakery.ovenBoughtOnDay}`,
    )
  }
  if (holdsPremises(bakery, state.day + 1) && bakery.oven !== oven) {
    throw new RangeError(
      `Invalid decision: bakery.oven must stay ${bakery.oven} until the bakery closes: ${oven}`,
    )
  }
  return { oven }
}

/**
 * The bakery the next morning finds, before its plan takes effect: the
 * bakery of the last close once the day under way has put its own plan in
 * effect (see `morningBakery`). A bakery that day opens, or whose oven it
 * buys, already counts. At the close of the day, the bakery already is.
 */
function bakeryTomorrow(state: GameState, content: BakeryContent): BakeryState {
  return morningBakery(state.bakery, state.decisions.bakery, state.day, content)
}

function known(product: ProductId): ProductId {
  if (!PRODUCTS.includes(product)) {
    throw new RangeError(`Invalid decision: unknown product ${product}`)
  }
  return product
}

/** The rule's own fields only, so the state never shares the caller's object. */
function copied(rule: RestockRule): RestockRule {
  switch (rule.kind) {
    case 'buyDaily':
      return { kind: 'buyDaily', quantity: rule.quantity }
    case 'topUp':
      return { kind: 'topUp', whenBelow: rule.whenBelow, upTo: rule.upTo }
  }
}

function perProductRule(
  rule: (product: ProductId) => RestockRule,
): Record<ProductId, RestockRule> {
  return Object.fromEntries(
    PRODUCTS.map((product) => [product, copied(rule(product))]),
  ) as Record<ProductId, RestockRule>
}

function ascending(weekdays: readonly number[]): number[] {
  return [...weekdays].sort((a, b) => a - b)
}

function expectProducts(field: string, record: object): void {
  const keys = Object.keys(record).sort()
  if (keys.join() !== [...PRODUCTS].sort().join()) {
    throw new RangeError(
      `Invalid decision: ${field} must name exactly ${PRODUCTS.join(', ')}: ${keys.join(', ')}`,
    )
  }
}

/** A bakery planned has oven terms and nothing else; none is planned too. */
function expectPlan(plan: BakeryPlan | null): void {
  if (plan === null) return
  const keys = typeof plan === 'object' ? Object.keys(plan) : []
  if (
    keys.length !== 1 ||
    keys[0] !== 'oven' ||
    !ovenTermsSchema.safeParse(plan.oven).success
  ) {
    throw new RangeError(
      `Invalid decision: bakery must be null or name its oven, one of ${ovenTermsSchema.options.join(', ')}: ${JSON.stringify(plan)}`,
    )
  }
}

function expectRule(
  field: string,
  rule: RestockRule,
  units: { min: number; max: number },
): void {
  switch (rule.kind) {
    case 'buyDaily':
      expectWithin(`${field}.quantity`, rule.quantity, units)
      return
    case 'topUp':
      expectWithin(`${field}.whenBelow`, rule.whenBelow, units)
      expectWithin(`${field}.upTo`, rule.upTo, units)
      if (rule.whenBelow > rule.upTo) {
        throw new RangeError(
          `Invalid decision: ${field}.whenBelow must not exceed upTo: ${rule.whenBelow} > ${rule.upTo}`,
        )
      }
      return
    default:
      throw new RangeError(
        `Invalid decision: ${field} has an unknown kind: ${String((rule as { kind: unknown }).kind)}`,
      )
  }
}

/**
 * Throws a RangeError naming the first field wrong unless `staff` holds at
 * most `content.maxEmployees`, each a different candidate of `content` in
 * one of its roles, at an hourly wage of whole cents within the role's
 * range, and nothing else.
 */
export function validateStaff(
  staff: readonly Hire[],
  content: StaffContent = STAFF,
): void {
  if (!Array.isArray(staff)) {
    throw new RangeError(`Invalid decision: staff must be a list: ${staff}`)
  }
  if (staff.length > content.maxEmployees) {
    throw new RangeError(
      `Invalid decision: staff holds at most ${content.maxEmployees} employees: ${staff.length}`,
    )
  }
  staff.forEach((hire, index) => {
    const field = `staff.${index}`
    const keys = typeof hire === 'object' ? Object.keys(hire).sort() : []
    if (
      keys.join() !== 'candidate,hourlyWage,role' &&
      keys.join() !== 'candidate,hourlyWage,role,truck'
    ) {
      throw new RangeError(
        `Invalid decision: ${field} must name exactly candidate, hourlyWage, role, and a truck or not: ${keys.join(', ')}`,
      )
    }
    if (!candidateIdSchema.safeParse(hire.candidate).success) {
      throw new RangeError(
        `Invalid decision: ${field}.candidate is unknown: ${hire.candidate}`,
      )
    }
    if (
      staff.findIndex(({ candidate }) => candidate === hire.candidate) !== index
    ) {
      throw new RangeError(
        `Invalid decision: ${field}.candidate is hired twice: ${hire.candidate}`,
      )
    }
    const role = staffRoleIdSchema.safeParse(hire.role)
    if (!role.success) {
      throw new RangeError(
        `Invalid decision: ${field}.role is unknown: ${hire.role}`,
      )
    }
    expectWithin(
      `${field}.hourlyWage`,
      hire.hourlyWage,
      content.roles[role.data].hourlyWageCents,
    )
    if (hire.truck === undefined) return
    if (hire.role !== AT_TRUCK) {
      throw new RangeError(
        `Invalid decision: ${field}.truck is for an employee at a truck, not ${hire.role}`,
      )
    }
    if (typeof hire.truck !== 'string' || hire.truck === FIRST_TRUCK) {
      throw new RangeError(
        `Invalid decision: ${field}.truck must name a truck after the first: ${String(hire.truck)}`,
      )
    }
  })
}

function expectWithin(
  field: string,
  value: number,
  { min, max }: { min: number; max: number },
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(
      `Invalid decision: ${field} must be a whole number from ${min} to ${max}: ${value}`,
    )
  }
}

function expectDaysOpen(
  field: string,
  weekdays: readonly number[],
  minDaysOpen: number,
): void {
  if (weekdays.length < minDaysOpen) {
    throw new RangeError(
      `Invalid decision: ${field} needs at least ${minDaysOpen} day(s): ${weekdays.length}`,
    )
  }
  weekdays.forEach((weekday, index) => {
    const previous = weekdays[index - 1] ?? MONDAY - 1
    if (
      !Number.isSafeInteger(weekday) ||
      weekday > SUNDAY ||
      weekday <= previous
    ) {
      throw new RangeError(
        `Invalid decision: ${field} must be ascending weekdays from ${MONDAY} to ${SUNDAY}, each once: ${weekdays.join(', ')}`,
      )
    }
  })
}
