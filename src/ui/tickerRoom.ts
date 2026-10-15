// The La Presse-Citron bar is fixed along the bottom of the window, and a
// headline wraps onto more lines on a narrow screen. The page keeps room
// under its screens for all of the bar, so their last rows can still be
// scrolled above it.

/** The custom property Ticker.css pads the page with. */
export const TICKER_HEIGHT = '--ticker-height'

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
 * Keeps `page`'s `--ticker-height` at the height of `bar`, now and each
 * time it changes size, and returns what stops it and takes the property
 * away. `observe` makes the observer that calls back on each change.
 */
export function keepRoomFor(
  bar: Element,
  page: PageLike,
  observe: (onResize: () => void) => ObserverLike = (onResize) =>
    new ResizeObserver(onResize),
): () => void {
  const resize = () => {
    const { height } = bar.getBoundingClientRect()
    page.style.setProperty(TICKER_HEIGHT, `${height}px`)
  }
  const observer = observe(resize)
  observer.observe(bar)
  resize()
  return () => {
    observer.disconnect()
    page.style.removeProperty(TICKER_HEIGHT)
  }
}
