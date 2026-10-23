import {
  type BakeryContent,
  loadCustomerContent,
  loadDefiContent,
  loadDifficultyContent,
  loadEnergyContent,
  loadEventContent,
  loadFoodTruckContent,
  loadPersonalContent,
  type CustomerContent,
  type DefiContent,
  type Difficulty,
  type DifficultyContent,
  type DifficultyId,
  type DreamContent,
  type EnergyContent,
  type EventContent,
  type FinancingContent,
  type FoodTruckContent,
  type GrocerContent,
  type PersonalContent,
  type PlacesContent,
  type ProductId,
  type StaffContent,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  balance,
  emptyJournal,
  entriesOf,
  type Journal,
} from '../finance/journal.ts'
import { loanSchedule } from '../finance/loan.ts'
import {
  BAKED,
  BAKERY,
  bake,
  bakeryMorning,
  bakeryWaste,
  isBakeryRunning,
} from './bakery.ts'
import { endAtClose } from './bankruptcy.ts'
import { monthsSinceStart, toCalendar } from './calendar.ts'
import {
  challengeDifficulties,
  defiById,
  recordChallengeDay,
} from './challenge.ts'
import { GROCERS, deliverContracts } from './contracts.ts'
import {
  dayTypeOf,
  noWithdrawals,
  perSegment,
  serveWalkIns,
  type CrowdChanges,
  type Served,
  type Withdrawal,
} from './customers.ts'
import {
  DREAM,
  crowned,
  dreamBonuses,
  dreamDepreciation,
  dreamEnergy,
  dreamService,
  housingOf,
  truckReplacedOn,
  withDreamStreet,
  type TruckOnBooks,
} from './dream.ts'
import { startOfDay } from './effects.ts'
import { energyAtClose } from './energy.ts'
import { FINANCING, closingFinancing, financingCharges } from './financing.ts'
import {
  PRODUCTS,
  onHand,
  orderSize,
  perProduct,
  removeExpired,
  takeFifo,
} from './inventory.ts'
import {
  marketingCrowd,
  marketingDayOf,
  rememberMarketingDay,
  rememberSpend,
} from './marketing.ts'
import { add, cents, mulInt, mulRatio, sub, sum, type Cents } from './money.ts'
import { netWorth } from './netWorth.ts'
import { inDebt, livePersonalDay } from './personal.ts'
import { PLACES, awayFromCounter, discountAtClose } from './places.ts'
import { credit, debit, depreciate, pay, post } from './posting.ts'
import { servers } from './service.ts'
import {
  STAFF,
  crewOf,
  isAbsent,
  type Doer,
  payWages,
  quitting,
  staffMorning,
  traitValue,
} from './staff.ts'
import { inEffect, streetOn, type Street } from './street.ts'
import {
  FIRST_TRUCK,
  ownerAtOf,
  truckDecisionsOf,
  truckOf,
  truckersAt,
  trucksOf,
  withTrucks,
} from './trucks.ts'
import { isProtected } from './tutorial.ts'
import type {
  Day,
  Decisions,
  Employee,
  GameState,
  Hire,
  Lot,
  PerProduct,
  TruckDay,
  TruckId,
  Worker,
} from './types.ts'
import { recordDay } from './week.ts'
import { rememberWork, workOf } from './work.ts'

/** The shipped food truck content, validated once when the engine loads. */
export const FOOD_TRUCK: FoodTruckContent = loadFoodTruckContent()

/** The shipped customer segments, validated once when the engine loads. */
export const CUSTOMERS: CustomerContent = loadCustomerContent()

/** The shipped difficulties, validated once when the engine loads. */
export const DIFFICULTIES: DifficultyContent = loadDifficultyContent()

/** The owner's shipped living costs, validated once when the engine loads. */
export const PERSONAL: PersonalContent = loadPersonalContent()

/**
 * What shipped tires the owner and what fatigue does, validated once when
 * the engine loads.
 */
export const ENERGY: EnergyContent = loadEnergyContent()

/**
 * The shipped event cards and their pacing, validated once when the engine
 * loads.
 */
export const EVENTS: EventContent = loadEventContent()

/**
 * The shipped Défis, validated once against the shipped event cards when
 * the engine loads.
 */
export const DEFIS: DefiContent = loadDefiContent(undefined, EVENTS)

const CASH: AccountCode = '1000'
const INVENTORY: AccountCode = '1200'
const EQUIPMENT: AccountCode = '1500'
const ACCUMULATED_DEPRECIATION: AccountCode = '1510'
const BANK_LOANS: AccountCode = '2500'
const SHARE_CAPITAL: AccountCode = '3000'
const SALES: AccountCode = '4000'
const COST_OF_GOODS_SOLD: AccountCode = '5000'
const INVENTORY_LOSSES: AccountCode = '5100'
const PACKAGING: AccountCode = '5200'
const WAGES: AccountCode = '6000'
const RENT_AND_PERMIT: AccountCode = '6100'
const TRUCK_LEASE: AccountCode = '6120'
const INSURANCE: AccountCode = '6150'
const FUEL_AND_MAINTENANCE: AccountCode = '6200'
const MARKETING: AccountCode = '6300'
const CARD_FEES: AccountCode = '6500'
const INTEREST: AccountCode = '7000'

