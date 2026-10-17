import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import { cents } from '../engine/money.ts'
import { STAFF } from '../engine/staff.ts'
import {
  bakeChange,
  daysOpenChange,
  marketingChange,
  ownerPayChange,
  parseMoney,
  parseUnits,
  priceChange,
  restockChange,
  restockFields,
  stepPrice,
  wageChange,
  type FieldResult,
} from './decisionInput.ts'
import { formatAmount } from './formatMoney.ts'

// No-break space (U+00A0), as in the amounts and messages, and narrow
// no-break space (U+202F), which some keyboards type between thousands.
const S = ' '
const NARROW = ' '

const STATE = createInitialState(1)
const START = STATE.decisions

/** Whether the engine takes `change` on the starting state. */
function engineAccepts(change: DecisionChange): boolean {
  try {
    applyDecision(STATE, change)
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

/** Whether the panel lets the text through: a change or the same value. */
function accepted(result: FieldResult): boolean {
  return result.kind !== 'invalid'
}

/** A whole number of cents written as the player might type it. */
function typed(amount: number): string {
  return amount < 0
    ? `-${formatAmount(cents(-amount))}`
    : formatAmount(cents(amount))
}

describe('parseMoney', () => {
  it.each([
    ['3,25', 325],
    ['3.25', 325],
    ['3,25 $', 325],
    [`3,25${S}$`, 325],
    ['3,25$', 325],
    ['  3,25  ', 325],
    ['3', 300],
    ['3,5', 350],
    ['0,05', 5],
    ['0', 0],
    ['1 000,00', 100_000],
    [`1${S}000,00`, 100_000],
    [`1${NARROW}000,00`, 100_000],
    [`1${S}234${S}567,89`, 123_456_789],
    ['1000', 100_000],
    ['007,50', 750],
  ])('reads "%s" as %d cents', (text, amount) => {
    expect(parseMoney(text)).toBe(amount)
  })

  it.each([
    '',
    ' ',
    'abc',
    '3,25 €',
    '$3,25',
    '-3,25',
    '+3',
    '3,255',
    '3,',
    ',50',
    '3,2,5',
    '1e3',
    '0x10',
    '10 00',
    '1 0000',
    '1.000,00',
    'Infinity',
    'NaN',
    '9'.repeat(400),
    '90071992547410',
  ])('turns down "%s"', (text) => {
    expect(parseMoney(text)).toBeNull()
  })

  it('reads every amount the panel shows back to the same cents', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), (amount) => {
        expect(parseMoney(formatAmount(cents(amount)))).toBe(amount)
      }),
    )
  })
})

describe('parseUnits', () => {
  it.each([
    ['0', 0],
    ['70', 70],
    [' 500 ', 500],
    ['007', 7],
  ])('reads "%s" as %d', (text, units) => {
    expect(parseUnits(text)).toBe(units)
  })

  it.each([
    '',
    'abc',
    '-1',
    '1,5',
    '1.5',
    '1e3',
    '+3',
    '1 000',
    '9'.repeat(400),
  ])('turns down "%s"', (text) => {
    expect(parseUnits(text)).toBeNull()
  })
})

describe('priceChange', () => {
  it('makes a price change from what the player typed', () => {
    expect(priceChange('cafe', '3,50', cents(325))).toEqual({
      kind: 'change',
      change: { kind: 'price', product: 'cafe', price: 350 },
    })
  })

  it('leaves an unchanged price alone', () => {
    expect(priceChange('cafe', '3,25 $', cents(325))).toEqual({
      kind: 'unchanged',
    })
  })

  it.each([
    ['', 'Entrez un montant en dollars, par exemple 3,25.'],
    ['trois', 'Entrez un montant en dollars, par exemple 3,25.'],
    ['-1', 'Entrez un montant en dollars, par exemple 3,25.'],
    ['0,45', `Le prix doit être entre 0,50${S}$ et 20,00${S}$.`],
    ['20,05', `Le prix doit être entre 0,50${S}$ et 20,00${S}$.`],
    ['3,27', `Le prix doit être un multiple de 0,05${S}$.`],
  ])('turns down "%s" in French', (text, message) => {
    expect(priceChange('cafe', text, cents(325))).toEqual({
      kind: 'invalid',
      message,
    })
  })
})

