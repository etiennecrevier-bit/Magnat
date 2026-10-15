import { z } from 'zod'
import { cents } from '../engine/money.ts'
import difficultyJson from './difficulty.json'
import energyJson from './energy.json'
import eventsJson from './events.json'
import foodTruckJson from './foodtruck.json'
import personalJson from './personal.json'
import profileJson from './profile.json'
import reportJson from './report.json'
import segmentsJson from './segments.json'

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

export const difficultyContentSchema = z.strictObject({
  _note: z.string().optional(),
  difficulties: z.record(difficultyIdSchema, difficultySchema),
})

export type DifficultyContent = z.output<typeof difficultyContentSchema>

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
 * and the truck closed whatever the days open.
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
  closed: { kind: z.literal('closed') },
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
    /** Buys `units` of `product` at its unit cost, paid now. */
    z.strictObject({
      kind: z.literal('buyStock'),
      product: productIdSchema,
      units: z.int().positive(),
      ...extra,
    }),
    /**
     * Takes up to `units` of `product` out of the stock, oldest first: sold
     * in an `order`, or given away to 6300 Marketing.
     */
    z.strictObject({
      kind: z.literal('useStock'),
      product: productIdSchema,
      units: z.int().positive(),
      to: z.enum(['order', 'giveaway']),
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
    /** For `days` days, the truck stays closed, whatever the days open. */
    z.strictObject({ ...STREET_CHANGES.closed, days: streetDays, ...extra }),
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
 * Thursday), never both.
 */
const timedEffectSchema = z
  .discriminatedUnion(
    'kind',
    effectSchemas({
      inDays: z.int().positive().optional(),
      onNextWeekday: weekday.optional(),
    }),
  )
  .refine(
    (effect) =>
      effect.inDays === undefined || effect.onNextWeekday === undefined,
    { message: 'an effect starts after inDays or onNextWeekday, not both' },
  )

export type TimedEventEffect = z.output<typeof timedEffectSchema>

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
    tags: z.array(frenchText()).min(1),
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
  /** Days after it last came up before it may be drawn again. */
  cooldownDays: z.int().positive().optional(),
  /** The product's restock rule buys some. */
  productOnMenu: productIdSchema.optional(),
  /** Only ever comes as another event's follow-up. */
  followUpOnly: z.boolean().optional(),
})

export type EventConditions = z.output<typeof eventConditionsSchema>

const eventSchema = z.strictObject({
  id: idSchema,
  /** Relative odds among the events whose conditions hold; 0 never draws. */
  weight: z.number().nonnegative(),
  /** Who brings the dilemma: a portrait id, a French name and a role. */
  character: z.strictObject({
    id: idSchema,
    name: frenchText(),
    role: frenchText(),
  }),
  title: frenchText(),
  situation: frenchText(SITUATION_MAX_LENGTH),
  quote: frenchText().optional(),
  conditions: eventConditionsSchema.optional(),
  choices: z.array(eventChoiceSchema).min(2).max(3),
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

export const eventContentSchema = z
  .strictObject({
    _note: z.string().optional(),
    pacing: eventPacingSchema,
    events: z.array(eventSchema),
  })
  .superRefine(({ events }, ctx) => {
    const ids = new Set(events.map(({ id }) => id))
    const seen = new Set<string>()
    events.forEach(({ id, choices }, e) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `the event id ${id} appears twice`,
          path: ['events', e, 'id'],
        })
      }
      seen.add(id)
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
} satisfies Record<WeekFactId, z.ZodType>)

/** What the « Bilan de la semaine » tells of a week. */
export const reportContentSchema = z.strictObject({
  _note: z.string().optional(),
  /** The most facts told about a week. */
  maxFacts: z.int().positive(),
  facts: weekFactsSchema,
})

export type ReportContent = z.output<typeof reportContentSchema>

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
 * Validates the event cards and their pacing and returns them typed, with
 * money as `Cents`. Throws an Error naming every invalid field: besides
 * each field, event ids must be unique, choice ids unique within their
 * event, each choice's chances must sum to 1 and every follow-up must name
 * an event of the file. Pass `raw` only to check other data; by default it
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