// Memos the player reads in the journal.
const MEMO = {
  capital: 'Mise de fonds',
  truckContributed: 'Camion apporté par le propriétaire',
  loan: 'Emprunt de démarrage',
  truckBought: 'Achat du camion',
  permit: 'Permis, stationnement et cuisine',
  insurance: 'Assurances',
  interest: "Intérêts sur l'emprunt",
  principal: "Remboursement de l'emprunt",
  depreciation: 'Amortissement du camion',
  lease: 'Location du camion',
  purchases: 'Achat de marchandises',
  sales: 'Ventes au comptant',
  costOfSales: 'Coût des marchandises vendues',
  botched: 'Produits ratés',
  packaging: 'Emballages',
  cardFees: 'Frais de cartes',
  fuel: 'Carburant et entretien',
  marketing: 'Marketing',
  ownerPay: 'Paie du propriétaire',
  spoilage: 'Marchandises périmées',
} as const

/** The memo of the owner's weekly pay, as the player reads it. */
export const OWNER_PAY_MEMO = MEMO.ownerPay

/**
 * The memos of the truck's own monthly charges, which end once a rung of «
 * Le rêve » replaces it.
 */
export const TRUCK_MEMO = {
  depreciation: MEMO.depreciation,
  lease: MEMO.lease,
} as const

/**
 * The memos of the entries whose charge or sale is the first truck's own
 * (#259), which name it on their line of the état des résultats: its day's
 * sales and what they cost, but « Coût des marchandises vendues », which
 * the grocers' and the events' sales post too (see `COST_OF_SALES_MEMO`),
 * and its monthly charges.
 */
export const FIRST_TRUCK_MEMOS: readonly string[] = [
  MEMO.sales,
  MEMO.botched,
  MEMO.packaging,
  MEMO.cardFees,
  MEMO.fuel,
  MEMO.marketing,
  MEMO.spoilage,
  MEMO.permit,
  MEMO.insurance,
  MEMO.interest,
  MEMO.depreciation,
  MEMO.lease,
]

/**
 * The memo of a truck's cash sales, and the memo of their cost, which a
 * truck posts right after them and the grocers' and events' sales post too.
 */
export const SALES_MEMO = MEMO.sales
export const COST_OF_SALES_MEMO = MEMO.costOfSales

const ZERO = cents(0)

/**
 * The books a game of `difficulty` opens with, all on day 0. The owner pays
 * in the Mise de fonds: the starting cash, plus what the truck costs beyond
 * the loan when the business borrows to buy it. Facile's owner also brings
 * the truck, at its price, as more capital. Moyen then takes the loan and
 * buys the truck with it. Difficile leases the truck, so the books never
 * carry it. Throws a RangeError if the loan is more than the truck and the
 * starting cash together, which would make the Mise de fonds negative.
 */
export function openingJournal(
  difficulty: DifficultyId,
  content: FoodTruckContent = FOOD_TRUCK,
  difficulties: DifficultyContent = DIFFICULTIES,
): Journal {
  const { startingCashCents, truck } = difficulties.difficulties[difficulty]
  const price = content.truck.priceCents
  switch (truck.kind) {
    case 'owned':
      return post(paidIn(startingCashCents), 0, MEMO.truckContributed, [
        debit(EQUIPMENT, price),
        credit(SHARE_CAPITAL, price),
      ])
    case 'loan': {
      const { loanCents } = truck
      const capital = sub(add(startingCashCents, price), loanCents)
      if (capital < 0) {
        throw new RangeError(
          `The ${difficulty} loan of ${loanCents} is more than the truck of ${price} and the starting cash of ${startingCashCents}`,
        )
      }
      const journal = post(paidIn(capital), 0, MEMO.loan, [
        debit(CASH, loanCents),
        credit(BANK_LOANS, loanCents),
      ])
      return pay(journal, 0, MEMO.truckBought, EQUIPMENT, price)
    }
    case 'lease':
      return paidIn(startingCashCents)
  }
}

/** The owner's Mise de fonds, the first entry of the books. */
function paidIn(capital: Cents): Journal {
  return post(emptyJournal(), 0, MEMO.capital, [
    debit(CASH, capital),
    credit(SHARE_CAPITAL, capital),
  ])
}

/**
 * The truck the books of a game of `difficulty` carry on the morning of
 * `day`, before that day's entries: its price, and its book value, the
 * price less the « Amortissement du camion » posted before `day`. Null when
 * the truck is leased, which the books never carry.
 */
