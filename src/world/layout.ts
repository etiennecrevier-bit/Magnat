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
