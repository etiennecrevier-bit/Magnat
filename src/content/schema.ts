import { z } from 'zod'
import { cents } from '../engine/money.ts'
import bakeryJson from './bakery.json'
import defiPercentilesJson from './defis-percentiles.json'
import defisJson from './defis.json'
import difficultyJson from './difficulty.json'
import energyJson from './energy.json'
import eventsJson from './events.json'
import financingJson from './financing.json'
import foodTruckJson from './foodtruck.json'
import grocersJson from './grocers.json'
import percentilesJson from './percentiles.json'
import personalJson from './personal.json'
import profileJson from './profile.json'
import reportJson from './report.json'
import segmentsJson from './segments.json'
import staffJson from './staff.json'

// Every object is strict, so a mistyped key while tuning fails loudly instead
// of being silently dropped.

/** Whole, non-negative cents, typed as the engine's `Cents`. */
const money = z
  .int()
  .nonnegative()
  .transform((n) => cents(n))

/** Whole cents above zero, typed as the engine's `Cents`. */
const positiveMoney = z
  .int()
  .positive()
  .transform((n) => cents(n))

const count = z.int().nonnegative()

/** A share of a whole, such as a probability. */
const share = z.number().min(0).max(1)

// A calendar fact, not a tunable: opening hours are minutes of one day.
const MINUTES_PER_DAY = 1440

/** A minute of the day, counted from midnight: 450 is 7 h 30. */
const minuteOfDay = z.int().min(0).max(MINUTES_PER_DAY)

// A calendar fact, not a tunable: ISO 8601 weekdays run from 1 = Monday to
// 7 = Sunday.
const DAYS_PER_WEEK = 7

/** An ISO 8601 weekday: 1 = Monday to 7 = Sunday. */
const weekday = z.int().min(1).max(DAYS_PER_WEEK)

// A scale, not a tunable: the owner's energy runs from 0 to 100, as in
// src/engine/energy.ts.
const FULL_ENERGY = 100

/** An amount of the owner's energy, on its scale of 0 to 100. */
const energyAmount = z.number().min(0).max(FULL_ENERGY)

// Shares that sum to 1 within this tolerance are taken as a whole.
const SHARE_SUM_TOLERANCE = 1e-9

// Calendar facts, not tunables: the month lengths of the game's years, which
// have no leap day, as in src/engine/calendar.ts.
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

export const productIdSchema = z.enum(['cafe', 'chocolat', 'croissant'])

export type ProductId = z.infer<typeof productIdSchema>

export const segmentIdSchema = z.enum(['aubaine', 'habitue', 'chic'])

export type SegmentId = z.infer<typeof segmentIdSchema>

export const dayTypeIdSchema = z.enum(['semaine', 'finDeSemaine'])

export type DayTypeId = z.infer<typeof dayTypeIdSchema>

export const difficultyIdSchema = z.enum(['facile', 'moyen', 'difficile'])

export type DifficultyId = z.infer<typeof difficultyIdSchema>

export const avatarSchema = z.enum(['femme', 'homme'])

/** The grocers who may sign a weekly croissant contract (#156). */
export const grocerIdSchema = z.enum([
  'chezNormand',
  'marcheBioLogique',
  'depanneur2424',
])

export type GrocerId = z.infer<typeof grocerIdSchema>

export type Avatar = z.infer<typeof avatarSchema>

const productSchema = z.strictObject({
  name: z.string().min(1),
  unitCostCents: money,
  /** The cup, lid or bag that goes with each unit sold. */
  packagingCents: money,
  shelfLifeDays: z.int().positive(),
})

/** The truck the business runs, whoever paid for it. */
const truckSchema = z.strictObject({
  /**
   * What the truck is worth when a game starts. The books carry it unless
   * it is leased.
   */
  priceCents: money,
  /** Months the truck is depreciated over, straight line. */
  usefulLifeMonths: z.int().positive(),
})

/** What every truck pays on the 1st of each month. */
const monthlyCostsSchema = z.strictObject({
  permitParkingAndCommissary: money,
  insurance: money,
})

/** How customers pay: the share of sales paid by card and its fee. */
const cardPaymentsSchema = z.strictObject({
  share,
  /** The bank's fee, as a share of the card sales. */
  feeRate: share,
})

/**
 * How a product is restocked each morning the truck opens: `buyDaily` buys
 * `quantity` units; `topUp` buys back up to `upTo` units on hand once they
 * fall below `whenBelow`.
 */
const restockRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('buyDaily'), quantity: count }),
  z
    .strictObject({ kind: z.literal('topUp'), whenBelow: count, upTo: count })
    .refine((rule) => rule.whenBelow <= rule.upTo, {
      message: 'whenBelow must not exceed upTo',
      path: ['whenBelow'],
    }),
])

export type RestockRule = z.output<typeof restockRuleSchema>

/** Each segment's share of a crowd: every segment, summing to 1. */
const segmentSharesSchema = z
  .record(segmentIdSchema, share)
  .refine(
    (shares) =>
      Math.abs(sumOf(Object.values(shares)) - 1) <= SHARE_SUM_TOLERANCE,
    'segment shares must sum to 1',
  )

/** The crowd one type of day brings to the truck. */
const dayTypeSchema = z
  .strictObject({
    name: z.string().min(1),
    /** Walk-in traffic before the day's noise. */
    customers: count,
    segmentShares: segmentSharesSchema,
    /** Multiplies each segment's purchase probability for the product. */
    productAppeal: z.record(productIdSchema, z.number().nonnegative()),
    /** How long this crowd waits in line, relative to the usual. */
    patienceMultiplier: z.number().positive(),
    /** Relative arrivals in each slot of the opening hours, in order. */
    arrivalWeights: z.array(z.number().nonnegative()).min(1),
  })
  .refine(({ arrivalWeights }) => sumOf(arrivalWeights) > 0, {
    message: 'at least one arrival weight must be above 0',
    path: ['arrivalWeights'],
  })

export type DayType = z.output<typeof dayTypeSchema>

const walkInsSchema = z
  .strictObject({
    noiseStdDevRatio: z.number().nonnegative(),
    opensAtMinute: minuteOfDay,
    closesAtMinute: minuteOfDay,
    arrivalSlotMinutes: z.int().positive(),
    dayTypes: z.record(dayTypeIdSchema, dayTypeSchema),
  })
  .superRefine((walkIns, ctx) => {
    const { opensAtMinute, closesAtMinute, arrivalSlotMinutes } = walkIns
    const open = closesAtMinute - opensAtMinute
    if (open <= 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'closesAtMinute must be after opensAtMinute',
        path: ['closesAtMinute'],
      })
      return
    }
    if (open % arrivalSlotMinutes !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'the opening hours must hold a whole number of arrival slots',
        path: ['arrivalSlotMinutes'],
      })
      return
    }
    const slots = open / arrivalSlotMinutes
    for (const id of dayTypeIdSchema.options) {
      if (walkIns.dayTypes[id].arrivalWeights.length !== slots) {
        ctx.addIssue({
          code: 'custom',
          message: `expected one arrival weight per slot: ${slots}`,
          path: ['dayTypes', id, 'arrivalWeights'],
        })
      }
    }
  })

export type WalkIns = z.output<typeof walkInsSchema>

/**
 * How long serving a customer takes at the counter, and how long a line
 * customers will still join. A server at speed 1 takes exactly these times.
 */
const serviceSchema = z.strictObject({
  /** Seconds every customer takes, whatever they order. */
  baseSeconds: count,
  /** Seconds each unit ordered adds, sold out or not. */
  perItemSeconds: count,
  /** The most customers a newcomer finds still waiting and joins anyway. */
  maxAheadInLine: count,
})

export type Service = z.output<typeof serviceSchema>

/**
 * What the daily marketing budget brings. Awareness is the average spend of
 * the last `awarenessDays` business days, today not included, so spending
 * pays off from the next day. Each open day brings k × √awareness extra
 * walk-ins, with awareness in cents, before the day's noise.
 */
const marketingSchema = z.strictObject({
  /** The business days awareness averages, a closed day counting as 0. */
  awarenessDays: z.int().positive(),
  /** k: the extra walk-ins per square root of a cent of awareness. */
  extraCustomersPerSqrtCent: z.number().nonnegative(),
  /** Who the extra walk-ins are. */
  segmentShares: segmentSharesSchema,
})

export type Marketing = z.output<typeof marketingSchema>

/**
 * How the truck runs when a game starts, until the player changes it. Each
 * product keeps the kind of restock rule it starts with.
 */
const startingDecisionsSchema = z.strictObject({
  pricesCents: z.record(productIdSchema, money),
  restock: z.record(productIdSchema, restockRuleSchema),
  /** The weekdays the truck opens. */
  daysOpen: z.array(weekday),
  ownerWeeklyPayCents: money,
  marketingDailyCents: money,
})

// A range of values the player may pick, both ends allowed.
const orderedRange = {
  check: ({ min, max }: { min: number; max: number }) => min <= max,
  params: { message: 'min must not exceed max', path: ['min'] },
}

const moneyRange = z
  .strictObject({ min: money, max: money })
  .refine(orderedRange.check, orderedRange.params)