export function truckOnBooks(
  journal: Journal,
  day: Day,
  difficulty: DifficultyId,
  content: FoodTruckContent = FOOD_TRUCK,
  difficulties: DifficultyContent = DIFFICULTIES,
): TruckOnBooks | null {
  if (difficulties.difficulties[difficulty].truck.kind === 'lease') return null
  let depreciated = ZERO
  for (const { day: on, memo, lines } of entriesOf(journal)) {
    // Days never go down, so no later entry is before `day` either.
    if (on >= day) break
    if (memo !== MEMO.depreciation) continue
    for (const line of lines) {
      if (line.account === ACCUMULATED_DEPRECIATION) {
        depreciated = add(depreciated, line.credit)
      }
    }
  }
  const { priceCents } = content.truck
  return { priceCents, bookValue: sub(priceCents, depreciated) }
}

/** What one unit of `product` sells for on day `state.day`. */
export function currentPrice(state: GameState, product: ProductId): Cents {
  return state.decisions.prices[product]
}

/**
 * Plays business day `morning.day` with `morning.decisions`. Throws an Error
 * while an event waits for the player's choice, once the game has ended, and
 * once the game's Défi, if any, is over. First the start of the day: the
 * delayed effects of the events' choices due that day, then the receivables
 * due (see `startOfDay`). Then the street that day, with the changes in
 * effect folded together (see `streetOn`).
 * On the 1st of the month, open or closed: the month's charges (see
 * `monthlyCharges`), the truck's counted in months from the game's first day,
 * day 0 or a Défi's first day, as if the truck came to the business then,
 * and none once a rung of `dream` replaced it (see `truckReplacedOn`), then
 * the depreciation of the company's rungs (see `dreamDepreciation`), then
 * what the emergency loans and the shares sold owe (see
 * `financingCharges`). Then, open or closed, the bakery's morning with
 * `bakeryContent` and the prices of the game's difficulty (see
 * `bakeryMorning`), then the staff's with `staff`,
 * which hires and lets go as the decisions want (see `staffMorning`), then
 * lets go those who quit that morning, underpaid, out of the decisions and
 * those waiting too (see `quitting`), and who does what that day, the owner
 * away all day or not and the absent employees' work not done (see
 * `isAbsent` and `crewOf`), each employee « Au camion » at their own
 * truck and the owner at theirs (see `truckOf` and `ownerAtOf`). Then the
 * deliveries of the contracts with `grocers`, missed when nobody delivers, the
 * bakery making their croissants first when it makes the truck's and someone
 * bakes (see `deliverContracts`). On a day the truck opens, one of the days
 * open the street does not close, with the owner or an employee at the truck,
 * each truck in turn, the first one first (#259), the others each on its
 * own generator and the street with no change, with no marketing, no
 * bakery and no discount, each naming itself on its lines of the état des
 * résultats:
 * the morning restock of every product the street leaves on sale, but the
 * croissants when they come from the bakery and it runs, which then makes them
 * with the capacity the deliveries left if someone bakes, and none otherwise
 * (see `bake`), but buys them by the bake rule when the baker is absent,
 * then the walk-in customers,
 * with those the marketing of the days before brings on top (see
 * `marketingCrowd`) and as the street, and the rungs owned, change them (see
 * `withDreamStreet`), the regulars × the accueil of each employee at the
 * truck, lining up at the counter, at the times and with the
 * line the rungs owned leave (see `dreamService`),
 * where `servers()` serve them from the stock on hand, none of a product that
 * cannot be sold, the owner slower and botching units the more tired they are
 * that morning (see `effectsOf`), and away from the counter while the day's
 * trip in `places` lasts (see `awayFromCounter`), when those who come with
 * nobody at the truck find it closed, what the sales cost in packaging and
 * card fees, the fuel and the day's marketing budget. The restock takes the
 * discount a trip to the mill left off each unit's cost, which its first
 * restock that buys anything uses up (see `discountAtClose`). On a day it is closed, nobody
 * comes, nothing is bought and nothing is spent on marketing, so the generator
 * does not move. When an employee baked, the croissants they threw away (see
 * `bakeryWaste`). On payday, open or closed, the owner's weekly pay, then each
 * employee's (see `payWages`). Every day: the
 * spoilage at the close. Every entry is dated `morning.day`. Then the owner's
 * own day, outside the books, with `personal` as their living costs (see
 * `livePersonalDay`), their home's payment in place of the rent once they own
 * one (see `housingOf`), and what the day did to their energy, with `energy`
 * as what tires them and a closed day giving the rungs' energy back on top
 * (see `dreamEnergy`): only the customers they served count, and a day of baking
 * takes `bakingEnergyCost` more and each delivery `deliveryEnergyCost` when
 * they do it, and the day's trip `places.energyCost`, while a day away
 * takes only the trip's (see `energyAtClose`). Returns a new
 * state on the same day with the books, the bakery, the staff, the contracts,
 * the stock, the generator, the marketing history, `lastDay`, with the changes
 * to the street in effect that day, the deliveries and those missed, the
 * employees absent whose role had work that day and those who quit, the
 * owner's personal account, their energy, the events, without the changes
 * whose last day it was, the financing with Encaisse at the close (see
 * `closingFinancing`), the game ended if that close ends it, by
 * `financing`'s rules (see `endAtClose`), unless a tutorial protects the
 * game (see `isProtected`), the receivables brought up to the
 * close, `dream.magnatOn` set at the first close whose net worth reaches the
 * last title, outside a Défi (see `crowned`), the discount waiting for the
 * next restock (see `discountAtClose`), the day added to the week under
 * way, summed up on a Sunday (see
 * `recordDay`), and, in a Défi of `defis`, the day added to its progress,
 * which may end it (see `recordChallengeDay`), with the
 * owner's lowest energy since the last close, the start of the day's effects
 * included, and at this one; never mutates `morning`. Cash may go negative.
 */
