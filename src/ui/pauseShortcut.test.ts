import { describe, expect, it, vi } from 'vitest'
import {
  blockSpaceClick,
  handlePauseKey,
  type KeyEventLike,
} from './pauseShortcut.ts'

function keyEvent(overrides: Partial<KeyEventLike> = {}) {
  return {
    key: ' ',
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

const EDITABLE_TARGETS = [
  { tagName: 'INPUT', isContentEditable: false },
  { tagName: 'TEXTAREA', isContentEditable: false },
  { tagName: 'SELECT', isContentEditable: false },
  { tagName: 'DIV', isContentEditable: true },
]

const MODIFIERS = ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const

describe('handlePauseKey', () => {
  it('toggles pause on Space and keeps the page from scrolling', () => {
    const togglePause = vi.fn()
    const event = keyEvent()
    handlePauseKey(event, togglePause)
    expect(togglePause).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('works while a speed button has focus', () => {
    const togglePause = vi.fn()
    const target = { tagName: 'BUTTON', isContentEditable: false }
    handlePauseKey(keyEvent({ target }), togglePause)
    expect(togglePause).toHaveBeenCalledTimes(1)
  })

  it('does not toggle again while Space is held down', () => {
    const togglePause = vi.fn()
    const event = keyEvent({ repeat: true })
    handlePauseKey(event, togglePause)
    expect(togglePause).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it.each(MODIFIERS)('ignores Space with %s', (modifier) => {
    const togglePause = vi.fn()
    const event = keyEvent({ [modifier]: true })
    handlePauseKey(event, togglePause)
    expect(togglePause).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it.each(['Enter', 'p', 'Spacebar'])('ignores the %s key', (key) => {
    const togglePause = vi.fn()
    const event = keyEvent({ key })
    handlePauseKey(event, togglePause)
    expect(togglePause).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it.each(EDITABLE_TARGETS)('lets $tagName fields type a space', (target) => {
    const togglePause = vi.fn()
    const event = keyEvent({ target })
    handlePauseKey(event, togglePause)
    expect(togglePause).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

describe('blockSpaceClick', () => {
  it('keeps Space from clicking the focused button', () => {
    const event = keyEvent()
    blockSpaceClick(event)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('leaves other keys alone', () => {
    const event = keyEvent({ key: 'Enter' })
    blockSpaceClick(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it.each(EDITABLE_TARGETS)('leaves $tagName fields alone', (target) => {
    const event = keyEvent({ target })
    blockSpaceClick(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
