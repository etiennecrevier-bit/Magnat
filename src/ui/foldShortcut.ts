import { isEditable, isInside, type KeyEventLike } from './pauseShortcut.ts'

/** The key that hides and shows « Hier »: R, for « Replier ». */
export const FOLD_KEY = 'R'

// An open panel or event card keeps its keys, as it does Space.
const IN_DIALOG = 'dialog'

/**
 * `keydown` handler: R, in either case, hides « Hier » or shows it, with
 * `toggle`. Held down, it does not toggle again. A modifier, a text
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

// What hiding « Hier » takes away, or showing it again replaces: the card
// and the pill.
const FOLDING = '.yesterday, .yesterday-pill'

/** The button that shows or hides « Hier », whichever is on the page. */
export const FOLD_BUTTONS = '.yesterday-pill, .yesterday__fold'

/**
 * Whether `focused`, the element with the focus, goes away when « Hier »
 * hides or shows again, so the focus should move to the button that shows
 * or hides it again.
 */
export function losesFocusOnFold(focused: unknown): boolean {
  return isInside(focused, FOLDING)
}
