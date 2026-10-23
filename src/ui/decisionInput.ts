import type {
  CandidateId,
  ProductId,
  RestockRule,
  StaffRoleId,
} from '../content/schema.ts'
import { BAKERY } from '../engine/bakery.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import type { DecisionChange } from '../engine/decisions.ts'
import { cents, type Cents } from '../engine/money.ts'
import { STAFF } from '../engine/staff.ts'
import { formatMoney } from './formatMoney.ts'

// What the player types in the « Le camion » and « Qui fait quoi »
// panels, read into the engine's decision changes. The limits are the engine's own, from the
// content, so a value is turned down here, in French, before it could make
// applyDecision() throw.

const LIMITS = FOOD_TRUCK.decisionLimits
const CENTS_PER_DOLLAR = 100
const NO_BREAK_SPACE = '\u00a0'

/**
 * What a field's text comes to: a change for the engine, the value the
 * decision already has, or a French message saying what is wrong.
 */
export type FieldResult =
  | { readonly kind: 'change'; readonly change: DecisionChange }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'invalid'; readonly message: string }

const UNCHANGED: FieldResult = { kind: 'unchanged' }

function invalid(message: string): FieldResult {
  return { kind: 'invalid', message }
}

function change(next: DecisionChange): FieldResult {
  return { kind: 'change', change: next }
}

// Dollars, optionally grouped by threes with spaces (any kind: the fields
// show no-break spaces), then up to two decimals after a comma or a point,
// then an optional dollar sign.
const MONEY_TEXT = /^(\d{1,3}(?:\s\d{3})+|\d+)(?:[,.](\d{1,2}))?(?:\s*\$)?$/

/**
 * An amount the player typed, in cents: `3,25`, `3.25`, `3,25 $`,
 * `1 000,00`, `3` or `3,5`. Null for anything else, such as a negative
 * amount, more than two decimals or a number past the safe integer range.
 * Integer arithmetic only.
 */
export function parseMoney(text: string): Cents | null {
  const match = MONEY_TEXT.exec(text.trim())
  if (match === null) return null
  const [, dollarsText = '', centsText = ''] = match
  const dollars = Number(dollarsText.replace(/\s/g, ''))
  if (!Number.isSafeInteger(dollars)) return null
  // Below 2^53, a product of whole numbers is exact.
  const total = dollars * CENTS_PER_DOLLAR + Number(centsText.padEnd(2, '0'))
  return Number.isSafeInteger(total) ? cents(total) : null
}

/** A whole number of units the player typed; null for anything else. */
export function parseUnits(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const units = Number(trimmed)
  return Number.isSafeInteger(units) ? units : null
}

const MONEY_MESSAGE = 'Entrez un montant en dollars, par exemple 3,25.'
const UNITS_MESSAGE = "Entrez un nombre entier d'unités."

function within(value: number, { min, max }: { min: number; max: number }) {
  return value >= min && value <= max
}

function moneyRange({ min, max }: { min: number; max: number }): string {
  return `entre ${formatMoney(cents(min))} et ${formatMoney(cents(max))}`
}

/** The price of `product` from the field's text, given the current price. */
export function priceChange(
  product: ProductId,
  text: string,
  current: Cents,
): FieldResult {
  const price = parseMoney(text)
  if (price === null) return invalid(MONEY_MESSAGE)
  const limits = LIMITS.priceCents
  if (!within(price, limits)) {
    return invalid(`Le prix doit être ${moneyRange(limits)}.`)
  }
  if (price % limits.step !== 0) {
    return invalid(
      `Le prix doit être un multiple de ${formatMoney(cents(limits.step))}.`,
    )
  }
  if (price === current) return UNCHANGED
  return change({ kind: 'price', product, price })
}

/**
 * One step up (`1`) or down (`-1`) from `current`, the price steppers'
 * move. Null when that step would leave the limits.
 */
export function stepPrice(current: Cents, direction: 1 | -1): Cents | null {
  const limits = LIMITS.priceCents
  const next = current + direction * limits.step
  return within(next, limits) ? cents(next) : null
}