/** What the player may decide; the engine rejects anything outside it. */
const decisionLimitsSchema = z.strictObject({
  /** Prices are whole multiples of `step`. */
  priceCents: z
    .strictObject({ min: money, max: money, step: z.int().positive() })
    .refine(orderedRange.check, orderedRange.params),
  /** The units a restock rule may name. */
  units: z
    .strictObject({ min: count, max: count })
    .refine(orderedRange.check, orderedRange.params),
  ownerWeeklyPayCents: moneyRange,
  marketingDailyCents: moneyRange,
  minDaysOpen: z.int().min(1).max(DAYS_PER_WEEK),
})

export type DecisionLimits = z.output<typeof decisionLimitsSchema>

// A record keyed by the enum needs every product and rejects any other key.
export const foodTruckSchema = z.strictObject({
  _note: z.string().optional(),
  products: z.record(productIdSchema, productSchema),
  truck: truckSchema,
  monthlyCostsCents: monthlyCostsSchema,
  fuelAndMaintenancePerOpenDayCents: money,
  cardPayments: cardPaymentsSchema,
  /** The weekday the owner is paid, whether the truck opens or not. */
  ownerPayWeekday: weekday,
  walkIns: walkInsSchema,
  service: serviceSchema,
  marketing: marketingSchema,
  startingDecisions: startingDecisionsSchema,
  decisionLimits: decisionLimitsSchema,
})

export type FoodTruckContent = z.output<typeof foodTruckSchema>

/** How a segment's customers decide on one product. */
const segmentProductSchema = z.strictObject({
  /** The price they find fair; above it they buy less. */
  referencePriceCents: z
    .int()
    .positive()
    .transform((n) => cents(n)),
  /** The chance they buy one at the reference price, before appeal. */
  purchaseProbability: share,
  /** How steeply they buy less as the price rises above the reference. */
  sensitivity: z.number().nonnegative(),
})

/** Customers who distrust a price far below their reference. */
const tooCheapSchema = z.strictObject({
  /** The price ratio under which they mostly stop buying. */
  belowRatio: z.number().gt(0).lt(1),
  /** How sharply they stop buying around that ratio. */
  steepness: z.number().positive(),
})

const segmentSchema = z.strictObject({
  name: z.string().min(1),
  /**
   * The longest wait in line they accept, in minutes, before the day type's
   * `patienceMultiplier`.
   */
  patienceMinutes: z.number().positive(),
  products: z.record(productIdSchema, segmentProductSchema),
  tooCheap: tooCheapSchema.optional(),
})

export type Segment = z.output<typeof segmentSchema>

export const customerSchema = z.strictObject({
  _note: z.string().optional(),
  segments: z.record(segmentIdSchema, segmentSchema),
})

export type CustomerContent = z.output<typeof customerSchema>

/**
 * How the truck comes to the business: already the owner's (`owned`), bought
 * with a startup loan (`loan`) or leased by the month (`lease`).
 */
const startingTruckSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owned') }),
  z.strictObject({
    kind: z.literal('loan'),
    loanCents: positiveMoney,
    /** The yearly rate in basis points: 800 is 8 %. */
    annualRateBasisPoints: z.int().nonnegative(),
    /** Monthly payments, the first a month after the loan. */
    termMonths: z.int().positive(),
  }),
  z.strictObject({ kind: z.literal('lease'), monthlyLeaseCents: money }),
])

/** One way to start a game, as the new game screen shows it. */
const difficultySchema = z.strictObject({
  name: z.string().min(1),
  /** What the business has in the bank once the truck is settled. */
  startingCashCents: money,
  /** What the owner has saved of their own, outside the business. */
  startingPersonalCashCents: money,
  truck: startingTruckSchema,
})

export type Difficulty = z.output<typeof difficultySchema>

/** What the bakery costs at one difficulty. */
const bakeryPricesSchema = z.strictObject({
  /** The bakery's rent, due on the 1st of each month it holds its premises. */
  monthlyRentCents: money,
  /** What the ingredients of one croissant cost, from Meunerie Bonpain. */
  ingredientCostCents: positiveMoney,
})

export type BakeryPrices = z.output<typeof bakeryPricesSchema>

export const difficultyContentSchema = z.strictObject({
  _note: z.string().optional(),
  difficulties: z.record(difficultyIdSchema, difficultySchema),
  /** The bakery's prices at each difficulty. */
  bakery: z.record(difficultyIdSchema, bakeryPricesSchema),
})

export type DifficultyContent = z.output<typeof difficultyContentSchema>

/**
 * Where the truck's croissants come from: bought from the supplier
 * (`acheter`) or made at the bakery (`fabriquer`).
 */
export const croissantSourceSchema = z.enum(['acheter', 'fabriquer'])

export type CroissantSource = z.infer<typeof croissantSourceSchema>

/** How the bakery's oven comes: leased by the month (`louer`) or bought (`acheter`). */
export const ovenTermsSchema = z.enum(['louer', 'acheter'])

export type OvenTerms = z.infer<typeof ovenTermsSchema>

/** The bakery, le fournil: what it costs, what it makes and how it runs. */
export const bakeryContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** The oven, bought or leased. */
    oven: z.strictObject({
      /** What buying it costs. The books carry it, depreciated. */
      priceCents: positiveMoney,
      /** Months it is depreciated over, straight line. */
      usefulLifeMonths: z.int().positive(),
      /** What leasing it costs on the 1st of each month. */
      monthlyLeaseCents: money,
    }),
    /** The most croissants the bakery makes in a day. */
    capacityPerDay: z.int().positive(),
    /** What moving into the premises costs, the day the bakery opens. */
    movingCostCents: money,
    /**
     * Whole months the rent is still due after the player closes the
     * bakery: it keeps its premises to the end of the month this many
     * months after the one it is closed in.
     */
    noticeMonths: z.int().nonnegative(),
    /** What a day of baking takes from the owner's energy. */
    bakingEnergyCost: energyAmount,
    /** How the croissants come when a game starts, until the player changes it. */
    startingDecisions: z.strictObject({
      croissantSource: croissantSourceSchema,
      /** How many croissants the bakery makes each morning the truck opens. */
      bake: restockRuleSchema,
    }),
  })
  .superRefine(({ capacityPerDay, startingDecisions }, ctx) => {
    const { bake } = startingDecisions
    const units = bake.kind === 'buyDaily' ? [bake.quantity] : [bake.upTo]
    if (units.some((n) => n > capacityPerDay)) {
      ctx.addIssue({
        code: 'custom',
        message: `the bake rule must stay within capacityPerDay: ${capacityPerDay}`,
        path: ['startingDecisions', 'bake'],
      })
    }
  })

export type BakeryContent = z.output<typeof bakeryContentSchema>

export const profileContentSchema = z.strictObject({
  _note: z.string().optional(),
  /** The most characters a business name may hold. */
  businessNameMaxLength: z.int().positive(),
  /** What the new game screen offers until the player changes it. */
  defaultProfile: z.strictObject({
    businessName: z.string().min(1),
    avatar: avatarSchema,
    difficulty: difficultyIdSchema,
  }),
})

export type ProfileContent = z.output<typeof profileContentSchema>

/**
 * What the owner's own life costs, paid from their personal account and
 * never by the business.
 */
export const personalContentSchema = z.strictObject({
  _note: z.string().optional(),
  /** The owner's rent, due on the 1st of each month. */
  rentCents: money,
  /** Groceries, phone, transit and the rest of the week, paid on payday. */
  weeklyExpensesCents: money,
})

export type PersonalContent = z.output<typeof personalContentSchema>

/** How the owner works once their energy falls below `below`. */
const fatigueSchema = z.strictObject({
  /** The energy under which these effects apply. */
  below: z.number().gt(0).max(FULL_ENERGY),
  /** How much longer serving a customer takes: 0.2 is 20 % longer. */
  serviceTimeIncrease: z.number().nonnegative(),
  /** The share of the units made that are botched and made again. */
  botchedShare: share,
})

/**
 * What wears the owner out and what brings them back, on an energy scale of
 * 0 to 100, and how they work once tired, then exhausted.
 */
export const energyContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** What each day the truck opens costs, however quiet. */
    openDayCost: energyAmount,
    /** What each customer who reaches the counter adds to that cost. */
    costPerCustomerServed: energyAmount,
    /** What each night gives back. */
    nightRecovery: energyAmount,
    /** What each day the truck is closed gives back. */
    closedDayRecovery: energyAmount,
    /** What each payday costs when the owner's personal cash is below zero. */
    debtStress: energyAmount,
    /** « Fatigué ». */
    tired: fatigueSchema,
    /** « Épuisé », below `tired`. */
    exhausted: fatigueSchema,
  })
  .refine(({ tired, exhausted }) => exhausted.below < tired.below, {
    message: 'exhausted.below must be below tired.below',
    path: ['exhausted', 'below'],
  })

export type EnergyContent = z.output<typeof energyContentSchema>

// Rules the event card is held to, not tunables: what fits on the card.
const SITUATION_MAX_LENGTH = 280
const CHOICE_LABEL_MAX_LENGTH = 45
const RESULT_MAX_LENGTH = 200

/** French text the player reads: not blank, with no space at either end. */
function frenchText(maxLength: number = Number.MAX_SAFE_INTEGER) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((text) => text === text.trim(), {
      message: 'text starts and ends with a character, not a space',
    })
}

