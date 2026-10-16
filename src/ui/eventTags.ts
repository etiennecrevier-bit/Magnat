import { TAG_AMOUNT } from '../content/schema.ts'
import { cents } from '../engine/money.ts'
import type { ChoiceTag, TagAmount, TextPiece } from '../engine/scaling.ts'
import { formatBriefMoney } from './formatMoney.ts'

// The amounts an event card shows (#137): the engine gives the amounts that
// apply at the game's difficulty, in the tags and in the card's text, and
// the card writes them.

const NO_BREAK_SPACE = '\u00a0'
const CENTS_PER_DOLLAR = 100

/**
 * A change of `points` of the owner's energy in whole points, rounded half
 * away from zero, so that a loss and a gain of the same size read the same
 * size: what the tags and the lines of what a choice did both show.
 */
export function wholeEnergy(points: number): number {
  const whole = Math.round(Math.abs(points))
  return points < 0 ? -whole : whole
}

/**
 * `amount` as the card writes it: money to the dollar, in fr-CA
 * (`1 000 $`), energy in whole points and a percentage whole (`55 %`).
 */
export function formatAmount(amount: TagAmount): string {
  switch (amount.unit) {
    case 'money':
      return formatBriefMoney(
        cents(Math.round(amount.cents / CENTS_PER_DOLLAR) * CENTS_PER_DOLLAR),
      )
    case 'energy':
      return String(wholeEnergy(amount.points))
    case 'percent':
      return `${Math.round(amount.percent)}${NO_BREAK_SPACE}%`
  }
}

/**
 * `tag`'s text with its amount in place of `{montant}` (see
 * `formatAmount`). The text gives the sign.
 */
export function formatChoiceTag({ text, amount }: ChoiceTag): string {
  if (amount === null) return text
  return text.replace(TAG_AMOUNT, () => formatAmount(amount))
}

/** A card's text with its amounts written (see `formatAmount`). */
export function formatCardText(pieces: readonly TextPiece[]): string {
  return pieces
    .map((piece) => (typeof piece === 'string' ? piece : formatAmount(piece)))
    .join('')
}
