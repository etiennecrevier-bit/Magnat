import { loadAssetManifest, type AssetManifest } from '../content/assets.ts'

/** The shipped asset manifest, validated once when the world loads. */
export const ASSETS: AssetManifest = loadAssetManifest()
