import {
  candidateIdSchema,
  croissantSourceSchema,
  decisionKindSchema,
  ovenTermsSchema,
  staffRoleIdSchema,
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
  type ProductId,
  type RestockRule,
  type RungId,
  type StaffContent,
  type StaffRoleId,
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
import { STAFF } from './staff.ts'
import type {
  BakeryPlan,
  BakeryState,
  Decisions,
  GameState,
  Hire,
} from './types.ts'

// The player's decisions: how the truck runs, from its prices to the days it
// opens, the bakery that makes its croissants and the employees. A change
// waits in `pendingDecisions` until the next morning, so a day is always
// played with the decisions it began with.

// ISO 8601 weekdays run from 1 = Monday to 7 = Sunday; a calendar fact.
const MONDAY = 1
const SUNDAY = 7

const CASH: AccountCode = '1000'

/** One change the player makes to how the truck runs. */
export type DecisionChange =
  | {
      readonly kind: 'price'
      readonly product: ProductId
      readonly price: Cents
    }
  | {
      readonly kind: 'restock'
      readonly product: ProductId
      readonly rule: RestockRule
    }
  | {
      readonly kind: 'daysOpen'
      /** The ISO weekdays the truck opens, in any order. */
      readonly weekdays: readonly number[]
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
 * others, at their role's starting wage in `staff`; `fire` takes them out,
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
 * `buy` is the one change that does not wait: it buys the rung of `dream`
 * on the morning of `state.day`, before the day is played (see `bought`).
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
): GameState {
  if (change.kind === 'buy') {
    return bought(state, change.rung, content, dream, difficulties)
  }
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
  return { ...state, pendingDecisions: decisions }
}

/**
 * The morning of `state.day` with the rung `id` of `dream` bought. A
 * personal rung moves the owner's cash (see `purchaseMovements`), selling
 * back the rung it sells first; a company rung posts its entries, dated
 * that day, before the day's own (see `purchaseEntries`), with the truck on
 * the books that morning when it replaces it (see `truckOnBooks`). The rung
 * joins `dream.bought` with what it cost (see `purchaseCost`).
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
  return {
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
 * whole cents within the role's range.
 */
export function validateDecisions(
  decisions: Decisions,
  limits: DecisionLimits,
  bakery: BakeryContent = BAKERY,
  staff: StaffContent = STAFF,
): void {
  expectProducts('prices', decisions.prices)
  expectProducts('restock', decisions.restock)
  for (const product of PRODUCTS) {
    const price = decisions.prices[product]
    expectWithin(`prices.${product}`, price, limits.priceCents)
    if (price % limits.priceCents.step !== 0) {
      throw new RangeError(
        `Invalid decision: prices.${product} must be a multiple of ${limits.priceCents.step}: ${price}`,
      )
    }
    expectRule(`restock.${product}`, decisions.restock[product], limits.units)
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
  expectDaysOpen(decisions.daysOpen, limits.minDaysOpen)
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

function changed(
  state: GameState,
  decisions: Decisions,
  change: DecisionChange,
  bakery: BakeryContent,
  staff: StaffContent,
): Decisions {
  switch (change.kind) {
    case 'price':
      return {
        ...decisions,
        prices: { ...decisions.prices, [known(change.product)]: change.price },
      }
    case 'restock': {
      const product = known(change.product)
      const { kind } = decisions.restock[product]
      if (change.rule.kind !== kind) {
        throw new RangeError(
          `Invalid decision: restock.${product} must stay a ${kind} rule: ${change.rule.kind}`,
        )
      }
      return {
        ...decisions,
        restock: { ...decisions.restock, [product]: copied(change.rule) },
      }
    }
    case 'daysOpen':
      return { ...decisions, daysOpen: ascending(change.weekdays) }
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
 * The hire `change` makes, on top of `decisions`, at the role's starting
 * wage: the candidate may be neither wanted yet nor at work the day under
 * way, which would make them leave and start again the same morning.
 */
function hired(
  state: GameState,
  decisions: Decisions,
  { role, candidate }: Extract<DecisionChange, { kind: 'hire' }>,
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
    hourlyWage: staff.roles[role].hourlyWageCents.start,
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
    if (keys.join() !== 'candidate,hourlyWage,role') {
      throw new RangeError(
        `Invalid decision: ${field} must name exactly candidate, hourlyWage, role: ${keys.join(', ')}`,
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
  weekdays: readonly number[],
  minDaysOpen: number,
): void {
  if (weekdays.length < minDaysOpen) {
    throw new RangeError(
      `Invalid decision: daysOpen needs at least ${minDaysOpen} day(s): ${weekdays.length}`,
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
        `Invalid decision: daysOpen must be ascending weekdays from ${MONDAY} to ${SUNDAY}, each once: ${weekdays.join(', ')}`,
      )
    }
  })
}