/** The id of an event, a choice, a character or a headline: camelCase. */
const idSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/, 'expected a camelCase id, such as essai')

/** Whole cents of either sign but never 0, typed as the engine's `Cents`. */
const nonZeroMoney = z
  .int()
  .refine((n) => n !== 0, 'expected an amount other than 0')
  .transform((n) => cents(n))

/**
 * The expense accounts an event may charge, from the chart in
 * src/finance/accounts.ts: Emballages, Loyer et permis, Assurances,
 * Carburant et entretien, Marketing, Frais bancaires et de cartes and Autres
 * charges.
 */
export const eventChargeAccountSchema = z.enum([
  '5200',
  '6100',
  '6150',
  '6200',
  '6300',
  '6500',
  '6900',
])

/** What a change to the street multiplies by: above 0. */
const factor = z.number().positive()

/**
 * The changes to the street, one shape for each kind, without how long they
 * last: the walk-ins of everyone or of one `segment`, one product's appeal,
 * what everyone or one `segment` will pay, a product that cannot be sold,
 * and the truck closed whatever the days open, for a day off or, with
 * `work`, for a day of work away from the counter.
 */
const STREET_CHANGES = {
  walkIns: {
    kind: z.literal('walkIns'),
    factor,
    segment: segmentIdSchema.optional(),
  },
  appeal: { kind: z.literal('appeal'), product: productIdSchema, factor },
  willingness: {
    kind: z.literal('willingness'),
    factor,
    segment: segmentIdSchema.optional(),
  },
  unavailable: { kind: z.literal('unavailable'), product: productIdSchema },
  closed: { kind: z.literal('closed'), work: z.boolean().optional() },
} as const

/**
 * A change to the street, as the game keeps it while it lasts: an effect of
 * a street kind without its `days`.
 */
export const streetChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject(STREET_CHANGES.walkIns),
  z.strictObject(STREET_CHANGES.appeal),
  z.strictObject(STREET_CHANGES.willingness),
  z.strictObject(STREET_CHANGES.unavailable),
  z.strictObject(STREET_CHANGES.closed),
])

export type StreetChange = z.output<typeof streetChangeSchema>

/** The kinds of change to the street. */
export type StreetModifierKind = StreetChange['kind']

/** The days a change to the street lasts, its first day included. */
const streetDays = z.int().positive()

/**
 * One kind of effect for each member, with `extra` added to each: nothing
 * for the effect as the engine applies it, its timing for the content.
 */
function effectSchemas<Extra extends z.core.$ZodShape>(extra: Extra) {
  return [
    /** Pays `amountCents` now, Dr `account` (6900 by default) / Cr 1000. */
    z.strictObject({
      kind: z.literal('charge'),
      amountCents: positiveMoney,
      description: frenchText(),
      account: eventChargeAccountSchema.optional(),
      ...extra,
    }),
    /** Revenue paid now: Dr 1000 / Cr 4000. */
    z.strictObject({
      kind: z.literal('cashSale'),
      amountCents: positiveMoney,
      description: frenchText(),
      ...extra,
    }),
    /** Revenue now, which `client` pays `dueInDays` days later. */
    z.strictObject({
      kind: z.literal('creditSale'),
      amountCents: positiveMoney,
      client: frenchText(),
      dueInDays: z.int().positive(),
      ...extra,
    }),
    /** `client` pays everything they owe now. */
    z.strictObject({
      kind: z.literal('collectReceivable'),
      client: frenchText(),
      ...extra,
    }),
    /** What `client` owes comes due `days` days later. */
    z.strictObject({
      kind: z.literal('delayReceivable'),
      client: frenchText(),
      days: z.int().positive(),
      ...extra,
    }),
    /** What `client` owes will never be paid. */
    z.strictObject({
      kind: z.literal('writeOff'),
      client: frenchText(),
      ...extra,
    }),
    /**
     * Buys `units` of `product`, paid now, at its unit cost or at
     * `unitCostCents`.
     */
    z.strictObject({
      kind: z.literal('buyStock'),
      product: productIdSchema,
      units: z.int().positive(),
      unitCostCents: positiveMoney.optional(),
      ...extra,
    }),
    /**
     * Takes up to `units` of `product` out of the stock, oldest first: sold
     * in an `order`, given away to 6300 Marketing, or lost to 5100 Pertes
     * sur stocks.
     */
    z.strictObject({
      kind: z.literal('useStock'),
      product: productIdSchema,
      units: z.int().positive(),
      to: z.enum(['order', 'giveaway', 'loss']),
      ...extra,
    }),
    /** Changes the owner's energy, which stays between 0 and 100. */
    z.strictObject({
      kind: z.literal('energy'),
      amount: z
        .number()
        .min(-FULL_ENERGY)
        .max(FULL_ENERGY)
        .refine((n) => n !== 0, 'expected an amount other than 0'),
      ...extra,
    }),
    /** Changes the owner's own cash, outside the books, as `label`. */
    z.strictObject({
      kind: z.literal('personal'),
      amountCents: nonZeroMoney,
      label: frenchText(),
      ...extra,
    }),
    /** Brings `event` `days` days later, with a `chance` of 1 by default. */
    z.strictObject({
      kind: z.literal('followUp'),
      event: idSchema,
      days: z.int().positive(),
      chance: z.number().gt(0).max(1).default(1),
      ...extra,
    }),
    /** Queues the La Presse-Citron headline `id`. */
    z.strictObject({ kind: z.literal('headline'), id: idSchema, ...extra }),
    /**
     * For `days` days from the day it starts, multiplies the walk-ins of
     * everyone, or of `segment`, by `factor`.
     */
    z.strictObject({ ...STREET_CHANGES.walkIns, days: streetDays, ...extra }),
    /** For `days` days, multiplies `product`'s appeal by `factor`. */
    z.strictObject({ ...STREET_CHANGES.appeal, days: streetDays, ...extra }),
    /**
     * For `days` days, multiplies what everyone, or `segment`, will pay,
     * their reference prices, by `factor`.
     */
    z.strictObject({
      ...STREET_CHANGES.willingness,
      days: streetDays,
      ...extra,
    }),
    /** For `days` days, `product` cannot be sold. */
    z.strictObject({
      ...STREET_CHANGES.unavailable,
      days: streetDays,
      ...extra,
    }),
    /**
     * For `days` days, the truck stays closed, whatever the days open. With
     * `work`, the owner works those days away from the counter.
     */
    z.strictObject({ ...STREET_CHANGES.closed, days: streetDays, ...extra }),
    /**
     * Starts a weekly contract with `grocer`, at its price times
     * `priceFactor`, 1 by default.
     */
    z.strictObject({
      kind: z.literal('contract'),
      grocer: grocerIdSchema,
      priceFactor: factor.optional(),
      ...extra,
    }),
    /** For `days` days, `grocer` offers no contract. */
    z.strictObject({
      kind: z.literal('grocerAway'),
      grocer: grocerIdSchema,
      days: z.int().positive(),
      ...extra,
    }),
    /**
     * An emergency loan from `lender` (#159): enough to bring Encaisse to
     * `monthsOfFixedCosts` months of fixed costs, `maxCents` at most, paid
     * back monthly over `termMonths` at `annualRateBasisPoints` a year,
     * with `feeShare` of it charged up front.
     */
    z.strictObject({
      kind: z.literal('emergencyLoan'),
      lender: frenchText(),
      monthsOfFixedCosts: z.number().positive(),
      maxCents: positiveMoney,
      annualRateBasisPoints: z.int().nonnegative(),
      termMonths: z.int().positive(),
      feeShare: share,
      ...extra,
    }),
    /**
     * Sells `share` of the business to `investor` for `amountCents` (#159),
     * who takes that share of each quarter's profit from then on.
     */
    z.strictObject({
      kind: z.literal('shareSale'),
      investor: frenchText(),
      amountCents: positiveMoney,
      share: z.number().gt(0).lt(1),
      ...extra,
    }),
  ] as const
}

/**
 * What an event does, as the engine applies it: on the day it starts,
 * without the timing the content gives it. A save holds the effects still
 * to come in this form.
 */
export const eventEffectSchema = z.discriminatedUnion('kind', effectSchemas({}))

export type EventEffect = z.output<typeof eventEffectSchema>

/**
 * An effect as the content writes it: now, or later, after `inDays` days or
 * on the next `onNextWeekday` (4 is next Thursday, a week away on a
 * Thursday), never both; at every difficulty, or only at the `difficulties`
 * listed; and with the `name` its choice's tags know it by, if any.
 */
const timedEffectSchema = z
  .discriminatedUnion(
    'kind',
    effectSchemas({
      inDays: z.int().positive().optional(),
      onNextWeekday: weekday.optional(),
      difficulties: z.array(difficultyIdSchema).min(1).optional(),
      name: idSchema.optional(),
    }),
  )
  .refine(
    (effect) =>
      effect.inDays === undefined || effect.onNextWeekday === undefined,
    { message: 'an effect starts after inDays or onNextWeekday, not both' },
  )
  // What a card shows of a later purchase reads the product's own cost.
  .refine(
    (effect) =>
      effect.kind !== 'buyStock' ||
      effect.unitCostCents === undefined ||
      (effect.inDays === undefined && effect.onNextWeekday === undefined),
    { message: 'a purchase at its own unit cost happens now' },
  )
  // A contract starts the morning it is signed, so its deliveries count
  // from there, and the grocer who walks away does it then.
  .refine(
    (effect) =>
      (effect.kind !== 'contract' && effect.kind !== 'grocerAway') ||
      (effect.inDays === undefined && effect.onNextWeekday === undefined),
    { message: 'a contract, or a grocer walking away, happens now' },
  )
  // The loan's amount reads the encaisse of the morning it is taken, and
  // the investor pays when the deal is made.
  .refine(
    (effect) =>
      (effect.kind !== 'emergencyLoan' && effect.kind !== 'shareSale') ||
      (effect.inDays === undefined && effect.onNextWeekday === undefined),
    { message: 'an emergency loan, or a share sale, happens now' },
  )