export function playDay(
  morning: GameState,
  content: FoodTruckContent = FOOD_TRUCK,
  customers: CustomerContent = CUSTOMERS,
  difficulties: DifficultyContent = DIFFICULTIES,
  personal: PersonalContent = PERSONAL,
  energy: EnergyContent = ENERGY,
  defis: DefiContent = DEFIS,
  bakeryContent: BakeryContent = BAKERY,
  grocers: GrocerContent = GROCERS,
  staff: StaffContent = STAFF,
  financing: FinancingContent = FINANCING,
  dream: DreamContent = DREAM,
  places: PlacesContent = PLACES,
): GameState {
  const { pending } = morning.events
  if (pending !== null) {
    throw new Error(
      `Day ${morning.day} cannot be played: the event ${pending.event} is waiting for a choice`,
    )
  }
  const { ended } = morning
  if (ended !== null) {
    throw new Error(
      `Day ${morning.day} cannot be played: the game ended in ${ended.reason} on day ${ended.day}`,
    )
  }
  const { challenge } = morning
  if (challenge !== null && challenge.status !== 'enCours') {
    throw new Error(
      `Day ${morning.day} cannot be played: the Défi ${challenge.id} is over`,
    )
  }
  const started = startOfDay(morning, content, grocers, places)
  const { day, decisions } = started
  const { dayOfMonth, weekday } = toCalendar(day)
  const { modifiers } = started.events
  const bonuses = dreamBonuses(started.dream, dream)
  const street = withDreamStreet(streetOn(modifiers, day), bonuses)
  let journal = started.journal

  if (dayOfMonth === 1) {
    const { truck } = difficulties.difficulties[started.profile.difficulty]
    const month = monthsSinceStart(day) - monthsSinceStart(firstDay(started))
    journal = monthlyCharges(
      journal,
      day,
      month,
      content,
      truck,
      truckReplacedOn(started.dream, dream),
    )
    journal = dreamDepreciation(journal, day, started.dream, dream)
    journal = financingCharges(journal, started.financing, day)
  }
  const prices = difficulties.bakery[started.profile.difficulty]
  const bakery = bakeryMorning(
    journal,
    started.bakery,
    decisions.bakery,
    day,
    prices,
    bakeryContent,
  )
  const staffed = staffMorning(
    bakery.journal,
    started.staff,
    decisions.staff,
    day,
    staff,
  )
  const left = quitting(staffed.staff, day, staff)
  const absent = left.staff
    .filter((employee) => isAbsent(started.seed, day, employee, staff))
    .map(({ candidate }) => candidate)
  const crew = crewOf(left.staff, started.ownerAway, absent)
  const ownerAt = ownerAtOf(decisions)
  // Each truck's street: the first truck's with the events' changes and the
  // rungs' bonuses, the others' the street with none (#259).
  const streetOf = (truck: TruckId): Street =>
    truck === FIRST_TRUCK ? street : streetOn([], day)
  // Whether the truck opens that day, staffed or not: one of its days open
  // that its street does not close.
  const scheduled = (truck: TruckId): boolean =>
    truckDecisionsOf(decisions, truck).daysOpen.includes(weekday) &&
    !streetOf(truck).closed
  const truckDay = scheduled(FIRST_TRUCK)
  const making =
    decisions.croissantSource === 'fabriquer' && isBakeryRunning(bakery.bakery)
  const baking = making && crew.bakes !== null
  const bakerAbsent =
    crew.baker === null && left.staff.some(({ role }) => role === BAKER)
  const delivered = deliverContracts(
    {
      ...started,
      journal: staffed.journal,
      staff: left.staff,
      decisions: without(decisions, left.quits),
      pendingDecisions:
        started.pendingDecisions === null
          ? null
          : without(started.pendingDecisions, left.quits),
    },
    baking,
    crew.delivers !== null,
    prices,
    content,
    bakeryContent,
    grocers,
  )
  const state = delivered.state
  journal = state.journal
  let baked = delivered.baked
  const { trip, discount } = state.town
  let discounted = false

  // Each truck in turn, the first one first: the first truck as the game
  // has always played it, each other one on its own generator, with its
  // own crew, the street with no change and no marketing, its croissants
  // bought.
  const away = awayFromCounter(state, places, dream)
  const plays = trucksOf(state).map((truck): TruckPlay => {
    const first = truck.id === FIRST_TRUCK
    const own = truckDecisionsOf(decisions, truck.id)
    const price = (product: ProductId) => own.prices[product]
    const truckers = truckersAt(crew.truckers, truck.id)
    const ownerHere = crew.ownerServes && ownerAt === truck.id
    const open = scheduled(truck.id) && (ownerHere || truckers.length > 0)
    if (!open) {
      return {
        id: truck.id,
        open,
        price,
        lots: truck.inventory,
        served: closed(truck.rngState),
        revenue: ZERO,
        marketingSpent: ZERO,
      }
    }
    const truckStreet = streetOf(truck.id)
    // With the baker absent, the croissants they would have made are bought.
    const makes = first && making
    const buyInstead = makes && bakerAbsent
    const restocked = restock(
      truck.inventory,
      day,
      buyInstead ? { ...own.restock, [BAKED]: decisions.bake } : own.restock,
      content,
      makes && !buyInstead
        ? { ...truckStreet.unavailable, [BAKED]: true }
        : truckStreet.unavailable,
      first ? discount : 0,
    )
    if (first) discounted = restocked.units > 0
    journal = post(journal, day, MEMO.purchases, [
      debit(INVENTORY, restocked.cost),
      credit(CASH, restocked.cost),
    ])
    const made =
      first && baking && !truckStreet.unavailable[BAKED]
        ? bake(
            journal,
            restocked.lots,
            day,
            decisions.bake,
            prices,
            bakeryContent,
            bakeryContent.capacityPerDay - delivered.baked,
          )
        : { journal, lots: restocked.lots, quantity: 0 }
    journal = made.journal
    baked += made.quantity

    const served = serveWalkIns(
      truck.rngState,
      content.walkIns,
      dayTypeOf(weekday),
      customers,
      price,
      perProduct((product) =>
        truckStreet.unavailable[product] ? 0 : onHand(made.lots, product),
      ),
      {
        service: first
          ? dreamService(content.service, bonuses)
          : content.service,
        servers: servers(state, energy, staff, away, absent, truck.id),
      },
      first ? marketingCrowd(state.marketingHistory, content.marketing) : null,
      welcomed(truckStreet, truckers, staff),
    )

    // The sale, its cost and what it costs to make are separate entries, so
    // each cash entry's other lines stay on one row of the état des flux de
    // trésorerie. Each names the truck on its line of the état des
    // résultats (#259).
    const sales = sell(made.lots, served.withdrawals, price, content.products)
    journal = post(journal, day, MEMO.sales, [
      debit(CASH, sales.revenue),
      credit(SALES, sales.revenue, truck.id),
    ])
    journal = post(journal, day, MEMO.costOfSales, [
      debit(COST_OF_GOODS_SOLD, sales.cost, truck.id),
      credit(INVENTORY, sales.cost),
    ])
    journal = post(journal, day, MEMO.botched, [
      debit(INVENTORY_LOSSES, sales.botchedCost, truck.id),
      credit(INVENTORY, sales.botchedCost),
    ])
    journal = pay(
      journal,
      day,
      MEMO.packaging,
      PACKAGING,
      sales.packaging,
      truck.id,
    )
    const { share, feeRate } = content.cardPayments
    const cardFees = mulRatio(mulRatio(sales.revenue, share), feeRate)
    journal = pay(journal, day, MEMO.cardFees, CARD_FEES, cardFees, truck.id)
    journal = pay(
      journal,
      day,
      MEMO.fuel,
      FUEL_AND_MAINTENANCE,
      content.fuelAndMaintenancePerOpenDayCents,
      truck.id,
    )
    const marketingSpent = first ? decisions.marketingDaily : ZERO
    journal = pay(
      journal,
      day,
      MEMO.marketing,
      MARKETING,
      marketingSpent,
      truck.id,
    )
    return {
      id: truck.id,
      open,
      price,
      lots: sales.lots,
      served,
      revenue: sales.revenue,
      marketingSpent,
    }
  })
  const [firstPlay, ...otherPlays] = plays
  if (firstPlay === undefined) throw new Error('A game has a first truck')
  const { served, revenue, marketingSpent, price } = firstPlay
  const ownerPlay = plays.find(({ id }) => id === ownerAt) ?? firstPlay

  let wasted = 0
  if (baked > 0 && crew.baker !== null) {
    const share =
      staff.bakeryWasteShare *
      traitValue(crew.baker.candidate, 'minutie', BAKER, staff)
    const waste = bakeryWaste(journal, day, baked, share, prices)
    journal = waste.journal
    wasted = waste.wasted
  }

  if (weekday === content.ownerPayWeekday) {
    journal = pay(journal, day, MEMO.ownerPay, WAGES, decisions.ownerWeeklyPay)
    journal = payWages(journal, state.staff, day, staff)
  }

  const shelfLives = perProduct(
    (product) => content.products[product].shelfLifeDays,
  )
  const closes = plays.map((play) => {
    const expired = removeExpired(play.lots, day, shelfLives)
    journal = post(journal, day, MEMO.spoilage, [
      debit(INVENTORY_LOSSES, expired.cost, play.id),
      credit(INVENTORY, expired.cost),
    ])
    return expired
  })
  const [expired] = closes
  if (expired === undefined) throw new Error('A game has a first truck')

  const account = livePersonalDay(
    state.personal,
    day,
    decisions.ownerWeeklyPay,
    content.ownerPayWeekday,
    personal,
    housingOf(state.dream, dream),
  )
  const closingEnergy = energyAtClose(
    state.energy,
    {
      // The owner works at their own truck only (#259).
      worked: ownerPlay.open || street.working,
      away: state.ownerAway,
      customersServed: ownerPlay.served.servedByOwner,
      stressed: weekday === content.ownerPayWeekday && inDebt(account),
      bakingCost:
        baked > 0 && crew.bakes === 'owner'
          ? bakeryContent.bakingEnergyCost
          : 0,
      deliveryCost:
        crew.delivers === 'owner'
          ? delivered.deliveries.length * grocers.deliveryEnergyCost
          : 0,
      tripCost: trip === null ? 0 : places.energyCost,
    },
    dreamEnergy(energy, bonuses),
  )
  const lasting = modifiers.filter(({ lastDay }) => lastDay > day)
  const deliveriesDue =
    delivered.deliveries.length + delivered.missed.length > 0
  const missedWork = absent.filter((candidate) =>
    hadWork(
      left.staff.find((employee) => employee.candidate === candidate),
      {
        // An employee « Au camion » had work on a day their own truck was
        // to open, whoever came to open it.
        truck: (employee) => scheduled(truckOf(employee)),
        deliveries: deliveriesDue,
        bakery: making && (truckDay || deliveriesDue),
      },
    ),
  )

  const listed = content.products[BAKED].unitCostCents
  const work = workOf({
    ownerAway: started.ownerAway,
    came: left.staff.filter(({ candidate }) => !absent.includes(candidate)),
    visits: served.visits,
    price,
    others: otherPlays.map((play) => ({
      visits: play.served.visits,
      price: play.price,
    })),
    deliveries: delivered.deliveries,
    delivers: doerOf(crew.delivers, crew.deliverer),
    baked,
    wasted,
    bakes: doerOf(crew.bakes, crew.baker),
    ingredientCost: prices.ingredientCostCents,
    boughtCost: sub(listed, mulRatio(listed, discount)),
  })

  const others = withTrucks(
    state,
    otherPlays.map((play, index) => {
      const spoiled = closes[index + 1] ?? expired
      return {
        id: play.id,
        rngState: play.served.rngState,
        inventory: spoiled.lots,
        lastDay: truckDayOf(day, play, spoiled.spoiled),
      }
    }),
  )
  const closing: GameState = {
    ...others,
    rngState: served.rngState,
    journal,
    inventory: expired.lots,
    marketingHistory: rememberSpend(
      state.marketingHistory,
      marketingSpent,
      content.marketing,
    ),
    marketingDays: rememberMarketingDay(
      state.marketingDays,
      marketingDayOf(day, marketingSpent, served.visits, price),
    ),
    workDays: rememberWork(
      state.workDays,
      day,
      work,
      started.ownerAway,
      absent,
    ),
    lastDay: {
      day,
      sold: served.sold,
      revenue,
      lostSales: served.lost,
      pricedOut: served.pricedOut,
      spoiled: expired.spoiled,
      segments: served.segments,
      visits: served.visits,
      leftLine: served.leftLine,
      averageWaitSeconds: served.averageWaitSeconds,
      longestWaitSeconds: served.longestWaitSeconds,
      energy: closingEnergy,
      botched: botchedOf(served),
      modifiers: inEffect(modifiers, day),
      deliveries: delivered.deliveries,
      // In the order a save holds them, so a game saved and loaded writes
      // the same save.
      work,
      ...(started.ownerAway ? { ownerAway: true } : {}),
      missed: delivered.missed,
      ...(missedWork.length > 0 ? { absent: missedWork } : {}),
      ...(left.quits.length > 0 ? { quits: left.quits } : {}),
    },
    personal: account,
    energy: closingEnergy,
    events:
      lasting.length === modifiers.length
        ? state.events
        : { ...state.events, modifiers: lasting },
    bakery: bakery.bakery,
    financing: closingFinancing(
      state.financing,
      day,
      balance(journal, CASH, { toDay: day }),
    ),
    town: {
      trip,
      discount: discountAtClose(trip, discount, discounted, places),
    },
  }
  const magnat =
    challenge === null && closing.dream.magnatOn === null
      ? crowned(closing.dream, netWorth(closing, dream), day, dream)
      : closing.dream
  const ending = {
    ...closing,
    dream: magnat,
    ended: isProtected(closing) ? null : endAtClose(closing, financing),
  }
  const recorded = {
    ...ending,
    ...recordDay(
      ending,
      plays.some((play) => play.open),
      sum(closes.map(({ cost }) => cost)),
      dream,
    ),
  }
  if (challenge === null) return recorded
  const defi = defiById(defis, challenge.id)
  const opening = openingJournal(
    state.profile.difficulty,
    content,
    challengeDifficulties(defi, difficulties),
  )
  return {
    ...recorded,
    challenge: recordChallengeDay(recorded, defi, entriesOf(opening).length),
  }
}

