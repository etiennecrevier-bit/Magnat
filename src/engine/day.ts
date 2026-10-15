import {
  loadCustomerContent,
  loadDifficultyContent,
  loadEnergyContent,
  loadEventContent,
  loadFoodTruckContent,
  loadPersonalContent,
  type CustomerContent,
  type Difficulty,
  type DifficultyContent,
  type DifficultyId,
  type EnergyContent,
  type EventContent,
  type FoodTruckContent,
  type PersonalContent,
  type ProductId,
  type RestockRule,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  emptyJournal,
  postEntry,
  type Journal,
  type JournalLine,
} from '../finance/journal.ts'
import { loanSchedule } from '../finance/loan.ts'
import { monthsSinceStart, toCalendar } from './calendar.ts'
import {
  dayTypeOf,
  noWithdrawals,
  perSegment,
  serveWalkIns,
  type Served,
  type Withdrawal,
} from './customers.ts'
import { startOfDay } from './effects.ts'
import { effectsOf, energyAtClose } from './energy.ts'
import {
  PRODUCTS,
  onHand,
  perProduct,
  removeExpired,
  takeFifo,
} from './inventory.ts'
import { marketingCrowd, rememberSpend } from './marketing.ts'
import { add, cents, mulInt, mulRatio, sub, type Cents } from './money.ts'
import { inDebt, livePersonalDay } from './personal.ts'
import { servers } from './service.ts'
import type { Day, Decisions, GameState, Lot } from './types.ts'

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
const DEPRECIATION: AccountCode = '6400'
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

/** What one unit of `product` sells for on day `state.day`. */
export function currentPrice(state: GameState, product: ProductId): Cents {
  return state.decisions.prices[product]
}

/**
 * Plays business day `morning.day` with `morning.decisions`. Throws an Error
 * while an event waits for the player's choice. First the start of the day:
 * the delayed effects of the events' choices due that day, then the
 * receivables due (see `startOfDay`). On the 1st of the month, open or
 * closed: the month's charges (see `monthlyCharges`). On a day the truck
 * opens: the morning restock, then the walk-in customers, with those the
 * marketing of the days before brings on top (see `marketingCrowd`), lining
 * up at the counter, where `servers()` serve them from the stock on hand,
 * slower and botching units the more tired the owner is that morning (see
 * `effectsOf`), what the sales cost in packaging and card fees, the fuel
 * and the day's marketing budget. On a day it is closed, nobody comes,
 * nothing is bought and nothing is spent on marketing, so the generator does
 * not move. On payday, open or closed, the owner's weekly pay. Every day:
 * the spoilage at the close. Every entry is dated `morning.day`. Then the
 * owner's own day, outside the books, with `personal` as their living costs
 * (see `livePersonalDay`), and what the day did to their energy, with
 * `energy` as what tires them (see `energyAtClose`). Returns a new state on
 * the same day with the books, the stock, the generator, the marketing
 * history, `lastDay`, the owner's personal account, their energy, the
 * events and the receivables brought up to the close; never mutates
 * `morning`. Cash may go negative.
 */
