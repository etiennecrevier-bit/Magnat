import type { BankruptcyText } from '../content/bankruptcyText.ts'
import type { Cents } from '../engine/money.ts'
import { netWorth } from '../engine/netWorth.ts'
import type { GameEnd, GameState } from '../engine/types.ts'
import { incomeStatement } from '../finance/statements.ts'
import { formatMoney } from './formatMoney.ts'

// What the « Faillite » screen shows of a game that went bankrupt (#160):
// its key numbers, read from the books and the engine, and Mme Prudhomme's
// line. Pure, so the screen only lays them out.

// French puts a no-break space (U+00A0) before a colon.
const COLON = '\u00a0:'

/** One of the key numbers, as the screen lists it. */
export interface EndFigure {
  readonly label: string
  readonly value: string
}

/**
 * The key numbers of `game`, ended as `ended` says: the days played from
 * day 0, the best week's ventes, if a week was reported, then the ventes
 * and the bénéfice net from day 0 to the last close, as the état des
 * résultats has them, and the « Valeur nette » (see `netWorth`).
 */
export function bankruptcyFigures(
  game: GameState,
  ended: GameEnd,
): EndFigure[] {
  const { sales, netIncome } = incomeStatement(game.journal, 0, ended.day)
  const best = bestWeek(game)
  return [
    { label: 'Jours joués', value: String(ended.day + 1) },
    ...(best === null
      ? []
      : [{ label: 'Meilleure semaine', value: formatMoney(best) }]),
    { label: 'Ventes', value: formatMoney(sales.amount) },
    { label: 'Bénéfice net', value: formatMoney(netIncome.amount) },
    { label: 'Valeur nette', value: formatMoney(netWorth(game)) },
  ]
}

/** `figure` as one line: « Ventes : 1 234,56 $ ». */
export function figureLine({ label, value }: EndFigure): string {
  return `${label}${COLON} ${value}`
}

/**
 * The highest ventes of a week of `game`: the last week reported's, or an
 * earlier week's if higher (see `previousBest`); null before a week is.
 */
export function bestWeek({
  lastWeek,
}: Pick<GameState, 'lastWeek'>): Cents | null {
  if (lastWeek === null) return null
  const { sales, previousBest } = lastWeek
  return previousBest !== null && previousBest > sales ? previousBest : sales
}

/**
 * Mme Prudhomme's line for the game of `seed`, one of `text`'s, the same
 * each time the game shows its end.
 */
export function prudhommeLine(
  seed: number,
  { prudhomme }: BankruptcyText,
): string {
  return prudhomme[seed % prudhomme.length] ?? ''
}
