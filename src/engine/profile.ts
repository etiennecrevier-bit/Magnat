import {
  avatarSchema,
  difficultyIdSchema,
  loadProfileContent,
  type ProfileContent,
} from '../content/schema.ts'
import type { Profile } from './types.ts'

/** The profile's defaults and limits, from `profile.json`. */
export const PROFILE_CONTENT: ProfileContent = loadProfileContent()

const CONTROL_CHARACTER = /\p{Cc}/u

/** The profile the new game screen offers until the player changes it. */
export function defaultProfile(
  content: ProfileContent = PROFILE_CONTENT,
): Profile {
  return { ...content.defaultProfile }
}

/**
 * Throws a RangeError naming the field unless the business name holds 1 to
 * `businessNameMaxLength` characters, counted as code points so that é or
 * an emoji counts once, with no space at either end and no control
 * character; and unless the avatar and the difficulty are ones the content
 * knows.
 */
export function validateProfile(
  profile: Profile,
  content: ProfileContent = PROFILE_CONTENT,
): void {
  const { businessName, avatar, difficulty } = profile
  const length = [...businessName].length
  const max = content.businessNameMaxLength
  if (length < 1 || length > max) {
    invalid(`businessName must hold 1 to ${max} characters: ${length}`)
  }
  if (businessName.trim() !== businessName) {
    invalid('businessName must not start or end with a space')
  }
  if (CONTROL_CHARACTER.test(businessName)) {
    invalid('businessName must not hold a control character')
  }
  if (!avatarSchema.options.includes(avatar)) {
    invalid(`unknown avatar: ${String(avatar)}`)
  }
  if (!difficultyIdSchema.options.includes(difficulty)) {
    invalid(`unknown difficulty: ${String(difficulty)}`)
  }
}

function invalid(reason: string): never {
  throw new RangeError(`Invalid profile: ${reason}`)
}
