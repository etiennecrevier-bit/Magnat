import {
  namedEffects,
  TAG_AMOUNT,
  TAG_UNITS,
  textParts,
  type DifficultyId,
  type EventCard,
  type EventChoice,
  type EventContent,
  type EventOutcome,
  type EventScaling,
  type TimedEventEffect,
} from '../content/schema.ts'
import { FULL_ENERGY } from './energy.ts'
import { cents, mulRatio, type Cents } from './money.ts'

// The same card at each difficulty (#137): each difficulty scales what a
// choice gives and what it takes, some effects apply at some difficulties
// only, and the tags show the amounts that apply.

// A scale, not a tunable: a percentage is a hundredth.
const PERCENT = 100

/** What a tag shows of the effects it names, at the game's difficulty. */
export type TagAmount =
  | { readonly unit: 'money'; readonly cents: Cents }
  | { readonly unit: 'energy'; readonly points: number }
  | { readonly unit: 'percent'; readonly percent: number }

/** A tag of a choice as the card shows it at a difficulty. */
export interface ChoiceTag {
  /** The content's text, `{montant}` where the amount goes. */
  readonly text: string
  /**
   * The size of the amount, without its sign, which the text gives: the
   * sum of the effects it names, in the first outcome where one applies.
   * Null when the text shows no amount.
   */
  readonly amount: TagAmount | null
}

/** Whether `effect` applies at `difficulty`: it names none, or that one. */
export function appliesAt(
  { difficulties }: Pick<TimedEventEffect, 'difficulties'>,
  difficulty: DifficultyId,
): boolean {
  return difficulties === undefined || difficulties.includes(difficulty)
}

/**
 * The effects of `effects` that apply at `difficulty`, in order, each
 * scaled by what `content` sets for it (see `scaledEffect`), as a choice
 * plays them.
 */
export function effectsAt(
  effects: readonly TimedEventEffect[],
  difficulty: DifficultyId,
  content: Pick<EventContent, 'scaling'>,
): TimedEventEffect[] {
  return effects
    .filter((effect) => appliesAt(effect, difficulty))
    .map((effect) => scaledEffect(effect, difficulty, content.scaling))
}

/**
 * `effect` at `difficulty`, with `scaling`'s multipliers; as it is without
 * scaling. A gain is what the player wants: a cash or a credit sale, what
 * shares sell for, the owner's energy or cash going up, a change to the
 * street above 1. A loss
 * is the opposite: a charge, the owner's energy or cash going down, a
 * change to the street below 1. Money is scaled to the cent and energy to
 * the whole point, half away from zero, and neither reaches 0; energy moves
 * 100 points at most, the whole scale; a change to the street scales by its
 * distance from 1, so ×0.65
 * with losses ×1.3 becomes ×0.545, and never falls below `lowestFactor`.
 * Stock, durations, chances, receivable terms, the share of the business
 * sold and an emergency loan's terms stay as the card writes them.
 */
export function scaledEffect(
  effect: TimedEventEffect,
  difficulty: DifficultyId,
  scaling: EventScaling | undefined,
): TimedEventEffect {
  if (scaling === undefined) return effect
  const { gains, losses } = scaling.difficulties[difficulty]
  switch (effect.kind) {
    case 'charge':
      return { ...effect, amountCents: scaledMoney(effect.amountCents, losses) }
    case 'cashSale':
    case 'creditSale':
    case 'shareSale':
      return { ...effect, amountCents: scaledMoney(effect.amountCents, gains) }
    case 'personal': {
      const { amountCents } = effect
      const by = amountCents > 0 ? gains : losses
      return { ...effect, amountCents: scaledMoney(amountCents, by) }
    }
    case 'energy': {
      const by = effect.amount > 0 ? gains : losses
      return { ...effect, amount: scaledPoints(effect.amount, by) }
    }
    case 'walkIns':
    case 'appeal':
    case 'willingness': {
      const { factor } = effect
      if (factor > 1) return { ...effect, factor: 1 + (factor - 1) * gains }
      if (factor === 1) return effect
      const scaled = 1 - (1 - factor) * losses
      return { ...effect, factor: Math.max(scaled, scaling.lowestFactor) }
    }
    default:
      return effect
  }
}

/**
 * The tags of `choice` as the card shows them at `difficulty`, in order,
 * with the amounts of `content`'s scaling. A tag shown only at other
 * difficulties is left out, and so is one naming an effect that applies at
 * none of the choice's outcomes there.
 */
