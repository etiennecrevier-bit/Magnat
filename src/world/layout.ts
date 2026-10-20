import type { CityManifest } from '../content/assets.ts'

/** Where the scene sits in the view: its scale and its top-left corner. */
export interface Fit {
  readonly scale: number
  readonly x: number
  readonly y: number
}

/**
 * Fits a scene designed at `designWidth` × `designHeight` in a view of
 * `viewWidth` × `viewHeight`, keeping its proportions: as large as fits,
 * centred across and standing on the bottom edge. A taller view shows more
 * sky above, and a wider one more of the street to each side.
 */
export function fitScene(
  viewWidth: number,
  viewHeight: number,
  designWidth: number,
  designHeight: number,
): Fit {
  const scale = Math.min(viewWidth / designWidth, viewHeight / designHeight)
  return {
    scale,
    x: (viewWidth - designWidth * scale) / 2,
    y: viewHeight - designHeight * scale,
  }
}

/**
 * Fits the city in a view of `viewWidth` × `viewHeight` around « Ville »
 * (see `CityManifest['frame']`): its island as large as fits in the room
 * right of the panel, between the top bar and the dock, and centred there.
 * In a view narrower than `frame.narrow`, or with no room left, the whole
 * design is fitted as `fitScene` fits it.
 */
export function fitCity(
  viewWidth: number,
  viewHeight: number,
  { designSize, frame }: Pick<CityManifest, 'designSize' | 'frame'>,
): Fit {
  const { island, panel, gap } = frame
  const left =
    panel.left +
    Math.min(panel.width, panel.share * viewWidth - panel.inset) +
    gap
  const width = viewWidth - gap - left
  const height = viewHeight - frame.bottom - frame.top
  if (viewWidth < frame.narrow || width <= 0 || height <= 0) {
    return fitScene(viewWidth, viewHeight, designSize.width, designSize.height)
  }
  const scale = Math.min(width / island.width, height / island.height)
  return {
    scale,
    x: left + (width - island.width * scale) / 2 - island.x * scale,
    y: frame.top + (height - island.height * scale) / 2 - island.y * scale,
  }
}