export type TimedEventEffect = z.output<typeof timedEffectSchema>

/** What a tag shows of an effect: money, energy or a percentage. */
export type TagUnit = 'money' | 'energy' | 'percent'

/**
 * The kinds of effect a tag may show the amount of, with what it shows:
 * money for a charge, a sale, the owner's own cash, the most an emergency
 * loan lends or what shares sell for, points of energy, and how far a
 * change to the street moves from 1, as a percentage.
 */
export const TAG_UNITS = {
  charge: 'money',
  cashSale: 'money',
  creditSale: 'money',
  personal: 'money',
  emergencyLoan: 'money',
  shareSale: 'money',
  energy: 'energy',
  walkIns: 'percent',
  appeal: 'percent',
  willingness: 'percent',
} as const satisfies Partial<Record<TimedEventEffect['kind'], TagUnit>>

/** Where a tag's text shows the amount of the effect it names. */
export const TAG_AMOUNT = '{montant}'

/**
 * Where a card's situation, quote, choice label or outcome result shows the
 * amount of the effects named `name`: `{montant:name}`.
 */
const TEXT_AMOUNT = /\{montant:([a-z][A-Za-z0-9]*)\}/g

/** A piece of a card's text: words, or the name of the effects shown. */
export type TextPart = string | { readonly amountOf: string }

/** `text` as its words and the amounts it shows (see `TEXT_AMOUNT`). */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let from = 0
  for (const match of text.matchAll(TEXT_AMOUNT)) {
    const [whole, name] = match
    if (match.index > from) parts.push(text.slice(from, match.index))
    if (name !== undefined) parts.push({ amountOf: name })
    from = match.index + whole.length
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts
}

/**
 * The effects of `outcomes` named `name` that apply at `difficulty`, in the
 * first outcome holding one; none when no outcome does.
 */
export function namedEffects(
  outcomes: readonly (readonly TimedEventEffect[])[],
  name: string,
  difficulty: DifficultyId,
): TimedEventEffect[] {
  for (const effects of outcomes) {
    const named = effects.filter(
      (effect) =>
        effect.name === name &&
        (effect.difficulties === undefined ||
          effect.difficulties.includes(difficulty)),
    )
    if (named.length > 0) return named
  }
  return []
}

/**
 * Checks `text`, at `path`: every amount it shows names effects of
 * `outcomes` (see `namedEffects`) at every difficulty, all of one unit, and
 * it has no other braces, so that no amount shows as written.
 */
function checkTextAmounts(
  text: string,
  outcomes: readonly (readonly TimedEventEffect[])[],
  path: readonly (string | number)[],
  ctx: z.RefinementCtx,
): void {
  for (const part of textParts(text)) {
    if (typeof part === 'string') {
      if (/[{}]/.test(part)) {
        ctx.addIssue({
          code: 'custom',
          message: `a card's text shows an amount as {montant:name}`,
          path: [...path],
        })
      }
      continue
    }
    for (const difficulty of difficultyIdSchema.options) {
      const named = namedEffects(outcomes, part.amountOf, difficulty)
      const units = new Set(
        named.map(({ kind }) =>
          kind in TAG_UNITS ? TAG_UNITS[kind as keyof typeof TAG_UNITS] : null,
        ),
      )
      if (named.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: `no effect named ${part.amountOf} applies at ${difficulty}`,
          path: [...path],
        })
      } else if (units.size !== 1 || units.has(null)) {
        ctx.addIssue({
          code: 'custom',
          message: `the effects named ${part.amountOf} have no amount of one unit to show`,
          path: [...path],
        })
      }
    }
  }
}

/**
 * What the owner would know of a choice before making it: a text shown as
 * it is, or a text shown only at the `difficulties` listed and, when it
 * names an `effect`, only where that effect applies, with `{montant}`
 * replaced by its amount at the game's difficulty.
 */
const choiceTagSchema = z.union([
  frenchText(),
  z
    .strictObject({
      text: frenchText(),
      effect: idSchema.optional(),
      difficulties: z.array(difficultyIdSchema).min(1).optional(),
    })
    .refine(
      ({ text, effect }) => effect !== undefined || !text.includes(TAG_AMOUNT),
      { message: `a tag showing ${TAG_AMOUNT} names its effect` },
    ),
])

export type ChoiceTagContent = z.output<typeof choiceTagSchema>

/** One way a choice can turn out; the player never sees its chance. */
const eventOutcomeSchema = z.strictObject({
  chance: z.number().gt(0).max(1),
  result: frenchText(RESULT_MAX_LENGTH),
  effects: z.array(timedEffectSchema),
})

export type EventOutcome = z.output<typeof eventOutcomeSchema>

const eventChoiceSchema = z
  .strictObject({
    id: idSchema,
    label: frenchText(CHOICE_LABEL_MAX_LENGTH),
    /** What the owner would know before choosing, as the card shows it. */
    tags: z.array(choiceTagSchema).min(1),
    /** Their chances sum to 1. */
    outcomes: z.array(eventOutcomeSchema).min(1),
  })
  .refine(
    ({ outcomes }) =>
      Math.abs(sumOf(outcomes.map(({ chance }) => chance)) - 1) <=
      SHARE_SUM_TOLERANCE,
    {
      message: 'the chances of the outcomes must sum to 1',
      path: ['outcomes'],
    },
  )
  .superRefine(({ tags, outcomes }, ctx) => {
    // The unit of each effect name of the choice; null when a name is
    // shared by effects that show different units, or none.
    const units = new Map<string, TagUnit | null>()
    for (const { effects } of outcomes) {
      for (const effect of effects) {
        if (effect.name === undefined) continue
        const unit: TagUnit | null =
          effect.kind in TAG_UNITS
            ? TAG_UNITS[effect.kind as keyof typeof TAG_UNITS]
            : null
        const known = units.get(effect.name)
        units.set(
          effect.name,
          known === undefined || known === unit ? unit : null,
        )
      }
    }
    tags.forEach((tag, t) => {
      if (typeof tag === 'string' || tag.effect === undefined) return
      const path = ['tags', t, 'effect']
      const unit = units.get(tag.effect)
      if (unit === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `no effect of this choice is named ${tag.effect}`,
          path,
        })
      } else if (unit === null && tag.text.includes(TAG_AMOUNT)) {
        ctx.addIssue({
          code: 'custom',
          message: `the effects named ${tag.effect} have no amount of one unit to show`,
          path,
        })
      }
    })
  })

export type EventChoice = z.output<typeof eventChoiceSchema>

/** A calendar date of any year: `dayOfMonth` exists in `month`. */
const calendarDateSchema = z
  .strictObject({
    month: z.int().min(1).max(MONTH_LENGTHS.length),
    dayOfMonth: z.int().min(1),
  })
  .refine(
    ({ month, dayOfMonth }) => dayOfMonth <= (MONTH_LENGTHS[month - 1] ?? 0),
    { message: 'no such day in that month', path: ['dayOfMonth'] },
  )

/** A choice of an event, as the history records it. */
const eventChoiceRefSchema = z.strictObject({
  event: idSchema,
  choice: idSchema,
})

export type EventChoiceRef = z.output<typeof eventChoiceRefSchema>

/**
 * When an event may be drawn: every condition given must hold on the
 * morning of the draw.
 */
const eventConditionsSchema = z.strictObject({
  /** The earliest game day. */
  fromDay: z.int().nonnegative().optional(),
  difficulties: z.array(difficultyIdSchema).min(1).optional(),
  /** Calendar months, 1 = January. */
  months: z.array(z.int().min(1).max(MONTH_LENGTHS.length)).min(1).optional(),
  /** One date of the year, such as June 30. */
  date: calendarDateSchema.optional(),
  /** The morning's ISO weekday. */
  weekdays: z.array(weekday).min(1).optional(),
  /** The owner's morning energy is below this. */
  energyBelow: energyAmount.optional(),
  /** Encaisse is above this. */
  cashAboveCents: z.int().optional(),
  /** Encaisse is below this. */
  cashBelowCents: z.int().optional(),
  /** Never drawn again once it has come up. */
  oncePerGame: z.boolean().optional(),
  /** Never drawn again once it has come up this many times. */
  maxPerGame: z.int().positive().optional(),
  /** Days after it last came up before it may be drawn again. */
  cooldownDays: z.int().positive().optional(),
  /** The player made one of these choices before. */
  chosen: z.array(eventChoiceRefSchema).min(1).optional(),
  /** The player never made any of these choices. */
  notChosen: z.array(eventChoiceRefSchema).min(1).optional(),
  /** The product's restock rule buys some. */
  productOnMenu: productIdSchema.optional(),
  /**
   * Whether the truck opens the next day: the days open hold its weekday
   * and no change to the street closes it.
   */
  openTomorrow: z.boolean().optional(),
  /** Only ever comes as another event's follow-up. */
  followUpOnly: z.boolean().optional(),
  /**
   * The grocer may offer a contract: none of theirs runs, fewer than the
   * most at once do, and they are not away.
   */
  grocer: grocerIdSchema.optional(),
})

