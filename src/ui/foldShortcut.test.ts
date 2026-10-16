import { describe, expect, it, vi } from 'vitest'
import { FOLD_KEY, handleFoldKey, losesFocusOnFold } from './foldShortcut.ts'
import type { KeyEventLike } from './pauseShortcut.ts'

function keyEvent(overrides: Partial<KeyEventLike> = {}) {
  return {
    key: 'r',
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...overrides,
  }
}

/**
 * A fake element that matches `closest()` only for the selectors in
 * `ancestors`: itself and what it sits inside.
 */
function element(tagName: string, ancestors: string[]) {
  return {
    tagName,
    isContentEditable: false,
    closest(selectors: string) {
      const matched = selectors
        .split(',')
        .map((selector) => selector.trim())
        .some((selector) => ancestors.includes(selector))
      return matched ? {} : null
    },
  }
}

const EDITABLE_TARGETS = [
  { tagName: 'INPUT', isContentEditable: false },
  { tagName: 'TEXTAREA', isContentEditable: false },
  { tagName: 'SELECT', isContentEditable: false },
  { tagName: 'DIV', isContentEditable: true },
]

const MODIFIERS = ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const

describe('handleFoldKey', () => {
  it('is R, which the tooltips name', () => {
    expect(FOLD_KEY).toBe('R')
  })

  it.each(['r', 'R'])(
    'toggles the fold on %s, the page doing nothing else',
    (key) => {
      const toggle = vi.fn()
      const event = keyEvent({ key })
      handleFoldKey(event, toggle)
      expect(toggle).toHaveBeenCalledOnce()
      expect(event.preventDefault).toHaveBeenCalledOnce()
    },
  )

  it('works from a button on the page, such as the strip or a screen button', () => {
    const toggle = vi.fn()
    handleFoldKey(
      keyEvent({ target: element('BUTTON', ['.screens-strip']) }),
      toggle,
    )
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('does not toggle again while R is held down', () => {
    const toggle = vi.fn()
    const event = keyEvent({ repeat: true })
    handleFoldKey(event, toggle)
    expect(toggle).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it.each(MODIFIERS)('leaves R with %s to the browser', (modifier) => {
    const toggle = vi.fn()
    const event = keyEvent({ [modifier]: true })
    handleFoldKey(event, toggle)
    expect(toggle).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it.each(EDITABLE_TARGETS)('leaves R to a text field: $tagName', (target) => {
    const toggle = vi.fn()
    const event = keyEvent({ target })
    handleFoldKey(event, toggle)
    expect(toggle).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it.each([
    ['a button inside a dialog', element('BUTTON', ['dialog'])],
    ['the dialog itself', element('DIALOG', ['dialog'])],
  ])('leaves R to an open panel or event card: %s', (_, target) => {
    const toggle = vi.fn()
    const event = keyEvent({ target })
    handleFoldKey(event, toggle)
    expect(toggle).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it.each([' ', 'e', 'Escape', '1', 'ArrowRight'])(
    'ignores any other key: %j',
    (key) => {
      const toggle = vi.fn()
      const event = keyEvent({ key })
      handleFoldKey(event, toggle)
      expect(toggle).not.toHaveBeenCalled()
      expect(event.preventDefault).not.toHaveBeenCalled()
    },
  )
})

describe('losesFocusOnFold', () => {
  it.each([
    ['the screen buttons and « Replier »', '.screen-nav'],
    ['the strip', '.screens-strip'],
    ['the screen', '.screens__screen'],
  ])('moves the focus away from %s, which the fold takes away', (_, inside) => {
    expect(losesFocusOnFold(element('BUTTON', [inside]))).toBe(true)
  })

  it('leaves it on a message, the top bar or the page', () => {
    expect(losesFocusOnFold(element('BUTTON', ['.messages']))).toBe(false)
    expect(losesFocusOnFold(element('BUTTON', ['.top-bar']))).toBe(false)
    expect(losesFocusOnFold(element('BODY', []))).toBe(false)
    expect(losesFocusOnFold(null)).toBe(false)
  })
})