describe('stepPrice', () => {
  it('moves by the content step', () => {
    expect(stepPrice(cents(325), 1)).toBe(330)
    expect(stepPrice(cents(325), -1)).toBe(320)
  })

  it('stops at the limits', () => {
    const { min, max } = FOOD_TRUCK.decisionLimits.priceCents
    expect(stepPrice(cents(min), -1)).toBeNull()
    expect(stepPrice(cents(min), 1)).toBe(min + 5)
    expect(stepPrice(cents(max), 1)).toBeNull()
    expect(stepPrice(cents(max), -1)).toBe(max - 5)
  })
})

describe('restockChange', () => {
  const topUp = { kind: 'topUp', whenBelow: 100, upTo: 300 } as const
  const buyDaily = { kind: 'buyDaily', quantity: 70 } as const

  it('changes a daily order', () => {
    expect(restockChange('croissant', 'quantity', '80', buyDaily)).toEqual({
      kind: 'change',
      change: {
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity: 80 },
      },
    })
  })

  it('changes one field of a top-up and keeps the other', () => {
    expect(restockChange('cafe', 'upTo', '250', topUp)).toEqual({
      kind: 'change',
      change: {
        kind: 'restock',
        product: 'cafe',
        rule: { kind: 'topUp', whenBelow: 100, upTo: 250 },
      },
    })
    expect(restockChange('cafe', 'whenBelow', '300', topUp)).toEqual({
      kind: 'change',
      change: {
        kind: 'restock',
        product: 'cafe',
        rule: { kind: 'topUp', whenBelow: 300, upTo: 300 },
      },
    })
  })

  it('leaves an unchanged rule alone', () => {
    expect(restockChange('cafe', 'whenBelow', '100', topUp)).toEqual({
      kind: 'unchanged',
    })
    expect(restockChange('croissant', 'quantity', ' 70', buyDaily)).toEqual({
      kind: 'unchanged',
    })
  })

  it.each([
    ['', "Entrez un nombre entier d'unités."],
    ['7,5', "Entrez un nombre entier d'unités."],
    ['-1', "Entrez un nombre entier d'unités."],
    ['501', `La quantité doit être entre 0 et 500${S}unités.`],
  ])('turns down "%s" in French', (text, message) => {
    expect(restockChange('croissant', 'quantity', text, buyDaily)).toEqual({
      kind: 'invalid',
      message,
    })
  })

  it('takes up to the units the bigger truck allows when given them', () => {
    const units = { min: 0, max: 750 }
    expect(
      restockChange('croissant', 'quantity', '600', buyDaily, units),
    ).toEqual({
      kind: 'change',
      change: {
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity: 600 },
      },
    })
    expect(
      restockChange('croissant', 'quantity', '751', buyDaily, units),
    ).toEqual({
      kind: 'invalid',
      message: `La quantité doit être entre 0 et 750${S}unités.`,
    })
  })

  it('keeps the threshold of a top-up at or below what it fills up to', () => {
    expect(restockChange('cafe', 'whenBelow', '301', topUp)).toEqual({
      kind: 'invalid',
      message: `«${S}Recommander sous${S}» ne peut pas dépasser «${S}Remplir jusqu'à${S}» (300${S}unités).`,
    })
    expect(restockChange('cafe', 'upTo', '99', topUp)).toEqual({
      kind: 'invalid',
      message: `«${S}Remplir jusqu'à${S}» ne peut pas être sous «${S}Recommander sous${S}» (100${S}unités).`,
    })
  })

  it('throws for a field the rule does not have', () => {
    expect(() => restockChange('cafe', 'quantity', '1', topUp)).toThrow(
      RangeError,
    )
    expect(() => restockChange('croissant', 'upTo', '1', buyDaily)).toThrow(
      RangeError,
    )
  })
})

describe('bakeChange', () => {
  const buyDaily = { kind: 'buyDaily', quantity: 70 } as const
  const topUp = { kind: 'topUp', whenBelow: 40, upTo: 120 } as const

  it('changes the daily batch, or one field of a top-up', () => {
    expect(bakeChange('quantity', '0', buyDaily)).toEqual({
      kind: 'change',
      change: { kind: 'bake', rule: { kind: 'buyDaily', quantity: 0 } },
    })
    expect(bakeChange('upTo', '300', topUp)).toEqual({
      kind: 'change',
      change: {
        kind: 'bake',
        rule: { kind: 'topUp', whenBelow: 40, upTo: 300 },
      },
    })
    expect(bakeChange('quantity', '70', buyDaily)).toEqual({
      kind: 'unchanged',
    })
  })

  it.each([
    ['', "Entrez un nombre entier d'unités."],
    ['-1', "Entrez un nombre entier d'unités."],
    ['801', `La quantité doit être entre 0 et 800${S}unités.`],
  ])('turns down "%s" in French, within the capacity', (text, message) => {
    expect(bakeChange('quantity', text, buyDaily)).toEqual({
      kind: 'invalid',
      message,
    })
  })

  it("names the bake rule's own fields", () => {
    expect(bakeChange('whenBelow', '121', topUp)).toEqual({
      kind: 'invalid',
      message: `«${S}Cuire sous${S}» ne peut pas dépasser «${S}Cuire jusqu'à${S}» (120${S}unités).`,
    })
  })
})

