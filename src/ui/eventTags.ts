import { TAG_AMOUNT } from '../content/schema.ts'
import { cents } from '../engine/money.ts'
import type { ChoiceTag } from '../engine/scaling.ts'
import { formatBriefMoney } from './formatMoney.ts'

// A choice's tag as the event card shows it (#137): the engine gives the
// amount that applies at the game's difficulty, and the card writes it.

const NO_BREAK_SPACE = ' '
const CENTS_PER_DOLLAR = 100

/**
 * `tag`'s text with its amount in place of `{montant}`: money to the dollar,
 * in fr-CA (`1 000 $`), energy in whole points and a percentage whole
 * (`55 %`). The text gives the sign.
 */
export function formatChoiceTag({ text, amount }: ChoiceTag): string {
  if (amount === null) return text
  return text.replace(TAG_AMOUNT, () => {
    switch (amount.unit) {
      case 'money':
        return formatBriefMoney(
          cents(Math.round(amount.cents / CENTS_PER_DOLLAR) * CENTS_PER_DOLLAR),
        )
      case 'energy':
        return String(Math.round(amount.points))
      case 'percent':
        return `${Math.round(amount.percent)}${NO_BREAK_SPACE}%`
    }
  })
}