export function choiceTags(
  choice: EventChoice,
  difficulty: DifficultyId,
  content: Pick<EventContent, 'scaling'>,
): ChoiceTag[] {
  const outcomes = choice.outcomes.map(({ effects }) => effects)
  return choice.tags.flatMap((tag): ChoiceTag[] => {
    if (typeof tag === 'string') return [{ text: tag, amount: null }]
    const { text, effect, difficulties } = tag
    if (difficulties !== undefined && !difficulties.includes(difficulty)) {
      return []
    }
    if (effect === undefined) return [{ text, amount: null }]
    const named = scaledNamed(outcomes, effect, difficulty, content)
    if (named.length === 0) return []
    return [
      { text, amount: text.includes(TAG_AMOUNT) ? amountOf(named) : null },
    ]
  })
}

/** A piece of a card's text at a difficulty: words, or an amount. */
export type TextPiece = string | TagAmount

/**
 * What a card's text holds amounts of: an event's situation and quote, the
 * effects of all its choices; a choice's label, its outcomes'; an outcome's
 * result, its own.
 */
export type TextScope =
  | Pick<EventCard, 'choices'>
  | Pick<EventChoice, 'outcomes'>
  | Pick<EventOutcome, 'effects'>

/**
 * `text`, written for `scope`, as the card shows it at `difficulty`: each
 * `{montant:name}` (see `textParts`) is the size of what the effects named
 * `name` add up to, in the first of the scope's outcomes where one applies,
 * with `content`'s scaling, as a tag shows it. Throws a RangeError when
 * none applies, which the content's schema rules out.
 */
export function cardText(
  text: string,
  scope: TextScope,
  difficulty: DifficultyId,
  content: Pick<EventContent, 'scaling'>,
): TextPiece[] {
  const outcomes = outcomesOf(scope)
  return textParts(text).map((part) => {
    if (typeof part === 'string') return part
    const named = scaledNamed(outcomes, part.amountOf, difficulty, content)
    const amount = amountOf(named)
    if (amount === null) {
      throw new RangeError(
        `No amount of ${part.amountOf} to show at ${difficulty}`,
      )
    }
    return amount
  })
}

function outcomesOf(scope: TextScope): (readonly TimedEventEffect[])[] {
  if ('effects' in scope) return [scope.effects]
  if ('outcomes' in scope) return scope.outcomes.map(({ effects }) => effects)
  return scope.choices.flatMap(({ outcomes }) =>
    outcomes.map(({ effects }) => effects),
  )
}

/**
 * The effects named `name` in the first of `outcomes` where one applies at
 * `difficulty` (see `namedEffects`), scaled as it plays them.
 */
function scaledNamed(
  outcomes: readonly (readonly TimedEventEffect[])[],
  name: string,
  difficulty: DifficultyId,
  content: Pick<EventContent, 'scaling'>,
): TimedEventEffect[] {
  return namedEffects(outcomes, name, difficulty).map((effect) =>
    scaledEffect(effect, difficulty, content.scaling),
  )
}

/**
 * The size of what `effects`, of one unit, add up to, an emergency loan
 * counting the most it lends; null for none, or when one shows no amount,
 * such as stock or a closed day.
 */
function amountOf(effects: readonly TimedEventEffect[]): TagAmount | null {
  let total = 0
  let unit: TagAmount['unit'] | undefined
  for (const effect of effects) {
    switch (effect.kind) {
      case 'charge':
      case 'cashSale':
      case 'creditSale':
      case 'personal':
      case 'shareSale':
        total += Math.abs(effect.amountCents)
        break
      case 'emergencyLoan':
        total += effect.maxCents
        break
      case 'energy':
        total += Math.abs(effect.amount)
        break
      case 'walkIns':
      case 'appeal':
      case 'willingness':
        total += Math.abs(effect.factor - 1) * PERCENT
        break
      default:
        return null
    }
    unit = TAG_UNITS[effect.kind]
  }
  switch (unit) {
    case 'money':
      return { unit, cents: cents(total) }
    case 'energy':
      return { unit, points: total }
    case 'percent':
      return { unit, percent: total }
    case undefined:
      return null
  }
}

/** `amount` × `by`, to the cent, of the same sign and never 0. */
function scaledMoney(amount: Cents, by: number): Cents {
  const scaled = mulRatio(amount, by)
  if (scaled !== 0) return scaled
  return cents(Math.sign(amount))
}

/**
 * `points` of energy × `by`, in whole points, rounded half away from zero
 * as money is (see `mulRatio`), of the same sign, never 0, and 100 at most
 * either way, the whole scale.
 */
function scaledPoints(points: number, by: number): number {
  const scaled: number = scaledMoney(cents(Math.round(points)), by)
  return Math.min(Math.max(scaled, -FULL_ENERGY), FULL_ENERGY)
}