export type EventConditions = z.output<typeof eventConditionsSchema>

/**
 * How the player stands on a morning, at a difficulty whose draw adapts to
 * them: « en difficulté », « dans la moyenne » or « en avance ».
 */
export const standingSchema = z.enum(['behind', 'average', 'ahead'])

export type Standing = z.infer<typeof standingSchema>

/** Relative odds among the events whose conditions hold; 0 never draws. */
const eventWeight = z.number().nonnegative()

const eventSchema = z
  .strictObject({
    id: idSchema,
    weight: eventWeight,
    /**
     * The weight at a difficulty whose draw adapts to the player, for each
     * standing it gives; `weight` for the others.
     */
    weightByStanding: z.partialRecord(standingSchema, eventWeight).optional(),
    /** Who brings the dilemma: a portrait id, a French name and a role. */
    character: z.strictObject({
      id: idSchema,
      name: frenchText(),
      role: frenchText(),
    }),
    title: frenchText(),
    /**
     * The situation, the quote, each choice's label and each outcome's
     * result may show amounts as `{montant:name}` (see `textParts`): the
     * effects so named in the event's choices, the choice's outcomes or the
     * outcome, in that order.
     */
    situation: frenchText(SITUATION_MAX_LENGTH),
    quote: frenchText().optional(),
    conditions: eventConditionsSchema.optional(),
    choices: z.array(eventChoiceSchema).min(2).max(3),
  })
  .superRefine(({ situation, quote, choices }, ctx) => {
    const everyOutcome = choices.flatMap(({ outcomes }) =>
      outcomes.map(({ effects }) => effects),
    )
    checkTextAmounts(situation, everyOutcome, ['situation'], ctx)
    if (quote !== undefined) {
      checkTextAmounts(quote, everyOutcome, ['quote'], ctx)
    }
    choices.forEach(({ label, outcomes }, c) => {
      checkTextAmounts(
        label,
        outcomes.map(({ effects }) => effects),
        ['choices', c, 'label'],
        ctx,
      )
      outcomes.forEach(({ result, effects }, o) => {
        checkTextAmounts(
          result,
          [effects],
          ['choices', c, 'outcomes', o, 'result'],
          ctx,
        )
      })
    })
  })

export type EventCard = z.output<typeof eventSchema>

/** How often events come: the first day, the gap and the daily chance. */
const eventPacingSchema = z.strictObject({
  /** No event is drawn before this game day. */
  firstDay: z.int().nonnegative(),
  /** Days from one drawn event to the next; follow-ups do not count. */
  minDaysBetween: z.int().nonnegative(),
  /** The chance of an event on a morning one may be drawn. */
  dailyChance: share,
})

/** How a difficulty scales what a choice gives and what it takes. */
const eventScaleSchema = z.strictObject({
  /** Multiplies every gain: a sale, a change to the street above 1. */
  gains: z.number().positive(),
  /** Multiplies every loss: a charge, a change to the street below 1. */
  losses: z.number().positive(),
})

export type EventScale = z.output<typeof eventScaleSchema>

/**
 * How each difficulty scales the effects of the choices; none does without
 * it. A change to the street scales by its distance from 1, never below
 * `lowestFactor`.
 */
const eventScalingSchema = z.strictObject({
  _note: z.string().optional(),
  lowestFactor: z.number().positive().max(1),
  difficulties: z.record(difficultyIdSchema, eventScaleSchema),
})

export type EventScaling = z.output<typeof eventScalingSchema>

/**
 * Where the draw follows the player's standing (see `weightByStanding`);
 * nowhere without it. The player is « en difficulté » below the percentile
 * `behindBelowPercentile` of their difficulty and week, or with an encaisse
 * below `behindBelowMonthsOfFixedCosts` months of fixed costs; « en
 * avance » above the percentile `aheadAbovePercentile`.
 */
const adaptiveDrawSchema = z
  .strictObject({
    _note: z.string().optional(),
    difficulties: z.array(difficultyIdSchema).min(1),
    behindBelowPercentile: z.number().min(0).max(100),
    aheadAbovePercentile: z.number().min(0).max(100),
    behindBelowMonthsOfFixedCosts: z.number().nonnegative(),
  })
  .refine(
    ({ behindBelowPercentile, aheadAbovePercentile }) =>
      behindBelowPercentile <= aheadAbovePercentile,
    {
      message: 'behindBelowPercentile is at most aheadAbovePercentile',
      path: ['aheadAbovePercentile'],
    },
  )

export type AdaptiveDraw = z.output<typeof adaptiveDrawSchema>

export const eventContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    pacing: eventPacingSchema,
    scaling: eventScalingSchema.optional(),
    adaptiveDraw: adaptiveDrawSchema.optional(),
    events: z.array(eventSchema),
  })
  .superRefine(({ events }, ctx) => {
    const ids = new Set(events.map(({ id }) => id))
    const choicesOf = new Map(
      events.map(({ id, choices }) => [id, choices.map((c) => c.id)]),
    )
    const seen = new Set<string>()
    events.forEach(({ id, choices, conditions }, e) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `the event id ${id} appears twice`,
          path: ['events', e, 'id'],
        })
      }
      seen.add(id)
      for (const key of ['chosen', 'notChosen'] as const) {
        conditions?.[key]?.forEach(({ event, choice }, r) => {
          const known = choicesOf.get(event)
          if (known?.includes(choice) === true) return
          ctx.addIssue({
            code: 'custom',
            message:
              known === undefined
                ? `no event has the id ${event}`
                : `the event ${event} has no choice ${choice}`,
            path: ['events', e, 'conditions', key, r],
          })
        })
      }
      const choiceIds = new Set<string>()
      choices.forEach((choice, c) => {
        if (choiceIds.has(choice.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `the choice id ${choice.id} appears twice in this event`,
            path: ['events', e, 'choices', c, 'id'],
          })
        }
        choiceIds.add(choice.id)
        choice.outcomes.forEach(({ effects }, o) => {
          effects.forEach((effect, f) => {
            if (effect.kind === 'followUp' && !ids.has(effect.event)) {
              ctx.addIssue({
                code: 'custom',
                message: `no event has the id ${effect.event}`,
                path: [
                  'events',
                  e,
                  'choices',
                  c,
                  'outcomes',
                  o,
                  'effects',
                  f,
                  'event',
                ],
              })
            }
          })
        })
      })
    })
  })

export type EventContent = z.output<typeof eventContentSchema>

/** One grocer and the contract they offer. */
const grocerSchema = z.strictObject({
  /** The shop, as the journal names the client. */
  name: frenchText(),
  /** Who runs it. */
  owner: frenchText(),
  /** Croissants delivered each week. */
  unitsPerWeek: z.int().positive(),
  /** What the grocer pays for each croissant. */
  unitPriceCents: positiveMoney,
  /** Days after a delivery the grocer pays for it. */
  paymentDays: z.int().positive(),
  /** Deliveries a contract runs for, one a week. */
  weeks: z.int().positive(),
  /** What the grocer pays more for each croissant the bakery made. */
  artisanalPremiumCents: money,
  /**
   * The event that offers to renew the contract, the morning after its last
   * delivery: a `followUpOnly` card.
   */
  renewalEvent: idSchema,
})

export type Grocer = z.output<typeof grocerSchema>

/** The grocers' weekly croissant contracts (#156). */
export const grocerContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** The most contracts that run at once. */
    maxContracts: z.int().positive(),
    /** The ISO weekday of the deliveries, open or closed. */
    deliveryWeekday: weekday,
    /** What a delivery takes from the owner's energy. */
    deliveryEnergyCost: energyAmount,
    /**
     * The missed deliveries that end a contract, with no renewal: the last
     * one does.
     */
    maxStrikes: z.int().positive(),
    grocers: z.record(grocerIdSchema, grocerSchema),
  })
  .superRefine(({ grocers }, ctx) => {
    const seen = new Set<string>()
    for (const [id, { name }] of Object.entries(grocers)) {
      if (seen.has(name)) {
        ctx.addIssue({
          code: 'custom',
          message: `two grocers are named ${name}, so their debts would mix`,
          path: ['grocers', id, 'name'],
        })
      }
      seen.add(name)
    }
  })

export type GrocerContent = z.output<typeof grocerContentSchema>

/**
 * What an employee does (#158): serves at the truck beside the owner
 * (`camion`), delivers to the grocers (`livreur`) or bakes at the bakery
 * (`boulanger`).
 */
export const staffRoleIdSchema = z.enum(['camion', 'livreur', 'boulanger'])

export type StaffRoleId = z.infer<typeof staffRoleIdSchema>

/** The people the player may hire (#158), by id. */
export const candidateIdSchema = z.enum([
  'amelie',
  'kevin',
  'sophie',
  'mathieu',
  'nadia',
  'jonathan',
  'isabelle',
  'samuel',
  'chloe',
  'olivier',
  'maude',
  'thierry',
])

