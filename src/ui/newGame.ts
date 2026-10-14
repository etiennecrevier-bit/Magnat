import {
  difficultyIdSchema,
  loadDifficultyContent,
  type Difficulty,
  type DifficultyId,
} from '../content/schema.ts'
import { PROFILE_CONTENT } from '../engine/profile.ts'
import { formatMoney } from './formatMoney.ts'

// What the new game screen shows and reads, apart from React.

/** The three ways to start a game, in the order the screen shows them. */
export const DIFFICULTIES: readonly (Difficulty & { id: DifficultyId })[] =
  (() => {
    const { difficulties } = loadDifficultyContent()
    return difficultyIdSchema.options.map((id) => ({
      id,
      ...difficulties[id],
    }))
  })()

/** What a difficulty means, in one line, from its amounts in the content. */
export function difficultyLine({
  startingCashCents,
  truck,
}: Difficulty): string {
  const cash = `${formatMoney(startingCashCents)} en banque`
  switch (truck.kind) {
    case 'owned':
      return `Le camion est à vous, ${cash}`
    case 'loan':
      return `Prêt de démarrage de ${formatMoney(truck.loanCents)} à la Caisse, ${cash}`
    case 'lease':
      return `Camion loué ${formatMoney(truck.monthlyLeaseCents)} par mois, ${cash}`
  }
}

/** The business name typed, cleaned up, or why it cannot be used. */
export type BusinessNameInput =
  | { readonly name: string; readonly error: null }
  | { readonly name: null; readonly error: string }

/**
 * Reads the business name the player typed: each run of spaces, line breaks
 * or control characters becomes one space, and the ends are trimmed, so the
 * name passes the engine's `validateProfile()` unless it is empty or too
 * long, which gives the French message the form shows.
 */
export function readBusinessName(text: string): BusinessNameInput {
  const name = text
    .normalize('NFC')
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim()
  const max = PROFILE_CONTENT.businessNameMaxLength
  if (name === '') {
    return { name: null, error: 'Donnez un nom à votre entreprise.' }
  }
  if ([...name].length > max) {
    return {
      name: null,
      error: `Le nom de l'entreprise compte au plus ${max} caractères.`,
    }
  }
  return { name, error: null }
}