/** What one truck's day did, before its close. */
interface TruckPlay {
  readonly id: TruckId
  /** Whether it opened. */
  readonly open: boolean
  /** What one unit of each product sold for there. */
  readonly price: (product: ProductId) => Cents
  /** Its stock once its sales are taken out. */
  readonly lots: readonly Lot[]
  /** Its walk-ins, with its generator after them. */
  readonly served: Served
  readonly revenue: Cents
  readonly marketingSpent: Cents
}

/** The units botched at the counter: `served.botched`, summed. */
function botchedOf(served: Served): number {
  return PRODUCTS.reduce((total, product) => total + served.botched[product], 0)
}

/**
 * The last day of a truck after the first, in the order a save holds it,
 * with `spoiled` the units written off at its close.
 */
function truckDayOf(day: Day, play: TruckPlay, spoiled: PerProduct): TruckDay {
  const { served } = play
  return {
    day,
    sold: served.sold,
    revenue: play.revenue,
    lostSales: served.lost,
    pricedOut: served.pricedOut,
    spoiled,
    segments: served.segments,
    visits: served.visits,
    leftLine: served.leftLine,
    averageWaitSeconds: served.averageWaitSeconds,
    longestWaitSeconds: served.longestWaitSeconds,
    botched: botchedOf(served),
    open: play.open,
  }
}

