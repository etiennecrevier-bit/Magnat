// The La Presse-Citron bar is fixed along the bottom of the window, and a
// headline wraps onto more lines on a narrow screen. The page keeps room
// under its screens for all of the bar, so their last rows can still be
// scrolled above it. The top bar is fixed along the top and wraps onto
// more rows as the window narrows, so what sits under it, the messages and
// the dock's panels, starts where it actually ends.

/** The custom property Ticker.css pads the page with. */
export const TICKER_HEIGHT = '--ticker-height'

/** The custom property that holds how far down the top bar ends. */
export const TOP_BAR_ROOM = '--top-bar-room'

/** The parts of a ResizeObserver used here, so tests can fake one. */
export interface ObserverLike {
  observe: (target: Element) => void
  disconnect: () => void
}

/** The page whose style takes the bar's height. */
export interface PageLike {
  style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>
}

/**
 * Keeps `page`'s `property` at what `measure` reads of `element`, now and
 * each time it changes size, and returns what stops it and takes the
 * property away.
 */
function keepMeasured(
  element: Element,
  page: PageLike,
  property: string,
  measure: (box: DOMRect) => number,
  observe: (onResize: () => void) => ObserverLike,
): () => void {
  const resize = () => {
    page.style.setProperty(
      property,
      `${measure(element.getBoundingClientRect())}px`,
    )
  }
  const observer = observe(resize)
  observer.observe(element)
  resize()
  return () => {
    observer.disconnect()
    page.style.removeProperty(property)
  }
}

const resizeObserver = (onResize: () => void): ObserverLike =>
  new ResizeObserver(onResize)

/**
 * Keeps `page`'s `--ticker-height` at the height of `bar`, now and each
 * time it changes size, and returns what stops it and takes the property
 * away. `observe` makes the observer that calls back on each change.
 */
export function keepRoomFor(
  bar: Element,
  page: PageLike,
  observe: (onResize: () => void) => ObserverLike = resizeObserver,
): () => void {
  return keepMeasured(bar, page, TICKER_HEIGHT, (box) => box.height, observe)
}

/**
 * Keeps `page`'s `--top-bar-room` at how far from the top of the window
 * the top bar `bar` ends, now and each time it changes size, as when its
 * cards wrap onto another row or a chip comes or goes, and returns what
 * stops it and takes the property away.
 */
export function keepRoomUnder(
  bar: Element,
  page: PageLike,
  observe: (onResize: () => void) => ObserverLike = resizeObserver,
): () => void {
  return keepMeasured(bar, page, TOP_BAR_ROOM, (box) => box.bottom, observe)
}
