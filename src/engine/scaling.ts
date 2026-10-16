import {
  TAG_AMOUNT,
  TAG_UNITS,
  type DifficultyId,
  type EventChoice,
  type EventContent,
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
 * scaling. A gain is what the player wants: a cash or a credit sale, the
 * owner's energy or cash going up, a change to the street above 1. A loss
 * is the opposite: a charge, the owner's energy or cash going down, a
 * change to the street below 1. Money is scaled to the cent, half away from
 * zero, and never reaches 0; energy moves 100 points at most, the whole
 * scale; a change to the street scales by its distance from 1, so ×0.65
 * with losses ×1.3 becomes ×0.545, and never falls below `lowestFactor`.
 * Stock, durations, chances and receivable terms stay as the card writes
 * them.
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
      return { ...effect, amountCents: scaledMoney(effect.amountCents, gains) }
    case 'personal': {
      const { amountCents } = effect
      const by = amountCents > 0 ? gains : losses
      return { ...effect, amountCents: scaledMoney(amountCents, by) }
    }
    case 'energy': {
      const scaled = effect.amount * (effect.amount > 0 ? gains : losses)
      const amount = Math.min(Math.max(scaled, -FULL_ENERGY), FULL_ENERGY)
      return { ...effect, amount }
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
  const outcomes = choice.outcomes.map(({ effects }) =>
    effectsAt(effects, difficulty, content),
  )
  return choice.tags.flatMap((tag): ChoiceTag[] => {
    if (typeof tag === 'string') return [{ text: tag, amount: null }]
    const { text, effect, difficulties } = tag
    if (difficulties !== undefined && !difficulties.includes(difficulty)) {
      return []
    }
    if (effect === undefined) return [{ text, amount: null }]
    const named = outcomes
      .map((effects) => effects.filter(({ name }) => name === effect))
      .find((effects) => effects.length > 0)
    if (named === undefined) return []
    return [
      { text, amount: text.includes(TAG_AMOUNT) ? amountOf(named) : null },
    ]
  })
}

/** The size of what `effects`, of one unit, add up to. */
function amountOf(effects: readonly TimedEventEffect[]): TagAmount | null {
  let total = 0
  let unit: TagAmount['unit'] | undefined
  for (const effect of effects) {
    switch (effect.kind) {
      case 'charge':
      case 'cashSale':
      case 'creditSale':
      case 'personal':
        total += Math.abs(effect.amountCents)
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