export type CandidateId = z.infer<typeof candidateIdSchema>

/** One role: what it is called, its hours and its wage. */
const staffRoleSchema = z
  .strictObject({
    /** The role, as the player reads it. */
    name: frenchText(),
    /** The hours worked a week, which the weekly wage pays. */
    hoursPerWeek: z.int().positive(),
    /** The hourly wage the player may set, and the one a hire starts at. */
    hourlyWageCents: z.strictObject({
      min: positiveMoney,
      start: positiveMoney,
      max: positiveMoney,
    }),
  })
  .refine(
    ({ hourlyWageCents: { min, start, max } }) => min <= start && start <= max,
    {
      message: 'the starting wage must be within [min, max]',
      path: ['hourlyWageCents'],
    },
  )

export type StaffRole = z.output<typeof staffRoleSchema>

/** Someone the player may hire. */
const candidateSchema = z.strictObject({
  /** Their name, as the player and the journal read it. */
  name: frenchText(),
  /** Their portrait's id; one with no image shows none. */
  portrait: idSchema,
})

export type Candidate = z.output<typeof candidateSchema>

/** The employees (#158): their roles, the candidates and what hiring costs. */
export const staffContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** The most employees at once. */
    maxEmployees: z.int().positive(),
    /** Weeks of pay a hire costs up front, as « Formation ». */
    trainingWeeks: z.int().nonnegative(),
    /** Weeks of pay firing costs, as « Préavis ». */
    noticeWeeks: z.int().nonnegative(),
    /**
     * How fast an employee at the truck serves, as a ratio to a rested
     * owner: 0.85 takes the content's service times ÷ 0.85.
     */
    truckSpeed: z.number().gt(0).max(1),
    roles: z.record(staffRoleIdSchema, staffRoleSchema),
    candidates: z.record(candidateIdSchema, candidateSchema),
  })
  .superRefine(({ candidates }, ctx) => {
    const seen = new Set<string>()
    for (const [id, { name }] of Object.entries(candidates)) {
      if (seen.has(name)) {
        ctx.addIssue({
          code: 'custom',
          message: `two candidates are named ${name}, so their wages would mix`,
          path: ['candidates', id, 'name'],
        })
      }
      seen.add(name)
    }
  })

export type StaffContent = z.output<typeof staffContentSchema>

/**
 * The emergency loan and the share sale (#159): the cards the engine
 * brings when Encaisse closes below zero, and when it brings them. The
 * terms are the cards' effects.
 */
export const financingContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** Mme Prudhomme's card, which offers the emergency loan. */
    loanEvent: idSchema,
    /** Max Duvent's card, which offers to buy shares. */
    investorEvent: idSchema,
    /**
     * Days after the last emergency loan that Max Duvent comes, if Encaisse
     * is still below zero.
     */
    investorDaysAfterLoan: z.int().positive(),
    /** The share sales a game may make, one a round. */
    maxShareRounds: z.int().nonnegative(),
    /** The difficulties at which she lends once a game at most. */
    noSecondLoanAt: z.array(difficultyIdSchema),
  })
  .refine(({ loanEvent, investorEvent }) => loanEvent !== investorEvent, {
    message: 'the loan and the investor come on cards of their own',
    path: ['investorEvent'],
  })

export type FinancingContent = z.output<typeof financingContentSchema>

/**
 * The facts of a week the « Bilan de la semaine » may tell, in the order
 * that breaks a tie between equal weights.
 */
export const weekFactIdSchema = z.enum([
  'profitUpCashDown',
  'unpaidRent',
  'receivableDue',
  'spoilage',
  'bestWeek',
  'lostToLine',
  'daysOpenInARow',
  'contractsReceivable',
])

export type WeekFactId = z.infer<typeof weekFactIdSchema>

/** How much a fact matters: the highest weight is told first. */
const factWeight = z.int().nonnegative()

/**
 * When each fact of a week is worth telling, and how much it matters.
 * Keyed by every `WeekFactId`, so a new fact fails the type check until it
 * has its thresholds.
 */
const weekFactsSchema = z.strictObject({
  /**
   * A bénéfice net above 0 while the encaisse went down, or went up at
   * least `minGapCents` less than the bénéfice.
   */
  profitUpCashDown: z.strictObject({ weight: factWeight, minGapCents: money }),
  /** The owner's rent went unpaid during the week. */
  unpaidRent: z.strictObject({ weight: factWeight }),
  /** A customer owes something due within `withinDays` of the Sunday. */
  receivableDue: z.strictObject({ weight: factWeight, withinDays: count }),
  /** The stock written off cost more than `aboveCents`. */
  spoilage: z.strictObject({ weight: factWeight, aboveCents: money }),
  /** Ventes above those of every earlier week of the game. */
  bestWeek: z.strictObject({ weight: factWeight }),
  /** More than `aboveVisits` visits left the line. */
  lostToLine: z.strictObject({ weight: factWeight, aboveVisits: count }),
  /** The truck opened at least `atLeast` days in a row. */
  daysOpenInARow: z.strictObject({
    weight: factWeight,
    atLeast: z.int().positive(),
  }),
  /** The grocers of the contracts owe more than `aboveCents`. */
  contractsReceivable: z.strictObject({
    weight: factWeight,
    aboveCents: money,
  }),
} satisfies Record<WeekFactId, z.ZodType>)

/** What the « Bilan de la semaine » tells of a week. */
export const reportContentSchema = z.strictObject({
  _note: z.string().optional(),
  /** The most facts told about a week. */
  maxFacts: z.int().positive(),
  facts: weekFactsSchema,
})

export type ReportContent = z.output<typeof reportContentSchema>

// A rule a Défi is held to, not a tunable: what fits on its card.
const STORY_MAX_LENGTH = 400

// A calendar fact, not a tunable: day 0 is May 1st of year 1, so a Défi
// starts in the first season, from May to December.
const FIRST_MONTH = 5

/** Whole cents of either sign, typed as the engine's `Cents`. */
const signedMoney = z.int().transform((n) => cents(n))

/**
 * A kind of change to the decisions, as `DecisionChange` in
 * src/engine/decisions.ts names it: what a Défi may lock.
 */
export const decisionKindSchema = z.enum([
  'price',
  'restock',
  'daysOpen',
  'ownerWeeklyPay',
  'marketingDaily',
])

export type DecisionKind = z.infer<typeof decisionKindSchema>

/** A Défi's medals, the best first: « Or », « Argent » and « Bronze ». */
export const medalSchema = z.enum(['or', 'argent', 'bronze'])

export type Medal = z.infer<typeof medalSchema>

/**
 * The threshold of each medal, in the unit of `threshold`: or ≥ argent ≥
 * bronze, or the other way around when a lower value is better.
 */
function medals(threshold: z.ZodType<number>, lowerIsBetter = false) {
  return z
    .strictObject({ or: threshold, argent: threshold, bronze: threshold })
    .refine(
      ({ or, argent, bronze }) =>
        lowerIsBetter
          ? or <= argent && argent <= bronze
          : or >= argent && argent >= bronze,
      {
        message: lowerIsBetter
          ? 'expected or ≤ argent ≤ bronze, since lower is better'
          : 'expected or ≥ argent ≥ bronze',
      },
    )
}

/**
 * What a Défi's medals measure over its days, and the least each medal
 * needs, or the most for `spoilageRate`: `lowestCash`, the lowest Encaisse
 * after any entry, in cents of either sign; `netIncome`, the bénéfice net,
 * in cents of either sign; `sales`, the ventes, in cents; `customersServed`,
 * the visits that reached the counter; `spoilageRate`, the units written off
 * at the close as a share of those sold and written off; `lowestEnergy`, the
 * owner's lowest energy.
 */
const defiGoalSchema = z.discriminatedUnion('metric', [
  z.strictObject({
    metric: z.literal('lowestCash'),
    medals: medals(signedMoney),
  }),
  z.strictObject({
    metric: z.literal('netIncome'),
    medals: medals(signedMoney),
  }),
  z.strictObject({ metric: z.literal('sales'), medals: medals(money) }),
  z.strictObject({
    metric: z.literal('customersServed'),
    medals: medals(count),
  }),
  z.strictObject({
    metric: z.literal('spoilageRate'),
    medals: medals(share, true),
  }),
  z.strictObject({
    metric: z.literal('lowestEnergy'),
    medals: medals(energyAmount),
  }),
])

export type DefiGoal = z.output<typeof defiGoalSchema>

/** What a Défi's medals measure. */
export type DefiMetric = DefiGoal['metric']

/**
 * A condition that must hold all along a Défi, or it fails at once: the
 * Encaisse never below `amountCents`, the owner's energy never below
 * `amount`, the spoilage rate never above `rate`.
 */
const defiConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('minCash'), amountCents: signedMoney }),
  z.strictObject({ kind: z.literal('minEnergy'), amount: energyAmount }),
  z.strictObject({ kind: z.literal('maxSpoilageRate'), rate: share }),
])

export type DefiCondition = z.output<typeof defiConditionSchema>

export type DefiConditionKind = DefiCondition['kind']