export function playDay(
  morning: GameState,
  content: FoodTruckContent = FOOD_TRUCK,
  customers: CustomerContent = CUSTOMERS,
  difficulties: DifficultyContent = DIFFICULTIES,
  personal: PersonalContent = PERSONAL,
  energy: EnergyContent = ENERGY,
): GameState {
  const { pending } = morning.events
  if (pending !== null) {
    throw new Error(
      `Day ${morning.day} cannot be played: the event ${pending.event} is waiting for a choice`,
    )
  }
  const state = startOfDay(morning, content)
  const { day, decisions } = state
  const { dayOfMonth, weekday } = toCalendar(day)
  const open = decisions.daysOpen.includes(weekday)
  let journal = state.journal
  let lots = state.inventory
  let served = closed(state.rngState)
  let revenue = ZERO
  let marketingSpent = ZERO

  if (dayOfMonth === 1) {
    const { truck } = difficulties.difficulties[state.profile.difficulty]
    journal = monthlyCharges(journal, day, content, truck)
  }

  if (open) {
    const restocked = restock(lots, day, decisions.restock, content)
    journal = post(journal, day, MEMO.purchases, [
      debit(INVENTORY, restocked.cost),
      credit(CASH, restocked.cost),
    ])

    const price = (product: ProductId) => currentPrice(state, product)
    served = serveWalkIns(
      state.rngState,
      content.walkIns,
      dayTypeOf(weekday),
      customers,
      price,
      perProduct((product) => onHand(restocked.lots, product)),
      {
        service: content.service,
        servers: servers(state, energy),
        botchedShare: effectsOf(state.energy, energy).botchedShare,
      },
      marketingCrowd(state.marketingHistory, content.marketing),
    )

    // The sale, its cost and what it costs to make are separate entries, so
    // each cash entry's other lines stay on one row of the état des flux de
    // trésorerie.
    const sales = sell(
      restocked.lots,
      served.withdrawals,
      price,
      content.products,
    )
    journal = post(journal, day, MEMO.sales, [
      debit(CASH, sales.revenue),
      credit(SALES, sales.revenue),
    ])
    journal = post(journal, day, MEMO.costOfSales, [
      debit(COST_OF_GOODS_SOLD, sales.cost),
      credit(INVENTORY, sales.cost),
    ])
    journal = post(journal, day, MEMO.botched, [
      debit(INVENTORY_LOSSES, sales.botchedCost),
      credit(INVENTORY, sales.botchedCost),
    ])
    journal = pay(journal, day, MEMO.packaging, PACKAGING, sales.packaging)
    const { share, feeRate } = content.cardPayments
    const cardFees = mulRatio(mulRatio(sales.revenue, share), feeRate)
    journal = pay(journal, day, MEMO.cardFees, CARD_FEES, cardFees)
    lots = sales.lots
    revenue = sales.revenue

    journal = pay(
      journal,
      day,
      MEMO.fuel,
      FUEL_AND_MAINTENANCE,
      content.fuelAndMaintenancePerOpenDayCents,
    )
    marketingSpent = decisions.marketingDaily
    journal = pay(journal, day, MEMO.marketing, MARKETING, marketingSpent)
  }

  if (weekday === content.ownerPayWeekday) {
    journal = pay(journal, day, MEMO.ownerPay, WAGES, decisions.ownerWeeklyPay)
  }

  const expired = removeExpired(
    lots,
    day,
    perProduct((product) => content.products[product].shelfLifeDays),
  )
  journal = post(journal, day, MEMO.spoilage, [
    debit(INVENTORY_LOSSES, expired.cost),
    credit(INVENTORY, expired.cost),
  ])

  const account = livePersonalDay(
    state.personal,
    day,
    decisions.ownerWeeklyPay,
    content.ownerPayWeekday,
    personal,
  )
  const closingEnergy = energyAtClose(
    state.energy,
    {
      open,
      customersServed: served.visits.filter(
        ({ servedMinute }) => servedMinute !== null,
      ).length,
      stressed: weekday === content.ownerPayWeekday && inDebt(account),
    },
    energy,
  )

  return {
    ...state,
    rngState: served.rngState,
    journal,
    inventory: expired.lots,
    marketingHistory: rememberSpend(
      state.marketingHistory,
      marketingSpent,
      content.marketing,
    ),
    lastDay: {
      day,
      sold: served.sold,
      revenue,
      lostSales: served.lost,
      spoiled: expired.spoiled,
      segments: served.segments,
      visits: served.visits,
      leftLine: served.leftLine,
      averageWaitSeconds: served.averageWaitSeconds,
      longestWaitSeconds: served.longestWaitSeconds,
      energy: closingEnergy,
      botched: PRODUCTS.reduce(
        (total, product) => total + served.botched[product],
        0,
      ),
    },
    personal: account,
    energy: closingEnergy,
  }
}

/**
 * What the 1st of the month costs, open or closed: the permit, parking and
 * commissary, the insurance, then the truck's own charges, which depend on
 * how it came to the business. Month 0 is the month of day 0.
 */