describe('wageChange', () => {
  it('changes an hourly wage within the role', () => {
    expect(wageChange('amelie', 'camion', '18,25', cents(1750))).toEqual({
      kind: 'change',
      change: { kind: 'setWage', candidate: 'amelie', hourlyWage: 1825 },
    })
    expect(wageChange('amelie', 'camion', '17,50 $', cents(1750))).toEqual({
      kind: 'unchanged',
    })
  })

  it.each([
    ['dix', 'Entrez un montant en dollars, par exemple 3,25.'],
    [
      '15,99',
      `Le salaire doit être entre 16,00${S}$ et 25,00${S}$ de l'heure.`,
    ],
    [
      '25,01',
      `Le salaire doit être entre 16,00${S}$ et 25,00${S}$ de l'heure.`,
    ],
  ])('turns down "%s" at the truck in French', (text, message) => {
    expect(wageChange('amelie', 'camion', text, cents(1750))).toEqual({
      kind: 'invalid',
      message,
    })
  })
})

describe('restockFields', () => {
  it('lists a rule by its kind', () => {
    expect(restockFields({ kind: 'buyDaily', quantity: 70 })).toEqual([
      { field: 'quantity', units: 70 },
    ])
    expect(restockFields({ kind: 'topUp', whenBelow: 50, upTo: 150 })).toEqual([
      { field: 'whenBelow', units: 50 },
      { field: 'upTo', units: 150 },
    ])
  })
})

describe('daysOpenChange', () => {
  it('opens and closes a day, in weekday order', () => {
    expect(daysOpenChange(1, [2, 3, 7])).toEqual({
      kind: 'change',
      change: { kind: 'daysOpen', weekdays: [1, 2, 3, 7] },
    })
    expect(daysOpenChange(3, [2, 3, 7])).toEqual({
      kind: 'change',
      change: { kind: 'daysOpen', weekdays: [2, 7] },
    })
  })

  it('keeps the truck open at least one day a week', () => {
    expect(daysOpenChange(4, [4])).toEqual({
      kind: 'invalid',
      message: 'Le camion doit ouvrir au moins 1 jour par semaine.',
    })
  })
})

describe('ownerPayChange and marketingChange', () => {
  it('make changes from what the player typed', () => {
    expect(ownerPayChange(`1${S}250,50`, cents(70_000))).toEqual({
      kind: 'change',
      change: { kind: 'ownerWeeklyPay', pay: 125_050 },
    })
    expect(marketingChange('15', cents(0))).toEqual({
      kind: 'change',
      change: { kind: 'marketingDaily', budget: 1500 },
    })
  })

  it('leave unchanged amounts alone', () => {
    expect(ownerPayChange('700', cents(70_000))).toEqual({ kind: 'unchanged' })
    expect(marketingChange('0,00', cents(0))).toEqual({ kind: 'unchanged' })
  })

  it('turn down amounts outside the limits in French', () => {
    expect(ownerPayChange('3000,01', cents(70_000))).toEqual({
      kind: 'invalid',
      message: `Le salaire doit être entre 0,00${S}$ et 3${S}000,00${S}$.`,
    })
    expect(marketingChange('200,01', cents(0))).toEqual({
      kind: 'invalid',
      message: `Le budget doit être entre 0,00${S}$ et 200,00${S}$.`,
    })
    expect(marketingChange('-5', cents(0))).toEqual({
      kind: 'invalid',
      message: 'Entrez un montant en dollars, par exemple 3,25.',
    })
  })
})

