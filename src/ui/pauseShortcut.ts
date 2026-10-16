/** The parts of a KeyboardEvent the shortcut reads, so tests can fake one. */
export interface KeyEventLike {
  key: string
  repeat: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  target: unknown
  preventDefault: () => void
}

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Whether `target` takes text, so its keys are the player's typing. */
export function isEditable(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const { tagName, isContentEditable } = target as {
    tagName?: unknown
    isContentEditable?: unknown
  }
  if (isContentEditable === true) return true
  return typeof tagName === 'string' && TEXT_ENTRY_TAGS.has(tagName)
}

// A button that opens a dialog, and everything inside an open dialog, keep
// Space for themselves: it opens the dialog, then clicks its buttons. The
// store keeps the game paused while a panel is open anyway.
const OWNS_SPACE = 'dialog, [aria-haspopup="dialog"]'

/** Whether `target` is, or sits inside, an element matching `selectors`. */
export function isInside(target: unknown, selectors: string): boolean {
  if (typeof target !== 'object' || target === null) return false
  const { closest } = target as { closest?: unknown }
  if (typeof closest !== 'function') return false
  return closest.call(target, selectors) !== null
}

function isPauseKey(event: KeyEventLike): boolean {
  return (
    event.key === ' ' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !isEditable(event.target) &&
    !isInside(event.target, OWNS_SPACE)
  )
}

/**
 * `keydown` handler: Space toggles pause. Holding it down does not toggle
 * again, and the page does not scroll.
 */
export function handlePauseKey(
  event: KeyEventLike,
  togglePause: () => void,
): void {
  if (!isPauseKey(event)) return
  event.preventDefault()
  if (!event.repeat) togglePause()
}

/**
 * `keyup` handler: stops Space from also clicking the focused button, which
 * would undo the toggle (say, pause on keydown, then ×3 again on keyup).
 * Browsers activate buttons on keydown or keyup, so both handlers prevent it.
 */
export function blockSpaceClick(event: KeyEventLike): void {
  if (isPauseKey(event)) event.preventDefault()
}