const BAKER = 'boulanger'
const AT_TRUCK = 'camion'
const DELIVERER = 'livreur'

/** Who did a job: the owner, the employee who did, or nobody. */
function doerOf(doer: Doer, employee: Employee | null): Worker | null {
  if (doer === 'owner') return 'owner'
  return doer === 'employee' ? (employee?.candidate ?? null) : null
}

/** `decisions` without the employees of `quits` in the staff they want. */
function without(
  decisions: Decisions,
  quits: readonly Hire['candidate'][],
): Decisions {
  if (quits.length === 0) return decisions
  return {
    ...decisions,
    staff: decisions.staff.filter(
      ({ candidate }) => !quits.includes(candidate),
    ),
  }
}

/**
 * Whether `employee`'s role had work on a day: the truck's on a day their
 * truck opens, the deliverer's on a day of deliveries, the baker's on a day
 * the bakery makes croissants for either.
 */
function hadWork(
  employee: Employee | undefined,
  work: {
    truck: (employee: Employee) => boolean
    deliveries: boolean
    bakery: boolean
  },
): boolean {
  if (employee === undefined) return false
  switch (employee.role) {
    case AT_TRUCK:
      return work.truck(employee)
    case DELIVERER:
      return work.deliveries
    case BAKER:
      return work.bakery
    default:
      return false
  }
}

