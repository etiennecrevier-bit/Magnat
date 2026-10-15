import type { KeyEventLike } from './pauseShortcut.ts'

// The keys that pick an event card's choices: 1 for the first, up to 3,
// the most choices a card has (see src/content/schema.ts).
const CHOICE_KEYS = ['1', '2', '3'] as const

/** The key that picks the choice at `index`, counting from 0. */
export function choiceKey(index: number): string | undefined {
  return CHOICE_KEYS[index]
}

/**
 * The index of the choice, among `count`, that `event` picks: 1, 2 or 3,
 * on its own, from the top row or the keypad. Null for any other key, a
 * key held down or one pressed with a modifier.
 */
export function choiceForKey(
  event: Pick<
    KeyEventLike,
    'key' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
  >,
  count: number,
): number | null {
  if (
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return null
  }
  const index = CHOICE_KEYS.findIndex((key) => key === event.key)
  return index === -1 || index >= count ? null : index
}
