import { describe, expect, it } from 'vitest'
import { loadDifficultyContent } from '../content/schema.ts'
import { cents } from '../engine/money.ts'
import { PROFILE_CONTENT, validateProfile } from '../engine/profile.ts'
import { DIFFICULTIES, difficultyLine, readBusinessName } from './newGame.ts'

// Every space in an amount is a no-break space (U+00A0).
const S = ' '
const MAX = PROFILE_CONTENT.businessNameMaxLength

describe('DIFFICULTIES', () => {
  it('lists difficulty.json from the easiest to the hardest', () => {
    const { difficulties } = loadDifficultyContent()
    expect(DIFFICULTIES).toEqual([
      { id: 'facile', ...difficulties.facile },
      { id: 'moyen', ...difficulties.moyen },
      { id: 'difficile', ...difficulties.difficile },
    ])
  })
})

describe('difficultyLine', () => {
  it.each([
    ['Facile', `Le camion est à vous, 15${S}000,00${S}$ en banque`],
    [
      'Moyen',
      `Prêt de démarrage de 70${S}000,00${S}$ à la Caisse, 10${S}000,00${S}$ en banque`,
    ],
    [
      'Difficile',
      `Camion loué 1${S}800,00${S}$ par mois, 5${S}000,00${S}$ en banque`,
    ],
  ])('says what %s means', (name, line) => {
    const difficulty = DIFFICULTIES.find((option) => option.name === name)!
    expect(difficultyLine(difficulty)).toBe(line)
  })

  it('reads its amounts from the content', () => {
    expect(
      difficultyLine({
        name: 'Test',
        startingCashCents: cents(123_456),
        truck: {
          kind: 'loan',
          loanCents: cents(100),
          annualRateBasisPoints: 800,
          termMonths: 60,
        },
      }),
    ).toBe(
      `Prêt de démarrage de 1,00${S}$ à la Caisse, 1${S}234,56${S}$ en banque`,
    )
  })
})

describe('readBusinessName', () => {
  it.each([
    ["Le P'tit Camion", "Le P'tit Camion"],
    ['  Chez Mimi  ', 'Chez Mimi'],
    ['Chez  Mimi', 'Chez Mimi'],
    ['Chez\n\tMimi', 'Chez Mimi'],
    ['Chez\u0000Mimi', 'Chez Mimi'],
    ['Cafe\u0301', 'Caf\u00e9'],
    ['x'.repeat(MAX), 'x'.repeat(MAX)],
    [`${'é'.repeat(MAX)} `, 'é'.repeat(MAX)],
    ['🚚'.repeat(MAX), '🚚'.repeat(MAX)],
  ])('reads %j as %j, a name the engine accepts', (text, name) => {
    const read = readBusinessName(text)
    expect(read).toEqual({ name, error: null })
    expect(() =>
      validateProfile({
        businessName: name,
        avatar: 'femme',
        difficulty: 'moyen',
      }),
    ).not.toThrow()
  })

  it.each(['', '   ', '\n\t'])('asks for a name for %j', (text) => {
    expect(readBusinessName(text)).toEqual({
      name: null,
      error: 'Donnez un nom à votre entreprise.',
    })
  })

  it.each(['x'.repeat(MAX + 1), '🚚'.repeat(MAX + 1)])(
    'says how long a name may be for %j',
    (text) => {
      expect(readBusinessName(text)).toEqual({
        name: null,
        error: `Le nom de l'entreprise compte au plus ${MAX} caractères.`,
      })
    },
  )
})