/**
 * `street` with the walk-ins of the content's `welcomedSegment`, the
 * regulars, × each of the `truckers`' accueil (see `traitValue`), as a
 * change to the street would make them: more of them come, or fewer.
 */
function welcomed(
  street: Street,
  truckers: readonly Employee[],
  staff: StaffContent,
): Street {
  const factor = truckers.reduce(
    (product, { candidate }) =>
      product * traitValue(candidate, 'accueil', AT_TRUCK, staff),
    1,
  )
  if (factor === 1) return street
  const segment = staff.welcomedSegment
  const walkIns: CrowdChanges['walkIns'] = {
    ...street.walkIns,
    [segment]: street.walkIns[segment] * factor,
  }
  return { ...street, walkIns }
}

/** The game's first day: day 0, or its Défi's first day. */
function firstDay({ challenge }: GameState): Day {
  return challenge?.startDay ?? 0
}

/**
 * What the 1st of the month costs, open or closed: the permit, parking and
 * commissary, the insurance, then the truck's own charges, which depend on
 * how it came to the business. `month` counts from the month the truck
 * came, its month 0. A truck replaced on `replacedOn` takes no depreciation
 * nor lease from that morning on, a purchase on the morning of a 1st coming
 * before that day's charges, but a loan is still repaid.
 */