/** The size of the price steppers' step, e.g. `0,05 $`. */
export const PRICE_STEP_TEXT = formatMoney(cents(LIMITS.priceCents.step))

/** A field of a restock rule: the daily quantity, or a top-up's two. */
export type RestockField = 'quantity' | 'whenBelow' | 'upTo'

/** The labels of a restock rule's fields, which its messages name. */
export const RESTOCK_LABELS: Readonly<Record<RestockField, string>> = {
  quantity: 'Commande quotidienne',
  whenBelow: 'Recommander sous',
  upTo: "Remplir jusqu'à",
}

/** The fields of `rule`, in the order the panel shows them, with their units. */
export function restockFields(
  rule: RestockRule,
): { readonly field: RestockField; readonly units: number }[] {
  switch (rule.kind) {
    case 'buyDaily':
      return [{ field: 'quantity', units: rule.quantity }]
    case 'topUp':
      return [
        { field: 'whenBelow', units: rule.whenBelow },
        { field: 'upTo', units: rule.upTo },
      ]
  }
}

function unitsText(units: number): string {
  return `${units}${NO_BREAK_SPACE}unité${units > 1 ? 's' : ''}`
}

/** French quotes, held to the text by no-break spaces. */
function quoted(text: string): string {
  return `«${NO_BREAK_SPACE}${text}${NO_BREAK_SPACE}»`
}

/**
 * The restock rule of `product` with `field` set from the field's text,
 * within `units`, the content's limits unless the rungs of « Améliorations »
 * owned allow more (see `dreamLimits`), the rule's other field kept. A
 * top-up's threshold may not exceed what it fills up to.
 */
export function restockChange(
  product: ProductId,
  field: RestockField,
  text: string,
  rule: RestockRule,
  units: { readonly min: number; readonly max: number } = LIMITS.units,
): FieldResult {
  const read = readRule(field, text, rule, units, RESTOCK_LABELS)
  if (read.kind !== 'rule') return read
  return change({ kind: 'restock', product, rule: read.rule })
}

/** The labels of the bake rule's fields, which its messages name. */
export const BAKE_LABELS: Readonly<Record<RestockField, string>> = {
  quantity: 'Fournée quotidienne',
  whenBelow: 'Cuire sous',
  upTo: "Cuire jusqu'à",
}

/**
 * The bake rule with `field` set from the field's text, the rule's other
 * field kept: from 0 to the bakery's capacity a day, a top-up's threshold no
 * higher than what it bakes up to.
 */
export function bakeChange(
  field: RestockField,
  text: string,
  rule: RestockRule,
): FieldResult {
  const limits = { min: 0, max: BAKERY.capacityPerDay }
  const read = readRule(field, text, rule, limits, BAKE_LABELS)
  if (read.kind !== 'rule') return read
  return change({ kind: 'bake', rule: read.rule })
}

/**
 * `rule` with `field` set from the field's text, within `limits`, the
 * rule's other field kept; the messages name the fields by `labels`.
 */
function readRule(
  field: RestockField,
  text: string,
  rule: RestockRule,
  limits: { min: number; max: number },
  labels: Readonly<Record<RestockField, string>>,
): { readonly kind: 'rule'; readonly rule: RestockRule } | FieldResult {
  const units = parseUnits(text)
  if (units === null) return invalid(UNITS_MESSAGE)
  const { min, max } = limits
  if (!within(units, limits)) {
    return invalid(`La quantité doit être entre ${min} et ${unitsText(max)}.`)
  }
  let next: RestockRule
  if (rule.kind === 'buyDaily') {
    if (field !== 'quantity') {
      throw new RangeError(`A buyDaily rule has no ${field} field`)
    }
    next = { kind: 'buyDaily', quantity: units }
  } else {
    if (field === 'quantity') {
      throw new RangeError('A topUp rule has no quantity field')
    }
    next =
      field === 'whenBelow'
        ? { ...rule, whenBelow: units }
        : { ...rule, upTo: units }
    if (next.whenBelow > next.upTo) {
      const whenBelow = quoted(labels.whenBelow)
      const upTo = quoted(labels.upTo)
      return invalid(
        field === 'whenBelow'
          ? `${whenBelow} ne peut pas dépasser ${upTo} (${unitsText(rule.upTo)}).`
          : `${upTo} ne peut pas être sous ${whenBelow} (${unitsText(rule.whenBelow)}).`,
      )
    }
  }
  if (sameRule(next, rule)) return UNCHANGED
  return { kind: 'rule', rule: next }
}