/**
 * How a Défi's game opens, besides its difficulty: each field given replaces
 * what a game starts with. `cashCents` replaces the difficulty's
 * `startingCashCents`, the cash in the bank once the truck is settled; the
 * decisions replace the content's starting decisions, product by product
 * for the prices and the restock; `energy` is the owner's on the first
 * morning.
 */
const defiSetupSchema = z.strictObject({
  cashCents: money.optional(),
  prices: z.partialRecord(productIdSchema, money).optional(),
  restock: z.partialRecord(productIdSchema, restockRuleSchema).optional(),
  daysOpen: z.array(weekday).min(1).optional(),
  ownerWeeklyPayCents: money.optional(),
  marketingDailyCents: money.optional(),
  energy: energyAmount.optional(),
})

/**
 * A change to the street a Défi forces for `days` days from its day `day`,
 * counting from 0, made as if by a choice of the card `event`.
 */
const defiModifierSchema = z.strictObject({
  day: count,
  days: streetDays,
  event: idSchema,
  change: streetChangeSchema,
})

/**
 * The card `event` a Défi brings on the morning of its day `day`, counting
 * from 0, where the player may make only the `choices` listed.
 */
const defiEventSchema = z.strictObject({
  day: count,
  event: idSchema,
  choices: z.array(idSchema).min(1),
})

/** A Défi as `defis.json` writes it. */
const defiSchema = z
  .strictObject({
    id: idSchema,
    title: frenchText(),
    story: frenchText(STORY_MAX_LENGTH),
    difficulty: difficultyIdSchema,
    /** The date of its first day, in the first season of year 1. */
    start: calendarDateSchema.refine(({ month }) => month >= FIRST_MONTH, {
      message: 'a Défi starts in the first season, from May 1st',
      path: ['month'],
    }),
    lengthDays: z.int().positive(),
    setup: defiSetupSchema,
    /** The kinds of change the player cannot make. */
    locked: z.array(decisionKindSchema),
    modifiers: z.array(defiModifierSchema),
    events: z.array(defiEventSchema),
    /** Whether the event cards' draws come too, besides the forced ones. */
    randomEvents: z.boolean(),
    goal: defiGoalSchema,
    conditions: z.array(defiConditionSchema),
  })
  .superRefine((defi, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: 'custom', message, path })
    const repeats = <T>(values: readonly T[], at: (index: number) => void) => {
      values.forEach((value, index) => {
        if (values.indexOf(value) !== index) at(index)
      })
    }
    defi.modifiers.forEach(({ day }, index) => {
      if (day >= defi.lengthDays) {
        issue(`day ${day} is not one of the ${defi.lengthDays} days`, [
          'modifiers',
          index,
          'day',
        ])
      }
    })
    defi.events.forEach(({ day, choices }, index) => {
      if (day >= defi.lengthDays) {
        issue(`day ${day} is not one of the ${defi.lengthDays} days`, [
          'events',
          index,
          'day',
        ])
      }
      repeats(choices, (c) =>
        issue('a choice appears twice', ['events', index, 'choices', c]),
      )
    })
    repeats(
      defi.events.map(({ day }) => day),
      (index) =>
        issue('one forced event a day at most', ['events', index, 'day']),
    )
    repeats(defi.locked, (index) =>
      issue('a kind of decision appears twice', ['locked', index]),
    )
    repeats(
      defi.conditions.map(({ kind }) => kind),
      (index) =>
        issue('a kind of condition appears twice', ['conditions', index]),
    )
  })

export type Defi = z.output<typeof defiSchema>

export const defiContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    defis: z.array(defiSchema),
  })
  .superRefine(({ defis }, ctx) => {
    defis.forEach(({ id }, index) => {
      if (defis.findIndex((defi) => defi.id === id) !== index) {
        ctx.addIssue({
          code: 'custom',
          message: `the Défi id ${id} appears twice`,
          path: ['defis', index, 'id'],
        })
      }
    })
  })

export type DefiContent = z.output<typeof defiContentSchema>

// A scale, not a tunable: a percentile lies strictly between 0 and 100.
const FULL_PERCENT = 100

/**
 * One week of the percentile table: the cumulative bénéfice net at each
 * percentile, in cents, never going down from one to the next.
 */
const percentileRowSchema = z.array(signedMoney)

/** Every week of one difficulty, from week 1, at least one. */
const percentileWeeksSchema = z.array(percentileRowSchema).min(1)

/**
 * How simulated owners did, generated by `npm run balance -- --percentiles`:
 * for each difficulty, one row a week from week 1, each the cumulative
 * bénéfice net at every percentile of `percentiles`.
 */
export const percentileContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** The simulated owners of each difficulty. */
    games: z.int().positive(),
    /** In %, whole, strictly between 0 and 100 and strictly increasing. */
    percentiles: z.array(z.int().gt(0).lt(FULL_PERCENT)).min(1),
    difficulties: z.strictObject({
      facile: percentileWeeksSchema,
      moyen: percentileWeeksSchema,
      difficile: percentileWeeksSchema,
    } satisfies Record<DifficultyId, z.ZodType>),
  })
  .superRefine(({ percentiles, difficulties }, ctx) => {
    checkPercentilesGoUp(percentiles, ctx)
    for (const [difficulty, weeks] of Object.entries(difficulties)) {
      weeks.forEach((row, week) => {
        const path = ['difficulties', difficulty, week]
        if (row.length !== percentiles.length) {
          ctx.addIssue({
            code: 'custom',
            message: `a week holds one amount per percentile, ${percentiles.length}, not ${row.length}`,
            path,
          })
        }
        row.forEach((amount, index) => {
          const before = row[index - 1]
          if (before !== undefined && amount < before) {
            ctx.addIssue({
              code: 'custom',
              message: `the amounts must not go down: ${amount} after ${before}`,
              path: [...path, index],
            })
          }
        })
      })
    }
  })

export type PercentileContent = z.output<typeof percentileContentSchema>

/** Adds an issue for each percentile not above the one before it. */
function checkPercentilesGoUp(
  percentiles: readonly number[],
  ctx: z.RefinementCtx,
): void {
  percentiles.forEach((percentile, index) => {
    const before = percentiles[index - 1]
    if (before !== undefined && percentile <= before) {
      ctx.addIssue({
        code: 'custom',
        message: `the percentiles must go up: ${percentile} after ${before}`,
        path: ['percentiles', index],
      })
    }
  })
}

/** What a Défi's goal measures, as `DefiMetric` names it. */
const defiMetricSchema = z.enum([
  'lowestCash',
  'netIncome',
  'sales',
  'customersServed',
  'spoilageRate',
  'lowestEnergy',
] as const satisfies readonly DefiMetric[])

/** The metrics counted in whole cents or customers. */
const WHOLE_METRICS: readonly DefiMetric[] = [
  'lowestCash',
  'netIncome',
  'sales',
  'customersServed',
]

/**
 * How one Défi's simulated games ended: what its goal measures, the share
 * of the games that broke a condition, and what the goal measured in the
 * others at each percentile, never going down, null when every game broke
 * one.
 */
const defiPercentileSchema = z.strictObject({
  metric: defiMetricSchema,
  brokenShare: share,
  values: z.array(z.number()).nullable(),
})

/**
 * How the simulated owners did in each Défi, generated by
 * `npm run balance -- --defis`: for « Mieux que N % des parties simulées ».
 */
export const defiPercentileContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** The simulated owners of each Défi. */
    games: z.int().positive(),
    /** In %, whole, strictly between 0 and 100 and strictly increasing. */
    percentiles: z.array(z.int().gt(0).lt(FULL_PERCENT)).min(1),
    defis: z.record(idSchema, defiPercentileSchema),
  })
  .superRefine(({ percentiles, defis }, ctx) => {
    checkPercentilesGoUp(percentiles, ctx)
    for (const [id, { metric, brokenShare, values }] of Object.entries(defis)) {
      const path = ['defis', id, 'values']
      const issue = (message: string, at: (string | number)[] = []) =>
        ctx.addIssue({ code: 'custom', message, path: [...path, ...at] })
      if (values === null) {
        if (brokenShare !== 1) {
          issue('values are null only when every game broke a condition')
        }
        continue
      }
      if (brokenShare === 1) {
        issue('every game broke a condition, so values must be null')
      }
      if (values.length !== percentiles.length) {
        issue(
          `one value per percentile, ${percentiles.length}, not ${values.length}`,
        )
      }
      values.forEach((value, index) => {
        const before = values[index - 1]
        if (before !== undefined && value < before) {
          issue(`the values must not go down: ${value} after ${before}`, [
            index,
          ])
        }
        if (WHOLE_METRICS.includes(metric) && !Number.isSafeInteger(value)) {
          issue(`${metric} counts whole units: ${value}`, [index])
        }
      })
    }
  })

export type DefiPercentileContent = z.output<typeof defiPercentileContentSchema>

/**
 * The Défis' content, checked against `events`: each forced change to the
 * street and each forced event names a card of it, and each choice allowed
 * one of that card's.
 */