function monthlyCharges(
  journal: Journal,
  day: Day,
  month: number,
  content: FoodTruckContent,
  truck: Difficulty['truck'],
  replacedOn: Day | null,
): Journal {
  const { permitParkingAndCommissary, insurance } = content.monthlyCostsCents
  // Each charge is the first truck's own (#259): its permit and parking,
  // its insurance, its loan's interest and its depreciation or lease.
  let books = pay(
    journal,
    day,
    MEMO.permit,
    RENT_AND_PERMIT,
    permitParkingAndCommissary,
    FIRST_TRUCK,
  )
  books = pay(books, day, MEMO.insurance, INSURANCE, insurance, FIRST_TRUCK)
  const replaced = replacedOn !== null && day >= replacedOn
  const depreciated = (journal: Journal) =>
    depreciate(
      journal,
      day,
      month,
      content.truck,
      MEMO.depreciation,
      FIRST_TRUCK,
    )
  switch (truck.kind) {
    case 'owned':
      return replaced ? books : depreciated(books)
    case 'loan':
      books = repay(books, day, month, truck)
      return replaced ? books : depreciated(books)
    case 'lease':
      return replaced
        ? books
        : pay(
            books,
            day,
            MEMO.lease,
            TRUCK_LEASE,
            truck.monthlyLeaseCents,
            FIRST_TRUCK,
          )
  }
}

type Loan = Extract<Difficulty['truck'], { kind: 'loan' }>

/**
 * Pays loan payment number `month` of `loanSchedule()`, the first a month
 * after the loan: its interest, then its principal, as two entries. Nothing
 * before the first payment or after the last.
 */
function repay(journal: Journal, day: Day, month: number, loan: Loan): Journal {
  if (month < 1 || month > loan.termMonths) return journal
  const { payments } = loanSchedule(
    loan.loanCents,
    loan.annualRateBasisPoints,
    loan.termMonths,
  )
  const payment = payments[month - 1]
  if (payment === undefined) return journal
  const books = pay(
    journal,
    day,
    MEMO.interest,
    INTEREST,
    payment.interest,
    FIRST_TRUCK,
  )
  return pay(books, day, MEMO.principal, BANK_LOANS, payment.principal)
}

/** A closed day's walk-ins: nobody, with no draw from `rngState`. */
function closed(rngState: number): Served {
  const none = perProduct(() => 0)
  return {
    visits: [],
    segments: perSegment(() => ({
      visits: 0,
      buyers: 0,
      tooExpensive: 0,
      soldOut: 0,
    })),
    sold: none,
    lost: none,
    pricedOut: none,
    botched: none,
    withdrawals: noWithdrawals(),
    leftLine: 0,
    servedByOwner: 0,
    averageWaitSeconds: 0,
    longestWaitSeconds: 0,
    rngState,
  }
}

/**
 * Buys each product its restock rule calls for, at today's unit cost less
 * `discount` of it, the discount rounded to the cent, as a new lot after the
 * others, but
 * none of a product that is `unavailable`. Also returns the units bought.
 */
function restock(
  lots: readonly Lot[],
  day: Day,
  rules: Decisions['restock'],
  content: FoodTruckContent,
  unavailable: Readonly<Record<ProductId, boolean>>,
  discount: number,
): { lots: readonly Lot[]; cost: Cents; units: number } {
  const bought: Lot[] = []
  let cost = ZERO
  let units = 0
  for (const product of PRODUCTS) {
    if (unavailable[product]) continue
    const quantity = orderSize(rules[product], onHand(lots, product))
    if (quantity === 0) continue
    const listed = content.products[product].unitCostCents
    const unitCost = sub(listed, mulRatio(listed, discount))
    bought.push({ product, quantity, unitCost, boughtOnDay: day })
    cost = add(cost, mulInt(unitCost, quantity))
    units += quantity
  }
  return { lots: [...lots, ...bought], cost, units }
}

interface Sales {
  lots: readonly Lot[]
  revenue: Cents
  /** What the units sold cost, first in, first out. */
  cost: Cents
  /** What the units botched cost, first in, first out. */
  botchedCost: Cents
  /** What the units sold went out in. */
  packaging: Cents
}

/**
 * Takes the units customers bought, and those botched, out of the stock,
 * oldest lot first, in the order the counter took them, and prices those
 * sold. Customers buy one at a time as they are served, but taking a run of
 * a product's units at once takes the same units from the same lots; a
 * rested day has one run of each product, its day total.
 */
function sell(
  lots: readonly Lot[],
  withdrawals: Readonly<Record<ProductId, readonly Withdrawal[]>>,
  price: (product: ProductId) => Cents,
  products: FoodTruckContent['products'],
): Sales {
  let left = lots
  let revenue = ZERO
  let cost = ZERO
  let botchedCost = ZERO
  let packaging = ZERO
  for (const product of PRODUCTS) {
    for (const { units, botched } of withdrawals[product]) {
      const taken = takeFifo(left, product, units)
      left = taken.lots
      if (botched) {
        botchedCost = add(botchedCost, taken.cost)
        continue
      }
      revenue = add(revenue, mulInt(price(product), taken.taken))
      cost = add(cost, taken.cost)
      packaging = add(
        packaging,
        mulInt(products[product].packagingCents, taken.taken),
      )
    }
  }
  return { lots: left, revenue, cost, botchedCost, packaging }
}
