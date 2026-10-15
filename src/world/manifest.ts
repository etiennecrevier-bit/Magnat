import { loadAssetManifest, type AssetManifest } from '../content/assets.ts'
import {
  loadAvatarFatigue,
  type AvatarFatigue,
} from '../content/avatarFatigue.ts'
import { loadCustomerLines, type CustomerLines } from '../content/lines.ts'

/** The shipped asset manifest, validated once when the world loads. */
export const ASSETS: AssetManifest = loadAssetManifest()

/** What customers say when the player picks them, validated once too. */
export const LINES: CustomerLines = loadCustomerLines()

/** How the owner's fatigue shows on the street, validated once too. */
export const AVATAR_FATIGUE: AvatarFatigue = loadAvatarFatigue()