// The panel repeats the engine's limits to word its messages in French.
// These hold the two together: the panel lets through exactly what
// applyDecision() takes, so nothing it lets through can make it throw.
describe('the panel and the engine agree', () => {
  it.each(PRODUCTS)(
    'on every price of %s, in cents from -1,00 $ to 30,00 $',
    (product) => {
      const current = START.prices[product]
      for (let price = -100; price <= 3000; price += 1) {
        const result = priceChange(product, typed(price), current)
        const engine = engineAccepts({
          kind: 'price',
          product,
          price: cents(price),
        })
        expect(accepted(result), `${price} cents`).toBe(engine)
        if (result.kind === 'change') {
          expect(engineAccepts(result.change)).toBe(true)
        }
      }
    },
  )

  it.each(PRODUCTS)(
    'on every restock field of %s, from -5 to 600 units',
    (product) => {
      const rule = START.restock[product]
      for (const { field } of restockFields(rule)) {
        for (let units = -5; units <= 600; units += 1) {
          const result = restockChange(product, field, String(units), rule)
          const next =
            rule.kind === 'buyDaily'
              ? { kind: 'buyDaily' as const, quantity: units }
              : { ...rule, [field]: units }
          const engine = engineAccepts({ kind: 'restock', product, rule: next })
          expect(accepted(result), `${field} ${units}`).toBe(engine)
          if (result.kind === 'change') {
            expect(engineAccepts(result.change)).toBe(true)
          }
        }
      }
    },
  )

  it('on every bake field, from -5 to 400 units', () => {
    for (const rule of [
      START.bake,
      { kind: 'topUp', whenBelow: 40, upTo: 120 } as const,
    ]) {
      const state = applyDecision(STATE, { kind: 'bake', rule })
      for (const { field } of restockFields(rule)) {
        for (let units = -5; units <= 400; units += 1) {
          const result = bakeChange(field, String(units), rule)
          const next =
            rule.kind === 'buyDaily'
              ? { kind: 'buyDaily' as const, quantity: units }
              : { ...rule, [field]: units }
          let engine = true
          try {
            applyDecision(state, { kind: 'bake', rule: next })
          } catch (error) {
            if (!(error instanceof RangeError)) throw error
            engine = false
          }
          expect(accepted(result), `${field} ${units}`).toBe(engine)
        }
      }
    }
  })

  it.each(Object.keys(STAFF.roles) as (keyof typeof STAFF.roles)[])(
    'on every hourly wage of %s, in cents from 10,00 $ to 35,00 $',
    (role) => {
      const hired = applyDecision(STATE, {
        kind: 'hire',
        role,
        candidate: 'amelie',
      })
      const current = STAFF.roles[role].hourlyWageCents.start
      for (let wage = 1000; wage <= 3500; wage += 1) {
        const result = wageChange('amelie', role, typed(wage), cents(current))
        let engine = true
        try {
          applyDecision(hired, {
            kind: 'setWage',
            candidate: 'amelie',
            hourlyWage: cents(wage),
          })
        } catch (error) {
          if (!(error instanceof RangeError)) throw error
          engine = false
        }
        expect(accepted(result), `${wage} cents`).toBe(engine)
      }
    },
  )

  it("on the owner's pay and the marketing budget", () => {
    const { ownerWeeklyPayCents, marketingDailyCents } =
      FOOD_TRUCK.decisionLimits
    const edges = (max: number) => [-1, 0, 1, max - 1, max, max + 1]
    const amounts = (max: number) =>
      fc.oneof(
        fc.constantFrom(...edges(max)),
        fc.integer({ min: -max, max: 2 * max }),
      )
    fc.assert(
      fc.property(
        amounts(ownerWeeklyPayCents.max),
        amounts(marketingDailyCents.max),
        (pay, budget) => {
          const payResult = ownerPayChange(typed(pay), START.ownerWeeklyPay)
          expect(accepted(payResult)).toBe(
            engineAccepts({ kind: 'ownerWeeklyPay', pay: cents(pay) }),
          )
          const budgetResult = marketingChange(
            typed(budget),
            START.marketingDaily,
          )
          expect(accepted(budgetResult)).toBe(
            engineAccepts({ kind: 'marketingDaily', budget: cents(budget) }),
          )
        },
      ),
      { numRuns: 500 },
    )
  })

  it('on toggling each day from every set of days open', () => {
    const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
    for (let mask = 0; mask < 2 ** WEEKDAYS.length; mask += 1) {
      const daysOpen = WEEKDAYS.filter((_, i) => (mask >> i) & 1)
      for (const weekday of WEEKDAYS) {
        const result = daysOpenChange(weekday, daysOpen)
        const weekdays = daysOpen.includes(weekday)
          ? daysOpen.filter((day) => day !== weekday)
          : [...daysOpen, weekday]
        expect(accepted(result), `${daysOpen} ± ${weekday}`).toBe(
          engineAccepts({ kind: 'daysOpen', weekdays }),
        )
        if (result.kind === 'change') {
          expect(engineAccepts(result.change)).toBe(true)
        }
      }
    }
  })
})
