import { isEditable, isInside, type KeyEventLike } from './pauseShortcut.ts'

/** The key that folds and unfolds the screens: R, for « Replier ». */
export const FOLD_KEY = 'R'

// An open panel or event card keeps its keys, as it does Space.
const IN_DIALOG = 'dialog'

/**
 * `keydown` handler: R, in either case, folds the screens or unfolds them,
 * with `toggle`. Held down, it does not toggle again. A modifier, a text
 * field or an open dialog leaves the key alone.
 */
export function handleFoldKey(event: KeyEventLike, toggle: () => void): void {
  if (
    event.key.toUpperCase() !== FOLD_KEY ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isEditable(event.target) ||
    isInside(event.target, IN_DIALOG)
  ) {
    return
  }
  event.preventDefault()
  if (!event.repeat) toggle()
}

// What folding hides or unfolding replaces: the screen menu, the strip and
// the screen. The messages above them stay.
const FOLDING = '.screen-nav, .screens-strip, .screens__screen'

/**
 * Whether `focused`, the element with the focus, goes away when the screens
 * fold or unfold, so the focus should move to the button that unfolds or
 * folds them again.
 */
export function losesFocusOnFold(focused: unknown): boolean {
  return isInside(focused, FOLDING)
}