function monthlyCharges(
  journal: Journal,
  day: Day,
  content: FoodTruckContent,
  truck: Difficulty['truck'],
): Journal {
  const { permitParkingAndCommissary, insurance } = content.monthlyCostsCents
  let books = pay(
    journal,
    day,
    MEMO.permit,
    RENT_AND_PERMIT,
    permitParkingAndCommissary,
  )
  books = pay(books, day, MEMO.insurance, INSURANCE, insurance)
  const month = monthsSinceStart(day)
  switch (truck.kind) {
    case 'owned':
      return depreciate(books, day, month, content.truck)
    case 'loan':
      books = repay(books, day, month, truck)
      return depreciate(books, day, month, content.truck)
    case 'lease':
      return pay(books, day, MEMO.lease, TRUCK_LEASE, truck.monthlyLeaseCents)
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
  const books = pay(journal, day, MEMO.interest, INTEREST, payment.interest)
  return pay(books, day, MEMO.principal, BANK_LOANS, payment.principal)
}

/**
 * Month `month`'s straight-line depreciation of the truck: its price over
 * its useful life, rounded down to the cent, with the last month taking what
 * the rounding left, so the months add up to the price. Nothing after.
 */
function depreciate(
  journal: Journal,
  day: Day,
  month: number,
  { priceCents, usefulLifeMonths }: FoodTruckContent['truck'],
): Journal {
  if (month >= usefulLifeMonths) return journal
  const remainder = priceCents % usefulLifeMonths
  const monthly = cents((priceCents - remainder) / usefulLifeMonths)
  const amount =
    month === usefulLifeMonths - 1 ? add(monthly, cents(remainder)) : monthly
  return post(journal, day, MEMO.depreciation, [
    debit(DEPRECIATION, amount),
    credit(ACCUMULATED_DEPRECIATION, amount),
  ])
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
    botched: none,
    withdrawals: noWithdrawals(),
    leftLine: 0,
    averageWaitSeconds: 0,
    longestWaitSeconds: 0,
    rngState,
  }
}

/**
 * Buys each product its restock rule calls for, at today's unit cost, as a
 * new lot after the others.
 */
function restock(
  lots: readonly Lot[],
  day: Day,
  rules: Decisions['restock'],
  content: FoodTruckContent,
): { lots: readonly Lot[]; cost: Cents } {
  const bought: Lot[] = []
  let cost = ZERO
  for (const product of PRODUCTS) {
    const quantity = orderSize(rules[product], onHand(lots, product))
    if (quantity === 0) continue
    const unitCost = content.products[product].unitCostCents
    bought.push({ product, quantity, unitCost, boughtOnDay: day })
    cost = add(cost, mulInt(unitCost, quantity))
  }
  return { lots: [...lots, ...bought], cost }
}

function orderSize(rule: RestockRule, onHandNow: number): number {
  switch (rule.kind) {
    case 'buyDaily':
      return rule.quantity
    case 'topUp':
      return onHandNow < rule.whenBelow ? rule.upTo - onHandNow : 0
  }
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

/**
 * Posts an entry made of the lines with an amount; the journal takes no
 * zero line, so an entry with none is not posted at all.
 */
function post(
  journal: Journal,
  day: Day,
  memo: string,
  lines: readonly JournalLine[],
): Journal {
  const moved = lines.filter(({ debit, credit }) => debit > 0 || credit > 0)
  return moved.length === 0
    ? journal
    : postEntry(journal, { day, memo, lines: moved })
}

/** An entry paying `amount` out of Encaisse, charged to `account`. */
function pay(
  journal: Journal,
  day: Day,
  memo: string,
  account: AccountCode,
  amount: Cents,
): Journal {
  return post(journal, day, memo, [
    debit(account, amount),
    credit(CASH, amount),
  ])
}

function debit(account: AccountCode, amount: Cents): JournalLine {
  return { account, debit: amount, credit: ZERO }
}

function credit(account: AccountCode, amount: Cents): JournalLine {
  return { account, debit: ZERO, credit: amount }
}