function defiContentFor(events: EventContent) {
  const cards = new Map(events.events.map((card) => [card.id, card]))
  return defiContentSchema.superRefine(({ defis }, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: 'custom', message, path: ['defis', ...path] })
    defis.forEach((defi, d) => {
      defi.modifiers.forEach(({ event }, m) => {
        if (!cards.has(event)) {
          issue(`no event has the id ${event}`, [d, 'modifiers', m, 'event'])
        }
      })
      defi.events.forEach(({ event, choices }, e) => {
        const card = cards.get(event)
        if (card === undefined) {
          issue(`no event has the id ${event}`, [d, 'events', e, 'event'])
          return
        }
        choices.forEach((choice, c) => {
          if (!card.choices.some(({ id }) => id === choice)) {
            issue(`the event ${event} has no choice ${choice}`, [
              d,
              'events',
              e,
              'choices',
              c,
            ])
          }
        })
      })
    })
  })
}

/**
 * The grocers' content, checked against `events`: each renewal is a card of
 * it that only comes as a follow-up.
 */
function financingContentFor(events: EventContent) {
  const cards = new Map(events.events.map((card) => [card.id, card]))
  return financingContentSchema.superRefine((financing, ctx) => {
    for (const [key, kind] of [
      ['loanEvent', 'emergencyLoan'],
      ['investorEvent', 'shareSale'],
    ] as const) {
      const id = financing[key]
      const card = cards.get(id)
      const holds = card?.choices.some(({ outcomes }) =>
        outcomes.some(({ effects }) =>
          effects.some((effect) => effect.kind === kind),
        ),
      )
      const reason =
        card === undefined
          ? `no event has the id ${id}`
          : card.weight !== 0
            ? `the event ${id} has a weight above 0, so a draw may bring it`
            : holds !== true
              ? `no choice of the event ${id} has a ${kind} effect`
              : null
      if (reason !== null) {
        ctx.addIssue({ code: 'custom', message: reason, path: [key] })
      }
    }
  })
}

function grocerContentFor(events: EventContent) {
  const cards = new Map(events.events.map((card) => [card.id, card]))
  return grocerContentSchema.superRefine(({ grocers }, ctx) => {
    for (const [id, { renewalEvent }] of Object.entries(grocers)) {
      const card = cards.get(renewalEvent)
      if (card?.conditions?.followUpOnly === true) continue
      ctx.addIssue({
        code: 'custom',
        message:
          card === undefined
            ? `no event has the id ${renewalEvent}`
            : `the event ${renewalEvent} does not come only as a follow-up`,
        path: ['grocers', id, 'renewalEvent'],
      })
    }
  })
}

/**
 * Validates the food truck's content and returns it typed, with money as
 * `Cents`. Throws an Error naming every invalid field. Pass `raw` only to
 * check other data; by default it reads `foodtruck.json`.
 */
export function loadFoodTruckContent(
  raw: unknown = foodTruckJson,
): FoodTruckContent {
  return parsed(foodTruckSchema, raw, 'foodtruck.json')
}

/**
 * Validates the customer segments and returns them typed, with money as
 * `Cents`. Throws an Error naming every invalid field. Pass `raw` only to
 * check other data; by default it reads `segments.json`.
 */
export function loadCustomerContent(
  raw: unknown = segmentsJson,
): CustomerContent {
  return parsed(customerSchema, raw, 'segments.json')
}

/**
 * Validates the difficulties and returns them typed, with money as `Cents`.
 * Throws an Error naming every invalid field. Pass `raw` only to check other
 * data; by default it reads `difficulty.json`.
 */
export function loadDifficultyContent(
  raw: unknown = difficultyJson,
): DifficultyContent {
  return parsed(difficultyContentSchema, raw, 'difficulty.json')
}

/**
 * Validates the bakery and returns it typed, with money as `Cents`. Throws
 * an Error naming every invalid field: besides each field, the starting bake
 * rule stays within the bakery's capacity. Pass `raw` only to check other
 * data; by default it reads `bakery.json`.
 */
export function loadBakeryContent(raw: unknown = bakeryJson): BakeryContent {
  return parsed(bakeryContentSchema, raw, 'bakery.json')
}

/**
 * Validates the player profile's defaults and limits and returns them typed.
 * Throws an Error naming every invalid field. Pass `raw` only to check other
 * data; by default it reads `profile.json`.
 */
export function loadProfileContent(raw: unknown = profileJson): ProfileContent {
  return parsed(profileContentSchema, raw, 'profile.json')
}

/**
 * Validates the owner's living costs and returns them typed, with money as
 * `Cents`. Throws an Error naming every invalid field. Pass `raw` only to
 * check other data; by default it reads `personal.json`.
 */
export function loadPersonalContent(
  raw: unknown = personalJson,
): PersonalContent {
  return parsed(personalContentSchema, raw, 'personal.json')
}

/**
 * Validates what tires the owner and what fatigue does, and returns it
 * typed. Throws an Error naming every invalid field. Pass `raw` only to check
 * other data; by default it reads `energy.json`.
 */
export function loadEnergyContent(raw: unknown = energyJson): EnergyContent {
  return parsed(energyContentSchema, raw, 'energy.json')
}

/**
 * Validates the event cards, their pacing, their scaling by difficulty and
 * the adaptive draw, and returns them typed, with money as `Cents`. Throws
 * an Error naming every invalid field: besides each field, event ids must
 * be unique, choice ids unique within their event, each choice's chances
 * must sum to 1, every follow-up must name an event of the file, a contract
 * and a grocer walking away happen when the choice is made, and every
 * effect a tag names must be one of its choice's, of one unit when the tag
 * shows its amount. Pass `raw` only to check other data; by default it
 * reads `events.json`.
 */
export function loadEventContent(raw: unknown = eventsJson): EventContent {
  return parsed(eventContentSchema, raw, 'events.json')
}

/**
 * Validates when the facts of a week are worth telling and returns them
 * typed, with money as `Cents`. Throws an Error naming every invalid field.
 * Pass `raw` only to check other data; by default it reads `report.json`.
 */
export function loadReportContent(raw: unknown = reportJson): ReportContent {
  return parsed(reportContentSchema, raw, 'report.json')
}

/**
 * Validates the Défis against the event cards `events` and returns them
 * typed, with money as `Cents`. Throws an Error naming every invalid field:
 * besides each field, the Défi ids are unique; each forced change to the
 * street and each forced event falls on one of the Défi's days and names an
 * event of `events`; a Défi forces one event a day at most, each choice
 * allowed is one of its card's and appears once; and a Défi locks each kind
 * of decision and sets each kind of condition once at most. Pass `raw` only
 * to check other data; by default it reads `defis.json`, against
 * `events.json`.
 */
export function loadDefiContent(
  raw: unknown = defisJson,
  events: EventContent = loadEventContent(),
): DefiContent {
  return parsed(defiContentFor(events), raw, 'defis.json')
}

/**
 * Validates the grocers' contracts against the event cards `events` and
 * returns them typed, with money as `Cents`. Throws an Error naming every
 * invalid field: besides each field, the grocers' names differ, and each
 * renewal names a card of `events` that only comes as a follow-up. Pass
 * `raw` only to check other data; by default it reads `grocers.json`,
 * against `events.json`.
 */
export function loadGrocerContent(
  raw: unknown = grocersJson,
  events: EventContent = loadEventContent(),
): GrocerContent {
  return parsed(grocerContentFor(events), raw, 'grocers.json')
}

/**
 * Validates the employees' roles and candidates and returns them typed, with
 * money as `Cents`. Throws an Error naming every invalid field: besides each
 * field, each role's starting wage is within its range and the candidates'
 * names differ. Pass `raw` only to check other data; by default it reads
 * `staff.json`.
 */
export function loadStaffContent(raw: unknown = staffJson): StaffContent {
  return parsed(staffContentSchema, raw, 'staff.json')
}

/**
 * Validates the emergency loan's and the share sale's rules against the
 * event cards `events` and returns them typed. Throws an Error naming every
 * invalid field: besides each field, the two cards differ, and each is a
 * card of `events` with a weight of 0, so no draw brings it, and a choice
 * with an effect of its kind, the loan's or the sale's. Pass `raw` only to
 * check other data; by default it reads `financing.json`, against
 * `events.json`.
 */
export function loadFinancingContent(
  raw: unknown = financingJson,
  events: EventContent = loadEventContent(),
): FinancingContent {
  return parsed(financingContentFor(events), raw, 'financing.json')
}

/**
 * Validates the percentile table of the simulated owners and returns it
 * typed, with money as `Cents`. Throws an Error naming every invalid field:
 * besides each field, the percentiles go up, and each week holds one amount
 * per percentile, never going down. Pass `raw` only to check other data; by
 * default it reads `percentiles.json`.
 */
export function loadPercentileContent(
  raw: unknown = percentilesJson,
): PercentileContent {
  return parsed(percentileContentSchema, raw, 'percentiles.json')
}

/**
 * Validates the Défis' percentile table and returns it typed. Throws an
 * Error naming every invalid field: besides each field, the percentiles go
 * up, and each Défi's values, null only when every game broke a condition,
 * hold one per percentile, never going down, whole for a metric of cents or
 * customers. Pass `raw` only to check other data; by default it reads
 * `defis-percentiles.json`.
 */
export function loadDefiPercentileContent(
  raw: unknown = defiPercentilesJson,
): DefiPercentileContent {
  return parsed(defiPercentileContentSchema, raw, 'defis-percentiles.json')
}

function parsed<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  file: string,
): z.output<T> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`${file} is invalid:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
