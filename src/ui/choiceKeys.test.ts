import { describe, expect, it, vi } from 'vitest'
import { EVENTS } from '../engine/day.ts'
import {
  allowedChoiceForKey,
  choiceForKey,
  choiceKey,
  handleCardEscape,
  pickChoice,
} from './choiceKeys.ts'

const key = (name: string, extra: Record<string, boolean> = {}) => ({
  key: name,
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...extra,
})

describe('choiceForKey', () => {
  it.each([
    ['1', 0],
    ['2', 1],
    ['3', 2],
  ])('picks with %s the choice at %d', (name, index) => {
    expect(choiceForKey(key(name), 3)).toBe(index)
  })

  it('ignores a key past the choices', () => {
    expect(choiceForKey(key('2'), 2)).toBe(1)
    expect(choiceForKey(key('3'), 2)).toBeNull()
  })

  it.each(['0', '4', 'Enter', ' ', 'Escape', 'a'])('ignores %j', (name) => {
    expect(choiceForKey(key(name), 3)).toBeNull()
  })

  it.each(['repeat', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey'])(
    'ignores a key with %s',
    (flag) => {
      expect(choiceForKey(key('1', { [flag]: true }), 3)).toBeNull()
    },
  )
})

describe('allowedChoiceForKey', () => {
  const choices = [
    { id: 'accepter' },
    { id: 'payeLivraison' },
    { id: 'refuser' },
  ]

  it('picks any choice when nothing is forced', () => {
    expect(allowedChoiceForKey(key('1'), choices, null)).toBe('accepter')
    expect(allowedChoiceForKey(key('3'), choices, null)).toBe('refuser')
  })

  it('skips a choice a Défi leaves out', () => {
    expect(allowedChoiceForKey(key('1'), choices, ['accepter'])).toBe(
      'accepter',
    )
    expect(allowedChoiceForKey(key('2'), choices, ['accepter'])).toBeNull()
    expect(allowedChoiceForKey(key('3'), choices, ['accepter'])).toBeNull()
  })

  it('ignores the keys choiceForKey ignores', () => {
    expect(allowedChoiceForKey(key('4'), choices, null)).toBeNull()
    expect(
      allowedChoiceForKey(key('1', { ctrlKey: true }), choices, null),
    ).toBeNull()
  })
})

describe('choiceKey', () => {
  it('names the key of each choice', () => {
    expect([0, 1, 2, 3].map(choiceKey)).toEqual(['1', '2', '3', undefined])
  })
})

describe('handleCardEscape', () => {
  const press = (name: string, showsResult: boolean, repeat = false) => {
    const event = { key: name, repeat, preventDefault: vi.fn() }
    const onContinue = vi.fn()
    handleCardEscape(event, showsResult, onContinue)
    return { prevented: event.preventDefault.mock.calls.length, onContinue }
  }

  it('does nothing before the choice, and keeps the dialog open', () => {
    const { prevented, onContinue } = press('Escape', false)
    expect(prevented).toBe(1)
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('continues once the result shows, as « Continuer » does', () => {
    const { prevented, onContinue } = press('Escape', true)
    expect(prevented).toBe(1)
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('does not continue on an Escape held down from the choice', () => {
    const { prevented, onContinue } = press('Escape', true, true)
    expect(prevented).toBe(1)
    expect(onContinue).not.toHaveBeenCalled()
  })

  it.each(['Enter', ' ', '1'])('leaves %j alone', (name) => {
    const { prevented, onContinue } = press(name, true)
    expect(prevented).toBe(0)
    expect(onContinue).not.toHaveBeenCalled()
  })
})

describe('pickChoice', () => {
  const card = (id: string) => {
    const found = EVENTS.events.find((event) => event.id === id)
    if (found === undefined) throw new Error(`No ${id}`)
    return found
  }

  it('plays the choice, then closes a notice at once (#160)', () => {
    const calls: string[] = []
    pickChoice(
      card('premierAvis'),
      'compris',
      (choice) => calls.push(`choose ${choice}`),
      () => calls.push('close'),
    )
    expect(calls).toEqual(['choose compris', 'close'])
  })

  it('plays the choice and leaves any other card open, to show what it did', () => {
    const choose = vi.fn()
    const close = vi.fn()
    pickChoice(card('pretUrgence'), 'refuser', choose, close)
    expect(choose).toHaveBeenCalledWith('refuser')
    expect(close).not.toHaveBeenCalled()
  })
})
