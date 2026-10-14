import { describe, expect, it } from 'vitest'
import { loadProfileContent } from '../content/schema.ts'
import { PROFILE_CONTENT, defaultProfile, validateProfile } from './profile.ts'
import type { Profile } from './types.ts'

const MAX = PROFILE_CONTENT.businessNameMaxLength

function named(businessName: string): Profile {
  return { ...defaultProfile(), businessName }
}

describe('defaultProfile', () => {
  it("is profile.json's default, and valid", () => {
    expect(defaultProfile()).toEqual(PROFILE_CONTENT.defaultProfile)
    expect(() => validateProfile(defaultProfile())).not.toThrow()
  })

  it('returns a new object each time', () => {
    expect(defaultProfile()).not.toBe(defaultProfile())
  })
})

describe('validateProfile', () => {
  it.each([
    ['one character', 'A'],
    ['the most characters', 'x'.repeat(MAX)],
    ['accents, each one character', 'é'.repeat(MAX)],
    ['emoji, each one character', '🚚'.repeat(MAX)],
    ['spaces inside', 'Le   Camion'],
    ['an apostrophe', "Le P'tit Camion"],
  ])('accepts %s', (_, businessName) => {
    expect(() => validateProfile(named(businessName))).not.toThrow()
  })

  it.each([
    ['an empty name', ''],
    ['one character too many', 'x'.repeat(MAX + 1)],
    ['one emoji too many', '🚚'.repeat(MAX + 1)],
    ['a space before', ' Camion'],
    ['a space after', 'Camion '],
    ['only a space', ' '],
    ['a no-break space after', 'Camion '],
    ['a line break', 'Le\nCamion'],
    ['a tab', 'Le\tCamion'],
    ['a NUL', 'Le\u0000Camion'],
    ['a DEL', 'Le\u007fCamion'],
  ])('rejects %s', (_, businessName) => {
    expect(() => validateProfile(named(businessName))).toThrow(
      /^Invalid profile: businessName/,
    )
    expect(() => validateProfile(named(businessName))).toThrow(RangeError)
  })

  it('follows the content limit', () => {
    const content = loadProfileContent({
      ...PROFILE_CONTENT,
      businessNameMaxLength: 5,
    })
    expect(() => validateProfile(named('Chez5'), content)).not.toThrow()
    expect(() => validateProfile(named('Chez 6'), content)).toThrow(
      'Invalid profile: businessName must hold 1 to 5 characters: 6',
    )
  })

  it.each([
    [{ avatar: 'robot' }, 'Invalid profile: unknown avatar: robot'],
    [{ difficulty: 'extreme' }, 'Invalid profile: unknown difficulty: extreme'],
  ])('rejects %j', (change, message) => {
    const profile = { ...defaultProfile(), ...change } as Profile
    expect(() => validateProfile(profile)).toThrow(message)
  })
})