function sameRule(a: RestockRule, b: RestockRule): boolean {
  switch (a.kind) {
    case 'buyDaily':
      return b.kind === 'buyDaily' && a.quantity === b.quantity
    case 'topUp':
      return (
        b.kind === 'topUp' && a.whenBelow === b.whenBelow && a.upTo === b.upTo
      )
  }
}

/**
 * The days open with ISO `weekday` (1 = Monday) opened or closed. The truck
 * has to stay open at least the content's minimum of days.
 */
export function daysOpenChange(
  weekday: number,
  daysOpen: readonly number[],
): FieldResult {
  const weekdays = daysOpen.includes(weekday)
    ? daysOpen.filter((open) => open !== weekday)
    : [...daysOpen, weekday].sort((a, b) => a - b)
  const min = LIMITS.minDaysOpen
  if (weekdays.length < min) {
    return invalid(
      `Le camion doit ouvrir au moins ${min} jour${min > 1 ? 's' : ''} par semaine.`,
    )
  }
  return change({ kind: 'daysOpen', weekdays })
}

/** The owner's weekly pay from the field's text, given the current pay. */
export function ownerPayChange(text: string, current: Cents): FieldResult {
  const pay = parseMoney(text)
  if (pay === null) return invalid(MONEY_MESSAGE)
  const limits = LIMITS.ownerWeeklyPayCents
  if (!within(pay, limits)) {
    return invalid(`Le salaire doit être ${moneyRange(limits)}.`)
  }
  if (pay === current) return UNCHANGED
  return change({ kind: 'ownerWeeklyPay', pay })
}

/** The daily marketing budget from the field's text, given the current one. */
export function marketingChange(text: string, current: Cents): FieldResult {
  const budget = parseMoney(text)
  if (budget === null) return invalid(MONEY_MESSAGE)
  const limits = LIMITS.marketingDailyCents
  if (!within(budget, limits)) {
    return invalid(`Le budget doit être ${moneyRange(limits)}.`)
  }
  if (budget === current) return UNCHANGED
  return change({ kind: 'marketingDaily', budget })
}

/**
 * The hourly wage of `candidate`, in `role`, from the field's text, given
 * their current one: within the role's range.
 */
export function wageChange(
  candidate: CandidateId,
  role: StaffRoleId,
  text: string,
  current: Cents,
): FieldResult {
  const hourlyWage = parseMoney(text)
  if (hourlyWage === null) return invalid(MONEY_MESSAGE)
  const limits = STAFF.roles[role].hourlyWageCents
  if (!within(hourlyWage, limits)) {
    return invalid(`Le salaire doit être ${moneyRange(limits)} de l'heure.`)
  }
  if (hourlyWage === current) return UNCHANGED
  return change({ kind: 'setWage', candidate, hourlyWage })
}

/**
 * The hourly wage one step up (`1`) or down (`-1`) from `current` in
 * `role`, the wage steppers' move: to the next multiple of the content's
 * `wageStepCents`, so a wage typed between two steps lands on one. Null
 * when that would leave the role's range.
 */
export function stepWage(
  role: StaffRoleId,
  current: Cents,
  direction: 1 | -1,
): Cents | null {
  const step = STAFF.wageStepCents
  const next =
    direction === 1
      ? (Math.floor(current / step) + 1) * step
      : (Math.ceil(current / step) - 1) * step
  return within(next, STAFF.roles[role].hourlyWageCents) ? cents(next) : null
}

/** The size of the wage steppers' step, e.g. `0,50 $`. */
export const WAGE_STEP_TEXT = formatMoney(cents(STAFF.wageStepCents))
